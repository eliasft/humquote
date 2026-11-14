// Pricing calculations, ported line for line from HUM.py and the Bulk Price Tracker
// page, with two intended changes (both pending in the Streamlit app):
//   - network energy charges apply per period (peak, shoulder, off-peak) instead of
//     charging all consumption at the peak rate;
//   - quotes are priced on 12-month contract periods (core/periods.ts) rather than
//     whichever FY strips ASX happens to list.
// test/parity.test.ts checks the rest against the Python app.

import { defaultNetwork, resolveTariffId, suggestTariff, tariffById, type Tariff, type Voltage } from './tariffs';

export const STATES = ['NSW', 'VIC', 'QLD', 'SA'] as const;
export type State = (typeof STATES)[number];

// A settle price ($/MWh) for each state.
export interface PriceRow {
  quoteDate: string;
  NSW: number;
  VIC: number;
  QLD: number;
  SA: number;
}

export interface FuturesRow extends PriceRow {
  year: number;
}

export interface QuoteInputs {
  totalConsumption: number;
  peakConsumption: number;
  shoulderConsumption: number;
  loadFactor: number;
  tariffId: string;
  // The site's connection voltage; tariffs are LV or HV.
  voltage: Voltage;
  peakCharge: number;
  offPeakCharge: number;
  shoulderCharge: number;
  // $/kVA/month for each demand charge on the tariff's bill (tariff.demand.lines).
  demandRates: number[];
  serviceAvailabilityCharge: number;
  aemoParticipantCharge: number;
  aemoAncillaryServicesCharge: number;
  srecCharge: number;
  lrecCharge: number;
  meteringCharge: number;
  retailServiceCharge: number;
  adminCharge: number;
  loadEscalation: number;
  retailEscalation: number;
  // 'auto' (the quarter after the ASX settlement date) or a quarter start, 'YYYY-MM'.
  supplyStart: string;
  // % a year applied to the last listed ASX contract for periods beyond it.
  carryForwardRate: number;
  // Network charges from the client's bill: each demand line's kVA (average of the
  // monthly figures on the last 12 bills; Ausgrid capacity: the 12-month maximum) and
  // the kWh in the network's peak, shoulder and off-peak windows. Off: every demand
  // line takes the estimated demand, and network energy uses the consumption shares.
  fromBill: boolean;
  billKva: number[];
  billKwh: number[];
}

// Fills in a tariff's network charges. Bill figures belong to the bill's own tariff
// (its demand lines and windows), so choosing a different tariff clears them.
export function applyTariff<T extends QuoteInputs>(inputs: T, tariff: Tariff): T {
  const same = inputs.tariffId === tariff.id;
  return {
    ...inputs,
    tariffId: tariff.id,
    peakCharge: tariff.energy.peak,
    offPeakCharge: tariff.energy.offPeak,
    shoulderCharge: tariff.energy.shoulder,
    demandRates: tariff.demand.lines.map((l) => l.rate),
    serviceAvailabilityCharge: tariff.fixed,
    ...(same ? {} : { fromBill: false, billKva: [], billKwh: [0, 0, 0] }),
  };
}

const sameNumbers = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// True when the network charges are still the tariff's own (not edited by hand).
export function tariffMatches(inputs: QuoteInputs): boolean {
  const t = tariffById(inputs.tariffId);
  return !!t && inputs.peakCharge === t.energy.peak && inputs.offPeakCharge === t.energy.offPeak
    && inputs.shoulderCharge === t.energy.shoulder && sameNumbers(inputs.demandRates, t.demand.lines.map((l) => l.rate))
    && inputs.serviceAvailabilityCharge === t.fixed;
}

// Names for the quote's demand charges: its tariff's bill lines ('Peak demand'), or
// 'Demand' when the rates were entered by hand for a different number of lines.
export function demandLineLabels(inputs: QuoteInputs): string[] {
  const lines = tariffById(inputs.tariffId)?.demand.lines ?? [];
  return inputs.demandRates.map((_, i) => (lines.length === inputs.demandRates.length ? lines[i].label : 'Demand'));
}

// The site's estimated monthly maximum demand (kVA): average load over the load factor.
export const estimatedDemand = (inputs: QuoteInputs) => inputs.totalConsumption / 8760 / inputs.loadFactor;

// The kVA each demand line is charged on: the bill's figure, or the estimate.
export const demandKva = (inputs: QuoteInputs): number[] => inputs.demandRates.map((_, i) => (
  inputs.fromBill ? inputs.billKva[i] ?? estimatedDemand(inputs) : estimatedDemand(inputs)));

// Turns on bill figures, starting from what the quote assumes now (so the price only
// changes as bill figures are entered): each demand line at the estimated demand, and
// the annual kWh split by the consumption shares, a share for a window the tariff
// doesn't have going to off-peak (which it's charged as).
export function startBill(inputs: QuoteInputs): QuoteInputs {
  const est = estimatedDemand(inputs);
  const billKva = inputs.demandRates.map((_, i) => inputs.billKva[i] ?? est);
  let billKwh = inputs.billKwh;
  if (!billKwh.some((v) => v > 0)) {
    const total = inputs.totalConsumption;
    const peak = total * inputs.peakConsumption / 100;
    const shoulder = total * inputs.shoulderConsumption / 100;
    const noShoulder = tariffById(inputs.tariffId)?.energyWindows?.shoulder === null;
    billKwh = [peak, noShoulder ? 0 : shoulder, total - peak - (noShoulder ? 0 : shoulder)];
  }
  return { ...inputs, fromBill: true, billKva, billKwh };
}

// The share of kWh in the network's peak, shoulder and off-peak windows: the bill's
// split when it has one, else the consumption shares.
export function networkShares(inputs: QuoteInputs): [number, number, number] {
  const total = inputs.billKwh.reduce((a, b) => a + b, 0);
  if (inputs.fromBill && total > 0) return [0, 1, 2].map((i) => (inputs.billKwh[i] ?? 0) / total) as [number, number, number];
  const peak = inputs.peakConsumption / 100;
  const shoulder = inputs.shoulderConsumption / 100;
  return [peak, shoulder, 1 - peak - shoulder];
}

// Carry-forward escalation for months beyond the last listed ASX contract: 2.5% a
// year, confirmed as the base case on 14 Nov 2026. Adjustable per quote and index.
export const DEFAULT_CARRY_FORWARD_RATE = 2.5;

export const DEFAULT_INPUTS: QuoteInputs = applyTariff({
  totalConsumption: 400000.00,
  peakConsumption: 50.00,
  shoulderConsumption: 0.00,
  loadFactor: 0.55,
  tariffId: '',
  voltage: 'LV',
  peakCharge: 0,
  offPeakCharge: 0,
  shoulderCharge: 0,
  demandRates: [],
  serviceAvailabilityCharge: 0,
  aemoParticipantCharge: 0.09910,
  aemoAncillaryServicesCharge: 0.09910,
  srecCharge: 1.09040,
  lrecCharge: 1.0000,
  meteringCharge: 100.00,
  retailServiceCharge: 0.00,
  adminCharge: 0.00,
  loadEscalation: 1.15,
  retailEscalation: 1.15,
  supplyStart: 'auto',
  carryForwardRate: DEFAULT_CARRY_FORWARD_RATE,
  fromBill: false,
  billKva: [],
  billKwh: [0, 0, 0],
}, suggestTariff(defaultNetwork('NSW').id, 400, 'LV'));

const ARRAY_KEYS = ['demandRates', 'billKva', 'billKwh'] as const;
const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

// Saved quotes and share links from before the tariff catalogue stored a preset
// name in `network` and had no contract inputs; fill the gaps from the defaults.
// Before demand lines, a quote had one demand rate (`nuosCharge`): the tariff's lines
// if it equals their sum, else one line at that rate.
export function migrateInputs(raw: Record<string, unknown>): QuoteInputs {
  const out = { ...DEFAULT_INPUTS } as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_INPUTS)) {
    if ((ARRAY_KEYS as readonly string[]).includes(key)) {
      if (isNumbers(raw[key])) out[key] = raw[key];
    } else if (raw[key] !== undefined && typeof raw[key] === typeof out[key]) out[key] = raw[key];
  }
  const legacy = typeof raw.network === 'string' ? resolveTariffId(raw.network) : undefined;
  if (legacy && raw.tariffId === undefined) out.tariffId = legacy;
  if (!tariffById(out.tariffId as string)) out.tariffId = resolveTariffId(out.tariffId as string) ?? DEFAULT_INPUTS.tariffId;
  const tariff = tariffById(out.tariffId as string)!;
  // Quotes from before the voltage input take their tariff's voltage.
  if (raw.voltage !== 'LV' && raw.voltage !== 'HV') out.voltage = tariff.voltage;
  if (!isNumbers(raw.demandRates)) {
    const lines = tariff.demand.lines.map((l) => l.rate);
    const nuos = raw.nuosCharge;
    out.demandRates = typeof nuos !== 'number' || nuos === tariff.demand.rate ? lines : [nuos];
  }
  const inputs = out as unknown as QuoteInputs;
  inputs.billKwh = [0, 1, 2].map((i) => inputs.billKwh[i] ?? 0);
  return inputs;
}

const TRANSMISSION_LOSS_FACTOR = 1.00860;
const DISTRIBUTION_LOSS_FACTOR = 1.04344;

// Python's round(): rounds the float's exact decimal value, ties to even. toFixed(100)
// gives that exact expansion, so escalated prices agree with HUM.py to the cent.
export function pyRound(value: number, digits: number): number {
  const sign = value < 0 ? '-' : '';
  const [intPart, frac] = Math.abs(value).toFixed(100).split('.');
  const kept = BigInt(intPart + frac.slice(0, digits));
  const rest = frac.slice(digits);

  let roundUp: boolean;
  if (rest[0] > '5') roundUp = true;
  else if (rest[0] < '5') roundUp = false;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else roundUp = kept % 2n === 1n;

  const digitsStr = (kept + (roundUp ? 1n : 0n)).toString().padStart(digits + 1, '0');
  const cut = digitsStr.length - digits;
  return Number(`${sign}${digitsStr.slice(0, cut)}.${digitsStr.slice(cut)}`);
}

// rows: [[quoteDate, year, NSW, VIC, QLD, SA], ...]
export function toRecords(rows: [string, number, number, number, number, number][]): FuturesRow[] {
  return rows.map(([quoteDate, year, NSW, VIC, QLD, SA]) => ({ quoteDate, year, NSW, VIC, QLD, SA }));
}

// Rows for the most recent Quote Date, ordered by Year (load_latest_futures in HUM.py).
export function latestFutures(records: FuturesRow[]): FuturesRow[] {
  if (!records.length) return [];
  const latest = records.reduce((max, r) => (r.quoteDate > max ? r.quoteDate : max), records[0].quoteDate);
  return records.filter((r) => r.quoteDate === latest).sort((a, b) => a.year - b.year);
}

// apply_escalation_and_format: $/MWh settle → escalated c/kWh peak price.
export function escalate<T extends PriceRow>(fetched: T[], loadEscalation: number, retailEscalation: number): T[] {
  return fetched.map((r) => {
    const out = { ...r };
    for (const s of STATES) out[s] = pyRound((r[s] / 10) * loadEscalation * retailEscalation, 2);
    return out;
  });
}

export interface SummaryRow {
  label: string;
  values: [number, number, number];
  average: number;
}

export interface SummaryTable {
  labelHeader: string;
  rows: SummaryRow[];
}

function table(labelHeader: string, labels: string[]): SummaryTable {
  return { labelHeader, rows: labels.map((label) => ({ label, values: [0, 0, 0], average: 0 })) };
}

function setAverages(t: SummaryTable) {
  for (const row of t.rows) row.average = (row.values[0] + row.values[1] + row.values[2]) / 3;
}

export interface QuoteResult {
  updated: PriceRow[];
  energyRates: SummaryTable;
  consumption: SummaryTable;
  charges: SummaryTable;
  costs: SummaryTable;
  rates: SummaryTable;
  bulkPrice: number;
}

// calculate_bulk_prices: returns the five summary tables and the bulk price ($/kWh).
export function calculateBulkPrices(fetched: PriceRow[], inputs: QuoteInputs, state: State): QuoteResult {
  const updated = escalate(fetched, inputs.loadEscalation, inputs.retailEscalation);
  const offPeakConsumptionPct = 100 - inputs.peakConsumption - inputs.shoulderConsumption;

  const energyRates = table('Tariffs & Factors', [
    'Peak Tariff (c/kWh)',
    'Shoulder Tariff (c/kWh)',
    'Off Peak Tariff (c/kWh)',
    'Transmission Loss Factor',
    'Distribution Loss Factor',
    'Net Loss Factor (NLF)',
    'Peak Tariff (Adj for Losses) (c/kWh)',
    'Shoulder Tariff (Adj for Losses) (c/kWh)',
    'Off Peak Tariff (Adj for Losses) (c/kWh)',
  ]);
  const consumption = table('Energy Consumption', [
    'Total Consumption (kWh)',
    'Peak Consumption (kWh)',
    'Shoulder Consumption (kWh)',
    'Off Peak Consumption (kWh)',
    'Load Factor',
    'Avg. Monthly Peak Demand (kVA)',
  ]);
  const charges = table('Costs per Unit', [
    'Peak Energy Charge (c/kWh)',
    'Shoulder Energy Charge (c/kWh)',
    'Off Peak Energy Charge (c/kWh)',
    'Peak Demand Charge ($/kVA)',
    'Network Volume Charge (avg c/kWh)',
    'Other Volume Charge (c/kWh)',
    'Fixed Charge ($/day)',
  ]);
  const costs = table('Annual Costs', [
    'Peak Energy Costs ($/year)',
    'Shoulder Energy Costs ($/year)',
    'Off Peak Energy Costs ($/year)',
    'Peak Demand Costs ($/year)',
    'Network Volume Costs ($/year)',
    'Other Volume Costs ($/year)',
    'Fixed Costs ($/year)',
    'Total Costs ($/year)',
    'kWh/year',
    'Bundled Bulk Cost ($/kWh)',
  ]);
  const rates = table('Rates Summary', [
    'Energy ($/kWh)',
    'Network ($/kWh)',
    'Other ($/kWh)',
    'Fixed ($/kWh)',
    'Total ($/kWh)',
  ]);

  if (fetched.length) {
    // Year 3 falls back to the last row when fewer than 3 are given (contract
    // periods always supply 3; kept for the legacy FY-row callers).
    const numAvailable = updated.length;

    for (let year = 1; year <= 3; year++) {
      const i = Math.min(year - 1, numAvailable - 1);
      const y = year - 1;

      const peakRate = updated[i][state];
      const shoulderRate = updated[i][state];
      const offPeakRate = fetched[i][state] / 10;

      const netLossFactor = TRANSMISSION_LOSS_FACTOR * DISTRIBUTION_LOSS_FACTOR;
      const peakEnergyAdj = peakRate * netLossFactor;
      const shoulderEnergyAdj = shoulderRate * netLossFactor;
      const offPeakEnergyAdj = offPeakRate * netLossFactor;

      [peakRate, shoulderRate, offPeakRate, TRANSMISSION_LOSS_FACTOR, DISTRIBUTION_LOSS_FACTOR,
        netLossFactor, peakEnergyAdj, shoulderEnergyAdj, offPeakEnergyAdj]
        .forEach((v, r) => { energyRates.rows[r].values[y] = v; });

      const total = inputs.totalConsumption;
      // Demand: each line's rate on its kVA. With every line on the estimate this is
      // the estimate times the summed rate; with bill figures, the rate-weighted kVA.
      const demandRate = inputs.demandRates.reduce((a, b) => a + b, 0);
      const kva = demandKva(inputs);
      const lineCosts = inputs.demandRates.reduce((sum, rate, i) => sum + rate * kva[i], 0);
      const peakDemand = inputs.fromBill && demandRate > 0 ? lineCosts / demandRate : estimatedDemand(inputs);
      const peakConsumption = total * (inputs.peakConsumption / 100);
      const shoulderConsumption = total * (inputs.shoulderConsumption / 100);
      const offPeakConsumption = total * (offPeakConsumptionPct / 100);

      [total, peakConsumption, shoulderConsumption, offPeakConsumption, inputs.loadFactor, peakDemand]
        .forEach((v, r) => { consumption.rows[r].values[y] = v; });

      const peakVolume = demandRate;
      // Each of the network's windows pays its own rate, on the bill's split of kWh or
      // else the consumption shares; a flat tariff (all three equal) reduces to one
      // rate on all consumption, as in HUM.py.
      const flatNetwork = inputs.peakCharge === inputs.shoulderCharge && inputs.shoulderCharge === inputs.offPeakCharge;
      const [netPeak, netShoulder, netOffPeak] = networkShares(inputs);
      const networkVolumeCosts = flatNetwork
        ? total * (inputs.peakCharge / 100)
        : inputs.fromBill
          ? total * (netPeak * inputs.peakCharge + netShoulder * inputs.shoulderCharge + netOffPeak * inputs.offPeakCharge) / 100
          : (peakConsumption * inputs.peakCharge + shoulderConsumption * inputs.shoulderCharge
            + offPeakConsumption * inputs.offPeakCharge) / 100;
      const networkVolume = flatNetwork ? inputs.peakCharge : (networkVolumeCosts / total) * 100;
      const otherVolume = inputs.aemoParticipantCharge + inputs.aemoAncillaryServicesCharge
        + inputs.srecCharge + inputs.lrecCharge;
      const fixed = inputs.serviceAvailabilityCharge
        + ((inputs.meteringCharge + inputs.retailServiceCharge + inputs.adminCharge) / 30);

      [peakEnergyAdj, shoulderEnergyAdj, offPeakEnergyAdj, peakVolume, networkVolume, otherVolume, fixed]
        .forEach((v, r) => { charges.rows[r].values[y] = v; });

      const peakEnergyCosts = peakConsumption * (peakEnergyAdj / 100);
      const shoulderEnergyCosts = shoulderConsumption * (shoulderEnergyAdj / 100);
      const offPeakEnergyCosts = offPeakConsumption * (offPeakEnergyAdj / 100);
      const peakDemandCosts = peakDemand * peakVolume * 12;
      const otherVolumeCosts = total * (otherVolume / 100);
      const fixedCosts = fixed * 365;
      const totalCosts = peakEnergyCosts + shoulderEnergyCosts + offPeakEnergyCosts + peakDemandCosts
        + networkVolumeCosts + otherVolumeCosts + fixedCosts;
      const bundledCost = totalCosts / total;

      [peakEnergyCosts, shoulderEnergyCosts, offPeakEnergyCosts, peakDemandCosts, networkVolumeCosts,
        otherVolumeCosts, fixedCosts, totalCosts, total, bundledCost]
        .forEach((v, r) => { costs.rows[r].values[y] = v; });

      const energy = (peakEnergyCosts + shoulderEnergyCosts + offPeakEnergyCosts) / total;
      const network = (peakDemandCosts + networkVolumeCosts) / total;
      const other = otherVolumeCosts / total;
      const fixedRate = fixedCosts / total;
      const totalRate = energy + network + other + fixedRate;

      [energy, network, other, fixedRate, totalRate]
        .forEach((v, r) => { rates.rows[r].values[y] = v; });
    }
  }

  for (const t of [energyRates, consumption, charges, costs, rates]) setAverages(t);

  return { updated, energyRates, consumption, charges, costs, rates, bulkPrice: rates.rows[4].average };
}

// SQLite's SUM/AVG use Kahan-Babuska-Neumaier summation; match it to the last digit.
function sqliteSum(values: number[]): number {
  let sum = 0;
  let err = 0;
  for (const v of values) {
    const t = sum + v;
    if (Math.abs(sum) >= Math.abs(v)) err += (sum - t) + v;
    else err += (v - t) + sum;
    sum = t;
  }
  return sum + err;
}

export interface IndexPoint {
  quoteDate: string;
  NSW: number;
  VIC: number;
  QLD: number;
  SA: number;
}

// calculate_bulk_price_index (Bulk Price Tracker page), kept as the "Original method":
// one index per Quote Date and state, using fixed reference inputs and the average
// settle price across whichever years were listed that day. See analysis.ts for the
// current method.
export function legacyBulkPriceIndex(records: FuturesRow[]): IndexPoint[] {
  const byDate = new Map<string, FuturesRow[]>();
  for (const r of records) {
    if (!byDate.has(r.quoteDate)) byDate.set(r.quoteDate, []);
    byDate.get(r.quoteDate)!.push(r);
  }

  const totalConsumption = 400000;
  const peakConsumption = totalConsumption * 0.50;
  const offPeakConsumption = totalConsumption * 0.50;
  const netLossFactor = TRANSMISSION_LOSS_FACTOR * DISTRIBUTION_LOSS_FACTOR;
  const loadFactor = 0.55;
  const peakDemand = totalConsumption / 8760 / loadFactor;

  const peakVolume = 14.67;
  const networkVolume = 0.96;
  const ancillary = 0.09910;
  const participant = 0.09910;
  const srec = 1.09040;
  const lrec = 1.0000;
  const service = 5.38;
  const metering = 100.00;
  const retail = 0.00;
  const admin = 0.00;

  const out: IndexPoint[] = [];
  for (const [quoteDate, rows] of byDate) {
    const entry = { quoteDate } as IndexPoint;
    for (const state of STATES) {
      const avg = sqliteSum(rows.map((r) => r[state])) / rows.length;
      const peakRate = avg / 10;
      const offPeakRate = peakRate * 0.85;

      const peakEnergyAdj = peakRate * netLossFactor;
      const offPeakEnergyAdj = offPeakRate * netLossFactor;

      const peakEnergyCosts = peakConsumption * (peakEnergyAdj / 100);
      const offPeakEnergyCosts = offPeakConsumption * (offPeakEnergyAdj / 100);
      const peakDemandCosts = peakDemand * peakVolume * 12;
      const networkVolumeCosts = totalConsumption * networkVolume / 100;
      const otherVolumeCosts = totalConsumption * (ancillary + participant + srec + lrec) / 100;
      const fixedCosts = (service + ((metering + retail + admin) / 30)) * 365;

      const energy = (peakEnergyCosts + offPeakEnergyCosts) / totalConsumption;
      const network = (peakDemandCosts + networkVolumeCosts) / totalConsumption;
      const other = otherVolumeCosts / totalConsumption;
      const fixed = fixedCosts / totalConsumption;
      entry[state] = energy + network + other + fixed;
    }
    out.push(entry);
  }
  return out.sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1));
}

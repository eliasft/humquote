// Features built on top of the core calculation: contract pricing for a date,
// quote history, state comparison, sensitivity, the bulk price index and input
// validation.

import {
  DEFAULT_INPUTS, STATES, applyTariff, calculateBulkPrices,
  type PriceRow, type QuoteInputs, type State,
} from './calc';
import { nextQuarter, priceContract, resolveStart, type Contract, type Estimate, type PeriodRow } from './periods';
import { defaultNetwork, fitIssues, suggestTariff, tariffById, tariffState } from './tariffs';

export const STATE_ORDER: State[] = ['NSW', 'QLD', 'VIC', 'SA'];

// The three contract periods a quote prices on a given date.
export function quotePeriods(curve: Contract[], inputs: QuoteInputs): PeriodRow[] {
  if (!curve.length) return [];
  return priceContract(curve, resolveStart(inputs.supplyStart, curve[0].quoteDate), inputs.carryForwardRate);
}

// The inputs to use for another state: the tariff its default network suggests for
// this site, unless the current tariff already belongs to that state.
export function inputsForState(inputs: QuoteInputs, state: State): QuoteInputs {
  if (tariffState(inputs.tariffId) === state) return inputs;
  return applyTariff(inputs, suggestTariff(defaultNetwork(state).id, inputs.totalConsumption / 1000, inputs.voltage));
}

export interface HistoryPoint {
  quoteDate: string;
  price: number;
  estimates: Estimate[];
}

// The quote priced on every settlement date. Each date prices a contract starting
// the quarter after it, so every point is a like-for-like three-year forward price.
export function quoteHistory(curves: Map<string, Contract[]>, inputs: QuoteInputs, state: State): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const [quoteDate, curve] of curves) {
    const periods = priceContract(curve, nextQuarter(quoteDate), inputs.carryForwardRate);
    out.push({ quoteDate, price: calculateBulkPrices(periods, inputs, state).bulkPrice, estimates: unionEstimates(periods) });
  }
  return out;
}

export const unionEstimates = (periods: PeriodRow[]): Estimate[] => [...new Set(periods.flatMap((p) => p.estimates))];

export function compareStates(periods: PeriodRow[], inputs: QuoteInputs) {
  return STATE_ORDER.map((state) => {
    const stateInputs = inputsForState(inputs, state);
    return { state, inputs: stateInputs, result: calculateBulkPrices(periods, stateInputs, state) };
  });
}

// ── Bulk price index ─────────────────────────────────────────────────────────

export interface IndexPoint2 {
  quoteDate: string;
  prices: Record<State, number>;
  // Energy, network, other and fixed, $/kWh (three-year averages).
  components: Record<State, [number, number, number, number]>;
  estimates: Estimate[];
}

// Reference customer: the default quote (400,000 kWh, 50% peak, load factor 0.55, low
// voltage, default system/service charges and escalation) on the tariff each state's
// default network suggests for it. Confirmed as right for now (PLACEHOLDERS.md).
export const indexInputs = (state: State): QuoteInputs => inputsForState({ ...DEFAULT_INPUTS, tariffId: '' }, state);

// Current method: on every settlement date, the reference customer's price for a
// three-year contract starting the next quarter. A fixed forward window, so the
// index doesn't jump when ASX adds or drops a contract year. Network charges are
// this year's tariffs on every date until historical tariffs are added.
export function bulkPriceIndex(curves: Map<string, Contract[]>, carryRate = DEFAULT_INPUTS.carryForwardRate): IndexPoint2[] {
  const inputs = Object.fromEntries(STATES.map((s) => [s, indexInputs(s)])) as Record<State, QuoteInputs>;
  const out: IndexPoint2[] = [];
  for (const [quoteDate, curve] of curves) {
    const periods = priceContract(curve, nextQuarter(quoteDate), carryRate);
    const point = { quoteDate, prices: {}, components: {}, estimates: unionEstimates(periods) } as IndexPoint2;
    for (const s of STATES) {
      const r = calculateBulkPrices(periods, inputs[s], s);
      point.prices[s] = r.bulkPrice;
      point.components[s] = [0, 1, 2, 3].map((i) => r.rates.rows[i].average) as [number, number, number, number];
    }
    out.push(point);
  }
  return out;
}

// ── Sensitivity ──────────────────────────────────────────────────────────────

function scaleFutures(fetched: PriceRow[], factor: number): PriceRow[] {
  return fetched.map((r) => {
    const out = { ...r };
    for (const s of STATES) out[s] = r[s] * factor;
    return out;
  });
}

export interface Driver {
  key: string;
  label: string;
  low: number;
  high: number;
  spread: number;
}

interface DriverSpec {
  key: string;
  label: string;
  apply: (inputs: QuoteInputs, f: number) => QuoteInputs;
  futures?: boolean;
}

const DRIVERS: DriverSpec[] = [
  { key: 'futures', label: 'ASX futures prices', apply: (i) => i, futures: true },
  { key: 'loadEscalation', label: 'Load escalation', apply: (i, f) => ({ ...i, loadEscalation: i.loadEscalation * f }) },
  { key: 'retailEscalation', label: 'Retail escalation', apply: (i, f) => ({ ...i, retailEscalation: i.retailEscalation * f }) },
  {
    key: 'peakConsumption', label: 'Peak share',
    apply: (i, f) => ({ ...i, peakConsumption: Math.min(100 - i.shoulderConsumption, i.peakConsumption * f) }),
  },
  { key: 'loadFactor', label: 'Load factor', apply: (i, f) => ({ ...i, loadFactor: i.loadFactor * f }) },
  {
    key: 'networkEnergy', label: 'Network energy charges',
    apply: (i, f) => ({ ...i, peakCharge: i.peakCharge * f, shoulderCharge: i.shoulderCharge * f, offPeakCharge: i.offPeakCharge * f }),
  },
  { key: 'nuosCharge', label: 'NUOS charge', apply: (i, f) => ({ ...i, nuosCharge: i.nuosCharge * f }) },
  {
    key: 'system', label: 'System charges',
    apply: (i, f) => ({
      ...i,
      aemoParticipantCharge: i.aemoParticipantCharge * f,
      aemoAncillaryServicesCharge: i.aemoAncillaryServicesCharge * f,
      srecCharge: i.srecCharge * f,
      lrecCharge: i.lrecCharge * f,
    }),
  },
  {
    key: 'fixed', label: 'Fixed charges',
    apply: (i, f) => ({
      ...i,
      serviceAvailabilityCharge: i.serviceAvailabilityCharge * f,
      meteringCharge: i.meteringCharge * f,
      retailServiceCharge: i.retailServiceCharge * f,
      adminCharge: i.adminCharge * f,
    }),
  },
  { key: 'totalConsumption', label: 'Annual consumption', apply: (i, f) => ({ ...i, totalConsumption: i.totalConsumption * f }) },
];

// Price at -pct and +pct for each driver, largest effect first. Drivers with no effect
// are dropped. The carry-forward rate is handled by the caller, since it changes the
// periods rather than the inputs to the calculation.
export function sensitivity(fetched: PriceRow[], inputs: QuoteInputs, state: State, pct = 10): { base: number; drivers: Driver[] } {
  const base = calculateBulkPrices(fetched, inputs, state).bulkPrice;
  const lo = 1 - pct / 100;
  const hi = 1 + pct / 100;
  const price = (spec: DriverSpec, f: number) => (spec.futures
    ? calculateBulkPrices(scaleFutures(fetched, f), inputs, state).bulkPrice
    : calculateBulkPrices(fetched, spec.apply(inputs, f), state).bulkPrice);

  const drivers = DRIVERS.map((spec) => {
    const low = price(spec, lo);
    const high = price(spec, hi);
    return { key: spec.key, label: spec.label, low, high, spread: Math.abs(high - low) };
  }).filter((d) => d.spread > 1e-9);
  drivers.sort((a, b) => b.spread - a.spread);
  return { base, drivers };
}

// ── Validation and warnings ──────────────────────────────────────────────────

export type InputIssue = { field: keyof QuoteInputs; message: string };

export function validateInputs(i: QuoteInputs): InputIssue[] {
  const issues: InputIssue[] = [];
  if (!(i.totalConsumption > 0)) issues.push({ field: 'totalConsumption', message: 'Annual consumption must be more than zero.' });
  if (i.peakConsumption + i.shoulderConsumption > 100) {
    issues.push({ field: 'shoulderConsumption', message: 'Peak and shoulder shares add up to more than 100%.' });
  }
  if (!(i.loadFactor > 0 && i.loadFactor <= 1)) issues.push({ field: 'loadFactor', message: 'Load factor should be between 0 and 1.' });
  if (!(i.loadEscalation > 0)) issues.push({ field: 'loadEscalation', message: 'Load escalation must be more than zero.' });
  if (!(i.retailEscalation > 0)) issues.push({ field: 'retailEscalation', message: 'Retail escalation must be more than zero.' });
  if (!(i.carryForwardRate > -100)) issues.push({ field: 'carryForwardRate', message: 'Carry-forward escalation must be more than −100%.' });
  return issues;
}

export type QuoteWarning = { kind: 'mismatch' | 'eligibility' | 'placeholder' | 'estimate'; message: string };

// Things a quote should flag rather than block: a tariff from another state, one that
// doesn't fit the site's voltage or size, a placeholder tariff, or contract periods
// that aren't fully priced from ASX.
export function quoteWarnings(inputs: QuoteInputs, state: State, periods: PeriodRow[]): QuoteWarning[] {
  const out: QuoteWarning[] = [];
  const t = tariffById(inputs.tariffId);
  const tState = tariffState(inputs.tariffId);
  if (tState && tState !== state) {
    out.push({ kind: 'mismatch', message: `The network tariff is for ${tState}, but the quote is for ${state}.` });
  }
  if (t) {
    for (const message of fitIssues(t, inputs.totalConsumption / 1000, inputs.voltage)) out.push({ kind: 'eligibility', message });
  }
  if (t?.status === 'placeholder') {
    out.push({ kind: 'placeholder', message: 'The network tariff is a placeholder, not a researched tariff. Network charges are indicative only.' });
  }
  periods.forEach((p, i) => {
    if (p.note) out.push({ kind: 'estimate', message: `Year ${i + 1} (${p.label}): ${p.note}.` });
  });
  return out;
}

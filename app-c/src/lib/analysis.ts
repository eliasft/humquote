// Features built on top of the core calculation: quote history, sensitivity,
// state comparison and input validation.

import {
  calculateBulkPrices, STATES,
  type FuturesRow, type QuoteInputs, type State,
} from './calc';

export const STATE_ORDER: State[] = ['NSW', 'QLD', 'VIC', 'SA'];

export function groupByDate(records: FuturesRow[]): Map<string, FuturesRow[]> {
  const byDate = new Map<string, FuturesRow[]>();
  for (const r of records) {
    if (!byDate.has(r.quoteDate)) byDate.set(r.quoteDate, []);
    byDate.get(r.quoteDate)!.push(r);
  }
  for (const rows of byDate.values()) rows.sort((a, b) => a.year - b.year);
  return byDate;
}

export interface HistoryPoint {
  quoteDate: string;
  price: number;
}

// The quote's price ($/kWh) on every settlement date, using that date's FY strips.
export function quoteHistory(byDate: Map<string, FuturesRow[]>, inputs: QuoteInputs, state: State): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const [quoteDate, rows] of byDate) out.push({ quoteDate, price: calculateBulkPrices(rows, inputs, state).bulkPrice });
  return out.sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1));
}

export function compareStates(fetched: FuturesRow[], inputs: QuoteInputs) {
  return STATE_ORDER.map((state) => ({ state, result: calculateBulkPrices(fetched, inputs, state) }));
}

function scaleFutures(fetched: FuturesRow[], factor: number): FuturesRow[] {
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
  { key: 'peakCharge', label: 'Network peak charge', apply: (i, f) => ({ ...i, peakCharge: i.peakCharge * f }) },
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

// Price at -pct and +pct for each driver, largest effect first. Drivers with no effect are dropped.
export function sensitivity(fetched: FuturesRow[], inputs: QuoteInputs, state: State, pct = 10): { base: number; drivers: Driver[] } {
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
  return issues;
}

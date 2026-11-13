// Contract periods: a quote covers three 12-month supply periods from a supply start
// (a quarter start). Each period is priced from the ASX contracts quoted that day:
//   1. an annual strip (CY or FY) covering exactly that period; otherwise
//   2. quarter by quarter: the quarterly contract, else the annual strip that covers
//      the quarter (the one overlapping the period most), and the four averaged.
// Quarters beyond the last listed contract are carried forward from it with an
// escalation rate; quarters before the first are back-filled from the earliest.
// Both are flagged as estimates wherever they're shown.

import { STATES, type FuturesRow, type PriceRow } from './calc';

export type Estimate = 'carried' | 'backfilled';

export interface Contract extends PriceRow {
  contract: string; // 'Q1 2027', 'CY2027', 'FY2028'
  start: number;    // month index (see monthIndex)
  months: number;   // 3 or 12
}

export interface QuarterPrice extends PriceRow {
  start: number;
  source: string;
  estimate?: Estimate;
}

export interface PeriodRow extends PriceRow {
  label: string;              // 'CY27', 'FY28' or 'Apr 27–Mar 28'
  start: number;
  sources: string[];          // contracts the price comes from
  estimates: Estimate[];      // empty when every quarter is an ASX price
  quarters: QuarterPrice[] | null; // null when one annual strip covers the period
  note?: string;              // how any estimate was made
}

// [quoteDate, contract, start 'YYYY-MM', months, NSW, VIC, QLD, SA]
export type StripRow = [string, string, string, number, number, number, number, number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Months since year 0: '2027-01' → 2027 * 12. Quarter starts are multiples of 3.
export const monthIndex = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + m - 1;
};
export const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
export const monthLabel = (i: number) => `${MONTHS[i % 12]} ${Math.floor(i / 12)}`;
const shortMonth = (i: number) => `${MONTHS[i % 12]} ${String(Math.floor(i / 12)).slice(-2)}`;
export const periodRange = (start: number, months = 12) => `${monthLabel(start)} – ${monthLabel(start + months - 1)}`;

// 'FY2028' → 'FY28', 'CY2027' → 'CY27', 'Q1 2027' → 'Q1 27'
export const shortContract = (c: string) => c.replace(/(\d{2})(\d{2})$/, '$2');

// The first quarter that starts after the settlement date.
export const nextQuarter = (quoteDate: string) => (Math.floor(monthIndex(quoteDate.slice(0, 7)) / 3) + 1) * 3;

export function resolveStart(supplyStart: string, quoteDate: string): number {
  if (supplyStart === 'auto' || !/^\d{4}-\d{2}$/.test(supplyStart)) return nextQuarter(quoteDate);
  return Math.floor(monthIndex(supplyStart) / 3) * 3;
}

export function fyContract(r: FuturesRow): Contract {
  return { quoteDate: r.quoteDate, NSW: r.NSW, VIC: r.VIC, QLD: r.QLD, SA: r.SA, contract: `FY${r.year}`, start: (r.year - 1) * 12 + 6, months: 12 };
}

// Every contract quoted on each date: the FY history plus the quarterly and CY
// contracts collected since 13 Nov 2026. Sorted by start, then length.
export function buildCurves(records: FuturesRow[], strips: StripRow[] = []): Map<string, Contract[]> {
  const byDate = new Map<string, Map<string, Contract>>();
  const add = (c: Contract) => {
    if (!byDate.has(c.quoteDate)) byDate.set(c.quoteDate, new Map());
    byDate.get(c.quoteDate)!.set(c.contract, c);
  };
  for (const r of records) add(fyContract(r));
  for (const [quoteDate, contract, start, months, NSW, VIC, QLD, SA] of strips) {
    add({ quoteDate, contract, start: monthIndex(start), months, NSW, VIC, QLD, SA });
  }
  const out = new Map<string, Contract[]>();
  for (const date of [...byDate.keys()].sort()) {
    out.set(date, [...byDate.get(date)!.values()].sort((a, b) => a.start - b.start || a.months - b.months));
  }
  return out;
}

const scaled = (c: PriceRow, f: number): PriceRow => {
  const out = { quoteDate: c.quoteDate } as PriceRow;
  for (const s of STATES) out[s] = c[s] * f;
  return out;
};

function priceQuarter(curve: Contract[], q: number, periodStart: number, carryRate: number): QuarterPrice {
  const quarter = curve.find((c) => c.months === 3 && c.start === q);
  if (quarter) return { ...scaled(quarter, 1), start: q, source: quarter.contract };

  const overlap = (c: Contract) => Math.min(c.start + 12, periodStart + 12) - Math.max(c.start, periodStart);
  const annual = curve.filter((c) => c.months === 12 && c.start <= q && q < c.start + 12)
    .sort((a, b) => overlap(b) - overlap(a))[0];
  if (annual) return { ...scaled(annual, 1), start: q, source: annual.contract };

  const last = curve.reduce((a, b) => (b.start + b.months > a.start + a.months || (b.start + b.months === a.start + a.months && b.months > a.months) ? b : a));
  if (q >= last.start + last.months) {
    const years = Math.max(1, Math.floor((q - last.start) / 12));
    return { ...scaled(last, (1 + carryRate / 100) ** years), start: q, source: last.contract, estimate: 'carried' };
  }
  const next = curve.find((c) => c.start > q) ?? last;
  return { ...scaled(next, 1), start: q, source: next.contract, estimate: 'backfilled' };
}

// Three 12-month periods from `start`, priced from one day's curve.
export function priceContract(curve: Contract[], start: number, carryRate: number, years = 3): PeriodRow[] {
  if (!curve.length) return [];
  const quoteDate = curve[0].quoteDate;
  const out: PeriodRow[] = [];
  for (let y = 0; y < years; y++) {
    const ps = start + y * 12;
    const exact = curve.find((c) => c.months === 12 && c.start === ps);
    if (exact) {
      out.push({ ...scaled(exact, 1), quoteDate, label: shortContract(exact.contract), start: ps, sources: [exact.contract], estimates: [], quarters: null });
      continue;
    }
    const quarters = [0, 3, 6, 9].map((m) => priceQuarter(curve, ps + m, ps, carryRate));
    const row = { quoteDate } as PeriodRow;
    for (const s of STATES) row[s] = quarters.reduce((a, q) => a + q[s], 0) / 4;
    const estimates = [...new Set(quarters.flatMap((q) => (q.estimate ? [q.estimate] : [])))];
    const notes: string[] = [];
    const carried = quarters.filter((q) => q.estimate === 'carried');
    const backfilled = quarters.filter((q) => q.estimate === 'backfilled');
    if (carried.length) {
      notes.push(`${carried.length} of 4 quarters carried forward from ${shortContract(carried[0].source)} at ${carryRate}% a year`);
    }
    if (backfilled.length) {
      notes.push(`${backfilled.length} of 4 quarters back-filled from ${shortContract(backfilled[0].source)} (no ASX price listed for them)`);
    }
    out.push({
      ...row,
      label: `${shortMonth(ps)}–${shortMonth(ps + 11)}`,
      start: ps,
      sources: [...new Set(quarters.map((q) => q.source))],
      estimates,
      quarters,
      note: notes.length ? notes.join('; ') : undefined,
    });
  }
  return out;
}

export const estimateLabel = (e: Estimate) => (e === 'carried' ? 'Carried forward' : 'Back-filled');

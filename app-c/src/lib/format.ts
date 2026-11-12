export const num = (v: number, dp: number, group = true) => (Number.isFinite(v)
  ? v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: group })
  : '—');

export const money = (v: number, dp: number) => (Number.isFinite(v) ? `${v < 0 ? '−' : ''}$${num(Math.abs(v), dp)}` : '—');

export const signed = (v: number, dp: number, prefix = '') =>
  `${v > 0 ? '+' : v < 0 ? '−' : '±'}${prefix}${num(Math.abs(v), dp)}`;

export const pct = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v), dp)}%`;

// Python's str(float), so CSV exports match the Streamlit app byte for byte.
export const pyStr = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const fy = (year: number) => `FY${String(year).slice(-2)}`;

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const longDate = (iso: string) =>
  parseDate(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const shortDate = (iso: string) =>
  parseDate(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

export function daysBetween(a: string, b: Date): number {
  const d = new Date(b);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - parseDate(a).getTime()) / 86_400_000);
}

export const RANGES = [['3M', 3], ['6M', 6], ['1Y', 12], ['2Y', 24], ['All', null]] as const;
export type RangeKey = (typeof RANGES)[number][0];

export function cutoffFor(range: RangeKey, latest: string | null): string | null {
  const months = RANGES.find(([k]) => k === range)?.[1];
  if (!months || !latest) return null;
  const d = parseDate(latest);
  d.setMonth(d.getMonth() - months);
  return isoDate(d);
}

export function valueOnOrBefore<T extends { quoteDate: string }>(series: T[], iso: string, get: (t: T) => number): number | undefined {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].quoteDate <= iso) return get(series[i]);
  return undefined;
}

export function daysAgo(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

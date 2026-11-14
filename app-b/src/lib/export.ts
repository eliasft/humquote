// CSV and Excel exports. The CSV builders are pure so test/parity.test.ts can check
// them byte for byte against the Streamlit app's pandas output.

import { STATES, demandKva, demandLineLabels, type FuturesRow, type IndexPoint, type QuoteInputs, type QuoteResult, type State, pyRound } from '@/core/calc';
import type { IndexPoint2, QuoteWarning } from '@/core/analysis';
import { estimateLabel, groupByKind, monthKey, monthLabel, periodRange, type Contract, type PeriodRow } from '@/core/periods';
import { tariffById, tariffLabel } from '@/core/tariffs';
import { pyStr } from './format';

// pandas pivot orders the state columns alphabetically.
const INDEX_COLS = ['NSW', 'QLD', 'SA', 'VIC'] as const;

const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.join(',')).join('\n') + '\n';

// Original method, identical to the Streamlit Bulk Price Tracker download.
export function bulkIndexCsv(index: IndexPoint[]): string {
  const desc = [...index].reverse();
  return toCsv([['Quote Date', ...INDEX_COLS], ...desc.map((d) => [d.quoteDate, ...INDEX_COLS.map((c) => pyStr(d[c]))])]);
}

// Current method: price per state, its components, and which dates include estimates.
export function bulkIndex2Csv(index: IndexPoint2[]): string {
  const cols = ['NSW', 'QLD', 'SA', 'VIC'] as const;
  const parts = ['energy', 'network', 'other', 'fixed'];
  const head = ['Quote Date', ...cols, ...cols.flatMap((c) => parts.map((p) => `${c} ${p}`)), 'Estimated periods'];
  const desc = [...index].reverse();
  return toCsv([head, ...desc.map((d) => [
    d.quoteDate,
    ...cols.map((c) => pyStr(d.prices[c])),
    ...cols.flatMap((c) => d.components[c].map(pyStr)),
    d.estimates.map(estimateLabel).join(' + '),
  ])]);
}

// Rows in the order the database returns them: newest date first, then newest contract year.
export function futuresCsv(records: FuturesRow[]): string {
  return toCsv([['Quote Date', 'Year', ...STATES], ...records.map((r) => [r.quoteDate, r.year, ...STATES.map((s) => pyStr(r[s]))])]);
}

// Every contract on every date, newest date first, then FY, CY and quarters.
export function allContractsCsv(curves: Map<string, Contract[]>): string {
  const rows: (string | number)[][] = [];
  for (const [date, curve] of [...curves].reverse()) {
    for (const g of groupByKind(curve)) {
      for (const c of g.contracts) rows.push([date, c.contract, g.kind, monthKey(c.start), c.months, ...STATES.map((s) => pyStr(c[s]))]);
    }
  }
  return toCsv([['Quote Date', 'Contract', 'Type', 'Start', 'Months', ...STATES], ...rows]);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadCsv = (filename: string, csv: string) => downloadBlob(filename, new Blob([csv], { type: 'text/csv' }));

const INPUT_LABELS: [keyof QuoteInputs, string][] = [
  ['totalConsumption', 'Annual consumption (kWh)'],
  ['peakConsumption', 'Peak share (%)'],
  ['shoulderConsumption', 'Shoulder share (%)'],
  ['loadFactor', 'Load factor'],
  ['voltage', 'Connection voltage'],
  ['tariffId', 'Network tariff'],
  ['peakCharge', 'Network peak charge (c/kWh)'],
  ['offPeakCharge', 'Network off-peak charge (c/kWh)'],
  ['shoulderCharge', 'Network shoulder charge (c/kWh)'],
  ['demandRates', 'Network demand charges ($/kVA/month)'],
  ['serviceAvailabilityCharge', 'Service availability charge ($/day)'],
  ['aemoParticipantCharge', 'AEMO participant charge (c/kWh)'],
  ['aemoAncillaryServicesCharge', 'AEMO ancillary services charge (c/kWh)'],
  ['srecCharge', 'SREC charge (c/kWh)'],
  ['lrecCharge', 'LREC charge (c/kWh)'],
  ['meteringCharge', 'Metering charge ($/month)'],
  ['retailServiceCharge', 'Retail service charge ($/month)'],
  ['adminCharge', 'Admin charge ($/month)'],
  ['loadEscalation', 'Load escalation factor'],
  ['retailEscalation', 'Retail escalation factor'],
  ['supplyStart', 'Supply start'],
  ['carryForwardRate', 'Carry-forward escalation (% a year)'],
  ['fromBill', 'Network charges from the bill'],
  ['billKva', 'Bill demand (kVA)'],
  ['billKwh', 'Bill energy by network window (kWh)'],
];

const n = (v: number, dp = 4) => Number(v.toFixed(dp)).toLocaleString('en-AU', { maximumFractionDigits: dp });

// An input's value as people read it: tariff names, supply start month, and demand
// and bill figures by the tariff's demand lines and windows.
export function inputDisplay(k: keyof QuoteInputs, inputs: QuoteInputs, periods?: PeriodRow[]): string | number {
  if (k === 'tariffId') return tariffLabel(inputs.tariffId);
  if (k === 'demandRates' || k === 'billKva') {
    if (k === 'billKva' && !inputs.fromBill) return 'Estimated';
    const values = k === 'demandRates' ? inputs.demandRates : demandKva(inputs);
    if (!values.length) return 'None';
    const labels = demandLineLabels(inputs);
    return values.map((v, i) => `${labels[i]} ${n(v, k === 'billKva' ? 1 : 4)}`).join(' · ');
  }
  if (k === 'fromBill') return inputs.fromBill ? 'Yes' : 'No';
  if (k === 'billKwh') {
    if (!inputs.fromBill) return 'Consumption shares';
    return (['Peak', 'Shoulder', 'Off-peak'] as const).map((l, i) => `${l} ${n(inputs.billKwh[i] ?? 0, 0)}`).join(' · ');
  }
  if (k === 'supplyStart') {
    const start = periods?.[0] ? monthLabel(periods[0].start) : inputs.supplyStart;
    return inputs.supplyStart === 'auto' ? `${start} (next quarter)` : start;
  }
  return inputs[k];
}

export { INPUT_LABELS };

// Same seven sheets as the Streamlit app's export, plus Inputs and Contract Periods
// sheets so the file records how the quote was built and flags any estimates.
export async function exportExcel(r: QuoteResult, periods: PeriodRow[], inputs: QuoteInputs, state: State, quoteDate: string, warnings: QuoteWarning[]) {
  const X = await import('xlsx');
  const summary = (t: QuoteResult['rates']) => X.utils.aoa_to_sheet([
    [t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'],
    ...t.rows.map((row) => [row.label, ...row.values, row.average]),
  ]);
  const priceCols = ['Quote Date', 'Period', ...STATES];
  const peakRows = r.updated.map((u, i) => [u.quoteDate, periods[i].label, ...STATES.map((s) => u[s])]);
  const baseRows = periods.map((f) => [f.quoteDate, f.label, ...STATES.map((s) => pyRound(f[s] / 10, 2))]);
  const tariff = tariffById(inputs.tariffId);

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, summary(r.rates), 'Bulk Prices');
  X.utils.book_append_sheet(wb, summary(r.consumption), 'Consumption');
  X.utils.book_append_sheet(wb, summary(r.costs), 'Yearly Costs');
  X.utils.book_append_sheet(wb, summary(r.energyRates), 'Energy Rates');
  X.utils.book_append_sheet(wb, summary(r.charges), 'Charges');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...peakRows]), 'Peak Prices');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([priceCols, ...baseRows]), 'Off-Peak Prices');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ['Input', 'Value'],
    ['State', state],
    ['ASX settlement date', quoteDate],
    ...INPUT_LABELS.map(([k, label]) => [label, inputDisplay(k, inputs, periods)]),
    ['Tariff status', tariff ? `${tariff.status}: ${tariff.source}` : 'unknown'],
    [],
    ['Warnings', warnings.length ? '' : 'None'],
    ...warnings.map((w) => ['', w.message]),
  ]), 'Inputs');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ['Year', 'Period', 'Months', 'Priced from', 'Estimate', `${state} settle ($/MWh)`, ...STATES.map((s) => `${s} ($/MWh)`)],
    ...periods.map((p, i) => [
      `Year ${i + 1}`, p.label, periodRange(p.start), p.sources.join(', '),
      p.note ?? (p.estimates.length ? p.estimates.map(estimateLabel).join(', ') : 'No'),
      p[state], ...STATES.map((s) => p[s]),
    ]),
  ]), 'Contract Periods');
  X.writeFile(wb, `bulk-electricity-pricing-${state}-${quoteDate}.xlsx`);
}

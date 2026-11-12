// CSV and Excel exports. The CSV builders are pure so test/parity.test.ts can check
// them byte for byte against the Streamlit app's pandas output.

import { STATES, type FuturesRow, type IndexPoint, type QuoteInputs, type QuoteResult, type State, pyRound } from './calc';
import { pyStr } from './format';

// pandas pivot orders the state columns alphabetically.
const INDEX_COLS = ['NSW', 'QLD', 'SA', 'VIC'] as const;

const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.join(',')).join('\n') + '\n';

export function bulkIndexCsv(index: IndexPoint[]): string {
  const desc = [...index].reverse();
  return toCsv([['Quote Date', ...INDEX_COLS], ...desc.map((d) => [d.quoteDate, ...INDEX_COLS.map((c) => pyStr(d[c]))])]);
}

// Rows in the order the database returns them: newest date first, then newest contract year.
export function futuresCsv(records: FuturesRow[]): string {
  return toCsv([['Quote Date', 'Year', ...STATES], ...records.map((r) => [r.quoteDate, r.year, ...STATES.map((s) => pyStr(r[s]))])]);
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
  ['network', 'Network tariff'],
  ['peakCharge', 'Network peak charge (c/kWh)'],
  ['offPeakCharge', 'Network off-peak charge (c/kWh)'],
  ['shoulderCharge', 'Network shoulder charge (c/kWh)'],
  ['nuosCharge', 'NUOS charge ($/kVA)'],
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
];

export { INPUT_LABELS };

// Same seven sheets as the Streamlit app's export, plus an Inputs sheet so the
// file records how the quote was built.
export async function exportExcel(r: QuoteResult, fetched: FuturesRow[], inputs: QuoteInputs, state: State, quoteDate: string) {
  const X = await import('xlsx');
  const summary = (t: QuoteResult['rates']) => X.utils.aoa_to_sheet([
    [t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average'],
    ...t.rows.map((row) => [row.label, ...row.values, row.average]),
  ]);
  const priceCols = ['Quote Date', 'Year', ...STATES];
  const peakRows = r.updated.map((u) => [u.quoteDate, String(u.year), ...STATES.map((s) => u[s])]);
  const baseRows = fetched.map((f) => [f.quoteDate, String(f.year), ...STATES.map((s) => pyRound(f[s] / 10, 2))]);

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
    ...INPUT_LABELS.map(([k, label]) => [label, inputs[k]]),
  ]), 'Inputs');
  X.writeFile(wb, `bulk-electricity-pricing-${state}-${quoteDate}.xlsx`);
}

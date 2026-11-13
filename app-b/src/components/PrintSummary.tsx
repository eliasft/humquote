// One-page quote sheet, shown only when printing (Print / Save as PDF).

import type { QuoteInputs, QuoteResult, State } from '@/core/calc';
import type { QuoteWarning } from '@/core/analysis';
import { periodRange, shortContract, type PeriodRow } from '@/core/periods';
import { INPUT_LABELS, inputDisplay } from '@/lib/export';
import { longDate, money, num } from '@/lib/format';
import { cn } from '@/lib/cn';

const fmtInput = (v: string | number) => (typeof v === 'number' ? v.toLocaleString('en-AU', { maximumFractionDigits: 4 }) : v);

export function PrintSummary({ result, inputs, state, periods, latestDate, warnings }: {
  result: QuoteResult; inputs: QuoteInputs; state: State; periods: PeriodRow[]; latestDate: string; warnings: QuoteWarning[];
}) {
  const cell = 'border-b border-neutral-300 px-2 py-1.5 text-right tabular-nums';
  const head = 'border-b-2 border-neutral-800 px-2 py-1.5 text-right text-xs font-semibold uppercase tracking-wide';
  const half = Math.ceil(INPUT_LABELS.length / 2);
  return (
    <div className="print-only bg-white text-[12px] text-black">
      <div className="flex items-end justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-xl font-bold">Bulk electricity quote</div>
          <div className="text-neutral-600">{state} · ASX settlement {longDate(latestDate)}</div>
        </div>
        <div className="text-right text-neutral-600">Prepared {new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div>

      <div className="mt-5 flex items-baseline gap-3">
        <div className="text-4xl font-bold">{money(result.bulkPrice, 4)}<span className="text-lg font-medium">/kWh</span></div>
        <div className="text-neutral-600">{money(result.bulkPrice * 1000, 2)}/MWh · three-year average, {periodRange(periods[0].start, 36)}</div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 border border-neutral-500 px-3 py-2">
          <div className="font-semibold">Please note</div>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </div>
      )}

      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(head, 'text-left')}>Component ($/kWh)</th>
            {periods.map((p, i) => <th key={i} className={head}>Year {i + 1} ({p.label}{p.estimates.length ? '*' : ''})</th>)}
            <th className={head}>Average</th>
          </tr>
        </thead>
        <tbody>
          {result.rates.rows.map((r, i) => (
            <tr key={r.label} className={i === 4 ? 'font-bold' : undefined}>
              <td className={cn(cell, 'text-left')}>{r.label.replace(' ($/kWh)', '')}</td>
              {[...r.values, r.average].map((v, j) => <td key={j} className={cell}>{num(v, 4)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10px] text-neutral-600">
        Priced from: {periods.map((p, i) => `Year ${i + 1} ${p.sources.map(shortContract).join(', ')}${p.estimates.length ? '*' : ''}`).join(' · ')}
        {periods.some((p) => p.estimates.length) && '. * Includes estimated months (see note above).'}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-x-8">
        {[INPUT_LABELS.slice(0, half), INPUT_LABELS.slice(half)].map((labels, t) => (
          <table key={t} className="w-full border-collapse">
            <tbody>
              {labels.map(([k, label]) => (
                <tr key={k}><td className="border-b border-neutral-200 py-1 text-neutral-600">{label}</td><td className="border-b border-neutral-200 py-1 text-right tabular-nums">{fmtInput(inputDisplay(k, inputs, periods))}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      <p className="mt-6 text-[10px] leading-relaxed text-neutral-500">
        Indicative estimate based on ASX Energy base settlement prices for {state} on {longDate(latestDate)}. Not an offer of supply.
      </p>
    </div>
  );
}

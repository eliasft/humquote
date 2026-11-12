// One-page quote sheet, shown only when printing (Print / Save as PDF).

import type { FuturesRow, QuoteInputs, QuoteResult, State } from '@/lib/calc';
import { INPUT_LABELS } from '@/lib/export';
import { fy, longDate, money, num } from '@/lib/format';
import { cn } from '@/lib/cn';

const fmtInput = (v: string | number) => (typeof v === 'number' ? v.toLocaleString('en-AU', { maximumFractionDigits: 4 }) : v);

export function PrintSummary({ result, inputs, state, latest, latestDate }: {
  result: QuoteResult; inputs: QuoteInputs; state: State; latest: FuturesRow[]; latestDate: string;
}) {
  const yearFy = [0, 1, 2].map((y) => fy(latest[Math.min(y, latest.length - 1)].year));
  const cell = 'border-b border-neutral-300 px-2 py-1.5 text-right tabular-nums';
  const head = 'border-b-2 border-neutral-800 px-2 py-1.5 text-right text-xs font-semibold uppercase tracking-wide';
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
        <div className="text-neutral-600">{money(result.bulkPrice * 1000, 2)}/MWh · three-year average</div>
      </div>

      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr>
            <th className={cn(head, 'text-left')}>Component ($/kWh)</th>
            {yearFy.map((f, i) => <th key={i} className={head}>Year {i + 1} ({f})</th>)}
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

      <div className="mt-5 grid grid-cols-2 gap-x-8">
        <table className="w-full border-collapse">
          <tbody>
            {INPUT_LABELS.slice(0, 10).map(([k, label]) => (
              <tr key={k}><td className="border-b border-neutral-200 py-1 text-neutral-600">{label}</td><td className="border-b border-neutral-200 py-1 text-right tabular-nums">{fmtInput(inputs[k])}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="w-full border-collapse">
          <tbody>
            {INPUT_LABELS.slice(10).map(([k, label]) => (
              <tr key={k}><td className="border-b border-neutral-200 py-1 text-neutral-600">{label}</td><td className="border-b border-neutral-200 py-1 text-right tabular-nums">{fmtInput(inputs[k])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-[10px] leading-relaxed text-neutral-500">
        Indicative estimate based on ASX Energy FY base strip settlement prices for {state} on {longDate(latestDate)}.
        {latest.length < 3 && ` Year 3 uses ${yearFy[2]}, the latest listed contract.`} Not an offer of supply.
      </p>
    </div>
  );
}

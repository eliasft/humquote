import { useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Bookmark, CalendarRange, Download, FileSpreadsheet, History, Link2, Printer, SlidersHorizontal, Table2, TrendingDown, TrendingUp,
} from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { InputsPanel } from '@/components/InputsPanel';
import { PrintSummary } from '@/components/PrintSummary';
import { DataTable } from '@/components/DataTable';
import { EChart, Legend, breakdownOption, seriesColor, timeLineOption, token, tornadoOption } from '@/components/charts/charts';
import {
  Button, Card, Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Tabs, TabsContent, TabsList, TabsTrigger, TextInput, Tip,
} from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { calculateBulkPrices, pyRound, type PriceRow, type QuoteInputs, type QuoteResult, type State } from '@/core/calc';
import {
  STATE_ORDER, compareStates, quoteHistory, quotePeriods, quoteWarnings, sensitivity, validateInputs, type QuoteWarning,
} from '@/core/analysis';
import { KIND_LABELS, contractKind, monthKey, monthLabel, periodRange, shortContract, type PeriodRow } from '@/core/periods';
import { tariffLabel } from '@/core/tariffs';
import type { MarketData } from '@/lib/data';
import { exportExcel } from '@/lib/export';
import { RANGES, cutoffFor, daysAgo, money, num, shortDate, signed, type RangeKey } from '@/lib/format';
import { shareUrl } from '@/lib/share';
import { useStore } from '@/lib/store';
import { useResolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/cn';

const COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed'];

export function EstimateBadge({ period }: { period: PeriodRow }) {
  if (!period.estimates.length) return null;
  return (
    <Tip content={period.note}>
      <span tabIndex={0} className="inline-flex cursor-help items-center gap-1 whitespace-nowrap rounded bg-warning/15 px-1.5 text-[11px] font-medium text-warning-text">
        <AlertTriangle className="size-3" /> Estimate
      </span>
    </Tip>
  );
}

function Warnings({ warnings }: { warnings: QuoteWarning[] }) {
  if (!warnings.length) return null;
  const title = { mismatch: 'Tariff from another state', placeholder: 'Placeholder tariff', estimate: 'Estimated price' };
  return (
    <div className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3">
      {warnings.map((w, i) => (
        <p key={i} className={cn('flex items-start gap-2 text-[13px]', w.kind === 'mismatch' ? 'text-danger' : 'text-warning-text')}>
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span><span className="font-semibold">{title[w.kind]}.</span> {w.message}</span>
        </p>
      ))}
    </div>
  );
}

function Hero({ result, data, state, periods, monthDelta, onState }: {
  result: QuoteResult; data: MarketData; state: State; periods: PeriodRow[]; monthDelta?: number; onState: (s: State) => void;
}) {
  const inputs = useStore((s) => s.inputs);
  const allStates = useMemo(
    () => compareStates(periods, inputs).map(({ state: s, result: r }) => ({ s, price: r.bulkPrice })),
    [periods, inputs],
  );
  const cheapest = Math.min(...allStates.map((x) => x.price));

  return (
    <Card className="overflow-hidden">
      <div className="relative grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,var(--accent-soft),transparent_55%)]" />
        <div className="relative">
          <div className="text-[13px] font-medium text-muted-foreground">Bulk electricity price · {state} · three-year average from {monthLabel(periods[0].start)}</div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-5xl font-semibold tracking-tight sm:text-6xl">{money(result.bulkPrice, 4)}</span>
            <span className="text-lg font-medium text-muted-foreground">/kWh</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{money(result.bulkPrice * 1000, 2)}/MWh</span>
            {monthDelta !== undefined && (
              <span className="inline-flex items-center gap-1">
                {monthDelta > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                {signed(monthDelta, 4, '$')} vs 30 days ago
              </span>
            )}
            <span>{tariffLabel(inputs.tariffId)}</span>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-2 self-end">
          {periods.map((p, y) => (
            <div key={y} className={cn('min-w-0 rounded-lg border bg-card/70 px-2.5 py-2.5 backdrop-blur sm:min-w-36 sm:px-3', p.estimates.length ? 'border-warning/50' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground sm:gap-1.5 sm:text-xs">
                Year {y + 1}
                <span className="whitespace-nowrap rounded bg-muted px-1.5 text-[11px] font-medium" title={periodRange(p.start)}>{p.label}</span>
              </div>
              <div className="tabular mt-1 text-base font-semibold sm:text-lg">{money(result.rates.rows[4].values[y], 4)}</div>
              <div className="mt-0.5 min-h-[18px]"><EstimateBadge period={p} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="no-print flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-border bg-card-2 px-3 py-2 text-[13px]">
        <Tip content="Your inputs in each state, on that state's default network tariff for the same customer segment.">
          <span tabIndex={0} className="cursor-help px-2 text-muted-foreground underline decoration-dotted underline-offset-2">Same inputs in</span>
        </Tip>
        {allStates.map(({ s, price }) => (
          <button
            key={s}
            type="button"
            onClick={() => onState(s)}
            className={cn('cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-muted', s === state && 'bg-muted font-semibold')}
          >
            {s} <span className="tabular text-muted-foreground">{money(price, 4)}</span>
            {price === cheapest && <span className="ml-1 rounded bg-accent-soft px-1 text-[11px] font-medium text-accent-text">lowest</span>}
          </button>
        ))}
        <span className="ml-auto px-2 text-xs text-subtle">ASX settlement {shortDate(data.latestDate)}</span>
      </div>
    </Card>
  );
}

function BreakdownTab({ result, periods }: { result: QuoteResult; periods: PeriodRow[] }) {
  const theme = useResolvedTheme();
  const cats = [...periods.map((p, y) => `Year ${y + 1} · ${p.label}${p.estimates.length ? '*' : ''}`), 'Average'];
  const parts = COMPONENTS.map((name, i) => ({ name, color: seriesColor(i), values: [...result.rates.rows[i].values, result.rates.rows[i].average] }));
  const totals = [...result.rates.rows[4].values, result.rates.rows[4].average];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => breakdownOption(cats, parts, totals), [result, periods, theme]);
  return (
    <div className="space-y-4 p-5">
      <Legend items={parts.map((p) => ({ label: p.name, color: p.color }))} />
      <EChart option={option} height={210} ariaLabel="Stacked bars of the energy, network, other and fixed parts of the price for each year and the average" />
      <DataTable
        head={['$/kWh', 'Year 1', 'Year 2', 'Year 3', 'Average']}
        rows={[...parts.map((p) => [p.name, ...p.values.map((v) => money(v, 4))]), ['Total', ...totals.map((v) => money(v, 4))]]}
        keys={parts.map((p) => p.color)}
        totalRow={4}
        highlightCol={4}
      />
      {periods.some((p) => p.estimates.length) && <p className="text-xs text-subtle">* Includes estimated months: see Contract periods.</p>}
    </div>
  );
}

function HistoryTab({ data, state }: { data: MarketData; state: State }) {
  const inputs = useStore((s) => s.inputs);
  const theme = useResolvedTheme();
  const [range, setRange] = useState<RangeKey>('1Y');
  const history = useMemo(() => quoteHistory(data.curves, inputs, state), [data.curves, inputs, state]);
  const cutoff = cutoffFor(range, data.latestDate);
  const shown = cutoff ? history.filter((h) => h.quoteDate >= cutoff) : history;
  const prices = shown.map((h) => h.price);
  const lo = shown[prices.indexOf(Math.min(...prices))];
  const hi = shown[prices.indexOf(Math.max(...prices))];
  const now = history[history.length - 1];
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const estimated = shown.filter((h) => h.estimates.length).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption(
    [{ name: `${state} quote`, color: token('--accent'), points: shown.map((h) => [h.quoteDate, h.price]), area: true }],
    {
      yFormat: (v) => `$${v.toFixed(3)}`,
      tooltipValue: (v) => `${money(v, 4)}/kWh`,
      baseline: { value: avg, label: `Avg ${money(avg, 4)}` },
      notes: new Map(shown.filter((h) => h.estimates.length).map((h) => [h.quoteDate, 'Includes estimated months'])),
    },
  ), [shown, theme]);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Your inputs priced on every past ASX settlement date, each for a three-year contract starting the following quarter.
          {estimated > 0 && <> {num(estimated, 0)} of {num(shown.length, 0)} dates include estimated months (carried forward or back-filled).</>}
        </p>
        <Segmented label="Date range" size="sm" value={range} onChange={setRange} options={RANGES.map(([k]) => k)} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {[['Today', now], ['Lowest', lo], ['Highest', hi]].map(([label, p]) => {
          const point = p as typeof now;
          return (
            <div key={label as string} className="rounded-lg bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">{label as string}</div>
              <div className="tabular font-semibold">{money(point.price, 4)}</div>
              <div className="text-xs text-subtle">{shortDate(point.quoteDate)}</div>
            </div>
          );
        })}
      </div>
      <EChart option={option} height={300} ariaLabel={`Line chart of this quote's price for ${state} on each settlement date`} />
    </div>
  );
}

function SensitivityTab({ periods, state }: { periods: PeriodRow[]; state: State }) {
  const inputs = useStore((s) => s.inputs);
  const theme = useResolvedTheme();
  const [pctKey, setPct] = useState<'5' | '10' | '20'>('10');
  const pct = Number(pctKey);
  const { base, drivers } = useMemo(() => sensitivity(periods, inputs, state, pct), [periods, inputs, state, pct]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => tornadoOption(drivers.map((d) => d.label), drivers.map((d) => d.low - base), drivers.map((d) => d.high - base), `${pct}%`), [drivers, base, theme]);
  const top = drivers[0];
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          How the price moves if each input changes by ±{pct}% on its own.
          {top && <> The biggest driver is <span className="font-medium text-foreground">{top.label}</span>: {money(Math.min(top.low, top.high), 4)} to {money(Math.max(top.low, top.high), 4)}/kWh.</>}
        </p>
        <Segmented label="Change size" size="sm" value={pctKey} onChange={setPct} options={[{ value: '5', label: '±5%' }, { value: '10', label: '±10%' }, { value: '20', label: '±20%' }]} />
      </div>
      <Legend items={[{ label: `Input −${pct}%`, color: token('--diverging-low') }, { label: `Input +${pct}%`, color: token('--diverging-high') }]} />
      <EChart option={option} height={Math.max(200, drivers.length * 34 + 40)} ariaLabel="Tornado chart of how much the price changes when each input moves up or down" />
      <DataTable
        head={['Input', `−${pct}%`, `+${pct}%`, 'Range']}
        rows={drivers.map((d) => [d.label, money(d.low, 4), money(d.high, 4), money(d.spread, 4)])}
      />
    </div>
  );
}

const DETAIL_TABLES = [
  { value: 'costs', label: 'Annual costs', get: (r: QuoteResult) => r.costs, dp: 2, total: 7 },
  { value: 'consumption', label: 'Consumption', get: (r: QuoteResult) => r.consumption, dp: 2 },
  { value: 'charges', label: 'Unit charges', get: (r: QuoteResult) => r.charges, dp: 4 },
  { value: 'tariffs', label: 'Tariffs & factors', get: (r: QuoteResult) => r.energyRates, dp: 4 },
] as const;

function DetailsTab({ result }: { result: QuoteResult }) {
  const [which, setWhich] = useState<(typeof DETAIL_TABLES)[number]['value']>('costs');
  const spec = DETAIL_TABLES.find((d) => d.value === which)!;
  const t = spec.get(result);
  return (
    <div className="space-y-4 p-5">
      <Segmented label="Table" size="sm" value={which} onChange={setWhich} options={DETAIL_TABLES.map((d) => ({ value: d.value, label: d.label }))} className="max-w-full overflow-x-auto" />
      <DataTable
        head={[t.labelHeader, 'Year 1', 'Year 2', 'Year 3', 'Average']}
        rows={t.rows.map((row) => [row.label, ...[...row.values, row.average].map((v) => num(v, row.label.includes('$/kWh') ? 4 : spec.dp))])}
        totalRow={'total' in spec ? spec.total : undefined}
        highlightCol={4}
      />
    </div>
  );
}

function PeriodsTab({ result, periods, state }: { result: QuoteResult; periods: PeriodRow[]; state: State }) {
  const [view, setView] = useState<'settle' | 'peak' | 'base'>('settle');
  const value = (row: PriceRow, s: State) => (view === 'settle' ? `$${num(row[s], 2)}` : num(pyRound(row[s] / 10, 2), 2));
  const rows = periods.flatMap((p, i) => [
    [
      <span className="font-medium text-foreground">Year {i + 1} · {p.label}</span>,
      <span className="text-muted-foreground">{periodRange(p.start)}</span>,
      <span className="inline-flex items-center gap-1.5">
        {p.sources.map((c) => (
          <span key={c} title={KIND_LABELS[contractKind({ contract: c })]} className="rounded border border-border bg-card-2 px-1.5 text-xs text-foreground">{shortContract(c)}</span>
        ))}
        <EstimateBadge period={p} />
      </span>,
      ...STATE_ORDER.map((s) => (view === 'peak' ? num(result.updated[i][s], 2) : value(p, s))),
    ],
    // Periods built from quarters list each quarter beneath (peak rates apply per period only).
    ...(p.quarters ?? []).map((q) => [
      <span className="pl-4 text-subtle">{q.months < 3 ? `${periodRange(q.from, q.months)} (part, ${q.days} days)` : periodRange(q.from, 3)}</span>,
      '',
      <span className={cn('text-subtle', q.estimate && 'text-warning-text')}>
        {shortContract(q.source)}{q.estimate === 'carried' ? ' carried forward' : q.estimate === 'backfilled' ? ' back-filled' : ''}
      </span>,
      ...STATE_ORDER.map((s) => <span className="text-subtle">{view === 'peak' ? '' : value(q, s)}</span>),
    ]),
  ]);
  const caption = {
    settle: 'ASX base settle price for each contract period, $/MWh. A period without a matching annual strip averages its four quarters.',
    peak: 'Settle price with load and retail escalation applied, c/kWh. Used as the peak and shoulder energy rate.',
    base: 'Settle price without escalation, c/kWh. Used as the off-peak energy rate.',
  }[view];
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{caption}</p>
        <Segmented label="Price type" size="sm" value={view} onChange={setView} options={[{ value: 'settle', label: 'Settle' }, { value: 'peak', label: 'Peak' }, { value: 'base', label: 'Base' }]} />
      </div>
      <DataTable head={['Period', 'Months', 'Priced from', ...STATE_ORDER]} rows={rows} highlightCol={STATE_ORDER.indexOf(state) + 3} />
      {periods.some((p) => p.estimates.length) && (
        <p className="text-xs text-subtle">
          Carried forward: beyond the last listed ASX contract, its price escalated by the carry-forward rate for each year beyond it.
          Back-filled: before the first listed contract, the earliest listed price, unescalated.
        </p>
      )}
    </div>
  );
}

// Saving fixes an automatic supply start to its month, so the saved quote keeps
// pricing the same contract.
const fixStart = (inputs: QuoteInputs, periods: PeriodRow[]): QuoteInputs =>
  (inputs.supplyStart === 'auto' && periods[0] ? { ...inputs, supplyStart: monthKey(periods[0].start) } : inputs);

function SaveDialog({ open, onOpenChange, result, data, periods }: {
  open: boolean; onOpenChange: (o: boolean) => void; result: QuoteResult; data: MarketData; periods: PeriodRow[];
}) {
  const { inputs, state, saveQuote } = useStore();
  const suggested = `${state} · ${num(inputs.totalConsumption, 0)} kWh · ${tariffLabel(inputs.tariffId)}`;
  const [name, setName] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setName(''); }} title="Save quote" description="Saved quotes stay in this browser. Reopen, compare or re-price them against the latest data at any time.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveQuote({ name: name.trim() || suggested, state, inputs: fixStart(inputs, periods), priceAtSave: result.bulkPrice, dataDate: data.latestDate });
          onOpenChange(false);
          toast('Quote saved');
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1 block text-[13px] text-muted-foreground">Name</span>
          <TextInput autoFocus placeholder={suggested} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="rounded-lg bg-muted px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Price at save: </span>
          <span className="tabular font-semibold">{money(result.bulkPrice, 4)}/kWh</span>
          <span className="text-muted-foreground"> · {state} · supply from {monthLabel(periods[0].start)} · {shortDate(data.latestDate)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary"><Bookmark /> Save quote</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function QuotePage({ data }: { data: MarketData }) {
  const inputs = useStore((s) => s.inputs);
  const state = useStore((s) => s.state);
  const setState = useStore((s) => s.setState);
  const [saveOpen, setSaveOpen] = useState(false);

  const periods = useMemo(() => quotePeriods(data.curve, inputs), [data.curve, inputs]);
  const result = useMemo(() => calculateBulkPrices(periods, inputs, state), [periods, inputs, state]);
  const warnings = useMemo(() => quoteWarnings(inputs, state, periods), [inputs, state, periods]);
  const valid = validateInputs(inputs).length === 0;
  const monthDelta = useMemo(() => {
    // Compare with the last settlement date at least 30 days before the latest one.
    const target = daysAgo(data.latestDate, 30);
    const pastDate = [...data.curves.keys()].filter((d) => d <= target).at(-1);
    if (!pastDate) return undefined;
    return result.bulkPrice - calculateBulkPrices(quotePeriods(data.curves.get(pastDate)!, inputs), inputs, state).bulkPrice;
  }, [data, inputs, state, result.bulkPrice]);

  // A tariff only applies in its own state, so changing state switches tariff too.
  const changeState = (s: State) => {
    const before = inputs.tariffId;
    setState(s);
    const after = useStore.getState().inputs.tariffId;
    if (after !== before) toast(`Network tariff changed to ${tariffLabel(after)} for ${s}`);
  };

  const copyLink = async () => {
    const url = shareUrl(inputs, state);
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { window.prompt('Copy this link', url); }
  };

  return (
    <>
      <PageHeader
        title="Quote"
        description="Price a three-year bulk electricity contract from the latest ASX futures and network tariffs."
        actions={(
          <>
            <Button onClick={copyLink}><Link2 /> Share</Button>
            <Menu>
              <MenuTrigger asChild><Button><Download /> Export</Button></MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => exportExcel(result, periods, inputs, state, data.latestDate, warnings)}><FileSpreadsheet /> Excel workbook (.xlsx)</MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={() => setTimeout(() => window.print(), 50)}><Printer /> Print or save as PDF</MenuItem>
              </MenuContent>
            </Menu>
            <Button variant="primary" onClick={() => setSaveOpen(true)} disabled={!valid}><Bookmark /> Save</Button>
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <InputsPanel latestDate={data.latestDate} state={state} />
        <div className="no-print min-w-0 space-y-5">
          <Segmented label="State" value={state} onChange={changeState} options={STATE_ORDER} className="w-full sm:w-auto" />
          <Warnings warnings={warnings} />
          <Hero result={result} data={data} state={state} periods={periods} monthDelta={monthDelta} onState={changeState} />
          <Card>
            <Tabs defaultValue="breakdown">
              <TabsList>
                <TabsTrigger value="breakdown"><BarChart3 /> Breakdown</TabsTrigger>
                <TabsTrigger value="history"><History /> Over time</TabsTrigger>
                <TabsTrigger value="sensitivity"><SlidersHorizontal /> Sensitivity</TabsTrigger>
                <TabsTrigger value="details"><Table2 /> Details</TabsTrigger>
                <TabsTrigger value="periods"><CalendarRange /> Contract periods</TabsTrigger>
              </TabsList>
              <TabsContent value="breakdown"><BreakdownTab result={result} periods={periods} /></TabsContent>
              <TabsContent value="history"><HistoryTab data={data} state={state} /></TabsContent>
              <TabsContent value="sensitivity"><SensitivityTab periods={periods} state={state} /></TabsContent>
              <TabsContent value="details"><DetailsTab result={result} /></TabsContent>
              <TabsContent value="periods"><PeriodsTab result={result} periods={periods} state={state} /></TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>

      <PrintSummary result={result} inputs={inputs} state={state} periods={periods} latestDate={data.latestDate} warnings={warnings} />
      <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} result={result} data={data} periods={periods} />
    </>
  );
}

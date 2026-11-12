import { useMemo, useState } from 'react';
import { BarChart3, Bookmark, Download, FileSpreadsheet, History, Link2, Printer, SlidersHorizontal, Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { InputsPanel } from '@/components/InputsPanel';
import { PrintSummary } from '@/components/PrintSummary';
import { DataTable } from '@/components/DataTable';
import { EChart, Legend, breakdownOption, seriesColor, timeLineOption, token, tornadoOption } from '@/components/charts/charts';
import {
  Button, Card, Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Tabs, TabsContent, TabsList, TabsTrigger, TextInput,
} from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { calculateBulkPrices, pyRound, type QuoteResult, type State } from '@/lib/calc';
import { STATE_ORDER, quoteHistory, sensitivity, validateInputs } from '@/lib/analysis';
import type { MarketData } from '@/lib/data';
import { exportExcel } from '@/lib/export';
import { RANGES, cutoffFor, daysAgo, fy, longDate, money, num, shortDate, signed, type RangeKey } from '@/lib/format';
import { shareUrl } from '@/lib/share';
import { useStore } from '@/lib/store';
import { useResolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/cn';

const COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed'];

function Hero({ result, data, state, monthDelta }: { result: QuoteResult; data: MarketData; state: State; monthDelta?: number }) {
  const setState = useStore((s) => s.setState);
  const inputs = useStore((s) => s.inputs);
  const n = data.latest.length;
  const allStates = useMemo(
    () => STATE_ORDER.map((s) => ({ s, price: calculateBulkPrices(data.latest, inputs, s).bulkPrice })),
    [data.latest, inputs],
  );
  const cheapest = Math.min(...allStates.map((x) => x.price));

  return (
    <Card className="overflow-hidden">
      <div className="relative grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,var(--accent-soft),transparent_55%)]" />
        <div className="relative">
          <div className="text-[13px] font-medium text-muted-foreground">Bulk electricity price · {state} · three-year average</div>
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
            <span>ASX settlement {longDate(data.latestDate)}</span>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-2 self-end">
          {[0, 1, 2].map((y) => {
            const idx = Math.min(y, n - 1);
            return (
              <div key={y} className="min-w-0 rounded-lg border border-border bg-card/70 px-2.5 py-2.5 backdrop-blur sm:min-w-32 sm:px-3">
                <div className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground sm:gap-1.5 sm:text-xs">
                  Year {y + 1}
                  <span className="rounded bg-muted px-1.5 text-[11px] font-medium" title={idx !== y ? `Repeats ${fy(data.latest[idx].year)}, the latest listed contract` : undefined}>
                    {fy(data.latest[idx].year)}{idx !== y && '*'}
                  </span>
                </div>
                <div className="tabular mt-1 text-base font-semibold sm:text-lg">{money(result.rates.rows[4].values[y], 4)}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="no-print flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-border bg-card-2 px-3 py-2 text-[13px]">
        <span className="px-2 text-muted-foreground">Same inputs in</span>
        {allStates.map(({ s, price }) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            className={cn('cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-muted', s === state && 'bg-muted font-semibold')}
          >
            {s} <span className="tabular text-muted-foreground">{money(price, 4)}</span>
            {price === cheapest && <span className="ml-1 rounded bg-accent-soft px-1 text-[11px] font-medium text-accent-text">lowest</span>}
          </button>
        ))}
        {n < 3 && <span className="ml-auto px-2 text-xs text-subtle">* Year 3 repeats {fy(data.latest[n - 1].year)}, the latest listed contract</span>}
      </div>
    </Card>
  );
}

function BreakdownTab({ result, data }: { result: QuoteResult; data: MarketData }) {
  const theme = useResolvedTheme();
  const cats = [...[0, 1, 2].map((y) => `Year ${y + 1} · ${fy(data.latest[Math.min(y, data.latest.length - 1)].year)}`), 'Average'];
  const parts = COMPONENTS.map((name, i) => ({ name, color: seriesColor(i), values: [...result.rates.rows[i].values, result.rates.rows[i].average] }));
  const totals = [...result.rates.rows[4].values, result.rates.rows[4].average];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => breakdownOption(cats, parts, totals), [result, theme]);
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
    </div>
  );
}

function HistoryTab({ data, state }: { data: MarketData; state: State }) {
  const inputs = useStore((s) => s.inputs);
  const theme = useResolvedTheme();
  const [range, setRange] = useState<RangeKey>('1Y');
  const history = useMemo(() => quoteHistory(data.byDate, inputs, state), [data.byDate, inputs, state]);
  const cutoff = cutoffFor(range, data.latestDate);
  const shown = cutoff ? history.filter((h) => h.quoteDate >= cutoff) : history;
  const prices = shown.map((h) => h.price);
  const lo = shown[prices.indexOf(Math.min(...prices))];
  const hi = shown[prices.indexOf(Math.max(...prices))];
  const now = history[history.length - 1];
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption(
    [{ name: `${state} quote`, color: token('--accent'), points: shown.map((h) => [h.quoteDate, h.price]), area: true }],
    { yFormat: (v) => `$${v.toFixed(3)}`, tooltipValue: (v) => `${money(v, 4)}/kWh`, baseline: { value: avg, label: `Avg ${money(avg, 4)}` } },
  ), [shown, theme]);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">Your current inputs priced on every past ASX settlement date: what this quote would have cost on each day.</p>
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

function SensitivityTab({ data, state }: { data: MarketData; state: State }) {
  const inputs = useStore((s) => s.inputs);
  const theme = useResolvedTheme();
  const [pctKey, setPct] = useState<'5' | '10' | '20'>('10');
  const pct = Number(pctKey);
  const { base, drivers } = useMemo(() => sensitivity(data.latest, inputs, state, pct), [data.latest, inputs, state, pct]);
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

function FuturesTab({ result, data, state }: { result: QuoteResult; data: MarketData; state: State }) {
  const [view, setView] = useState<'settle' | 'peak' | 'base'>('peak');
  const rows = data.latest.map((row, i) => {
    const values = STATE_ORDER.map((s) => {
      if (view === 'settle') return `$${num(row[s], 2)}`;
      if (view === 'peak') return num(result.updated[i][s], 2);
      return num(pyRound(row[s] / 10, 2), 2);
    });
    return [fy(row.year), ...values];
  });
  const caption = {
    settle: 'ASX FY base strip settle price, $/MWh.',
    peak: 'Settle price with load and retail escalation applied, c/kWh. Used as the peak and shoulder energy rate.',
    base: 'Settle price without escalation, c/kWh. Used as the off-peak energy rate.',
  }[view];
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">{caption}</p>
        <Segmented label="Price type" size="sm" value={view} onChange={setView} options={[{ value: 'settle', label: 'Settle' }, { value: 'peak', label: 'Peak' }, { value: 'base', label: 'Base' }]} />
      </div>
      <DataTable head={['Contract', ...STATE_ORDER]} rows={rows} highlightCol={STATE_ORDER.indexOf(state) + 1} />
    </div>
  );
}

function SaveDialog({ open, onOpenChange, result, data }: { open: boolean; onOpenChange: (o: boolean) => void; result: QuoteResult; data: MarketData }) {
  const { inputs, state, saveQuote } = useStore();
  const suggested = `${state} · ${num(inputs.totalConsumption, 0)} kWh · ${inputs.network}`;
  const [name, setName] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) setName(''); }} title="Save quote" description="Saved quotes stay in this browser. Reopen, compare or re-price them against the latest data at any time.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveQuote({ name: name.trim() || suggested, state, inputs, priceAtSave: result.bulkPrice, dataDate: data.latestDate });
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
          <span className="text-muted-foreground"> · {state} · {shortDate(data.latestDate)}</span>
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

  const result = useMemo(() => calculateBulkPrices(data.latest, inputs, state), [data.latest, inputs, state]);
  const valid = validateInputs(inputs).length === 0;
  const monthDelta = useMemo(() => {
    // Compare with the last settlement date at least 30 days before the latest one.
    const target = daysAgo(data.latestDate, 30);
    const pastDate = [...data.byDate.keys()].filter((d) => d <= target).sort().at(-1);
    if (!pastDate) return undefined;
    return result.bulkPrice - calculateBulkPrices(data.byDate.get(pastDate)!, inputs, state).bulkPrice;
  }, [data, inputs, state, result.bulkPrice]);

  const copyLink = async () => {
    const url = shareUrl(inputs, state);
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { window.prompt('Copy this link', url); }
  };

  return (
    <>
      <PageHeader
        title="Quote"
        description="Price a three-year bulk electricity contract from the latest ASX futures."
        actions={(
          <>
            <Button onClick={copyLink}><Link2 /> Share</Button>
            <Menu>
              <MenuTrigger asChild><Button><Download /> Export</Button></MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => exportExcel(result, data.latest, inputs, state, data.latestDate)}><FileSpreadsheet /> Excel workbook (.xlsx)</MenuItem>
                <MenuSeparator />
                <MenuItem onSelect={() => setTimeout(() => window.print(), 50)}><Printer /> Print or save as PDF</MenuItem>
              </MenuContent>
            </Menu>
            <Button variant="primary" onClick={() => setSaveOpen(true)} disabled={!valid}><Bookmark /> Save</Button>
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
        <InputsPanel />
        <div className="no-print min-w-0 space-y-5">
          <Segmented label="State" value={state} onChange={setState} options={STATE_ORDER} className="w-full sm:w-auto" />
          <Hero result={result} data={data} state={state} monthDelta={monthDelta} />
          <Card>
            <Tabs defaultValue="breakdown">
              <TabsList>
                <TabsTrigger value="breakdown"><BarChart3 /> Breakdown</TabsTrigger>
                <TabsTrigger value="history"><History /> Over time</TabsTrigger>
                <TabsTrigger value="sensitivity"><SlidersHorizontal /> Sensitivity</TabsTrigger>
                <TabsTrigger value="details"><Table2 /> Details</TabsTrigger>
                <TabsTrigger value="futures">Futures used</TabsTrigger>
              </TabsList>
              <TabsContent value="breakdown"><BreakdownTab result={result} data={data} /></TabsContent>
              <TabsContent value="history"><HistoryTab data={data} state={state} /></TabsContent>
              <TabsContent value="sensitivity"><SensitivityTab data={data} state={state} /></TabsContent>
              <TabsContent value="details"><DetailsTab result={result} /></TabsContent>
              <TabsContent value="futures"><FuturesTab result={result} data={data} state={state} /></TabsContent>
            </Tabs>
          </Card>
        </div>
      </div>

      <PrintSummary result={result} inputs={inputs} state={state} latest={data.latest} latestDate={data.latestDate} />
      <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} result={result} data={data} />
    </>
  );
}

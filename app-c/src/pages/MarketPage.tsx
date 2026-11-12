import { useMemo, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, Download } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { DataTable } from '@/components/DataTable';
import { EChart, Legend, seriesColor, timeLineOption, token } from '@/components/charts/charts';
import { Button, Card, CardHeader, Segmented, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import type { State } from '@/lib/calc';
import { STATE_ORDER } from '@/lib/analysis';
import type { MarketData } from '@/lib/data';
import { bulkIndexCsv, downloadCsv, futuresCsv } from '@/lib/export';
import { RANGES, cutoffFor, daysAgo, fy, money, num, shortDate, signed, valueOnOrBefore, type RangeKey } from '@/lib/format';
import { useResolvedTheme } from '@/lib/theme';

function TableDisclosure({ children, count }: { children: React.ReactNode; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-t border-border">
      <Collapsible.Trigger className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Hide' : 'Show'} data table <span className="font-normal text-subtle">({num(count, 0)} rows)</span>
      </Collapsible.Trigger>
      <Collapsible.Content>{open && <div className="max-h-[420px] overflow-auto border-t border-border">{children}</div>}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function IndexTab({ data, range }: { data: MarketData; range: RangeKey }) {
  const theme = useResolvedTheme();
  const cutoff = cutoffFor(range, data.latestDate);
  const shown = cutoff ? data.index.filter((d) => d.quoteDate >= cutoff) : data.index;
  const last = data.index[data.index.length - 1];
  const monthAgo = daysAgo(last.quoteDate, 30);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption(
    STATE_ORDER.map((s, i) => ({ name: s, color: seriesColor(i), points: shown.map((d) => [d.quoteDate, d[s]] as [string, number]) })),
    { yFormat: (v) => `$${v.toFixed(2)}`, tooltipValue: (v) => `${money(v, 4)}/kWh` },
  ), [shown, theme]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATE_ORDER.map((s, i) => {
          const before = valueOnOrBefore(data.index, monthAgo, (d) => d[s]);
          return (
            <Stat key={s} label={s} keyColor={seriesColor(i)} value={money(last[s], 4)} unit="/kWh"
              sub={before === undefined ? '—' : `${signed(last[s] - before, 4, '$')} vs 30 days ago`} />
          );
        })}
      </div>
      <Card>
        <CardHeader title="Bulk price index by state" description="Reference contract: 400,000 kWh, 50% peak, fixed network and system charges. $/kWh." />
        <div className="space-y-3 p-5">
          <Legend items={STATE_ORDER.map((s, i) => ({ label: s, color: seriesColor(i), line: true }))} />
          <EChart option={option} height={380} ariaLabel="Line chart of the bulk price index for each state over time" />
        </div>
        <TableDisclosure count={shown.length}>
          <DataTable stickyHead head={['Quote date', ...STATE_ORDER]} rows={[...shown].reverse().map((d) => [shortDate(d.quoteDate), ...STATE_ORDER.map((s) => money(d[s], 4))])} />
        </TableDisclosure>
      </Card>
    </div>
  );
}

function FuturesTab({ data, range, state }: { data: MarketData; range: RangeKey; state: State }) {
  const theme = useResolvedTheme();
  const cutoff = cutoffFor(range, data.latestDate);
  const active = data.latest.map((r) => r.year);
  const years = [...new Set(data.records.map((r) => r.year))].sort((a, b) => a - b);
  const expired = years.filter((y) => !active.includes(y));
  const monthAgo = daysAgo(data.latestDate, 30);

  const seriesFor = (y: number) => data.records
    .filter((r) => r.year === y && (!cutoff || r.quoteDate >= cutoff))
    .sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1))
    .map((r) => [r.quoteDate, r[state]] as [string, number]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption([
    ...expired.map((y) => ({ name: fy(y), color: token('--series-muted'), points: seriesFor(y), width: 1.5, z: 1, muted: false })),
    ...active.map((y, i) => ({ name: fy(y), color: seriesColor(i), points: seriesFor(y), z: 3 })),
  ].filter((s) => s.points.length), { yFormat: (v) => `$${v.toFixed(0)}`, tooltipValue: (v) => `$${num(v, 2)}/MWh` }), [data, range, state, theme]);

  const rows = data.records.filter((r) => !cutoff || r.quoteDate >= cutoff);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {active.map((y, i) => {
          const series = data.records.filter((r) => r.year === y).sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1));
          const now = series[series.length - 1][state];
          const before = valueOnOrBefore(series, monthAgo, (r) => r[state]);
          return (
            <Stat key={y} label={`${fy(y)} · ${state}`} keyColor={seriesColor(i)} value={`$${num(now, 2)}`} unit="/MWh"
              sub={before === undefined ? 'New contract' : `${signed(now - before, 2, '$')} vs 30 days ago`} />
          );
        })}
      </div>
      <Card>
        <CardHeader title={`${state} FY base strip settlement prices`} description="Contracts still trading are coloured; expired contracts are grey. $/MWh." />
        <div className="space-y-3 p-5">
          <Legend items={[
            ...active.map((y, i) => ({ label: `${fy(y)} (trading)`, color: seriesColor(i), line: true })),
            ...(expired.length ? [{ label: 'Expired contracts', color: token('--series-muted'), line: true }] : []),
          ]} />
          <EChart option={option} height={380} ariaLabel={`Line chart of ${state} futures settlement prices by contract year`} />
        </div>
        <TableDisclosure count={rows.length}>
          <DataTable stickyHead head={['Quote date', 'Contract', ...STATE_ORDER]} highlightCol={STATE_ORDER.indexOf(state) + 2}
            rows={rows.map((r) => [shortDate(r.quoteDate), fy(r.year), ...STATE_ORDER.map((s) => num(r[s], 2))])} />
        </TableDisclosure>
      </Card>
    </div>
  );
}

export function MarketPage({ data }: { data: MarketData }) {
  const [tab, setTab] = useState<'index' | 'futures'>('index');
  const [range, setRange] = useState<RangeKey>('2Y');
  const [state, setState] = useState<State>('NSW');

  const download = () => (tab === 'index'
    ? downloadCsv('historical_bulk_price_index.csv', bulkIndexCsv(data.index))
    : downloadCsv('historical-futures-data.csv', futuresCsv(data.records)));

  return (
    <>
      <PageHeader title="Market" description="ASX Energy FY base strip prices and the bulk price index built from them." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <TabsList className="border-b-0 px-0">
            <TabsTrigger value="index">Bulk price index</TabsTrigger>
            <TabsTrigger value="futures">Futures</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {tab === 'futures' && <Segmented label="State" size="sm" value={state} onChange={setState} options={STATE_ORDER} />}
            <Segmented label="Date range" size="sm" value={range} onChange={setRange} options={RANGES.map(([k]) => k)} />
            <Button size="sm" onClick={download}><Download /> CSV</Button>
          </div>
        </div>
        <TabsContent value="index"><IndexTab data={data} range={range} /></TabsContent>
        <TabsContent value="futures"><FuturesTab data={data} range={range} state={state} /></TabsContent>
      </Tabs>
    </>
  );
}

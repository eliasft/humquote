import { useMemo, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { AlertTriangle, ChevronDown, Download } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { DataTable } from '@/components/DataTable';
import { EChart, Legend, seriesColor, stackedAreaOption, timeLineOption, token } from '@/components/charts/charts';
import { Button, Card, CardHeader, Segmented, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import type { State } from '@/core/calc';
import { STATE_ORDER } from '@/core/analysis';
import { periodRange, shortContract } from '@/core/periods';
import { TARIFF_YEAR, defaultTariff, tariffLabel } from '@/core/tariffs';
import type { MarketData } from '@/lib/data';
import { bulkIndex2Csv, bulkIndexCsv, downloadCsv, futuresCsv } from '@/lib/export';
import { RANGES, cutoffFor, daysAgo, fy, money, num, shortDate, signed, valueOnOrBefore, type RangeKey } from '@/lib/format';
import { useResolvedTheme } from '@/lib/theme';

type Method = 'current' | 'original';

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

// Both index methods as rows of { quoteDate, NSW, VIC, QLD, SA }.
function indexRows(data: MarketData, method: Method) {
  if (method === 'original') return data.legacyIndex.map((d) => ({ ...d, estimated: false }));
  return data.index.map((d) => ({ quoteDate: d.quoteDate, ...d.prices, estimated: d.estimates.length > 0 }));
}

const COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed'];

function IndexTab({ data, range, method, state }: { data: MarketData; range: RangeKey; method: Method; state: State }) {
  const theme = useResolvedTheme();
  const all = useMemo(() => indexRows(data, method), [data, method]);
  const cutoff = cutoffFor(range, data.latestDate);
  const shown = cutoff ? all.filter((d) => d.quoteDate >= cutoff) : all;
  const last = all[all.length - 1];
  const monthAgo = daysAgo(last.quoteDate, 30);
  const estimated = shown.filter((d) => d.estimated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption(
    STATE_ORDER.map((s, i) => ({ name: s, color: seriesColor(i), points: shown.map((d) => [d.quoteDate, d[s]] as [string, number]) })),
    {
      yFormat: (v) => `$${v.toFixed(2)}`,
      tooltipValue: (v) => `${money(v, 4)}/kWh`,
      notes: new Map(estimated.map((d) => [d.quoteDate, 'Includes estimated months'])),
    },
  ), [shown, theme]);

  const comp = cutoff ? data.index.filter((d) => d.quoteDate >= cutoff) : data.index;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const compOption = useMemo(() => stackedAreaOption(
    comp.map((d) => d.quoteDate),
    COMPONENTS.map((name, i) => ({ name, color: seriesColor(i), values: comp.map((d) => d.components[state][i]) })),
    (v) => `${money(v, 4)}/kWh`,
  ), [comp, state, theme]);

  const description = method === 'current'
    ? `Reference customer: 400,000 kWh a year, 50% peak, load factor 0.55, on each state's default large low-voltage tariff (${TARIFF_YEAR} rates). Each date prices a three-year contract starting the next quarter. $/kWh.`
    : 'The Streamlit app\'s method: 400,000 kWh, 50% peak, fixed network and system charges, and the average of whichever FY strips ASX listed that day. $/kWh.';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATE_ORDER.map((s, i) => {
          const before = valueOnOrBefore(all, monthAgo, (d) => d[s]);
          return (
            <Stat key={s} label={s} keyColor={seriesColor(i)} value={money(last[s], 4)} unit="/kWh"
              sub={before === undefined ? '—' : `${signed(last[s] - before, 4, '$')} vs 30 days ago`} />
          );
        })}
      </div>
      <Card>
        <CardHeader title={method === 'current' ? 'Bulk price index by state' : 'Bulk price index by state · original method'} description={description} />
        <div className="space-y-3 p-5">
          <Legend items={STATE_ORDER.map((s, i) => ({ label: s, color: seriesColor(i), line: true }))} />
          <EChart option={option} height={380} ariaLabel="Line chart of the bulk price index for each state over time" />
          {method === 'current' && (
            <div className="space-y-1 text-xs text-subtle">
              <p>Network charges use this year's tariffs on every date until historical tariffs are added. VIC and SA use placeholder tariffs.</p>
              {estimated.length > 0 && (
                <p className="flex items-start gap-1.5 text-warning-text">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  {num(estimated.length, 0)} of {num(shown.length, 0)} dates include estimated months: ASX didn't list a contract for part of the three years, so those months were carried forward or back-filled.
                </p>
              )}
            </div>
          )}
        </div>
        <TableDisclosure count={shown.length}>
          <DataTable stickyHead head={['Quote date', ...STATE_ORDER, ...(method === 'current' ? ['Estimate'] : [])]}
            rows={[...shown].reverse().map((d) => [shortDate(d.quoteDate), ...STATE_ORDER.map((s) => money(d[s], 4)), ...(method === 'current' ? [d.estimated ? 'Yes' : ''] : [])])} />
        </TableDisclosure>
      </Card>
      {method === 'current' && (
        <Card>
          <CardHeader
            title={`What makes up the ${state} index`}
            description={`Energy, network, other and fixed parts of the index, $/kWh. Network: ${tariffLabel(defaultTariff(state, 'large-lv').id)}.`}
          />
          <div className="space-y-3 p-5">
            <Legend items={COMPONENTS.map((c, i) => ({ label: c, color: seriesColor(i) }))} />
            <EChart option={compOption} height={300} ariaLabel={`Stacked area chart of the parts of the ${state} bulk price index over time`} />
          </div>
        </Card>
      )}
    </div>
  );
}

function FuturesTab({ data, range, state }: { data: MarketData; range: RangeKey; state: State }) {
  const theme = useResolvedTheme();
  const cutoff = cutoffFor(range, data.latestDate);
  const active = data.latestFy.map((r) => r.year);
  const years = [...new Set(data.records.map((r) => r.year))].sort((a, b) => a - b);
  const delisted = years.filter((y) => !active.includes(y));
  const monthAgo = daysAgo(data.latestDate, 30);

  const seriesFor = (y: number) => data.records
    .filter((r) => r.year === y && (!cutoff || r.quoteDate >= cutoff))
    .sort((a, b) => (a.quoteDate < b.quoteDate ? -1 : 1))
    .map((r) => [r.quoteDate, r[state]] as [string, number]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption([
    ...delisted.map((y) => ({ name: fy(y), color: token('--series-muted'), points: seriesFor(y), width: 1.5, z: 1, muted: false })),
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
        <CardHeader
          title={`${state} FY base strip settlement prices`}
          description="FY strips ASX still lists are coloured. Grey strips are no longer quoted: ASX stops listing a financial year once it's in delivery (or, since its 2026 site change, once its first quarter has passed). $/MWh."
        />
        <div className="space-y-3 p-5">
          <Legend items={[
            ...active.map((y, i) => ({ label: `${fy(y)} (quoted)`, color: seriesColor(i), line: true })),
            ...(delisted.length ? [{ label: 'No longer quoted', color: token('--series-muted'), line: true }] : []),
          ]} />
          <EChart option={option} height={380} ariaLabel={`Line chart of ${state} futures settlement prices by contract year`} />
        </div>
        <TableDisclosure count={rows.length}>
          <DataTable stickyHead head={['Quote date', 'Contract', ...STATE_ORDER]} highlightCol={STATE_ORDER.indexOf(state) + 2}
            rows={rows.map((r) => [shortDate(r.quoteDate), fy(r.year), ...STATE_ORDER.map((s) => num(r[s], 2))])} />
        </TableDisclosure>
      </Card>
      <Card>
        <CardHeader
          title={`All contracts quoted on ${shortDate(data.latestDate)}`}
          description="Quarterly, calendar-year and financial-year base contracts, $/MWh. Quotes use these to price any 12-month supply period. Collected daily from 13 Nov 2026."
        />
        <div className="p-5">
          <DataTable
            head={['Contract', 'Months', ...STATE_ORDER]}
            highlightCol={STATE_ORDER.indexOf(state) + 2}
            rows={data.curve.map((c) => [shortContract(c.contract), periodRange(c.start, c.months), ...STATE_ORDER.map((s) => num(c[s], 2))])}
          />
        </div>
      </Card>
    </div>
  );
}

export function MarketPage({ data }: { data: MarketData }) {
  const [tab, setTab] = useState<'index' | 'futures'>('index');
  const [range, setRange] = useState<RangeKey>('2Y');
  const [state, setState] = useState<State>('NSW');
  const [method, setMethod] = useState<Method>('current');

  const download = () => {
    if (tab === 'futures') downloadCsv('historical-futures-data.csv', futuresCsv(data.records));
    else if (method === 'original') downloadCsv('historical_bulk_price_index.csv', bulkIndexCsv(data.legacyIndex));
    else downloadCsv('bulk_price_index.csv', bulkIndex2Csv(data.index));
  };

  return (
    <>
      <PageHeader title="Market" description="ASX Energy base futures and the bulk price index built from them." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <TabsList className="border-b-0 px-0">
            <TabsTrigger value="index">Bulk price index</TabsTrigger>
            <TabsTrigger value="futures">Futures</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {tab === 'index' && <Segmented label="Index method" size="sm" value={method} onChange={setMethod} options={[{ value: 'current', label: 'Current' }, { value: 'original', label: 'Original' }]} />}
            {(tab === 'futures' || method === 'current') && <Segmented label="State" size="sm" value={state} onChange={setState} options={STATE_ORDER} />}
            <Segmented label="Date range" size="sm" value={range} onChange={setRange} options={RANGES.map(([k]) => k)} />
            <Button size="sm" onClick={download}><Download /> CSV</Button>
          </div>
        </div>
        <TabsContent value="index"><IndexTab data={data} range={range} method={method} state={state} /></TabsContent>
        <TabsContent value="futures"><FuturesTab data={data} range={range} state={state} /></TabsContent>
      </Tabs>
    </>
  );
}

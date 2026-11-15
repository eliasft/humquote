import { useMemo, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { AlertTriangle, ChevronDown, Download } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { DataTable } from '@/components/DataTable';
import { EChart, Legend, forwardCurveOption, seriesColor, stackedAreaOption, timeLineOption, token } from '@/components/charts/charts';
import { Button, Card, CardHeader, NumberField, Segmented, Stat, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DEFAULT_CARRY_FORWARD_RATE, type State } from '@/core/calc';
import { STATE_ORDER, bulkPriceIndex, indexInputs } from '@/core/analysis';
import {
  KIND_LABELS, KIND_ORDER, contractHistory, contractKind, groupByKind, monthKey, periodRange, shortContract, splitEstimates,
  type ContractKind, type ContractSeries,
} from '@/core/periods';
import { TARIFF_YEAR, tariffLabel } from '@/core/tariffs';
import type { MarketData } from '@/lib/data';
import { allContractsCsv, bulkIndex2Csv, bulkIndexCsv, downloadCsv } from '@/lib/export';
import { RANGES, cutoffFor, daysAgo, isoDate, money, num, parseDate, shortDate, signed, valueOnOrBefore, type RangeKey } from '@/lib/format';
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

function IndexTab({ data, range, method, state, carryRate, onCarryRate }: {
  data: MarketData; range: RangeKey; method: Method; state: State; carryRate: number; onCarryRate: (v: number) => void;
}) {
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
    ? `Reference customer: 400,000 kWh a year, 50% peak, load factor 0.55, low voltage, on the tariff each state's default network suggests for it. Each date prices a three-year contract starting the next quarter. $/kWh.`
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
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="w-56">
                <NumberField id="index-carry" label="Carry-forward escalation" value={carryRate} onChange={onCarryRate} unit="% a year" step={0.5} min={-50} max={50} decimals={2} />
              </div>
              <p className="max-w-xl pb-1 text-xs text-subtle">
                Applied to months beyond the last ASX contract listed on each date. Changing it only affects dates flagged as estimates.
              </p>
            </div>
          )}
          {method === 'current' && (
            <div className="space-y-1 text-xs text-subtle">
              <p>Network charges are the rates in force on each date: Essential BLND3AO and Energex 7200 from each financial year's price list, FY22 onwards. VIC and SA use placeholder tariffs at {TARIFF_YEAR} rates.</p>
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
            description={`Energy, network, other and fixed parts of the index, $/kWh. Network: ${tariffLabel(indexInputs(state).tariffId)}.`}
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

// Contract types, in the order they're shown everywhere: FY, CY, then quarters.
const KIND_OPTIONS = KIND_ORDER.map((k) => ({ value: k, label: k === 'Q' ? 'Quarters' : k }));
const firstOfMonth = (i: number) => `${monthKey(i)}-01`;
const shiftDays = (iso: string, days: number) => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

function FuturesTab({ data, range, state, kind }: { data: MarketData; range: RangeKey; state: State; kind: ContractKind }) {
  const theme = useResolvedTheme();
  const cutoff = cutoffFor(range, data.latestDate);
  const monthAgo = daysAgo(data.latestDate, 30);
  // A price from 30–40 days ago, so a gap in collection (CY strips, Jun–Nov 2026)
  // doesn't turn into a months-long change labelled "30 days".
  const monthWindow = daysAgo(data.latestDate, 40);
  const history = useMemo(() => contractHistory(data.curves, kind), [data.curves, kind]);
  const active = history.filter((c) => c.active);
  const colour = (c: ContractSeries) => (c.active ? seriesColor(active.indexOf(c)) : token('--series-muted'));
  const inRange = (p: { quoteDate: string }) => !cutoff || p.quoteDate >= cutoff;
  const allDays = [...new Set(history.flatMap((c) => c.points.map((p) => p.quoteDate)))].sort();
  const days = allDays.length;
  const first = days ? shortDate(allDays[0]) : '';

  // With only a few days of history (quarters, collected from 13 Nov 2026),
  // show at least a month so the date axis stays readable.
  const shown = history.map((c) => ({ c, points: c.points.filter(inRange) })).filter((s) => s.points.length);
  const dates = shown.flatMap((s) => s.points.map((p) => p.quoteDate)).sort();
  const shortHistory = dates.length > 0 && daysAgo(dates[dates.length - 1], 30) < dates[0];

  // Estimated CY prices for the 2026 gap (only FY strips were collected): drawn dashed,
  // with the gap shaded. They're never used for pricing.
  const estimatesFor = (contract: string) => data.estimates
    .filter((r) => r[1] === contract && inRange({ quoteDate: r[0] }))
    .map((r) => [r[0], r[4 + STATE_ORDER.indexOf(state)] as number] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const estDates = kind === 'CY' ? shown.flatMap((s) => estimatesFor(s.c.contract).map((e) => e[0])).sort() : [];
  const hasEstimates = estDates.length > 0;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => timeLineOption(
    [...shown.filter((s) => !s.c.active), ...shown.filter((s) => s.c.active)].flatMap(({ c, points }) => {
      const real = points.map((p) => [p.quoteDate, p[state]] as [string, number]);
      const { solid, dashed } = splitEstimates(real, kind === 'CY' ? estimatesFor(c.contract) : [],
        hasEstimates ? [estDates[0], estDates[estDates.length - 1]] : undefined);
      const base = { color: colour(c), width: c.active ? 2 : 1.5, z: c.active ? 3 : 1 };
      return [
        { ...base, name: shortContract(c.contract), points: solid, symbols: points.length < 5 },
        ...(dashed.length ? [{ ...base, name: `${shortContract(c.contract)} (estimate)`, points: dashed, dashed: true }] : []),
      ];
    }),
    {
      yFormat: (v) => `$${v.toFixed(0)}`,
      tooltipValue: (v) => `$${num(v, 2)}/MWh`,
      xRange: shortHistory ? [shiftDays(dates[0], -7), shiftDays(dates[dates.length - 1], 21)] : undefined,
      notes: new Map(estDates.map((d) => [d, 'Estimated from FY prices: not ASX settlements'])),
      bands: hasEstimates ? [{ from: estDates[0], to: estDates[estDates.length - 1], label: 'Not collected · estimated' }] : undefined,
    },
  ), [history, range, state, theme, data.estimates]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const curveOption = useMemo(() => {
    const styles = { Q: { color: seriesColor(0), width: 3 }, CY: { color: seriesColor(1), dashed: true }, FY: { color: seriesColor(2) } };
    return forwardCurveOption(data.curve.map((c) => ({
      name: shortContract(c.contract),
      from: firstOfMonth(c.start),
      to: firstOfMonth(c.start + c.months),
      value: c[state],
      ...styles[contractKind(c)],
    })));
  }, [data.curve, state, theme]);
  const curveKinds = groupByKind(data.curve).map((g) => g.kind);
  const curveColours = { Q: seriesColor(0), CY: seriesColor(1), FY: seriesColor(2) };

  const rows = shown.flatMap(({ c, points }) => [
    ...points.map((p) => ({ ...p, contract: c.contract, estimate: false })),
    ...(kind === 'CY' ? data.estimates.filter((r) => r[1] === c.contract && inRange({ quoteDate: r[0] }))
      .map((r) => ({ quoteDate: r[0], start: c.start, contract: c.contract, estimate: true, NSW: r[4], VIC: r[5], QLD: r[6], SA: r[7] })) : []),
  ]).sort((a, b) => (a.quoteDate === b.quoteDate ? b.start - a.start : a.quoteDate < b.quoteDate ? 1 : -1));

  // The latest contracts in sections: financial years, calendar years, quarters.
  const groupedRows = groupByKind(data.curve).flatMap((g) => [
    [<span className="text-xs font-semibold uppercase tracking-wide text-foreground">{g.label}</span>, '', ...STATE_ORDER.map(() => '')],
    ...g.contracts.map((c) => [shortContract(c.contract), periodRange(c.start, c.months), ...STATE_ORDER.map((s) => num(c[s], 2))]),
  ]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {active.map((c) => {
          const now = c.points[c.points.length - 1][state];
          const before = valueOnOrBefore(c.points.filter((p) => p.quoteDate >= monthWindow), monthAgo, (p) => p[state]);
          const sub = before !== undefined ? `${signed(now - before, 2, '$')} vs 30 days ago`
            : c.points[0].quoteDate > monthAgo ? `New since ${shortDate(c.points[0].quoteDate)}` : 'No price 30 days ago';
          return (
            <Stat key={c.contract} label={`${shortContract(c.contract)} · ${state}`} keyColor={colour(c)} value={`$${num(now, 2)}`} unit="/MWh" sub={sub} />
          );
        })}
      </div>
      <Card>
        <CardHeader
          title={`${state} ${KIND_LABELS[kind].toLowerCase()} · settlement prices`}
          description={kind === 'Q'
            ? 'Contracts ASX still lists are coloured; grey ones are no longer quoted. $/MWh.'
            : 'Strips ASX still lists are coloured. Grey strips are no longer quoted: ASX stops listing a strip once its first quarter is over. $/MWh.'}
        />
        <div className="space-y-3 p-5">
          <Legend items={[
            ...active.map((c) => ({ label: `${shortContract(c.contract)} (quoted)`, color: colour(c), line: true })),
            ...(history.length > active.length ? [{ label: 'No longer quoted', color: token('--series-muted'), line: true }] : []),
            ...(hasEstimates ? [{ label: 'Estimated from FY prices', color: token('--muted-foreground'), line: true, dashed: true }] : []),
          ]} />
          <EChart option={option} height={380} ariaLabel={`Line chart of ${state} ${KIND_LABELS[kind].toLowerCase()} settlement prices over time`} />
          {kind === 'FY' && days > 0 && (
            <p className="text-xs text-muted-foreground">Financial years are collected from {first}. Before then ASX&apos;s page listed calendar years: see CY.</p>
          )}
          {kind === 'CY' && days > 0 && (
            <p className="text-xs text-muted-foreground">
              Calendar years go back to {first} (sparse before 2024). From 22 June to 12 November 2026 only financial years were
              collected (plus every contract on 22 July): the dashed lines estimate CY2027 and CY2028 from the FY prices, typically
              within $1–2/MWh. They&apos;re for the chart only and aren&apos;t used in any price or index.
            </p>
          )}
          {kind === 'Q' && days > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-warning-text">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              Quarters are collected from {first}, so there {days === 1 ? 'is 1 day' : `are ${days} days`} of history so far.
            </p>
          )}
        </div>
        <TableDisclosure count={rows.length}>
          <DataTable stickyHead head={['Quote date', 'Contract', ...STATE_ORDER]} highlightCol={STATE_ORDER.indexOf(state) + 2}
            rows={rows.map((r) => [shortDate(r.quoteDate), `${shortContract(r.contract)}${r.estimate ? ' (estimate)' : ''}`, ...STATE_ORDER.map((s) => num(r[s], 2))])} />
        </TableDisclosure>
      </Card>
      <Card>
        <CardHeader
          title={`${state} forward curve`}
          description={`What the market prices each delivery period at, quoted on ${shortDate(data.latestDate)}. Quarters are steps; calendar- and financial-year strips span their 12 months. A quote prices each year from a matching strip, or from its quarters. $/MWh.`}
        />
        <div className="space-y-3 p-5">
          <Legend items={curveKinds.map((k) => ({ label: KIND_LABELS[k], color: curveColours[k], line: true }))} />
          <EChart option={curveOption} height={320} ariaLabel={`Forward curve of ${state} base contracts quoted on ${shortDate(data.latestDate)}`} />
        </div>
      </Card>
      <Card>
        <CardHeader
          title={`All contracts quoted on ${shortDate(data.latestDate)}`}
          description="Financial-year, calendar-year and quarterly base contracts, $/MWh. Quotes use these to price any 12-month supply period. Calendar years and quarters are collected daily from 13 Nov 2026."
        />
        <div className="p-5">
          <DataTable head={['Contract', 'Months', ...STATE_ORDER]} highlightCol={STATE_ORDER.indexOf(state) + 2} rows={groupedRows} />
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
  const [kind, setKind] = useState<ContractKind>('FY');
  const [carryRate, setCarryRate] = useState(DEFAULT_CARRY_FORWARD_RATE);
  // The index at the chosen carry-forward rate (the default is precomputed with the data).
  const index = useMemo(
    () => (carryRate === DEFAULT_CARRY_FORWARD_RATE ? data.index : bulkPriceIndex(data.curves, carryRate)),
    [data, carryRate],
  );

  const download = () => {
    if (tab === 'futures') downloadCsv('all-futures-contracts.csv', allContractsCsv(data.curves));
    else if (method === 'original') downloadCsv('historical_bulk_price_index.csv', bulkIndexCsv(data.legacyIndex));
    else downloadCsv('bulk_price_index.csv', bulkIndex2Csv(index));
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
            {tab === 'futures' && <Segmented label="Contract type" size="sm" value={kind} onChange={setKind} options={KIND_OPTIONS} />}
            {(tab === 'futures' || method === 'current') && <Segmented label="State" size="sm" value={state} onChange={setState} options={STATE_ORDER} />}
            <Segmented label="Date range" size="sm" value={range} onChange={setRange} options={RANGES.map(([k]) => k)} />
            <Button size="sm" onClick={download} title={tab === 'futures' ? 'Every contract on every date, with its type, start and length' : undefined}>
              <Download /> {tab === 'futures' ? 'All contracts CSV' : 'CSV'}
            </Button>
          </div>
        </div>
        <TabsContent value="index">
          <IndexTab data={{ ...data, index }} range={range} method={method} state={state} carryRate={carryRate} onCarryRate={setCarryRate} />
        </TabsContent>
        <TabsContent value="futures"><FuturesTab data={data} range={range} state={state} kind={kind} /></TabsContent>
      </Tabs>
    </>
  );
}

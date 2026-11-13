import { useMemo } from 'react';
import { ArrowRight, Bookmark } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { DataTable } from '@/components/DataTable';
import { EChart, Legend, breakdownOption, seriesColor } from '@/components/charts/charts';
import { Button, Card, CardHeader } from '@/components/ui/primitives';
import { calculateBulkPrices, type QuoteInputs } from '@/core/calc';
import { compareStates, quotePeriods, unionEstimates } from '@/core/analysis';
import { tariffById, tariffLabel } from '@/core/tariffs';
import type { MarketData } from '@/lib/data';
import { INPUT_LABELS, inputDisplay } from '@/lib/export';
import { money, num, shortDate, signed } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useStore } from '@/lib/store';
import { useResolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/cn';

const COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed'];

function StatesCompare({ data }: { data: MarketData }) {
  const inputs = useStore((s) => s.inputs);
  const current = useStore((s) => s.state);
  const setState = useStore((s) => s.setState);
  const theme = useResolvedTheme();
  const periods = useMemo(() => quotePeriods(data.curve, inputs), [data.curve, inputs]);
  const rows = useMemo(() => compareStates(periods, inputs), [periods, inputs]);
  const cheapest = Math.min(...rows.map((r) => r.result.bulkPrice));
  const parts = COMPONENTS.map((name, i) => ({ name, color: seriesColor(i), values: rows.map((r) => r.result.rates.rows[i].average) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const option = useMemo(() => breakdownOption(rows.map((r) => r.state), parts, rows.map((r) => r.result.bulkPrice)), [rows, theme]);

  return (
    <Card>
      <CardHeader title="States side by side" description="Your current inputs priced in each state, each on its own default network tariff for the same customer segment. Bars show the three-year average by component." />
      <div className="space-y-4 p-5">
        <Legend items={parts.map((p) => ({ label: p.name, color: p.color }))} />
        <EChart option={option} height={220} ariaLabel="Stacked bars comparing the price components in each state" />
        <DataTable
          head={['State', 'Network tariff', 'Year 1', 'Year 2', 'Year 3', 'Average', 'vs lowest', '']}
          highlightCol={5}
          rows={rows.map(({ state, result, inputs: stateInputs }) => [
            <span className={cn('font-medium', state === current ? 'text-foreground' : undefined)}>{state}{state === current && <span className="ml-1.5 text-xs text-accent-text">current</span>}</span>,
            <span className={cn('text-muted-foreground', tariffById(stateInputs.tariffId)?.status === 'placeholder' && 'text-warning-text')}>{tariffLabel(stateInputs.tariffId)}</span>,
            ...result.rates.rows[4].values.map((v) => money(v, 4)),
            <span className="font-semibold">{money(result.bulkPrice, 4)}</span>,
            result.bulkPrice === cheapest ? <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent-text">lowest</span> : signed(result.bulkPrice - cheapest, 4, '$'),
            <Button variant="ghost" size="sm" onClick={() => { setState(state); navigate('quote'); }}>Open <ArrowRight /></Button>,
          ])}
        />
      </div>
    </Card>
  );
}

function fmtInput(k: keyof QuoteInputs, inputs: QuoteInputs) {
  const v = inputDisplay(k, inputs);
  if (typeof v === 'string') return v;
  if (k === 'totalConsumption') return num(v, 0);
  return v.toLocaleString('en-AU', { maximumFractionDigits: 4 });
}

function SavedCompare({ data }: { data: MarketData }) {
  const saved = useStore((s) => s.saved);
  const compareIds = useStore((s) => s.compareIds);
  const quotes = compareIds.map((id) => saved.find((q) => q.id === id)).filter((q) => q !== undefined);

  if (!quotes.length) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-muted"><Bookmark className="size-5 text-muted-foreground" /></span>
        <div>
          <div className="font-medium">Compare saved quotes</div>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {saved.length ? 'Pick up to three quotes on the Saved page to see them side by side, re-priced with today’s data.' : 'Save a quote from the Quote page, then pick up to three here to compare them side by side.'}
          </p>
        </div>
        <Button onClick={() => navigate(saved.length ? 'saved' : 'quote')}>{saved.length ? 'Choose quotes' : 'Go to Quote'} <ArrowRight /></Button>
      </Card>
    );
  }

  const priced = quotes.map((q) => {
    const periods = quotePeriods(data.curve, q.inputs);
    return { q, now: calculateBulkPrices(periods, q.inputs, q.state), estimated: unionEstimates(periods).length > 0 };
  });
  const differs = (k: keyof QuoteInputs) => new Set(quotes.map((q) => q.inputs[k])).size > 1;

  return (
    <Card>
      <CardHeader
        title="Saved quotes side by side"
        description="Re-priced with the latest ASX data. Inputs that differ are highlighted."
        actions={<Button size="sm" onClick={() => navigate('saved')}>Change selection</Button>}
      />
      <div className="p-5">
        <DataTable
          head={['', ...quotes.map((q) => <span className="normal-case text-foreground">{q.name}</span>)]}
          rows={[
            ['Price now ($/kWh)', ...priced.map(({ now, estimated }) => <span className="text-base font-semibold">{money(now.bulkPrice, 4)}{estimated && <span className="ml-1 text-xs font-medium text-warning-text" title="Includes estimated months">est.</span>}</span>)],
            ['When saved', ...priced.map(({ q, now }) => <span>{money(q.priceAtSave, 4)} <span className="text-xs text-subtle">({signed(now.bulkPrice - q.priceAtSave, 4, '$')})</span></span>)],
            ['Saved on', ...quotes.map((q) => shortDate(q.dataDate))],
            [
              <span className={cn(new Set(quotes.map((q) => q.state)).size > 1 && 'font-medium text-foreground')}>State</span>,
              ...quotes.map((q) => <span className={cn(new Set(quotes.map((x) => x.state)).size > 1 && 'rounded bg-accent-soft px-1.5 py-0.5 text-accent-text')}>{q.state}</span>),
            ],
            ...['Energy', 'Network', 'Other', 'Fixed'].map((c, i) => [`${c} ($/kWh)`, ...priced.map(({ now }) => money(now.rates.rows[i].average, 4))]),
            ...INPUT_LABELS.map(([k, label]) => [
              <span className={cn(differs(k) && 'font-medium text-foreground')}>{label}</span>,
              ...quotes.map((q) => <span className={cn(differs(k) && 'rounded bg-accent-soft px-1.5 py-0.5 text-accent-text')}>{fmtInput(k, q.inputs)}</span>),
            ]),
          ]}
        />
      </div>
    </Card>
  );
}

export function ComparePage({ data }: { data: MarketData }) {
  return (
    <>
      <PageHeader title="Compare" description="See how the price changes across states, and compare saved quotes." />
      <div className="space-y-6">
        <StatesCompare data={data} />
        <SavedCompare data={data} />
      </div>
    </>
  );
}

// The tariff catalogue (reference-data/tariffs.json), read-only: every network's
// tariffs with their rates, time windows, notes, past years' rates and sources.

import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { PageHeader } from '@/components/Shell';
import { DataTable } from '@/components/DataTable';
import { Card, CardHeader, Segmented } from '@/components/ui/primitives';
import { STATES, type State } from '@/core/calc';
import { STATE_ORDER, indexInputs } from '@/core/analysis';
import {
  DEMAND_BASIS, NETWORKS, TARIFFS, TARIFF_YEAR, defaultNetwork, eligibilityText, rateHistory, tariffsOf,
  type Network, type Tariff,
} from '@/core/tariffs';
import { num } from '@/lib/format';
import { cn } from '@/lib/cn';

type Filter = 'All' | State;

const rate = (v: number) => num(v, 4);
const PERIODS = [['Peak', 'peak'], ['Shoulder', 'shoulder'], ['Off-peak', 'offPeak']] as const;

// The tariff each state's bulk price index prices its reference customer on.
const INDEX_TARIFFS = new Map(STATES.map((s) => [indexInputs(s).tariffId, s]));

function StatusTag({ t }: { t: Tariff }) {
  return t.status === 'placeholder'
    ? <span className="rounded-md bg-warning/12 px-1.5 py-0.5 text-xs font-medium text-warning-text">Placeholder</span>
    : <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Researched</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">{title}</h3>
      {children}
    </section>
  );
}

function TariffDetails({ t }: { t: Tariff }) {
  const years = rateHistory(t);
  const flat = t.energy.peak === t.energy.shoulder && t.energy.shoulder === t.energy.offPeak;
  const windows = t.energyWindows;
  const energyRows = flat
    ? [['All times', '', rate(t.energy.peak)]]
    : PERIODS.filter(([, k]) => !windows || windows[k] !== null)
      .map(([label, k]) => [label, windows?.[k] ?? '', rate(t.energy[k])]);
  const index = INDEX_TARIFFS.get(t.id);
  return (
    <div className="grid gap-5 px-5 pb-5 pt-1 xl:grid-cols-2">
      {t.status === 'placeholder' && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-[13px] text-warning-text xl:col-span-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div>Placeholder: these are stand-in rates until this network's {TARIFF_YEAR} tariff is researched. Quotes on it are indicative only.</div>
        </div>
      )}
      <Section title="Energy (c/kWh)">
        <DataTable className="rounded-lg border border-border" head={['Period · network window', 'Rate']}
          rows={energyRows.map(([label, window, v]) => [
            <span className="block whitespace-normal"><span className="text-foreground">{label}</span>{window && <span className="block">{window}</span>}</span>, v,
          ])} />
      </Section>
      <Section title="Demand ($/kVA/month)">
        {t.demand.lines.length ? (
          <DataTable className="rounded-lg border border-border" head={['Charge · window · how the kVA is set', 'Rate']}
            rows={t.demand.lines.map((l) => [
              <span className="block whitespace-normal">
                <span className="text-foreground">{l.label}</span>
                <span className="block">{l.window}</span>
                <span className="block text-subtle">{DEMAND_BASIS[l.basis]}</span>
              </span>,
              rate(l.rate),
            ])} />
        ) : <p className="text-sm text-muted-foreground">No demand charge.</p>}
        <p className="mt-2 text-sm">Fixed charge: <span className="tabular font-medium">${rate(t.fixed)}</span> a day</p>
      </Section>
      {(t.periods || t.notes.length > 0) && (
        <Section title="Time windows and notes">
          <div className="space-y-1.5 text-sm text-muted-foreground">
            {t.periods && <p>{t.periods}</p>}
            {t.notes.map((n) => <p key={n}>{n}</p>)}
            {index && <p>The bulk price index prices {index}'s reference customer on this tariff.</p>}
          </div>
        </Section>
      )}
      <Section title="Source">
        <p className="text-sm text-muted-foreground">{t.source}</p>
        {t.toConfirm && t.toConfirm.length > 0 && (
          <p className="mt-1.5 text-sm text-warning-text">To confirm: {t.toConfirm.join(', ')}.</p>
        )}
      </Section>
      {years.length > 1 && (
        <div className="xl:col-span-2">
          <Section title="Rates by financial year">
            <DataTable className="rounded-lg border border-border"
              head={['Year', 'Peak c/kWh', 'Shoulder c/kWh', 'Off-peak c/kWh', 'Demand $/kVA/mo', 'Fixed $/day']}
              rows={years.map((r) => [r.year, rate(r.energy.peak), rate(r.energy.shoulder), rate(r.energy.offPeak), rate(r.demand.rate), rate(r.fixed)])} />
            <ul className="mt-2 space-y-0.5 text-xs text-subtle">
              {years.slice(1).map((r) => <li key={r.year}>{r.year}: {r.source}</li>)}
            </ul>
            <p className="mt-1 text-xs text-subtle">Demand is the sum of the tariff's demand charges.</p>
          </Section>
        </div>
      )}
    </div>
  );
}

function TariffRow({ t }: { t: Tariff }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-t border-border">
      <Collapsible.Trigger className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-card-2">
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{t.status === 'placeholder' ? 'Placeholder' : t.code}</span>
          <span className="text-muted-foreground"> · {t.name}</span>
          <span className="block text-[13px] text-subtle">{t.voltage} · {eligibilityText(t)}</span>
        </span>
        <StatusTag t={t} />
      </Collapsible.Trigger>
      <Collapsible.Content>{open && <TariffDetails t={t} />}</Collapsible.Content>
    </Collapsible.Root>
  );
}

function NetworkCard({ n }: { n: Network }) {
  const tariffs = tariffsOf(n.id);
  const isDefault = defaultNetwork(n.state).id === n.id;
  const allPlaceholder = tariffs.every((t) => t.status === 'placeholder');
  return (
    <Card>
      <CardHeader
        title={n.name}
        description={[n.state, isDefault && `default network for ${n.state}`, allPlaceholder && 'placeholder rates until researched'].filter(Boolean).join(' · ')}
      />
      <DataTable
        className="mt-3 border-t border-border"
        head={['Tariff', 'Voltage', 'Peak c/kWh', 'Shoulder', 'Off-peak', 'Demand $/kVA/mo', 'Fixed $/day']}
        rows={tariffs.map((t) => [
          <span className="text-foreground">{t.status === 'placeholder' ? 'Placeholder' : t.code} <span className="text-muted-foreground">· {t.name}</span></span>,
          t.voltage, rate(t.energy.peak), rate(t.energy.shoulder), rate(t.energy.offPeak), rate(t.demand.rate), rate(t.fixed),
        ])}
      />
      <div className="mt-3">
        {tariffs.map((t) => <TariffRow key={t.id} t={t} />)}
      </div>
    </Card>
  );
}

export function TariffsPage() {
  const [filter, setFilter] = useState<Filter>('All');
  const networks = [...NETWORKS]
    .filter((n) => filter === 'All' || n.state === filter)
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  const researched = TARIFFS.filter((t) => t.status !== 'placeholder').length;
  return (
    <>
      <PageHeader
        title="Network tariffs"
        description={`${TARIFF_YEAR} network tariffs from the networks' published price lists, excluding GST. Choosing one on the Quote page fills in its network charges.`}
        actions={<Segmented label="State" value={filter} onChange={setFilter} options={['All', ...STATE_ORDER]} />}
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {researched} researched · {TARIFFS.length - researched} placeholders (stand-in rates, flagged wherever they're used).
        Open a tariff for its time windows, demand charges, notes and sources.
      </p>
      <div className="space-y-5">
        {networks.map((n) => <NetworkCard key={n.id} n={n} />)}
      </div>
    </>
  );
}

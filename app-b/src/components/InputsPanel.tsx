import { useState, type ReactNode } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Select from '@radix-ui/react-select';
import { AlertCircle, AlertTriangle, Check, ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  applyTariff, demandKva, demandLineLabels, estimatedDemand, startBill, tariffMatches, type QuoteInputs, type State,
} from '@/core/calc';
import { validateInputs } from '@/core/analysis';
import { monthIndex, monthKey, monthLabel, nextQuarter } from '@/core/periods';
import {
  TARIFF_YEAR, VOLTAGES, defaultNetwork, fitIssues, networkOf, networksFor, suggestTariff, tariffById, tariffLabel, tariffOptionLabel,
  tariffState, tariffsOf, type Voltage,
} from '@/core/tariffs';
import { useStore } from '@/lib/store';
import { num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button, Card, NumberField, Segmented } from './ui/primitives';

type FieldSpec = [label: string, key: keyof QuoteInputs, opts: { unit?: string; step?: number; min?: number; max?: number; decimals?: number; hint?: string }];

function Section({ title, summary, defaultOpen, children }: { title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="border-b border-border last:border-b-0">
      <Collapsible.Trigger className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left hover:bg-card-2">
        <span className="text-sm font-semibold">{title}</span>
        {summary && !open && <span className="ml-auto truncate text-xs text-subtle">{summary}</span>}
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open ? 'ml-auto rotate-180' : !summary && 'ml-auto')} />
      </Collapsible.Trigger>
      <Collapsible.Content className="grid grid-cols-[minmax(0,1fr)] gap-3 px-5 pb-5">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

interface Option { value: string; label: ReactNode; text: string; tag?: string }

function SelectField({ id, label, value, onChange, groups, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; groups: { label?: string; options: Option[] }[]; hint?: ReactNode;
}) {
  const all = groups.flatMap((g) => g.options);
  const current = all.find((o) => o.value === value);
  return (
    <div>
      <div id={`${id}-label`} className="mb-1 text-[13px] text-muted-foreground">{label}</div>
      <Select.Root value={current ? value : undefined} onValueChange={onChange}>
        <Select.Trigger aria-labelledby={`${id}-label`} className="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border-strong bg-card px-3 text-left text-sm outline-none focus:border-ring focus:ring-3 focus:ring-accent-soft">
          <span className="truncate"><Select.Value placeholder="Choose…">{current?.text}</Select.Value></span>
          <Select.Icon><ChevronDown className="size-4 shrink-0 text-subtle" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={4} className="z-50 max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-card p-1 shadow-pop">
            <Select.Viewport>
              {groups.map((g, gi) => (
                <Select.Group key={gi}>
                  {g.label && <Select.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">{g.label}</Select.Label>}
                  {g.options.map((o) => (
                    <Select.Item key={o.value} value={o.value} className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted">
                      <Select.ItemText>{o.label}</Select.ItemText>
                      <span className="flex items-center gap-2">
                        {o.tag && <span className="rounded bg-warning/15 px-1.5 text-[11px] font-medium text-warning-text">{o.tag}</span>}
                        <Select.ItemIndicator><Check className="size-4 text-accent-text" /></Select.ItemIndicator>
                      </span>
                    </Select.Item>
                  ))}
                </Select.Group>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {hint && <div className="mt-1.5 text-xs text-subtle">{hint}</div>}
    </div>
  );
}

function Callout({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]', tone === 'warning' ? 'bg-warning/12 text-warning-text' : 'bg-danger-soft text-danger')}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function NetworkTariff({ state }: { state: State }) {
  const inputs = useStore((s) => s.inputs);
  const setTariff = useStore((s) => s.setTariff);
  const setInputs = useStore((s) => s.setInputs);
  const tariff = tariffById(inputs.tariffId);
  const tState = tariffState(inputs.tariffId);
  const mismatch = tState !== undefined && tState !== state;
  const edited = !tariffMatches(inputs);
  const mwh = inputs.totalConsumption / 1000;
  const network = tariff && !mismatch ? networkOf(tariff) : defaultNetwork(state);
  const suggestion = suggestTariff(network.id, mwh, inputs.voltage);
  const issues = tariff && !mismatch ? fitIssues(tariff, mwh, inputs.voltage) : [];

  const networkOptions = networksFor(state).map((n) => ({
    value: n.id, text: n.name, label: n.name,
    tag: tariffsOf(n.id).every((t) => t.status === 'placeholder') ? 'Placeholder' : undefined,
  }));
  // The network's tariff codes, as shown on a site's bill. A tariff from another
  // state (a shared link or saved quote) stays listed so the field still shows it.
  const tariffGroups: { label?: string; options: Option[] }[] = [{
    options: tariffsOf(network.id).map((t) => ({
      value: t.id, text: tariffOptionLabel(t), label: tariffOptionLabel(t),
      tag: fitIssues(t, mwh, inputs.voltage).length ? "Doesn't fit" : t.status === 'placeholder' ? 'Placeholder' : undefined,
    })),
  }];
  if (mismatch && tariff) {
    tariffGroups.push({ label: `Other state (${tState})`, options: [{ value: tariff.id, text: tariffLabel(tariff.id), label: tariffLabel(tariff.id), tag: tState }] });
  }

  return (
    <>
      <Segmented
        label="Connection voltage"
        size="sm"
        value={inputs.voltage}
        // A tariff is for one voltage, so changing it picks the network's tariff for the site.
        onChange={(v: Voltage) => setInputs(applyTariff({ ...inputs, voltage: v }, suggestTariff(network.id, mwh, v)))}
        options={VOLTAGES}
        className="w-full"
      />
      <SelectField
        id="network"
        label={`Network · ${state}`}
        value={network.id}
        onChange={(id) => setTariff(suggestTariff(id, mwh, inputs.voltage).id)}
        groups={[{ options: networkOptions }]}
      />
      <SelectField
        id="tariff"
        label="Tariff code"
        value={inputs.tariffId}
        onChange={setTariff}
        groups={tariffGroups}
        hint={<>As shown on the site's bill. {TARIFF_YEAR} rates; choosing a tariff fills in its network charges{edited && !mismatch && <> · <button type="button" className="cursor-pointer font-medium text-accent-text hover:underline" onClick={() => tariff && setInputs(applyTariff(inputs, tariff))}>edited, restore tariff rates</button></>}.</>}
      />
      {mismatch && (
        <Callout tone="danger">
          This tariff is for {tState}, but the quote is for {state}.{' '}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={() => setTariff(suggestTariff(defaultNetwork(state).id, mwh, inputs.voltage).id)}>
            Use {state}'s default network
          </button>
        </Callout>
      )}
      {issues.length > 0 && (
        <Callout tone="warning">
          {issues.join(' ')}
          {suggestion.id !== inputs.tariffId && (
            <>{' '}<button type="button" className="cursor-pointer font-semibold underline" onClick={() => setTariff(suggestion.id)}>Use {tariffOptionLabel(suggestion)}</button></>
          )}
        </Callout>
      )}
      {tariff?.status === 'placeholder' && (
        <Callout tone="warning">Placeholder rates: this network's tariff hasn't been researched yet, so its charges are stand-ins and the quote is indicative only.</Callout>
      )}
      {tariff && (tariff.periods || tariff.notes.length > 0) && (
        // The network's time windows, which the consumption shares should follow, and
        // how the published tariff was simplified for the model.
        <div className="space-y-1 rounded-lg border border-border px-3 py-2 text-xs text-subtle">
          {tariff.periods && <p><span className="font-medium text-muted-foreground">Time windows:</span> {tariff.periods}</p>}
          {tariff.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
    </>
  );
}

const BASIS_HINT: Record<string, string> = {
  month: 'average of the monthly maximums, last 12 bills',
  '12 months': 'highest in the last 12 months (latest bill)',
  agreed: 'authorised demand',
};

// One rate per demand charge on the tariff's bill (Essential BLND3AO: peak, shoulder
// and off-peak demand).
function DemandRates() {
  const inputs = useStore((s) => s.inputs);
  const setInput = useStore((s) => s.setInput);
  const lines = tariffById(inputs.tariffId)?.demand.lines ?? [];
  const labels = demandLineLabels(inputs);
  if (!inputs.demandRates.length) return <p className="text-xs text-subtle">No demand charge on this tariff.</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {inputs.demandRates.map((rate, i) => (
        <NumberField
          key={i}
          id={`in-demandRates-${i}`}
          label={labels[i]}
          unit="$/kVA/mo"
          step={1}
          value={rate}
          onChange={(v) => setInput('demandRates', inputs.demandRates.map((r, j) => (j === i ? v : r)))}
        />
      ))}
      {lines.length === inputs.demandRates.length && (
        <p className="col-span-2 text-xs text-subtle">{lines.map((l) => `${l.label}: ${l.window}`).join(' · ')}</p>
      )}
    </div>
  );
}

// Network charges from the client's bill: each demand line's kVA and the kWh in the
// network's windows. Off: the estimated demand on every line and the consumption shares.
function BillFigures() {
  const inputs = useStore((s) => s.inputs);
  const setInput = useStore((s) => s.setInput);
  const setInputs = useStore((s) => s.setInputs);
  const tariff = tariffById(inputs.tariffId);
  const lines = tariff?.demand.lines ?? [];
  const labels = demandLineLabels(inputs);
  const kva = demandKva(inputs);
  const windows = tariff?.energyWindows ?? null;
  const flat = inputs.peakCharge === inputs.shoulderCharge && inputs.shoulderCharge === inputs.offPeakCharge;
  const kwhFields = ([['Peak', 'peak'], ['Shoulder', 'shoulder'], ['Off-peak', 'offPeak']] as const)
    .map(([label, key], i) => ({ label, i, window: windows ? windows[key] : null }))
    .filter((f) => !flat && (windows ? f.window !== null : true));
  const billTotal = inputs.billKwh.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-3 rounded-lg border border-border px-3 py-3">
      <Segmented
        label="Demand and network energy"
        size="sm"
        value={inputs.fromBill ? 'bill' : 'estimate'}
        onChange={(v) => setInputs(v === 'bill' ? startBill(inputs) : { ...inputs, fromBill: false })}
        options={[{ value: 'estimate', label: 'Estimate' }, { value: 'bill', label: "Client's bill" }]}
      />
      {!inputs.fromBill ? (
        <p className="text-xs text-subtle">
          Every demand charge uses the estimated demand, {num(estimatedDemand(inputs), 1)} kVA (consumption ÷ 8,760 h ÷ load factor), and
          network energy uses the consumption shares in the network's windows. Use the client's bill for its figures.
        </p>
      ) : (
        <>
          {inputs.demandRates.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {inputs.demandRates.map((_, i) => (
                <NumberField
                  key={i}
                  id={`in-billKva-${i}`}
                  label={`${labels[i]} (kVA)`}
                  unit="kVA"
                  step={1}
                  min={0}
                  decimals={1}
                  value={kva[i]}
                  onChange={(v) => setInput('billKva', inputs.demandRates.map((__, j) => (j === i ? v : kva[j])))}
                />
              ))}
            </div>
          )}
          {kwhFields.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {kwhFields.map((f) => (
                <NumberField
                  key={f.i}
                  id={`in-billKwh-${f.i}`}
                  label={`${f.label} kWh`}
                  unit="kWh"
                  step={1000}
                  min={0}
                  decimals={0}
                  value={inputs.billKwh[f.i] ?? 0}
                  onChange={(v) => setInput('billKwh', [0, 1, 2].map((j) => (j === f.i ? v : inputs.billKwh[j] ?? 0)))}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-subtle">
            {lines.length === inputs.demandRates.length && lines.length > 0 && <>{lines.map((l) => `${l.label}: ${BASIS_HINT[l.basis]}`).join(' · ')}. </>}
            {windows && kwhFields.length > 0 && <>{kwhFields.map((f) => `${f.label} ${f.window}`).join(' · ')}. </>}
            kWh for the last 12 months in the network's windows
            {billTotal > 0 ? ` (${num(billTotal, 0)} kWh in all). Network energy charges use this split of the annual consumption.` : '.'}
          </p>
        </>
      )}
    </div>
  );
}

export function InputsPanel({ latestDate, state }: { latestDate: string; state: State }) {
  const inputs = useStore((s) => s.inputs);
  const setInput = useStore((s) => s.setInput);
  const resetInputs = useStore((s) => s.resetInputs);
  const [mobileOpen, setMobileOpen] = useState(false);
  const issues = validateInputs(inputs);
  const invalid = new Set(issues.map((i) => i.field));

  const field = ([label, key, opts]: FieldSpec) => (
    <NumberField
      key={key}
      id={`in-${key}`}
      label={label}
      value={inputs[key] as number}
      onChange={(v) => setInput(key, v)}
      invalid={invalid.has(key)}
      {...opts}
    />
  );
  const offPeak = 100 - inputs.peakConsumption - inputs.shoulderConsumption;

  // Supply start: the next quarter by default, or any month in the next three years.
  const first = nextQuarter(latestDate);
  const startOptions: Option[] = [
    { value: 'auto', text: `Next quarter (${monthLabel(first)})`, label: `Next quarter · ${monthLabel(first)}` },
    ...Array.from({ length: 36 }, (_, i) => monthIndex(latestDate.slice(0, 7)) + 1 + i).filter((m) => m !== first)
      .map((m) => ({ value: monthKey(m), text: monthLabel(m), label: monthLabel(m) })),
  ];
  if (inputs.supplyStart !== 'auto' && !startOptions.some((o) => o.value === inputs.supplyStart)) {
    startOptions.push({ value: inputs.supplyStart, text: inputs.supplyStart, label: inputs.supplyStart, tag: 'Saved' });
  }
  const tariff = tariffById(inputs.tariffId);

  return (
    <Card className="no-print lg:sticky lg:top-8 lg:flex lg:max-h-[calc(100dvh-4rem)] lg:flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">Quote inputs</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setMobileOpen((o) => !o)} aria-expanded={mobileOpen}>
            <SlidersHorizontal /> {mobileOpen ? 'Hide' : 'Edit'}
          </Button>
          <Button variant="ghost" size="sm" onClick={resetInputs} title="Reset all inputs to their defaults">
            <RotateCcw /> Reset
          </Button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="space-y-1 border-b border-border bg-danger-soft px-5 py-3">
          {issues.map((i) => (
            <p key={i.field} className="flex items-start gap-2 text-[13px] text-danger"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{i.message}</p>
          ))}
        </div>
      )}

      <div className={cn('overflow-y-auto', !mobileOpen && 'hidden lg:block')}>
        <Section title="Contract" summary={inputs.supplyStart === 'auto' ? `From ${monthLabel(first)}` : `From ${startOptions.find((o) => o.value === inputs.supplyStart)?.text}`} defaultOpen>
          <SelectField
            id="supply-start"
            label="Supply start"
            value={inputs.supplyStart}
            onChange={(v) => setInput('supplyStart', v)}
            groups={[{ options: startOptions }]}
            hint="Three 12-month periods from this date. A start part-way through a quarter weights each part quarter by its days."
          />
          {field(['Carry-forward escalation', 'carryForwardRate', { unit: '% a year', step: 0.5, decimals: 2, hint: 'Assumption' }])}
          <p className="-mt-1 text-xs text-subtle">Used only for months beyond the last listed ASX contract; those periods are flagged as estimates.</p>
        </Section>
        <Section title="Consumption" summary={`${num(inputs.totalConsumption, 0)} kWh`} defaultOpen>
          {field(['Annual consumption', 'totalConsumption', { unit: 'kWh', step: 10000, min: 0, decimals: 2 }])}
          <div className="grid grid-cols-2 gap-3">
            {field(['Peak share', 'peakConsumption', { unit: '%', step: 1, min: 0, max: 100, decimals: 2 }])}
            {field(['Shoulder share', 'shoulderConsumption', { unit: '%', step: 1, min: 0, max: 100, decimals: 2 }])}
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-[13px]">
            <span className="text-muted-foreground">Off-peak share</span>
            <span className={cn('tabular font-semibold', offPeak < 0 && 'text-danger')}>{num(offPeak, 2)}%</span>
          </div>
          {field(['Load factor', 'loadFactor', { step: 0.01, min: 0 }])}
        </Section>
        <Section
          title="Network charges"
          summary={tariff ? <>{inputs.voltage} · {networkOf(tariff).name} {tariff.status === 'placeholder' ? <span className="text-warning-text">placeholder</span> : tariff.code}</> : undefined}
          defaultOpen={tariff?.status === 'placeholder' || tariffState(inputs.tariffId) !== state
            || (!!tariff && fitIssues(tariff, inputs.totalConsumption / 1000, inputs.voltage).length > 0)}
        >
          <NetworkTariff state={state} />
          <div className="grid grid-cols-2 gap-3">
            {field(['Peak', 'peakCharge', { unit: 'c/kWh' }])}
            {field(['Shoulder', 'shoulderCharge', { unit: 'c/kWh' }])}
            {field(['Off-peak', 'offPeakCharge', { unit: 'c/kWh' }])}
            {field(['Service availability', 'serviceAvailabilityCharge', { unit: '$/day' }])}
          </div>
          <DemandRates />
          <BillFigures />
        </Section>
        <Section title="System charges" summary="AEMO, SREC, LREC">
          <div className="grid grid-cols-2 gap-3">
            {field(['AEMO participant', 'aemoParticipantCharge', { unit: 'c/kWh' }])}
            {field(['AEMO ancillary', 'aemoAncillaryServicesCharge', { unit: 'c/kWh' }])}
            {field(['SREC', 'srecCharge', { unit: 'c/kWh' }])}
            {field(['LREC', 'lrecCharge', { unit: 'c/kWh' }])}
          </div>
        </Section>
        <Section title="Service charges" summary={`$${num(inputs.meteringCharge + inputs.retailServiceCharge + inputs.adminCharge, 0)}/month`}>
          {field(['Metering', 'meteringCharge', { unit: '$/month', step: 1, decimals: 2 }])}
          {field(['Retail service', 'retailServiceCharge', { unit: '$/month', step: 1, decimals: 2 }])}
          {field(['Admin', 'adminCharge', { unit: '$/month', step: 1, decimals: 2 }])}
        </Section>
        <Section title="Escalation" summary={`${num(inputs.loadEscalation, 2)} × ${num(inputs.retailEscalation, 2)}`}>
          <div className="grid grid-cols-2 gap-3">
            {field(['Load', 'loadEscalation', { step: 0.01, min: 0 }])}
            {field(['Retail', 'retailEscalation', { step: 0.01, min: 0 }])}
          </div>
          <p className="text-xs text-subtle">Multiplies the ASX settle price to give the peak energy rate.</p>
        </Section>
      </div>
    </Card>
  );
}

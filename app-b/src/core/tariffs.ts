// Network tariff catalogue (reference-data/tariffs.json). A quote picks a network in
// its state, then one of that network's tariff codes (as shown on a site's bill).
// Each tariff records its connection voltage and the annual consumption it's for, so
// the app can suggest a tariff for a site and warn when the chosen one doesn't fit.
// Entries with status 'placeholder', and fields listed in toConfirm, are stand-ins
// (reference-data/PLACEHOLDERS.md) and are flagged wherever they're used.

import catalogue from '../../../reference-data/tariffs.json';
import type { State } from './calc';

export type Voltage = 'LV' | 'HV';
export type TariffStatus = 'verified' | 'placeholder';

export interface Network {
  id: string;
  name: string;
  state: State;
}

// A demand charge as it appears on a bill: its window, and how its kVA is set
// ('month': highest 30-minute kVA in the window each month; '12 months': highest over
// the previous 12 months; 'agreed': authorised demand).
export interface DemandLine {
  label: string;
  window: string;
  rate: number; // $/kVA/month
  basis: 'month' | '12 months' | 'agreed';
}

export interface Demand {
  rate: number; // sum of the lines' rates
  unit: string;
  per: string;
  lines: DemandLine[];
}

// The network's own energy windows, by the model's three periods (null: no such window).
export interface EnergyWindows {
  peak: string | null;
  shoulder: string | null;
  offPeak: string | null;
}

// One financial year's rates, in the same units as the tariff's own.
export interface YearRates {
  energy: { peak: number; shoulder: number; offPeak: number };
  demand: Demand;
  fixed: number;
  source: string;
}

export interface Tariff {
  id: string;
  network: string;
  code: string;
  name: string;                       // 'LV business demand'
  voltage: Voltage;
  eligibility: { minMWh: number | null; maxMWh: number | null };
  status: TariffStatus;
  energy: { peak: number; shoulder: number; offPeak: number }; // c/kWh
  demand: Demand;                                                // $/kVA/month
  energyWindows: EnergyWindows | null;                           // null for a flat tariff
  fixed: number;                                                 // $/day
  periods: string;                    // the network's time windows, in words ('' if unknown)
  notes: string[];                    // how the published tariff was simplified for the model
  source: string;
  toConfirm?: string[];
  history?: Record<string, YearRates>; // past financial years ('FY24'), index reference tariffs only
}

export const TARIFF_YEAR: string = catalogue.financialYear;
export const VOLTAGES: { value: Voltage; label: string }[] = [
  { value: 'LV', label: 'Low voltage' },
  { value: 'HV', label: 'High voltage' },
];
export const NETWORKS = catalogue.networks as Network[];
export const TARIFFS = catalogue.tariffs as Tariff[];
const DEFAULT_NETWORKS = catalogue.defaults as Record<State, string>;
const LEGACY_NAMES = catalogue.legacyNames as Record<string, string>;

const mwhText = (mwh: number) => Math.round(mwh).toLocaleString('en-AU');

const byId = new Map(TARIFFS.map((t) => [t.id, t]));
const networkById = new Map(NETWORKS.map((n) => [n.id, n]));

export const tariffById = (id: string): Tariff | undefined => byId.get(id);

// The financial year a date falls in: '2023-09-14' -> 'FY24' (years start 1 July).
export function financialYearOf(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4)) + (Number(isoDate.slice(5, 7)) >= 7 ? 1 : 0);
  return `FY${String(year % 100).padStart(2, '0')}`;
}

// The tariff with the rates it had in a financial year: its recorded rates for that
// year, else today's (catalogue) rates. `year` says which year's rates were used.
export function tariffForYear(t: Tariff, fy: string): { tariff: Tariff; year: string } {
  const h = t.history?.[fy];
  return h ? { tariff: { ...t, energy: h.energy, demand: h.demand, fixed: h.fixed }, year: fy } : { tariff: t, year: TARIFF_YEAR };
}
// A tariff's rates by financial year, newest first: this year's (the catalogue's),
// then the past years recorded in its history.
export function rateHistory(t: Tariff): (YearRates & { year: string })[] {
  const past = Object.entries(t.history ?? {})
    .map(([year, r]) => ({ year, ...r }))
    .sort((a, b) => b.year.localeCompare(a.year));
  return [{ year: TARIFF_YEAR, energy: t.energy, demand: t.demand, fixed: t.fixed, source: t.source }, ...past];
}

// How a demand line's kVA is set, in words.
export const DEMAND_BASIS: Record<DemandLine['basis'], string> = {
  month: 'Highest 30-minute kVA in the window each month',
  '12 months': 'Highest 30-minute kVA in the previous 12 months',
  agreed: 'Authorised (agreed) demand',
};

// The annual consumption a tariff is for: '160 MWh a year or more', 'Up to 40 MWh a year',
// '40 to 160 MWh a year', or 'Any consumption'.
export function eligibilityText(t: Tariff): string {
  const { minMWh: lo, maxMWh: hi } = t.eligibility;
  if (lo !== null && hi !== null) return `${mwhText(lo)} to ${mwhText(hi)} MWh a year`;
  if (lo !== null) return `${mwhText(lo)} MWh a year or more`;
  if (hi !== null) return `Up to ${mwhText(hi)} MWh a year`;
  return 'Any consumption';
}

export const networkOf = (t: Tariff): Network => networkById.get(t.network)!;
export const tariffState = (id: string): State | undefined => {
  const t = byId.get(id);
  return t && networkOf(t).state;
};

export const networksFor = (state: State): Network[] => NETWORKS.filter((n) => n.state === state);
export const tariffsOf = (networkId: string): Tariff[] => TARIFFS.filter((t) => t.network === networkId);
export const defaultNetwork = (state: State): Network => networkById.get(DEFAULT_NETWORKS[state])!;

// 'BLND3AO · LV business demand', or 'Placeholder · HV demand'.
export const tariffOptionLabel = (t: Tariff) => `${t.status === 'placeholder' ? 'Placeholder' : t.code} · ${t.name}`;

// 'Essential Energy BLND3AO', or 'Ausgrid HV demand (placeholder)'.
export function tariffLabel(id: string): string {
  const t = byId.get(id);
  if (!t) return id;
  const network = networkOf(t).name;
  return t.status === 'placeholder' ? `${network} ${t.name} (placeholder)` : `${network} ${t.code}`;
}

// Why a tariff doesn't fit a site (empty when it does): its connection voltage and
// annual consumption bounds.
export function fitIssues(t: Tariff, annualMWh: number, voltage: Voltage): string[] {
  const issues: string[] = [];
  const name = t.status === 'placeholder' ? `The ${t.name} placeholder` : t.code;
  const note = t.toConfirm?.includes('eligibility') ? ' (threshold to be confirmed)' : '';
  if (t.voltage !== voltage) issues.push(`${name} is a ${t.voltage} tariff, but the site is connected at ${voltage}.`);
  const { minMWh, maxMWh } = t.eligibility;
  if (minMWh !== null && annualMWh < minMWh) {
    issues.push(`${name} is for sites using ${mwhText(minMWh)} MWh a year or more${note}; this site uses ${mwhText(annualMWh)} MWh.`);
  }
  if (maxMWh !== null && annualMWh > maxMWh) {
    issues.push(`${name} is for sites using up to ${mwhText(maxMWh)} MWh a year${note}; this site uses ${mwhText(annualMWh)} MWh.`);
  }
  return issues;
}

// The network's first tariff that fits the site; else its first at that voltage; else its first.
export function suggestTariff(networkId: string, annualMWh: number, voltage: Voltage): Tariff {
  const options = tariffsOf(networkId);
  return options.find((t) => fitIssues(t, annualMWh, voltage).length === 0)
    ?? options.find((t) => t.voltage === voltage)
    ?? options[0];
}

// Share links and saved quotes from before the catalogue used preset names ("BLNT1AO"),
// or ids of tariffs since replaced ("energex-8100"); both map to today's nearest tariff.
export const resolveTariffId = (idOrName: string): string | undefined =>
  (byId.has(idOrName) ? idOrName : LEGACY_NAMES[idOrName]);

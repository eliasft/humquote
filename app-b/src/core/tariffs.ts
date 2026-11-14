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

export interface Tariff {
  id: string;
  network: string;
  code: string;
  name: string;                       // 'LV business demand'
  voltage: Voltage;
  eligibility: { minMWh: number | null; maxMWh: number | null };
  status: TariffStatus;
  energy: { peak: number; shoulder: number; offPeak: number }; // c/kWh
  demand: { rate: number; unit: string; per: string };          // $/kVA/month
  fixed: number;                                                 // $/day
  periods: string;                    // the network's time windows, in words ('' if unknown)
  notes: string[];                    // how the published tariff was simplified for the model
  source: string;
  toConfirm?: string[];
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

const byId = new Map(TARIFFS.map((t) => [t.id, t]));
const networkById = new Map(NETWORKS.map((n) => [n.id, n]));

export const tariffById = (id: string): Tariff | undefined => byId.get(id);
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

const mwhText = (mwh: number) => Math.round(mwh).toLocaleString('en-AU');

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

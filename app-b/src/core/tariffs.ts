// Network tariff catalogue (reference-data/tariffs.json). Every tariff belongs to a
// network, and every network to one state, so a quote can only pick tariffs from
// its own state. Entries with status 'placeholder' are stand-ins, listed in
// reference-data/PLACEHOLDERS.md, and are flagged wherever they're used.

import catalogue from '../../../reference-data/tariffs.json';
import type { State } from './calc';

export type SegmentId = 'small' | 'large-lv';
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
  segment: SegmentId;
  status: TariffStatus;
  energy: { peak: number; shoulder: number; offPeak: number }; // c/kWh
  demand: { rate: number; unit: string; per: string };          // $/kVA/month
  fixed: number;                                                 // $/day
  source: string;
  toConfirm?: string[];
}

export const TARIFF_YEAR: string = catalogue.financialYear;
export const SEGMENTS = catalogue.segments as { id: SegmentId; name: string }[];
export const NETWORKS = catalogue.networks as Network[];
export const TARIFFS = catalogue.tariffs as Tariff[];
const DEFAULTS = catalogue.defaults as Record<State, Record<SegmentId, string>>;
const LEGACY_NAMES = catalogue.legacyNames as Record<string, string>;

const byId = new Map(TARIFFS.map((t) => [t.id, t]));
const networkById = new Map(NETWORKS.map((n) => [n.id, n]));

export const tariffById = (id: string): Tariff | undefined => byId.get(id);
export const networkOf = (t: Tariff): Network => networkById.get(t.network)!;
export const tariffState = (id: string): State | undefined => {
  const t = byId.get(id);
  return t && networkOf(t).state;
};
export const segmentName = (id: SegmentId) => SEGMENTS.find((s) => s.id === id)?.name ?? id;

// "Essential Energy BLND3AO", or "Ausgrid (placeholder)" for a stand-in.
export function tariffLabel(id: string): string {
  const t = byId.get(id);
  if (!t) return id;
  const network = networkOf(t).name;
  return t.status === 'placeholder' ? `${network} (placeholder)` : `${network} ${t.code}`;
}

export const defaultTariff = (state: State, segment: SegmentId): Tariff => byId.get(DEFAULTS[state][segment])!;

// A state's tariffs for one segment, grouped by network in catalogue order.
export function tariffsFor(state: State, segment: SegmentId): { network: Network; tariffs: Tariff[] }[] {
  return NETWORKS.filter((n) => n.state === state)
    .map((network) => ({ network, tariffs: TARIFFS.filter((t) => t.network === network.id && t.segment === segment) }))
    .filter((g) => g.tariffs.length);
}

// Share links and saved quotes from before the catalogue used preset names ("BLNT1AO").
export const resolveTariffId = (idOrName: string): string | undefined =>
  (byId.has(idOrName) ? idOrName : LEGACY_NAMES[idOrName]);

// Share links: the quote's state and any inputs that differ from the defaults,
// encoded in the URL hash (e.g. #/?s=QLD&tc=1200000&tf=energex-8100). Links made
// before the tariff catalogue used net=<preset name>; those still open.

import { DEFAULT_INPUTS, migrateInputs, type QuoteInputs, type State, STATES } from '@/core/calc';

const KEYS: Record<keyof QuoteInputs, string> = {
  totalConsumption: 'tc',
  peakConsumption: 'pk',
  shoulderConsumption: 'sh',
  loadFactor: 'lf',
  tariffId: 'tf',
  peakCharge: 'npc',
  offPeakCharge: 'nop',
  shoulderCharge: 'nsc',
  nuosCharge: 'nuos',
  serviceAvailabilityCharge: 'sac',
  aemoParticipantCharge: 'aemo',
  aemoAncillaryServicesCharge: 'anc',
  srecCharge: 'srec',
  lrecCharge: 'lrec',
  meteringCharge: 'met',
  retailServiceCharge: 'rsc',
  adminCharge: 'adm',
  loadEscalation: 'le',
  retailEscalation: 're',
  supplyStart: 'ss',
  carryForwardRate: 'cf',
};

const TEXT_KEYS = new Set<keyof QuoteInputs>(['tariffId', 'supplyStart']);

// Links without v=2 left out anything equal to the old defaults, which used the
// Energex 8300 preset.
const LEGACY_DEFAULTS = { network: 'Energex 8300', peakCharge: 2.8140, offPeakCharge: 2.8140, shoulderCharge: 2.8140, nuosCharge: 13.4270, serviceAvailabilityCharge: 7.7240 };

export function encodeQuote(inputs: QuoteInputs, state: State): string {
  const p = new URLSearchParams();
  p.set('v', '2');
  p.set('s', state);
  for (const [key, short] of Object.entries(KEYS) as [keyof QuoteInputs, string][]) {
    if (inputs[key] !== DEFAULT_INPUTS[key]) p.set(short, String(inputs[key]));
  }
  return p.toString();
}

export function decodeQuote(query: string): { inputs: QuoteInputs; state: State } | null {
  const p = new URLSearchParams(query);
  if (![...p.keys()].length) return null;
  const raw: Record<string, unknown> = p.get('v') === '2' ? {} : { ...LEGACY_DEFAULTS };
  for (const [key, short] of Object.entries(KEYS) as [keyof QuoteInputs, string][]) {
    const v = p.get(short);
    if (v === null) continue;
    if (TEXT_KEYS.has(key)) raw[key] = v;
    else if (Number.isFinite(Number(v))) raw[key] = Number(v);
  }
  const legacyNetwork = p.get('net');
  if (legacyNetwork) raw.network = legacyNetwork;
  const inputs = migrateInputs(raw);
  const s = p.get('s') as State | null;
  return { inputs, state: s && (STATES as readonly string[]).includes(s) ? s : 'NSW' };
}

export function shareUrl(inputs: QuoteInputs, state: State): string {
  const url = new URL(window.location.href);
  url.hash = `/?${encodeQuote(inputs, state)}`;
  return url.toString();
}

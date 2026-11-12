// Share links: the quote's state and any inputs that differ from the defaults,
// encoded in the URL hash (e.g. #/?s=QLD&tc=1200000&net=BLNT1AO).

import { DEFAULT_INPUTS, type QuoteInputs, type State, STATES } from './calc';

const KEYS: Record<keyof QuoteInputs, string> = {
  totalConsumption: 'tc',
  peakConsumption: 'pk',
  shoulderConsumption: 'sh',
  loadFactor: 'lf',
  network: 'net',
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
};

export function encodeQuote(inputs: QuoteInputs, state: State): string {
  const p = new URLSearchParams();
  p.set('s', state);
  for (const [key, short] of Object.entries(KEYS) as [keyof QuoteInputs, string][]) {
    if (inputs[key] !== DEFAULT_INPUTS[key]) p.set(short, String(inputs[key]));
  }
  return p.toString();
}

export function decodeQuote(query: string): { inputs: QuoteInputs; state: State } | null {
  const p = new URLSearchParams(query);
  if (![...p.keys()].length) return null;
  const inputs: QuoteInputs = { ...DEFAULT_INPUTS };
  for (const [key, short] of Object.entries(KEYS) as [keyof QuoteInputs, string][]) {
    const raw = p.get(short);
    if (raw === null) continue;
    if (key === 'network') inputs.network = raw;
    else {
      const n = Number(raw);
      if (Number.isFinite(n)) (inputs[key] as number) = n;
    }
  }
  const s = p.get('s') as State | null;
  return { inputs, state: s && (STATES as readonly string[]).includes(s) ? s : 'NSW' };
}

export function shareUrl(inputs: QuoteInputs, state: State): string {
  const url = new URL(window.location.href);
  url.hash = `/?${encodeQuote(inputs, state)}`;
  return url.toString();
}

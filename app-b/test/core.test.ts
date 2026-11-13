// Contract periods, the tariff catalogue, migration of old quotes and links, and the
// features built on them.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUTS, STATES, applyTariff, calculateBulkPrices, migrateInputs, tariffMatches, toRecords,
  type FuturesRow, type State,
} from '../src/core/calc';
import {
  buildCurves, monthIndex, monthKey, nextQuarter, priceContract, resolveStart, type Contract, type StripRow,
} from '../src/core/periods';
import {
  NETWORKS, SEGMENTS, TARIFFS, defaultTariff, networkOf, tariffById, tariffState, tariffsFor,
} from '../src/core/tariffs';
import {
  bulkPriceIndex, compareStates, inputsForState, quoteHistory, quotePeriods, quoteWarnings, sensitivity, validateInputs,
} from '../src/core/analysis';
import { decodeQuote, encodeQuote } from '../src/lib/share';

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf-8');
const records = toRecords(JSON.parse(fixture('futures.json')).rows);

const D = '2026-11-13';
const fy = (year: number, p: number): FuturesRow => ({ quoteDate: D, year, NSW: p, VIC: p, QLD: p, SA: p });
const strip = (contract: string, start: string, months: number, p: number): StripRow => [D, contract, start, months, p, p, p, p];

// The contracts ASX listed on 13 Nov 2026 (NSW prices, same for every state here).
const NOV13 = buildCurves([fy(2028, 95.68), fy(2029, 99.21)], [
  strip('Q4 2026', '2026-10', 3, 121.68), strip('Q1 2027', '2027-01', 3, 102.25), strip('CY2027', '2027-01', 12, 98.98),
  strip('Q2 2027', '2027-04', 3, 107.31), strip('Q3 2027', '2027-07', 3, 97.02), strip('FY2028', '2027-07', 12, 95.68),
  strip('Q4 2027', '2027-10', 3, 89.5), strip('CY2028', '2028-01', 12, 96.33), strip('FY2029', '2028-07', 12, 99.21),
  strip('CY2029', '2029-01', 12, 101.14),
]).get(D)!;
const FY_ONLY = buildCurves([fy(2028, 95.68), fy(2029, 99.21)]).get(D)!;

describe('contract periods', () => {
  it('starts the quarter after the settlement date', () => {
    expect(monthKey(nextQuarter('2026-11-13'))).toBe('2027-01');
    expect(monthKey(nextQuarter('2026-12-31'))).toBe('2027-01');
    expect(monthKey(nextQuarter('2027-01-01'))).toBe('2027-04');
    expect(monthKey(resolveStart('2027-08', D))).toBe('2027-07'); // snaps to its quarter
  });

  it('uses an annual strip that matches the period exactly', () => {
    const p = priceContract(NOV13, monthIndex('2027-01'), 2.5);
    expect(p.map((x) => x.label)).toEqual(['CY27', 'CY28', 'CY29']);
    expect(p.map((x) => x.NSW)).toEqual([98.98, 96.33, 101.14]);
    expect(p.every((x) => x.estimates.length === 0 && x.quarters === null)).toBe(true);
  });

  it('averages quarters when no strip matches, preferring quarterly contracts', () => {
    const [y1] = priceContract(NOV13, monthIndex('2027-04'), 2.5);
    expect(y1.label).toBe('Apr 27–Mar 28');
    expect(y1.quarters!.map((q) => q.source)).toEqual(['Q2 2027', 'Q3 2027', 'Q4 2027', 'FY2028']); // FY28 overlaps the period by 9 months, CY28 by 3
    expect(y1.NSW).toBeCloseTo((107.31 + 97.02 + 89.5 + 95.68) / 4, 10);
    expect(y1.estimates).toEqual([]);
  });

  it('carries forward beyond the last contract and flags it', () => {
    const p = priceContract(FY_ONLY, monthIndex('2027-07'), 2.5);
    expect(p.map((x) => x.label)).toEqual(['FY28', 'FY29', 'Jul 29–Jun 30']);
    expect(p[2].NSW).toBeCloseTo(99.21 * 1.025, 10);
    expect(p[2].estimates).toEqual(['carried']);
    expect(p[2].note).toMatch(/4 of 4 quarters carried forward from FY29 at 2.5% a year/);
  });

  it('back-fills months before the first listed contract and flags it', () => {
    const [y1] = priceContract(FY_ONLY, monthIndex('2027-01'), 2.5);
    expect(y1.quarters!.map((q) => q.estimate ?? 'asx')).toEqual(['backfilled', 'backfilled', 'asx', 'asx']);
    expect(y1.NSW).toBeCloseTo(95.68, 10);
    expect(y1.note).toMatch(/2 of 4 quarters back-filled from FY28/);
  });

  it('prices a contract on FY strips exactly like the FY rows themselves', () => {
    const rows = [fy(2027, 93.1), fy(2028, 95.68), fy(2029, 99.21)];
    const periods = priceContract(buildCurves(rows).get(D)!, monthIndex('2026-07'), 2.5);
    for (const s of STATES) {
      expect(calculateBulkPrices(periods, DEFAULT_INPUTS, s)).toEqual({ ...calculateBulkPrices(rows, DEFAULT_INPUTS, s), updated: expect.anything() });
    }
  });
});

describe('tariff catalogue', () => {
  it('links every tariff to a network in one state', () => {
    for (const t of TARIFFS) {
      expect(NETWORKS.some((n) => n.id === t.network), t.id).toBe(true);
      expect(STATES).toContain(networkOf(t).state);
    }
    expect(new Set(TARIFFS.map((t) => t.id)).size).toBe(TARIFFS.length);
  });

  it('has a default for every state and segment, from that state and segment', () => {
    for (const s of STATES) {
      for (const seg of SEGMENTS) {
        const t = defaultTariff(s, seg.id);
        expect(tariffState(t.id)).toBe(s);
        expect(t.segment).toBe(seg.id);
      }
    }
  });

  it('only offers a state its own tariffs', () => {
    for (const s of STATES) {
      for (const g of tariffsFor(s, 'large-lv')) expect(g.network.state).toBe(s);
    }
  });

  it('keeps the four researched tariffs and marks every other entry as a placeholder', () => {
    const verified = TARIFFS.filter((t) => t.status === 'verified').map((t) => t.id).sort();
    expect(verified).toEqual(['energex-8100', 'energex-8300', 'essential-blnd3ao', 'essential-blnt1ao']);
    expect(tariffById('essential-blnt1ao')!.energy).toEqual({ peak: 20.4161, shoulder: 15.9733, offPeak: 8.4967 });
  });
});

describe('network charges and state', () => {
  it('charges each consumption period its own network rate', () => {
    const inputs = { ...applyTariff(DEFAULT_INPUTS, tariffById('essential-blnt1ao')!), peakConsumption: 40, shoulderConsumption: 20 };
    const r = calculateBulkPrices([fy(2028, 95.68)], inputs, 'NSW');
    const expected = 400000 * (0.4 * 20.4161 + 0.2 * 15.9733 + 0.4 * 8.4967) / 100;
    expect(r.costs.rows[4].values[0]).toBeCloseTo(expected, 8);
  });

  it('switches to the new state\'s default tariff for the same segment', () => {
    const qld = inputsForState(applyTariff(DEFAULT_INPUTS, tariffById('essential-blnt1ao')!), 'QLD');
    expect(qld.tariffId).toBe(defaultTariff('QLD', 'small').id);
    expect(tariffMatches(qld)).toBe(true);
    const same = inputsForState(DEFAULT_INPUTS, 'NSW');
    expect(same).toBe(DEFAULT_INPUTS);
  });

  it('compares each state on its own tariff', () => {
    const rows = compareStates(quotePeriods(NOV13, DEFAULT_INPUTS), DEFAULT_INPUTS);
    for (const r of rows) expect(tariffState(r.inputs.tariffId)).toBe(r.state);
  });

  it('warns about mismatched and placeholder tariffs and estimated periods', () => {
    const periods = quotePeriods(FY_ONLY, DEFAULT_INPUTS);
    const w = quoteWarnings(DEFAULT_INPUTS, 'SA', periods).map((x) => x.kind);
    expect(w).toContain('mismatch');
    expect(w).toContain('estimate');
    const sa = inputsForState(DEFAULT_INPUTS, 'SA');
    expect(quoteWarnings(sa, 'SA', quotePeriods(NOV13, sa)).map((x) => x.kind)).toEqual(['placeholder']);
  });
});

describe('saved quotes and share links from before the catalogue', () => {
  it('migrates a preset name to its tariff and fills new inputs', () => {
    const old = { ...DEFAULT_INPUTS, network: 'BLNT1AO', peakCharge: 20.4161 } as Record<string, unknown>;
    delete old.tariffId;
    delete old.supplyStart;
    const m = migrateInputs(old);
    expect(m.tariffId).toBe('essential-blnt1ao');
    expect(m.peakCharge).toBe(20.4161);
    expect(m.supplyStart).toBe('auto');
    expect(m.carryForwardRate).toBe(DEFAULT_INPUTS.carryForwardRate);
  });

  it('round-trips share links', () => {
    const inputs = { ...applyTariff(DEFAULT_INPUTS, tariffById('energex-8100')!), totalConsumption: 1234567, supplyStart: '2027-07', carryForwardRate: 3 };
    expect(decodeQuote(encodeQuote(inputs, 'QLD'))).toEqual({ inputs, state: 'QLD' });
  });

  it('opens old links with the old default tariff', () => {
    const decoded = decodeQuote('s=QLD&tc=1200000')!;
    expect(decoded.inputs.tariffId).toBe('energex-8300');
    expect(decoded.inputs.peakCharge).toBe(2.814);
    const blnt = decodeQuote('s=SA&net=BLNT1AO&npc=20.4161&nop=8.4967&nsc=15.9733&nuos=0&sac=2.2229')!;
    expect(blnt.inputs.tariffId).toBe('essential-blnt1ao');
    expect(tariffMatches(blnt.inputs)).toBe(true);
  });
});

describe('features', () => {
  const curves = buildCurves(records);

  it('quote history on the latest date equals the quote with an automatic start', () => {
    const history = quoteHistory(curves, DEFAULT_INPUTS, 'NSW');
    const [lastDate, lastCurve] = [...curves].at(-1)!;
    expect(history.at(-1)!.quoteDate).toBe(lastDate);
    expect(history.at(-1)!.price).toBe(calculateBulkPrices(quotePeriods(lastCurve, DEFAULT_INPUTS), DEFAULT_INPUTS, 'NSW').bulkPrice);
  });

  it('bulk price index: one point per date, components add up to the price', () => {
    const index = bulkPriceIndex(curves);
    expect(index.length).toBe(curves.size);
    for (const p of index.slice(-50)) {
      for (const s of STATES as readonly State[]) {
        expect(p.components[s].reduce((a, b) => a + b, 0)).toBeCloseTo(p.prices[s], 12);
      }
    }
    // Since ASX stopped listing FY27 (1 Oct 2026), the months before FY28 are back-filled.
    expect(index.at(-1)!.estimates).toContain('backfilled');
  });

  it('sensitivity brackets the base price and ranks drivers by effect', () => {
    const periods = quotePeriods(NOV13, DEFAULT_INPUTS);
    const { base, drivers } = sensitivity(periods, DEFAULT_INPUTS, 'QLD');
    expect(drivers.length).toBeGreaterThan(3);
    for (const d of drivers) expect(Math.min(d.low, d.high)).toBeLessThanOrEqual(base + 1e-12);
    for (let i = 1; i < drivers.length; i++) expect(drivers[i - 1].spread).toBeGreaterThanOrEqual(drivers[i].spread);
  });

  it('validation flags shares over 100%', () => {
    expect(validateInputs(DEFAULT_INPUTS)).toEqual([]);
    expect(validateInputs({ ...DEFAULT_INPUTS, peakConsumption: 80, shoulderConsumption: 30 })[0].field).toBe('shoulderConsumption');
  });
});

// Curves built from FY rows start each FY in July of the previous year.
it('FY contracts start in July', () => {
  const c: Contract = buildCurves([fy(2028, 1)]).get(D)![0];
  expect(monthKey(c.start)).toBe('2027-07');
});

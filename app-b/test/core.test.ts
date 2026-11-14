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
  buildCurves, contractHistory, contractKind, groupByKind, monthIndex, monthKey, nextQuarter, priceContract, resolveStart,
  type Contract, type StripRow,
} from '../src/core/periods';
import {
  NETWORKS, TARIFFS, TARIFF_YEAR, defaultNetwork, financialYearOf, fitIssues, networkOf, networksFor, suggestTariff, tariffById,
  tariffForYear, tariffState, tariffsOf,
} from '../src/core/tariffs';
import {
  bulkPriceIndex, compareStates, indexInputsOn, inputsForState, quoteHistory, quotePeriods, quoteWarnings, sensitivity, validateInputs,
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
    expect(monthKey(resolveStart('2027-08', D))).toBe('2027-08'); // any month
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
    // Weighted by days: Q2 91, Q3 92, Q4 92, Q1 2028 91 (a leap year).
    expect(y1.quarters!.map((q) => q.days)).toEqual([91, 92, 92, 91]);
    expect(y1.NSW).toBeCloseTo((107.31 * 91 + 97.02 * 92 + 89.5 * 92 + 95.68 * 91) / 366, 10);
    expect(y1.estimates).toEqual([]);
  });

  it('starts mid-quarter with a part quarter at each end, weighted by days', () => {
    const [y1] = priceContract(NOV13, monthIndex('2027-02'), 2.5);
    expect(y1.label).toBe('Feb 27–Jan 28');
    expect(y1.quarters!.map((q) => [monthKey(q.from), q.months, q.days, q.source]))
      .toEqual([['2027-02', 2, 59, 'Q1 2027'], ['2027-04', 3, 91, 'Q2 2027'], ['2027-07', 3, 92, 'Q3 2027'], ['2027-10', 3, 92, 'Q4 2027'], ['2028-01', 1, 31, 'FY2028']]);
    expect(y1.NSW).toBeCloseTo((102.25 * 59 + 107.31 * 91 + 97.02 * 92 + 89.5 * 92 + 95.68 * 31) / 365, 10);
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

describe('contract types', () => {
  it('classifies contracts', () => {
    expect(['FY2028', 'CY2027', 'Q4 2026'].map((contract) => contractKind({ contract }))).toEqual(['FY', 'CY', 'Q']);
  });

  it("groups a day's contracts into FY, CY and quarters, each by delivery date", () => {
    const groups = groupByKind(NOV13);
    expect(groups.map((g) => [g.kind, g.contracts.map((c) => c.contract)])).toEqual([
      ['FY', ['FY2028', 'FY2029']],
      ['CY', ['CY2027', 'CY2028', 'CY2029']],
      ['Q', ['Q4 2026', 'Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027']],
    ]);
    expect(groupByKind(FY_ONLY).map((g) => g.kind)).toEqual(['FY']);
  });

  it("builds each contract's history and marks the ones still quoted", () => {
    const curves = buildCurves(records);
    const fy = contractHistory(curves, 'FY');
    expect(fy.map((s) => s.contract)).toEqual(['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026', 'FY2027', 'FY2028', 'FY2029']);
    expect(fy.filter((s) => s.active).map((s) => s.contract)).toEqual(['FY2028', 'FY2029']);
    const fy28 = fy.find((s) => s.contract === 'FY2028')!;
    expect(fy28.points.length).toBe(records.filter((r) => r.year === 2028).length);
    expect(fy28.points[0].quoteDate < fy28.points.at(-1)!.quoteDate).toBe(true);
    expect(contractHistory(curves, 'Q')).toEqual([]);
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

  it('has a default network in every state, and LV and HV tariffs on every network', () => {
    for (const s of STATES) {
      expect(defaultNetwork(s).state).toBe(s);
      for (const n of networksFor(s)) {
        expect(n.state).toBe(s);
        const voltages = tariffsOf(n.id).map((t) => t.voltage);
        expect(voltages).toContain('LV');
        expect(voltages).toContain('HV');
      }
    }
  });

  it('suggests the tariff that fits the site, and explains a misfit', () => {
    expect(suggestTariff('essential', 400, 'LV').id).toBe('essential-blnd3ao');
    expect(suggestTariff('essential', 60, 'LV').id).toBe('essential-blnbss1');
    expect(suggestTariff('essential', 400, 'HV').id).toBe('essential-bhnd3ao');
    expect(suggestTariff('energex', 400, 'LV').id).toBe('energex-7200');
    expect(suggestTariff('energex', 60, 'LV').id).toBe('energex-6800');
    expect(suggestTariff('ausgrid', 130, 'LV').id).toBe('ausgrid-ea302');
    expect(suggestTariff('ausgrid', 1000, 'LV').id).toBe('ausgrid-ea310');
    expect(fitIssues(tariffById('essential-blnd3ao')!, 400, 'LV')).toEqual([]);
    expect(fitIssues(tariffById('essential-blnbss1')!, 400, 'LV'))
      .toEqual(['BLNBSS1 is for sites using up to 160 MWh a year; this site uses 400 MWh.']);
    expect(fitIssues(tariffById('energex-7200')!, 1234.5, 'HV'))
      .toEqual(['7200 is a LV tariff, but the site is connected at HV.']);
    expect(fitIssues(tariffById('energex-7200')!, 60, 'LV')[0]).toMatch(/100 MWh a year or more; this site uses 60 MWh/);
  });

  it('has researched tariffs for NSW and QLD, and placeholders only for VIC and SA', () => {
    for (const t of TARIFFS) {
      const state = networkOf(t).state;
      expect(t.status, t.id).toBe(state === 'NSW' || state === 'QLD' ? 'verified' : 'placeholder');
      if (t.status === 'verified') expect(t.periods, t.id).not.toBe('');
    }
    // From Essential's FY27 price list: demand is the sum of its peak, shoulder and off-peak rates.
    const blnd3ao = tariffById('essential-blnd3ao')!;
    expect(blnd3ao.energy).toEqual({ peak: 7.0201, shoulder: 5.6141, offPeak: 3.645 });
    expect(blnd3ao.demand.rate).toBe(25.7855);
    expect(blnd3ao.fixed).toBe(22.3346);
  });
});

describe('network charges and state', () => {
  it('charges each consumption period its own network rate', () => {
    const inputs = { ...applyTariff(DEFAULT_INPUTS, tariffById('essential-blnt1ao')!), peakConsumption: 40, shoulderConsumption: 20 };
    const r = calculateBulkPrices([fy(2028, 95.68)], inputs, 'NSW');
    const expected = 400000 * (0.4 * 21.6514 + 0.2 * 16.9328 + 0.4 * 9.0349) / 100;
    expect(r.costs.rows[4].values[0]).toBeCloseTo(expected, 8);
  });

  it("switches to the tariff the new state's default network suggests for the site", () => {
    const qld = inputsForState(applyTariff(DEFAULT_INPUTS, tariffById('essential-blnt1ao')!), 'QLD');
    expect(qld.tariffId).toBe('energex-7200'); // 400 MWh, LV
    expect(inputsForState({ ...DEFAULT_INPUTS, totalConsumption: 60000 }, 'QLD').tariffId).toBe('energex-6800');
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
    const hv = quoteWarnings({ ...DEFAULT_INPUTS, voltage: 'HV' }, 'NSW', periods);
    expect(hv.find((x) => x.kind === 'eligibility')?.message).toBe('BLND3AO is a LV tariff, but the site is connected at HV.');
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
    expect(m.voltage).toBe('LV');
  });

  it('maps a replaced tariff id to its successor and keeps the quote\'s own rates', () => {
    const old = { ...DEFAULT_INPUTS, tariffId: 'energex-8100', peakCharge: 1.301, nuosCharge: 15.773 } as Record<string, unknown>;
    const m = migrateInputs(old);
    expect(m.tariffId).toBe('energex-7200');
    expect(m.peakCharge).toBe(1.301);
    expect(m.nuosCharge).toBe(15.773);
    expect(migrateInputs({ tariffId: 'ausgrid-large-lv-placeholder' }).tariffId).toBe('ausgrid-ea305');
  });

  it('round-trips share links', () => {
    const inputs = { ...applyTariff(DEFAULT_INPUTS, tariffById('energex-7200')!), totalConsumption: 1234567, supplyStart: '2027-07', carryForwardRate: 3 };
    expect(decodeQuote(encodeQuote(inputs, 'QLD'))).toEqual({ inputs, state: 'QLD' });
  });

  it('opens old links with the old default tariff', () => {
    const decoded = decodeQuote('s=QLD&tc=1200000')!;
    expect(decoded.inputs.tariffId).toBe('energex-8300');
    expect(decoded.inputs.peakCharge).toBe(2.814);
    const blnt = decodeQuote('s=SA&net=BLNT1AO&npc=20.4161&nop=8.4967&nsc=15.9733&nuos=0&sac=2.2229')!;
    expect(blnt.inputs.tariffId).toBe('essential-blnt1ao');
    expect(blnt.inputs.peakCharge).toBe(20.4161); // the link's own (FY26) rates, not today's
    expect(tariffMatches(blnt.inputs)).toBe(false);
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

  it('bulk price index: each date uses the network rates of its financial year', () => {
    expect(financialYearOf('2021-09-10')).toBe('FY22');
    expect(financialYearOf('2024-06-30')).toBe('FY24');
    expect(financialYearOf('2024-07-01')).toBe('FY25');
    // Essential BLND3AO, FY24 price list: demand is the sum of its three windows.
    const nsw = indexInputsOn('NSW', '2023-11-14');
    expect(nsw.year).toBe('FY24');
    expect(nsw.inputs.tariffId).toBe('essential-blnd3ao');
    expect([nsw.inputs.peakCharge, nsw.inputs.nuosCharge, nsw.inputs.serviceAvailabilityCharge]).toEqual([4.8555, 23.4835, 17.7679]);
    // Energex 7200 before FY26: one volume rate, peak-window demand, metering in fixed.
    const qld = indexInputsOn('QLD', '2022-03-01');
    expect(qld.year).toBe('FY22');
    expect([qld.inputs.peakCharge, qld.inputs.offPeakCharge, qld.inputs.nuosCharge]).toEqual([2.746, 2.746, 12.582]);
    // No recorded rates (placeholders, or the current year): today's catalogue rates.
    expect(indexInputsOn('VIC', '2022-03-01').year).toBe(TARIFF_YEAR);
    expect(indexInputsOn('NSW', '2026-11-13').year).toBe(TARIFF_YEAR);
    expect(tariffForYear(tariffById('ausgrid-ea305')!, 'FY24').tariff).toBe(tariffById('ausgrid-ea305'));

    const byDate = new Map(bulkPriceIndex(curves).map((p) => [p.quoteDate, p]));
    const [date, curve] = [...curves].find(([d]) => financialYearOf(d) === 'FY24')!;
    const periods = priceContract(curve, nextQuarter(date), DEFAULT_INPUTS.carryForwardRate);
    expect(byDate.get(date)!.networkYears.NSW).toBe('FY24');
    expect(byDate.get(date)!.prices.NSW).toBe(calculateBulkPrices(periods, indexInputsOn('NSW', date).inputs, 'NSW').bulkPrice);
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

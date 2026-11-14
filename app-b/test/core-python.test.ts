// The Streamlit app prices quotes with humquote_core.py, a Python port of src/core.
// This checks the two agree: contract periods, every table value, warnings, the
// other-state prices and the bulk price index, on cases written by
// generate_core_cases.py. Regenerate them after changing either core.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateBulkPrices, toRecords, type QuoteInputs, type QuoteResult, type State } from '../src/core/calc';
import { buildCurves, type StripRow } from '../src/core/periods';
import { bulkPriceIndex, compareStates, quotePeriods, quoteWarnings } from '../src/core/analysis';

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf-8');
const data = JSON.parse(fixture('core_cases.json'));

// Python and JavaScript share IEEE doubles, but pow() can differ in the last bit.
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(b)));

const curves = {
  nov13: buildCurves(toRecords(data.nov13Fy), data.nov13 as StripRow[]).get('2026-11-13')!,
  fy_only: buildCurves(toRecords(data.nov13Fy)).get('2026-11-13')!,
};

const TABLE_KEYS: Record<string, keyof Omit<QuoteResult, 'updated' | 'bulkPrice'>> = {
  energy_rates: 'energyRates', consumption: 'consumption', charges: 'charges', costs: 'costs', rates: 'rates',
};

describe('the Streamlit core (humquote_core.py) matches the web core', () => {
  for (const c of data.cases) {
    const inputs = c.inputs as QuoteInputs;
    const state = c.state as State;
    it(`${c.curve} · ${state} · ${inputs.tariffId} · from ${inputs.supplyStart}`, () => {
      const periods = quotePeriods(curves[c.curve as keyof typeof curves], inputs);
      expect(periods.map((p) => [p.label, p.start, p.sources, p.estimates, p.note ?? null]))
        .toEqual(c.periods.map((p: { label: string; start: number; sources: string[]; estimates: string[]; note: string | null }) => [p.label, p.start, p.sources, p.estimates, p.note]));
      periods.forEach((p, i) => {
        for (const s of ['NSW', 'VIC', 'QLD', 'SA'] as State[]) close(p[s], c.periods[i].prices[s]);
      });

      const r = calculateBulkPrices(periods, inputs, state);
      for (const [key, rows] of Object.entries(c.tables) as [string, number[][]][]) {
        r[TABLE_KEYS[key]].rows.forEach((row, i) => [...row.values, row.average].forEach((v, j) => close(v, rows[i][j])));
      }
      close(r.bulkPrice, c.bulkPrice);
      expect(quoteWarnings(inputs, state, periods).map((w) => [w.kind, w.message])).toEqual(c.warnings);
      for (const o of compareStates(periods, inputs)) {
        expect(o.inputs.tariffId).toBe(c.otherStates[o.state][0]);
        close(o.result.bulkPrice, c.otherStates[o.state][1]);
      }
    });
  }

  it('bulk price index (current method)', () => {
    const index = bulkPriceIndex(buildCurves(toRecords(JSON.parse(fixture('futures.json')).rows)));
    const tail = index.slice(-data.index.length);
    tail.forEach((p, i) => {
      const want = data.index[i];
      expect(p.quoteDate).toBe(want.quoteDate);
      expect(p.estimates).toEqual(want.estimates);
      for (const s of ['NSW', 'VIC', 'QLD', 'SA'] as State[]) {
        close(p.prices[s], want.prices[s]);
        p.components[s].forEach((v, j) => close(v, want.components[s][j]));
      }
    });
  });
});

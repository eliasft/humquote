// Checks the TypeScript calculations against values produced by the Python app
// (see generate_fixtures.py). Runs before every deploy; a mismatch blocks publishing.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUTS, applyNetworkPreset, bulkPriceIndex, calculateBulkPrices, latestFutures, pyRound, toRecords,
  type QuoteInputs, type QuoteResult, type State,
} from '../src/lib/calc';
import { bulkIndexCsv, futuresCsv } from '../src/lib/export';
import { decodeQuote, encodeQuote } from '../src/lib/share';
import { groupByDate, quoteHistory, sensitivity, validateInputs } from '../src/lib/analysis';

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf-8');

const records = toRecords(JSON.parse(fixture('futures.json')).rows);
const latest = latestFutures(records);

interface ExpectedCase {
  state: State;
  network: string | null;
  inputs: Partial<QuoteInputs>;
  tables: Record<string, number[][]>;
}
const cases: ExpectedCase[] = JSON.parse(fixture('expected_quotes.json'));

const TABLE_KEYS: Record<string, keyof Omit<QuoteResult, 'updated' | 'bulkPrice'>> = {
  'Energy Consumption': 'consumption',
  'Rates Summary': 'rates',
  'Annual Costs': 'costs',
  'Tariffs & Factors': 'energyRates',
  'Costs per Unit': 'charges',
};

describe('quote calculation matches the Python app exactly', () => {
  for (const c of cases) {
    const label = `${c.state} · ${c.network ?? 'default network'} · ${Object.keys(c.inputs).length ? 'custom inputs' : 'default inputs'}`;
    it(label, () => {
      let inputs = { ...DEFAULT_INPUTS };
      if (c.network) inputs = applyNetworkPreset(inputs, c.network);
      inputs = { ...inputs, ...c.inputs };
      const r = calculateBulkPrices(latest, inputs, c.state);

      for (const [header, rows] of Object.entries(c.tables)) {
        const t = r[TABLE_KEYS[header]];
        rows.forEach((values, i) => {
          expect([...t.rows[i].values, t.rows[i].average], `${header} / ${t.rows[i].label}`).toEqual(values);
        });
      }
      expect(r.bulkPrice).toBe(c.tables['Rates Summary'][4][3]);
    });
  }
});

describe('tracker CSV downloads match the Python app byte for byte', () => {
  it('bulk price index', () => {
    expect(bulkIndexCsv(bulkPriceIndex(records))).toBe(fixture('expected_bulk_index.csv'));
  });
  it('futures history', () => {
    expect(futuresCsv(records)).toBe(fixture('expected_futures.csv'));
  });
});

describe('pyRound matches Python round()', () => {
  it.each([
    [2.675, 2, 2.67], [0.125, 2, 0.12], [0.375, 2, 0.38], [1.005, 2, 1.0], [12.345, 2, 12.35], [-2.5, 0, -2],
  ])('round(%f, %i) = %f', (v, d, want) => expect(pyRound(v, d)).toBe(want));
});

describe('features', () => {
  it('quote history on the latest date equals the current quote', () => {
    const history = quoteHistory(groupByDate(records), DEFAULT_INPUTS, 'NSW');
    expect(history.at(-1)!.quoteDate).toBe(latest[0].quoteDate);
    expect(history.at(-1)!.price).toBe(calculateBulkPrices(latest, DEFAULT_INPUTS, 'NSW').bulkPrice);
  });

  it('sensitivity brackets the base price and ranks drivers by effect', () => {
    const { base, drivers } = sensitivity(latest, DEFAULT_INPUTS, 'QLD');
    expect(drivers.length).toBeGreaterThan(3);
    for (const d of drivers) expect(Math.min(d.low, d.high)).toBeLessThanOrEqual(base + 1e-12);
    for (let i = 1; i < drivers.length; i++) expect(drivers[i - 1].spread).toBeGreaterThanOrEqual(drivers[i].spread);
  });

  it('share links round-trip inputs and state', () => {
    const inputs = { ...applyNetworkPreset(DEFAULT_INPUTS, 'BLNT1AO'), totalConsumption: 1234567, loadFactor: 0.62 };
    const decoded = decodeQuote(encodeQuote(inputs, 'SA'));
    expect(decoded).toEqual({ inputs, state: 'SA' });
  });

  it('validation flags shares over 100%', () => {
    expect(validateInputs(DEFAULT_INPUTS)).toEqual([]);
    expect(validateInputs({ ...DEFAULT_INPUTS, peakConsumption: 80, shoulderConsumption: 30 })[0].field).toBe('shoulderConsumption');
  });
});

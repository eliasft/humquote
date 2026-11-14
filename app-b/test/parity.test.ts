// Checks the TypeScript calculations against values produced by the Python app
// (see generate_fixtures.py). Runs before every deploy; a mismatch blocks publishing.
//
// Two changes are intentional and not yet in the Streamlit app, so they're checked
// separately: network energy charges per consumption period (TOU tariffs only; flat
// tariffs must still match exactly), and the bulk price index method (the original
// method must still match byte for byte).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUTS, calculateBulkPrices, latestFutures, legacyBulkPriceIndex, pyRound, toRecords,
  type QuoteInputs, type QuoteResult, type State,
} from '../src/core/calc';
import { resolveTariffId } from '../src/core/tariffs';
import { bulkIndexCsv, futuresCsv } from '../src/lib/export';

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

// Rows that depend on the network energy charge (changed on purpose for TOU tariffs).
const NETWORK_ROWS: Record<string, number[]> = {
  'Costs per Unit': [4],
  'Annual Costs': [4, 7, 9],
  'Rates Summary': [1, 4],
};

// The Python app's network presets (test/legacy/app/HUM.py), which the tariff catalogue
// has since replaced with researched FY27 rates.
const LEGACY_PRESETS: Record<string, [number, number, number, number, number]> = {
  // peak, shoulder, off-peak (c/kWh), NUOS ($/kVA/month), service availability ($/day)
  'Energex 8300': [2.8140, 2.8140, 2.8140, 13.4270, 7.7240],
  'Energex 8100': [1.3010, 1.3010, 1.3010, 15.7730, 37.7400],
  BLNT1AO: [20.4161, 15.9733, 8.4967, 0.0, 2.2229],
  BLND3AO: [6.1763, 4.9580, 3.2273, 0.0, 20.8017],
};

// The Python app's inputs for a case: its old defaults used the Energex 8300 preset.
function legacyInputs(c: ExpectedCase): QuoteInputs {
  const name = c.network ?? 'Energex 8300';
  const [peakCharge, shoulderCharge, offPeakCharge, nuosCharge, serviceAvailabilityCharge] = LEGACY_PRESETS[name];
  // The Python app had one demand rate (NUOS), now a single demand line.
  const { nuosCharge: customNuos, ...custom } = c.inputs as Partial<QuoteInputs> & { nuosCharge?: number };
  return {
    ...DEFAULT_INPUTS, tariffId: resolveTariffId(name)!,
    peakCharge, shoulderCharge, offPeakCharge, demandRates: [customNuos ?? nuosCharge], serviceAvailabilityCharge, ...custom,
  };
}

describe('quote calculation matches the Python app', () => {
  for (const c of cases) {
    const inputs = legacyInputs(c);
    const flat = inputs.peakCharge === inputs.shoulderCharge && inputs.shoulderCharge === inputs.offPeakCharge;
    const label = `${c.state} · ${c.network ?? 'default network'} · ${Object.keys(c.inputs).length ? 'custom inputs' : 'default inputs'}`;

    it(`${label}${flat ? ' (exact)' : ' (exact except network energy)'}`, () => {
      const r = calculateBulkPrices(latest, inputs, c.state);
      for (const [header, rows] of Object.entries(c.tables)) {
        const t = r[TABLE_KEYS[header]];
        rows.forEach((values, i) => {
          if (!flat && NETWORK_ROWS[header]?.includes(i)) return;
          expect([...t.rows[i].values, t.rows[i].average], `${header} / ${t.rows[i].label}`).toEqual(values);
        });
      }
      if (flat) expect(r.bulkPrice).toBe(c.tables['Rates Summary'][4][3]);
    });

    if (!flat) {
      it(`${label}: network energy is charged per consumption period`, () => {
        const r = calculateBulkPrices(latest, inputs, c.state);
        const [total, peak, shoulder, offPeak] = r.consumption.rows.map((row) => row.values[0]);
        const expected = (peak * inputs.peakCharge + shoulder * inputs.shoulderCharge + offPeak * inputs.offPeakCharge) / 100;
        expect(r.costs.rows[4].values[0]).toBeCloseTo(expected, 9);
        expect(r.charges.rows[4].values[0]).toBeCloseTo((expected / total) * 100, 12);
        // Everything else is unchanged, so the total moves by exactly the network difference.
        const pythonNetwork = c.tables['Annual Costs'][4][0];
        expect(r.costs.rows[7].values[0]).toBeCloseTo(c.tables['Annual Costs'][7][0] - pythonNetwork + expected, 6);
      });
    }
  }
});

describe('tracker CSV downloads match the Python app byte for byte', () => {
  it('bulk price index (original method)', () => {
    expect(bulkIndexCsv(legacyBulkPriceIndex(records))).toBe(fixture('expected_bulk_index.csv'));
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

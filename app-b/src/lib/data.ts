// Loads the ASX futures data published by the daily GitHub Action (data/futures.json):
// the FY strip history plus the quarterly and CY contracts collected since 13 Nov 2026.

import { useEffect, useMemo, useState } from 'react';
import { latestFutures, legacyBulkPriceIndex, toRecords, type FuturesRow, type IndexPoint } from '@/core/calc';
import { buildCurves, type Contract, type StripRow } from '@/core/periods';
import { bulkPriceIndex, type IndexPoint2 } from '@/core/analysis';

export interface MarketData {
  records: FuturesRow[];
  strips: StripRow[];
  latestDate: string;
  // FY strips listed on the latest date (the Futures chart's "still quoted" years).
  latestFy: FuturesRow[];
  curves: Map<string, Contract[]>;
  curve: Contract[];
  index: IndexPoint2[];
  legacyIndex: IndexPoint[];
}

type Raw = { rows: FuturesRow[]; strips: StripRow[] };
type Status = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: MarketData };

const DATA_URL = new URL('../data/futures.json', new URL(import.meta.env.BASE_URL, window.location.origin));

export function useMarketData(): Status {
  const [raw, setRaw] = useState<Raw | { error: string } | null>(null);

  useEffect(() => {
    // Bust the browser cache roughly hourly so the daily data update shows up promptly.
    const url = `${DATA_URL.href}?v=${Math.floor(Date.now() / 3_600_000)}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setRaw({ rows: toRecords(json.rows), strips: json.strips?.rows ?? [] }))
      .catch((e: Error) => setRaw({ error: `Could not load futures data: ${e.message}` }));
  }, []);

  return useMemo<Status>(() => {
    if (!raw) return { status: 'loading' };
    if ('error' in raw) return { status: 'error', message: raw.error };
    const latestFy = latestFutures(raw.rows);
    if (!latestFy.length) return { status: 'error', message: 'No futures data found.' };
    const curves = buildCurves(raw.rows, raw.strips);
    const latestDate = [...curves.keys()].at(-1)!;
    return {
      status: 'ready',
      data: {
        records: raw.rows,
        strips: raw.strips,
        latestDate,
        latestFy,
        curves,
        curve: curves.get(latestDate)!,
        index: bulkPriceIndex(curves),
        legacyIndex: legacyBulkPriceIndex(raw.rows),
      },
    };
  }, [raw]);
}

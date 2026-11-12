// Loads the ASX futures data published by the daily GitHub Action (data/futures.json).

import { useEffect, useMemo, useState } from 'react';
import { bulkPriceIndex, latestFutures, toRecords, type FuturesRow, type IndexPoint } from './calc';
import { groupByDate } from './analysis';

export interface MarketData {
  records: FuturesRow[];
  latest: FuturesRow[];
  latestDate: string;
  byDate: Map<string, FuturesRow[]>;
  index: IndexPoint[];
}

type Status = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: MarketData };

const DATA_URL = new URL('../data/futures.json', new URL(import.meta.env.BASE_URL, window.location.origin));

export function useMarketData(): Status {
  const [raw, setRaw] = useState<{ rows: FuturesRow[] } | { error: string } | null>(null);

  useEffect(() => {
    // Bust the browser cache roughly hourly so the daily data update shows up promptly.
    const url = `${DATA_URL.href}?v=${Math.floor(Date.now() / 3_600_000)}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setRaw({ rows: toRecords(json.rows) }))
      .catch((e: Error) => setRaw({ error: `Could not load futures data: ${e.message}` }));
  }, []);

  return useMemo<Status>(() => {
    if (!raw) return { status: 'loading' };
    if ('error' in raw) return { status: 'error', message: raw.error };
    const latest = latestFutures(raw.rows);
    if (!latest.length) return { status: 'error', message: 'No futures data found.' };
    return {
      status: 'ready',
      data: {
        records: raw.rows,
        latest,
        latestDate: latest[0].quoteDate,
        byDate: groupByDate(raw.rows),
        index: bulkPriceIndex(raw.rows),
      },
    };
  }, [raw]);
}

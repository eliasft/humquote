"""
Exports data/asx_futures.csv to JSON for the web versions of HUMQuote.

  strips: every contract on every date (Quote Date, Contract, Start, Months, prices),
          named for what it is (Q4 2026, CY2027, FY2028); the web apps build their
          price curves from these.
  rows:   each date's yearly strips in the original (Quote Date, Year, prices) shape,
          for the bulk index's original method: FY strips, or CY strips before
          22 Jun 2026 (futures_store.headline_rows).
  estimates: estimated CY prices for dates with only FY strips, from
          asx_futures_estimates.csv next to the data (same columns plus Note); only the
          charts use them.

Usage: python export_futures_json.py <data/asx_futures.csv> <output.json>
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
import futures_store as store  # noqa: E402

COLUMNS = ['Quote Date', 'Year', 'NSW', 'VIC', 'QLD', 'SA']
STRIP_COLUMNS = list(store.COLUMNS)


def main(csv_path, out_path):
    contracts = store.load(csv_path)
    rows = sorted(store.headline_rows(contracts), key=lambda r: (r[0], r[1]), reverse=True)
    strips = sorted(contracts, key=lambda r: r[0], reverse=True)  # stable: start, months within a date
    est_path = os.path.join(os.path.dirname(csv_path), os.path.basename(store.ESTIMATES_PATH))
    estimates = sorted(store.load_estimates(est_path), key=lambda r: r[0], reverse=True)
    out = {'columns': COLUMNS, 'rows': rows, 'strips': {'columns': STRIP_COLUMNS, 'rows': strips},
           'estimates': {'columns': list(store.ESTIMATE_COLUMNS), 'rows': estimates}}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"Exported {len(rows)} yearly rows, {len(strips)} contract rows and {len(estimates)} estimates to {out_path}")


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

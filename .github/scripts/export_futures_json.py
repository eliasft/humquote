"""
Exports futures_prices.db to JSON for the web versions of HUMQuote, so the
browser doesn't need a SQLite library.

  rows:   futures_data (FY base strips, the full history)
  strips: futures_strips (quarterly, CY and FY base contracts; collected from
          13 Nov 2026), omitted if the table doesn't exist yet

Usage: python export_futures_json.py <futures_prices.db> <output.json>
"""

import json
import sqlite3
import sys

COLUMNS = ['Quote Date', 'Year', 'NSW', 'VIC', 'QLD', 'SA']
STRIP_COLUMNS = ['Quote Date', 'Contract', 'Start', 'Months', 'NSW', 'VIC', 'QLD', 'SA']


def main(db_path, out_path):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT `Quote Date`, `Year`, `NSW`, `VIC`, `QLD`, `SA` "
        "FROM futures_data ORDER BY `Quote Date` DESC, `Year` DESC"
    ).fetchall()
    out = {'columns': COLUMNS, 'rows': rows}

    has_strips = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'futures_strips'"
    ).fetchone()
    if has_strips:
        strips = conn.execute(
            "SELECT `Quote Date`, `Contract`, `Start`, `Months`, `NSW`, `VIC`, `QLD`, `SA` "
            "FROM futures_strips ORDER BY `Quote Date` DESC, `Start`, `Months`"
        ).fetchall()
        out['strips'] = {'columns': STRIP_COLUMNS, 'rows': strips}
    conn.close()

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"Exported {len(rows)} rows and {len(out.get('strips', {}).get('rows', []))} contract rows to {out_path}")


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

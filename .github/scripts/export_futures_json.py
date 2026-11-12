"""
Exports futures_data from futures_prices.db to JSON for the Option B (JavaScript)
build of HUMQuote, so the browser doesn't need a SQLite library.

Usage: python export_futures_json.py <futures_prices.db> <output.json>
"""

import json
import sqlite3
import sys

COLUMNS = ['Quote Date', 'Year', 'NSW', 'VIC', 'QLD', 'SA']


def main(db_path, out_path):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT `Quote Date`, `Year`, `NSW`, `VIC`, `QLD`, `SA` "
        "FROM futures_data ORDER BY `Quote Date` DESC, `Year` DESC"
    ).fetchall()
    conn.close()

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'columns': COLUMNS, 'rows': rows}, f, separators=(',', ':'))
    print(f"Exported {len(rows)} rows to {out_path}")


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

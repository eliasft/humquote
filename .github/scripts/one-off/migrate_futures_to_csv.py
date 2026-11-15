"""
One-off (Nov 2026): converts futures_prices.db into data/asx_futures.csv, the text
file the apps and the daily update now use. Run after clean_futures_history.py.

  - futures_strips rows are copied as they are.
  - futures_data rows become named yearly strips. Before 22 Jun 2026 they came from
    ASX Energy's old homepage, which listed calendar years (each year dropped out at
    the end of March, when a calendar year's first quarter ends), so they become
    CY<year> (January–December). From 22 Jun 2026 they are FY<year> (July–June).
  - Where both tables hold the same contract on the same date (FY strips from
    13 Nov 2026) the prices must agree.

Checks that every price is carried over unchanged, then writes the file.
Usage: python .github/scripts/one-off/migrate_futures_to_csv.py [futures_prices.db] [data/asx_futures.csv]
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
import futures_store as store  # noqa: E402


def convert(db_path):
    conn = sqlite3.connect(db_path)
    by_key = {}

    def add(row):
        key = (row[0], row[1])
        if key in by_key and by_key[key][4:] != row[4:]:
            raise SystemExit(f'{key}: futures_data and futures_strips disagree: {by_key[key][4:]} vs {row[4:]}')
        by_key[key] = row

    fy = conn.execute('SELECT "Quote Date", "Year", "NSW", "VIC", "QLD", "SA" FROM futures_data').fetchall()
    for d, y, *p in fy:
        d = str(d)[:10]
        name = f'CY{y}' if d < store.FY_STRIPS_FROM else f'FY{y}'
        start, months = store.contract_period(name)
        add((d, name, start, months, *map(float, p)))
    strips = conn.execute('SELECT "Quote Date", "Contract", "Start", "Months", "NSW", "VIC", "QLD", "SA" '
                          'FROM futures_strips').fetchall()
    for d, c, s, m, *p in strips:
        add((str(d)[:10], c, s, int(m), *map(float, p)))
    conn.close()
    return list(by_key.values()), fy, strips


def main(db_path, csv_path):
    rows, fy, strips = convert(db_path)
    store.save(rows, csv_path)

    # Read back and compare with both tables.
    back = {(r[0], r[1]): r for r in store.load(csv_path)}
    for d, y, *p in fy:
        name = f'CY{y}' if str(d)[:10] < store.FY_STRIPS_FROM else f'FY{y}'
        assert tuple(back[(str(d)[:10], name)][4:]) == tuple(map(float, p)), (d, y)
    for d, c, s, m, *p in strips:
        r = back[(str(d)[:10], c)]
        assert (r[2], r[3], tuple(r[4:])) == (s, int(m), tuple(map(float, p))), (d, c)
    assert len(back) == len(rows)
    found = store.problems(list(back.values()))
    if found:
        raise SystemExit('Problems after conversion:\n  ' + '\n  '.join(found))
    cy = sum(1 for r in back.values() if r[1].startswith('CY'))
    print(f'Wrote {len(back)} rows to {csv_path} ({len(fy)} yearly strips, {len(strips)} contract rows; '
          f'{cy} CY rows). All prices match the database; no data-quality problems.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'futures_prices.db',
         sys.argv[2] if len(sys.argv) > 2 else store.PATH)

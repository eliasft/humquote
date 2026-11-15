"""
One-off clean-up of futures_data (audit of 15 Nov 2026). Safe to run more than
once: it checks every date it touches against fingerprints of the data as audited,
applies the fix only to that exact data, reports "already applied" afterwards, and
changes nothing if anything differs.

1. Deletes rows saved on days ASX 24 didn't trade, and one stale copy:
   - 14 Jan, 14 May and 1 Jul 2023, 20 Oct and 2 Nov 2024: weekends (entered by hand)
   - 9 Jun 2025: King's Birthday, a copy of Friday 6 Jun (the old ASX homepage moved
     its date forward on holidays)
   - 9 Sep 2022: identical to 2 Sep 2022 (a copy)

2. Re-dates 42 rows saved by the daily update between 23 Jun and 26 Aug 2026. Those
   runs started before the day's settlement (about 4:20 pm Sydney time), when the
   page shows the previous trading day's prices under today's date. Each run's start
   time is known from its commit, so each row moves to the trading day its prices
   belong to (runs from 4:21 pm on got the day's own settlement; none ran between
   4:06 and 4:21 pm). Four rows land on a day that already holds the same prices
   (23 Jun, 30 Jun, 2 Jul and 7 Jul were exact repeats) and are dropped. The days
   whose own settlement was never captured (26 Jun, 30 Jun, 3 Jul, 13 Jul, 18 Aug
   and 26 Aug 2026) end up with no row instead of the wrong day's prices.

Usage: python .github/scripts/one-off/clean_futures_history.py [futures_prices.db]
"""

import hashlib
import sqlite3
import sys

DELETES = ["2022-09-09", "2023-01-14", "2023-05-14", "2023-07-01", "2024-10-20", "2024-11-02", "2025-06-09"]

# saved under → belongs to
MOVES = {
    '2026-06-23': '2026-06-22',
    '2026-06-24': '2026-06-23',
    '2026-06-25': '2026-06-24',
    '2026-06-26': '2026-06-25',
    '2026-06-30': '2026-06-29',
    '2026-07-02': '2026-07-01',
    '2026-07-03': '2026-07-02',
    '2026-07-07': '2026-07-06',
    '2026-07-08': '2026-07-07',
    '2026-07-09': '2026-07-08',
    '2026-07-10': '2026-07-09',
    '2026-07-13': '2026-07-10',
    '2026-07-15': '2026-07-14',
    '2026-07-16': '2026-07-15',
    '2026-07-17': '2026-07-16',
    '2026-07-20': '2026-07-17',
    '2026-07-21': '2026-07-20',
    '2026-07-22': '2026-07-21',
    '2026-07-23': '2026-07-22',
    '2026-07-24': '2026-07-23',
    '2026-07-27': '2026-07-24',
    '2026-07-28': '2026-07-27',
    '2026-07-29': '2026-07-28',
    '2026-07-30': '2026-07-29',
    '2026-07-31': '2026-07-30',
    '2026-08-03': '2026-07-31',
    '2026-08-04': '2026-08-03',
    '2026-08-05': '2026-08-04',
    '2026-08-06': '2026-08-05',
    '2026-08-07': '2026-08-06',
    '2026-08-10': '2026-08-07',
    '2026-08-11': '2026-08-10',
    '2026-08-12': '2026-08-11',
    '2026-08-13': '2026-08-12',
    '2026-08-14': '2026-08-13',
    '2026-08-17': '2026-08-14',
    '2026-08-18': '2026-08-17',
    '2026-08-20': '2026-08-19',
    '2026-08-21': '2026-08-20',
    '2026-08-24': '2026-08-21',
    '2026-08-25': '2026-08-24',
    '2026-08-26': '2026-08-25',
}

# sha1 of each touched date's rows (Year, NSW, VIC, QLD, SA) before and after; None = no rows
BEFORE = {
    '2022-09-09': '3388749730d2',
    '2023-01-14': 'e2e4fe0b4adc',
    '2023-05-14': 'd2ed30365844',
    '2023-07-01': '11d49ab8fb18',
    '2024-10-20': '3556146d50ca',
    '2024-11-02': 'c7dcc944ba7a',
    '2025-06-09': 'f30b1cdd8687',
    '2026-06-22': '1e379f09dfde',
    '2026-06-23': '1e379f09dfde',
    '2026-06-24': '3061f368d3ed',
    '2026-06-25': '67938190f77f',
    '2026-06-26': '56df8fde2b01',
    '2026-06-29': 'c59478a60632',
    '2026-06-30': 'c59478a60632',
    '2026-07-01': 'ecdb95e98f42',
    '2026-07-02': 'ecdb95e98f42',
    '2026-07-03': '97bd5f71b3f6',
    '2026-07-06': '21894d3c450c',
    '2026-07-07': '21894d3c450c',
    '2026-07-08': 'c446c4abb068',
    '2026-07-09': '08987b685edb',
    '2026-07-10': 'fa23ea6a30b2',
    '2026-07-13': '35d4d4e72097',
    '2026-07-14': None,
    '2026-07-15': '5327bb30c26d',
    '2026-07-16': '398a10089a78',
    '2026-07-17': 'eeaf306c4323',
    '2026-07-20': '8a0ac202adb7',
    '2026-07-21': '0d7ad4b5f17a',
    '2026-07-22': 'ccf87f6a77e9',
    '2026-07-23': '70153fde7cd1',
    '2026-07-24': '4e6e81050e95',
    '2026-07-27': '6ea6554b1feb',
    '2026-07-28': '166f3f853a1a',
    '2026-07-29': '67f16d1fecae',
    '2026-07-30': '7cdd5d1c6fdf',
    '2026-07-31': 'c06e44930ee3',
    '2026-08-03': '0d8dff682714',
    '2026-08-04': '1f51edf17f90',
    '2026-08-05': '74fe0f14b0e4',
    '2026-08-06': '8ac75d8b7ef1',
    '2026-08-07': '48031c9cdf49',
    '2026-08-10': '532d390f278e',
    '2026-08-11': 'c9f1d86dc946',
    '2026-08-12': '5d4b81372ebc',
    '2026-08-13': '7429ed3698a7',
    '2026-08-14': 'afd708327864',
    '2026-08-17': '4995a8e27f2b',
    '2026-08-18': '17012acbd7db',
    '2026-08-19': None,
    '2026-08-20': '8bb912bbd5e2',
    '2026-08-21': '35a25a9e54de',
    '2026-08-24': 'ab829727154d',
    '2026-08-25': 'cc452574125c',
    '2026-08-26': 'd2257dd5b429',
}

AFTER = {
    '2022-09-09': None,
    '2023-01-14': None,
    '2023-05-14': None,
    '2023-07-01': None,
    '2024-10-20': None,
    '2024-11-02': None,
    '2025-06-09': None,
    '2026-06-22': '1e379f09dfde',
    '2026-06-23': '3061f368d3ed',
    '2026-06-24': '67938190f77f',
    '2026-06-25': '56df8fde2b01',
    '2026-06-26': None,
    '2026-06-29': 'c59478a60632',
    '2026-06-30': None,
    '2026-07-01': 'ecdb95e98f42',
    '2026-07-02': '97bd5f71b3f6',
    '2026-07-03': None,
    '2026-07-06': '21894d3c450c',
    '2026-07-07': 'c446c4abb068',
    '2026-07-08': '08987b685edb',
    '2026-07-09': 'fa23ea6a30b2',
    '2026-07-10': '35d4d4e72097',
    '2026-07-13': None,
    '2026-07-14': '5327bb30c26d',
    '2026-07-15': '398a10089a78',
    '2026-07-16': 'eeaf306c4323',
    '2026-07-17': '8a0ac202adb7',
    '2026-07-20': '0d7ad4b5f17a',
    '2026-07-21': 'ccf87f6a77e9',
    '2026-07-22': '70153fde7cd1',
    '2026-07-23': '4e6e81050e95',
    '2026-07-24': '6ea6554b1feb',
    '2026-07-27': '166f3f853a1a',
    '2026-07-28': '67f16d1fecae',
    '2026-07-29': '7cdd5d1c6fdf',
    '2026-07-30': 'c06e44930ee3',
    '2026-07-31': '0d8dff682714',
    '2026-08-03': '1f51edf17f90',
    '2026-08-04': '74fe0f14b0e4',
    '2026-08-05': '8ac75d8b7ef1',
    '2026-08-06': '48031c9cdf49',
    '2026-08-07': '532d390f278e',
    '2026-08-10': 'c9f1d86dc946',
    '2026-08-11': '5d4b81372ebc',
    '2026-08-12': '7429ed3698a7',
    '2026-08-13': 'afd708327864',
    '2026-08-14': '4995a8e27f2b',
    '2026-08-17': '17012acbd7db',
    '2026-08-18': None,
    '2026-08-19': '8bb912bbd5e2',
    '2026-08-20': '35a25a9e54de',
    '2026-08-21': 'ab829727154d',
    '2026-08-24': 'cc452574125c',
    '2026-08-25': 'd2257dd5b429',
    '2026-08-26': None,
}


def rows_on(conn, d):
    return sorted(tuple(r) for r in conn.execute(
        'SELECT "Year", "NSW", "VIC", "QLD", "SA" FROM futures_data WHERE "Quote Date" = ?', (d,)))


def fingerprint(rows):
    return hashlib.sha1(repr(sorted(rows)).encode()).hexdigest()[:12] if rows else None


def main(db):
    conn = sqlite3.connect(db)
    now = {d: fingerprint(rows_on(conn, d)) for d in BEFORE}
    if now == AFTER:
        print('Already applied: nothing to do.')
        return
    if now != BEFORE:
        bad = sorted(d for d in BEFORE if now[d] != BEFORE[d])
        sys.exit(f'Data differs from the audited state on {bad}: nothing changed.')

    moved = {d: rows_on(conn, d) for d in MOVES}
    with conn:
        for d in DELETES + list(MOVES):
            conn.execute('DELETE FROM futures_data WHERE "Quote Date" = ?', (d,))
        for d, target in MOVES.items():
            for year, *prices in moved[d]:
                conn.execute('INSERT OR IGNORE INTO futures_data ("Quote Date", "Year", "NSW", "VIC", "QLD", "SA") '
                             'VALUES (?, ?, ?, ?, ?, ?)', (target, year, *prices))
        result = {d: fingerprint(rows_on(conn, d)) for d in BEFORE}
        if result != AFTER:
            raise RuntimeError('result differs from the expected state; rolled back')
    conn.execute('VACUUM')
    conn.close()
    print(f'Deleted {len(DELETES)} dates and re-dated {len(MOVES)} rows.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'futures_prices.db')

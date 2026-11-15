"""
Data-quality check for data/asx_futures.csv (standard library only). Exits 1 and
lists the problems (futures_store.problems) if there is:
  - a quote date that isn't an ASX 24 trading day (weekend or holiday), or is in
    the future
  - a quote date whose prices equal the previous saved date's for every contract
    the two share (a stale copy saved under a new date)
  - a duplicate row, a zero or negative price, or a start/length that doesn't match
    the contract's name

Usage: python .github/scripts/check_futures_data.py [data/asx_futures.csv]
Run by the daily update before it pushes, and on every pull request.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
import futures_store as store  # noqa: E402


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else store.PATH
    rows = store.load(path)
    found = store.problems(rows)
    for p in found:
        print('✗', p)
    if found:
        print(f'{len(found)} problem(s) in {path}')
        sys.exit(1)
    dates = sorted({r[0] for r in rows})
    print(f'✓ {path}: {len(rows)} rows on {len(dates)} trading days ({dates[0]} to {dates[-1]}); '
          'no weekend, holiday, future or repeated dates; names, periods and prices valid')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()

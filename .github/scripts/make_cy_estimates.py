"""
Rebuilds data/asx_futures_estimates.csv from data/asx_futures.csv (standard library only):
estimated CY prices for dates where only FY strips were collected
(futures_store.estimate_calendar_years). Only the charts read the estimates.

Usage: python .github/scripts/make_cy_estimates.py [data/asx_futures.csv] [data/asx_futures_estimates.csv]
Run by the daily update after each new day, so the two files always agree;
check_futures_data.py fails if they don't.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
import futures_store as store  # noqa: E402


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else store.PATH
    dst = sys.argv[2] if len(sys.argv) > 2 else store.ESTIMATES_PATH
    est = store.estimate_calendar_years(store.load(src))
    store.save_estimates(est, dst)
    dates = sorted({r[0] for r in est})
    span = f' ({dates[0]} to {dates[-1]})' if dates else ''
    print(f'✓ {dst}: {len(est)} estimated CY prices on {len(dates)} days{span}')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()

"""
The ASX futures price history: data/asx_futures.csv (standard library only).

One row per settlement date and contract, oldest first, so each day's update adds
lines at the end and the history diffs and merges as plain text:

    Quote Date,Contract,Start,Months,NSW,VIC,QLD,SA
    2026-11-13,Q4 2026,2026-10,3,121.68,66.96,91.75,70.0
    2026-11-13,FY2028,2027-07,12,95.68,73.76,79.12,87.41

Prices are base-load settlements in $/MWh. Contracts are named Q4 2026 (a calendar
quarter), CY2027 (January–December 2027) or FY2028 (July 2027–June 2028).

What was collected when:
  - CY strips, 10 Sep 2021 – 4 Jun 2026: from ASX Energy's old homepage, which listed
    calendar years (sparse before 2024: hand-collected, often weekly or monthly).
  - FY strips from 22 Jun 2026, after ASX's site change.
  - Quarters, CY and FY strips from 13 Nov 2026: every base contract on the page.
"""

import csv
import os
from datetime import date

import asx_calendar as cal

PATH = os.path.join('data', 'asx_futures.csv')
STATES = ('NSW', 'VIC', 'QLD', 'SA')
COLUMNS = ('Quote Date', 'Contract', 'Start', 'Months', *STATES)
# The first date with FY strips. Before it, the yearly strips are calendar years.
FY_STRIPS_FROM = '2026-06-22'


def contract_period(contract):
    """('YYYY-MM' start, months) for 'Q4 2026', 'CY2027' or 'FY2028'; None if unrecognised."""
    try:
        if contract.startswith('FY') and len(contract) == 6:
            year = int(contract[2:])
            return f'{year - 1}-07', 12
        if contract.startswith('CY') and len(contract) == 6:
            return f'{int(contract[2:])}-01', 12
        if contract.startswith('Q') and len(contract) == 7 and contract[2] == ' ':
            q, year = int(contract[1]), int(contract[3:])
            if 1 <= q <= 4:
                return f'{year}-{(q - 1) * 3 + 1:02d}', 3
    except ValueError:
        pass
    return None


def _sort_key(row):
    return row[0], row[2], -row[3], row[1]


def load(path=PATH):
    """Rows as tuples (quote date, contract, start, months, NSW, VIC, QLD, SA), oldest first."""
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = tuple(next(reader))
        if header != COLUMNS:
            raise ValueError(f'{path}: unexpected columns {header}')
        rows = [(d, c, s, int(m), *map(float, p)) for d, c, s, m, *p in reader]
    return sorted(rows, key=_sort_key)


def save(rows, path=PATH):
    """Writes rows sorted by date then contract (the same rows always give the same file)."""
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(COLUMNS)
        for d, c, s, m, *p in sorted(rows, key=_sort_key):
            w.writerow([d, c, s, m, *(repr(float(x)) for x in p)])
    os.replace(tmp, path)


def merge(rows, new_rows):
    """
    rows with new_rows added: new (date, contract) pairs are inserted; existing ones
    are replaced only where a price differs. Returns (rows, inserted, corrected) where
    corrected lists (key, old prices, new prices).
    """
    by_key = {(r[0], r[1]): r for r in rows}
    inserted, corrected = 0, []
    for r in new_rows:
        key = (r[0], r[1])
        old = by_key.get(key)
        if old is None:
            inserted += 1
        elif tuple(old[4:]) != tuple(r[4:]):
            corrected.append((key, tuple(old[4:]), tuple(r[4:])))
        else:
            continue
        by_key[key] = tuple(r)
    return sorted(by_key.values(), key=_sort_key), inserted, corrected


def last_date_before(rows, quote_date):
    """(date, {contract: prices}) of the latest saved date before quote_date, or (None, {})."""
    before = [r[0] for r in rows if r[0] < quote_date]
    if not before:
        return None, {}
    last = max(before)
    return last, {r[1]: tuple(r[4:]) for r in rows if r[0] == last}


def is_stale(new_rows, previous):
    """True when every contract also saved on the previous date has the same prices."""
    scraped = {r[1]: tuple(r[4:]) for r in new_rows}
    common = set(scraped) & set(previous)
    return bool(common) and all(scraped[c] == previous[c] for c in common)


def headline_rows(rows):
    """
    The yearly strips the tracker has always used, in the original
    (quote date, year, NSW, VIC, QLD, SA) shape: each date's FY strips, or its CY
    strips on dates with no FY strip (before 22 Jun 2026). Feeds the bulk index's
    original method, unchanged.
    """
    by_date = {}
    for d, c, _, m, *p in rows:
        if m == 12 and c[:2] in ('FY', 'CY'):
            by_date.setdefault(d, {}).setdefault(c[:2], []).append((int(c[2:]), *p))
    out = []
    for d in sorted(by_date):
        kinds = by_date[d]
        out += [(d, *r) for r in sorted(kinds.get('FY') or kinds['CY'])]
    return out


def problems(rows, today=None):
    """Data-quality problems, as messages (empty when the data is clean)."""
    today = today or cal.now_sydney().date().isoformat()
    out = []
    seen = set()
    by_date = {}
    for r in rows:
        d, c, s, m, *p = r
        if (d, c) in seen:
            out.append(f'{d} {c}: duplicate row')
        seen.add((d, c))
        if contract_period(c) != (s, m):
            out.append(f'{d} {c}: start {s} / {m} months does not match the contract name')
        if any(x <= 0 for x in p):
            out.append(f'{d} {c}: zero or negative price {tuple(p)}')
        by_date.setdefault(d, {})[c] = tuple(p)
    dates = sorted(by_date)
    for d in dates:
        day = date.fromisoformat(d)
        if d > today:
            out.append(f'{d}: in the future')
        elif not cal.is_trading_day(day):
            out.append(f'{d}: not a trading day ({cal.holiday_name(day) or day.strftime("%A")})')
    for a, b in zip(dates, dates[1:]):
        common = set(by_date[a]) & set(by_date[b])
        if common and all(by_date[a][c] == by_date[b][c] for c in common):
            out.append(f'{b}: same prices as {a} for all {len(common)} shared contracts')
    return out

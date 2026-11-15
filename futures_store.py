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
  - 22 Jul 2026: every base contract, from the Wayback Machine's copy of ASX's page.

data/asx_futures_estimates.csv holds estimated CY prices for the 2026 gap (built from
the FY strips by estimate_calendar_years). It has the same columns plus a Note, and only
the charts read it: estimates are never mixed into the settlement history.
"""

import csv
import os
from datetime import date

import asx_calendar as cal

PATH = os.path.join('data', 'asx_futures.csv')
ESTIMATES_PATH = os.path.join('data', 'asx_futures_estimates.csv')
STATES = ('NSW', 'VIC', 'QLD', 'SA')
COLUMNS = ('Quote Date', 'Contract', 'Start', 'Months', *STATES)
ESTIMATE_COLUMNS = (*COLUMNS, 'Note')
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


# --- Estimated calendar years for dates with only FY strips -------------------------
#
# From 22 Jun to 12 Nov 2026 only FY strips were collected (and every contract on 22 Jul,
# recovered from an archived copy of the page). CY2027 (Jan-Dec 2027) is the second half
# of FY2027 plus the first half of FY2028, so its estimate starts from the average of
# those two FY strips. That average misses the difference between half-years, so it is
# corrected by the error measured on the nearest real CY prices on each side, blended
# linearly between them (held constant where there is only one side). Once FY2027 stops
# being listed (October), CY2027 follows FY2028 alone, with the correction running from
# the last estimate to the real price on 13 Nov, so the line has no jumps. A CY strip is
# only estimated where both FY partners exist or a real price sits on each side; CY2029
# (no FY2030 was listed) is left as a gap. Tested on 22 Jul and 13 Nov 2026 against the
# real prices: within about $1-2/MWh uncorrected.


def _days(a, b):
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def estimate_calendar_years(rows):
    """Estimated CY rows for dates that have FY strips but no real price for that CY.

    Returns rows shaped like ESTIMATE_COLUMNS (prices rounded to the cent), oldest first.
    """
    prices = {}
    for d, c, _s, _m, *p in rows:
        prices.setdefault(d, {})[c] = tuple(p)
    dates = sorted(prices)
    out = []
    for cy in sorted({c for d in dates for c in prices[d] if c.startswith('CY')}):
        year = int(cy[2:])
        partners = (f'FY{year}', f'FY{year + 1}')
        real = [d for d in dates if cy in prices[d]]
        if len(real) < 2:
            continue
        # Interior dates (between the first and last real price) with no real price
        # but at least one FY partner, grouped into runs that share the same partners.
        runs = []
        for d in dates:
            if not real[0] < d < real[-1] or cy in prices[d]:
                if runs and runs[-1][1]:
                    runs.append((None, []))     # a real price (or the edge) ends a run
                continue
            base = tuple(f for f in partners if f in prices[d])
            if not base:
                if runs and runs[-1][1]:
                    runs.append((None, []))
                continue
            if not runs or runs[-1][0] != base:
                runs.append((base, []))
            runs[-1][1].append(d)
        runs = [r for r in runs if r[1]]
        estimates = {}                           # date -> prices, real or estimated so far

        def known(d):
            return prices.get(d, {}).get(cy) or estimates.get(d)

        for base, run in runs:
            i, j = dates.index(run[0]), dates.index(run[-1])
            left = dates[i - 1] if i > 0 else None
            right = dates[j + 1] if j + 1 < len(dates) else None

            def base_on(d):
                if d is None or not all(f in prices[d] for f in base):
                    return None
                return tuple(sum(prices[d][f][k] for f in base) / len(base) for k in range(4))

            def residual(d):
                b, v = base_on(d), known(d) if d else None
                return tuple(v[k] - b[k] for k in range(4)) if b and v else None

            r_left, r_right = residual(left), residual(right)
            if r_left is None and r_right is None:
                continue
            if len(base) < 2 and (r_left is None or r_right is None):
                continue                         # one FY partner and only one real side
            what = f'average of {base[0]} and {base[1]}' if len(base) == 2 else base[0]
            real_sides = [x for x, r in ((left, r_left), (right, r_right)) if r and cy in prices.get(x, {})]
            note = f'Estimate (not an ASX price): {what}, corrected to the real {cy} price on {" and ".join(real_sides)}'
            if r_left and left not in real_sides:
                note += f', continuing from the {left} estimate'
            for d in run:
                if r_left is None or r_right is None:
                    r = r_left or r_right
                else:
                    w = _days(left, d) / _days(left, right)
                    r = tuple(r_left[k] + (r_right[k] - r_left[k]) * w for k in range(4))
                b = base_on(d)
                estimates[d] = tuple(round(b[k] + r[k], 2) for k in range(4))
                start, months = contract_period(cy)
                out.append((d, cy, start, months, *estimates[d], note))
    return sorted(out, key=_sort_key)


def save_estimates(rows, path=ESTIMATES_PATH):
    """Writes estimate rows (ESTIMATE_COLUMNS) in the same stable order as save()."""
    tmp = path + '.tmp'
    with open(tmp, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(ESTIMATE_COLUMNS)
        for d, c, s, m, *rest in sorted(rows, key=_sort_key):
            *p, note = rest
            w.writerow([d, c, s, m, *(repr(float(x)) for x in p), note])
    os.replace(tmp, path)


def load_estimates(path=ESTIMATES_PATH):
    """Estimate rows (quote date, contract, start, months, NSW, VIC, QLD, SA, note); [] if no file."""
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = tuple(next(reader))
        if header != ESTIMATE_COLUMNS:
            raise ValueError(f'{path}: unexpected columns {header}')
        rows = [(d, c, s, int(m), *map(float, p), note) for d, c, s, m, *p, note in reader]
    return sorted(rows, key=_sort_key)

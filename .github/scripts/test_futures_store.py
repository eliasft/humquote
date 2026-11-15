"""
Tests for futures_store (standard library only): python .github/scripts/test_futures_store.py
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
import futures_store as store  # noqa: E402
import humquote_core as core  # noqa: E402


def row(d, c, *p):
    s, m = store.contract_period(c)
    return (d, c, s, m, *(map(float, p or (90, 70, 80, 100))))


def test_contract_period():
    assert store.contract_period('FY2028') == ('2027-07', 12)
    assert store.contract_period('CY2027') == ('2027-01', 12)
    assert store.contract_period('Q4 2026') == ('2026-10', 3)
    assert store.contract_period('Q1 2027') == ('2027-01', 3)
    for bad in ('FY28', 'Q5 2026', 'Q42026', 'XY2027', ''):
        assert store.contract_period(bad) is None, bad


def test_save_load_round_trip_is_byte_stable():
    rows = [row('2026-11-13', 'FY2029', 99.21, 84.0, 82.35, 101.52), row('2026-11-13', 'Q4 2026'),
            row('2026-11-12', 'FY2028'), row('2026-11-13', 'CY2027')]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'f.csv')
        store.save(rows, p)
        first = open(p, 'rb').read()
        back = store.load(p)
        store.save(list(reversed(back)), p)
        assert open(p, 'rb').read() == first
        lines = first.decode().splitlines()
        assert lines[0] == ','.join(store.COLUMNS)
        assert lines[1].startswith('2026-11-12,FY2028')          # oldest date first
        assert [ln.split(',')[1] for ln in lines[2:]] == ['Q4 2026', 'CY2027', 'FY2029']  # then by start
        assert lines[-1] == '2026-11-13,FY2029,2028-07,12,99.21,84.0,82.35,101.52'
        assert b'\r' not in first


def test_merge():
    base = [row('2026-11-12', 'FY2028'), row('2026-11-12', 'FY2029')]
    merged, ins, corr = store.merge(base, [row('2026-11-12', 'FY2028'), row('2026-11-12', 'FY2029', 1, 2, 3, 4),
                                           row('2026-11-13', 'FY2028')])
    assert ins == 1 and len(corr) == 1 and corr[0][0] == ('2026-11-12', 'FY2029')
    assert len(merged) == 3
    assert dict(((r[0], r[1]), r[4:]) for r in merged)[('2026-11-12', 'FY2029')] == (1.0, 2.0, 3.0, 4.0)


def test_stale_detection():
    rows = [row('2026-11-12', 'FY2028', 1, 2, 3, 4), row('2026-11-12', 'FY2029', 5, 6, 7, 8)]
    prev_date, prev = store.last_date_before(rows, '2026-11-13')
    assert prev_date == '2026-11-12'
    assert store.is_stale([row('2026-11-13', 'FY2028', 1, 2, 3, 4), row('2026-11-13', 'Q4 2026')], prev)
    assert not store.is_stale([row('2026-11-13', 'FY2028', 1, 2, 3, 4.5)], prev)
    assert not store.is_stale([row('2026-11-13', 'FY2030')], prev)   # nothing in common
    assert store.last_date_before(rows, '2026-11-12') == (None, {})


def test_headline_rows():
    rows = [row('2026-06-04', 'CY2027', 1, 2, 3, 4), row('2026-06-04', 'CY2028'),
            row('2026-11-13', 'CY2027'), row('2026-11-13', 'FY2028', 5, 6, 7, 8), row('2026-11-13', 'Q4 2026')]
    assert store.headline_rows(rows) == [
        ('2026-06-04', 2027, 1.0, 2.0, 3.0, 4.0), ('2026-06-04', 2028, 90.0, 70.0, 80.0, 100.0),
        ('2026-11-13', 2028, 5.0, 6.0, 7.0, 8.0),   # FY strips win when a date has them
    ]


def test_problems():
    clean = [row('2026-11-12', 'FY2028', 1, 2, 3, 4), row('2026-11-13', 'FY2028', 1, 2, 3, 5)]
    assert store.problems(clean, today='2026-11-15') == []
    found = store.problems(clean + [
        row('2026-11-14', 'FY2028', 9, 9, 9, 9),                    # Saturday
        row('2026-12-28', 'FY2028', 8, 8, 8, 8),                    # Boxing Day (observed)
        ('2026-11-16', 'CY2027', '2027-07', 12, 1.0, 2.0, 3.0, 4.0),  # wrong start for a CY strip
        row('2026-11-16', 'FY2028', 1, 2, 0, 4),                    # zero price
        row('2026-11-17', 'FY2028', 1, 2, 0, 4),                    # same as the day before
    ], today='2026-11-20')
    text = '\n'.join(found)
    for expect in ('2026-11-14: not a trading day (Saturday)', "2026-12-28: in the future",
                   '2026-11-16 CY2027: start 2027-07', '2026-11-16 FY2028: zero or negative',
                   '2026-11-17: same prices as 2026-11-16'):
        assert expect in text, (expect, text)
    assert 'duplicate' in '\n'.join(store.problems([clean[0], clean[0]], today='2026-11-15'))
    assert 'Boxing Day' in '\n'.join(store.problems([row('2026-12-28', 'FY2028')], today='2027-01-10'))


def test_estimate_calendar_years():
    p = lambda v: (v, v, v, v)  # noqa: E731
    rows = [
        row('2026-11-02', 'CY2027', *p(100)), row('2026-11-02', 'FY2027', *p(90)), row('2026-11-02', 'FY2028', *p(100)),
        row('2026-11-03', 'FY2027', *p(90)), row('2026-11-03', 'FY2028', *p(100)),
        row('2026-11-04', 'FY2027', *p(92)), row('2026-11-04', 'FY2028', *p(102)),
        row('2026-11-05', 'CY2027', *p(110)), row('2026-11-05', 'FY2027', *p(94)), row('2026-11-05', 'FY2028', *p(104)),
        # CY2029: one FY partner (FY2029) and a real price with a partner on one side only: left alone
        row('2026-11-02', 'CY2029', *p(120)), row('2026-11-03', 'FY2029', *p(118)),
        row('2026-11-05', 'CY2029', *p(121)), row('2026-11-05', 'FY2029', *p(119)),
    ]
    est = store.estimate_calendar_years(rows)
    # base = average of the FYs; correction blends from +5 (2 Nov) to +11 (5 Nov) by days
    assert [(r[0], r[1], r[4]) for r in est] == [('2026-11-03', 'CY2027', 102.0), ('2026-11-04', 'CY2027', 106.0)]
    assert est[0][2:4] == ('2027-01', 12) and est[0][4:8] == p(102.0)
    assert est[0][8].startswith('Estimate (not an ASX price): average of FY2027 and FY2028')
    assert '2026-11-02 and 2026-11-05' in est[0][8]
    # real prices are never overwritten, and dates with no FY partner get nothing
    assert store.estimate_calendar_years([r for r in rows if r[1] == 'CY2027']) == []
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'e.csv')
        store.save_estimates(est, path)
        assert store.load_estimates(path) == est
        assert store.load_estimates(os.path.join(d, 'missing.csv')) == []


def test_split_estimates_matches_the_web_version():
    # Same cases as 'splits a contract into a solid real line...' in app-b/test/core.test.ts
    solid, dashed = core.split_estimates([('a', 1), ('d', 4), ('g', 7), ('h', 8)], [('b', 2), ('c', 3), ('e', 5), ('f', 6)])
    assert solid == [('a', 1), ('c', None), ('d', 4), ('f', None), ('g', 7), ('h', 8)]
    assert dashed == [('a', 1), ('b', 2), ('c', 3), ('d', 4), ('e', 5), ('f', 6), ('g', 7)]
    _, two = core.split_estimates([('a', 1), ('c', 3), ('d', 4), ('f', 6)], [('b', 2), ('e', 5)])
    assert two == [('a', 1), ('b', 2), ('c', 3), ('d', None), ('d', 4), ('e', 5), ('f', 6)]
    assert core.split_estimates([('a', 1)], []) == ([('a', 1)], [])
    assert core.split_estimates([('a', 1), ('b', 2), ('f', 6), ('g', 7)], [], ('c', 'e'))[0] == \
        [('a', 1), ('b', 2), ('c', None), ('f', 6), ('g', 7)]


def test_curves_place_calendar_years_in_their_own_months():
    rows = [row('2026-06-04', 'CY2027'), row('2026-11-13', 'FY2028'), row('2026-11-13', 'Q4 2026')]
    curves = core.build_curves((), rows)
    cy = curves['2026-06-04'][0]
    assert (cy['contract'], cy['start'], cy['months']) == ('CY2027', core.month_index('2027-01'), 12)
    fy = next(c for c in curves['2026-11-13'] if c['contract'] == 'FY2028')
    assert fy['start'] == core.month_index('2027-07')


if __name__ == '__main__':
    tests = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for t in tests:
        t()
        print('ok', t.__name__)
    print(f'{len(tests)} tests passed')

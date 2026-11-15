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

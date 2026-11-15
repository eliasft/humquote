"""
Tests for asx_calendar (standard library only): python .github/scripts/test_asx_calendar.py

The holiday expectations are ASX's own T24 trading calendars for 2026, 2027 and
2028 (days the ASX 24 day session is closed). The timing cases are the situations
that put prices under the wrong date before: runs at midday, in the evening, after
midnight, on weekends and on holidays.
"""

import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
import asx_calendar as cal  # noqa: E402

D = date.fromisoformat


def at(s):
    """A Sydney wall-clock time, 'YYYY-MM-DD HH:MM'."""
    return datetime.strptime(s, '%Y-%m-%d %H:%M').replace(tzinfo=cal.SYDNEY)


def test_holidays_match_asx_calendars():
    expected = {
        2026: ['2026-01-01', '2026-01-26', '2026-04-03', '2026-04-06', '2026-06-08', '2026-12-25', '2026-12-28'],
        2027: ['2027-01-01', '2027-01-26', '2027-03-26', '2027-03-29', '2027-06-14', '2027-12-27', '2027-12-28'],
        2028: ['2028-01-03', '2028-01-26', '2028-04-14', '2028-04-17', '2028-06-12', '2028-12-25', '2028-12-26'],
    }
    for year, days in expected.items():
        got = sorted(d.isoformat() for d in cal.holidays(year))
        assert got == days, (year, got)


def test_anzac_day_trades():
    for d in ['2026-04-27', '2027-04-26', '2028-04-25', '2025-04-25']:
        assert cal.is_trading_day(D(d)), d


def test_past_closures():
    assert not cal.is_trading_day(D('2025-06-09'))   # King's Birthday
    assert not cal.is_trading_day(D('2022-09-22'))   # National Day of Mourning
    assert not cal.is_trading_day(D('2025-01-27'))   # Australia Day (Sunday) observed Monday


def test_trading_day_steps():
    assert cal.previous_trading_day(D('2026-12-29')) == D('2026-12-24')
    assert cal.next_trading_day(D('2026-12-24')) == D('2026-12-29')
    assert cal.previous_trading_day(D('2026-11-16')) == D('2026-11-13')


def test_latest_settlement_date():
    cases = {
        '2026-11-16 12:00': '2026-11-13',  # Monday midday: Friday's settlement still showing
        '2026-11-16 16:59': '2026-11-13',
        '2026-11-16 17:00': '2026-11-16',
        '2026-11-16 23:59': '2026-11-16',
        '2026-11-17 01:30': '2026-11-16',  # a delayed run after midnight
        '2026-11-14 10:00': '2026-11-13',  # Saturday
        '2026-11-15 22:00': '2026-11-13',  # Sunday
        '2026-12-28 18:00': '2026-12-24',  # Boxing Day (observed)
        '2026-12-29 09:00': '2026-12-24',
        '2027-04-05 18:00': '2027-04-05',  # first trading day after DST ends (AEST)
        '2026-10-05 18:00': '2026-10-05',  # first day of AEDT
    }
    for now, want in cases.items():
        assert cal.latest_settlement_date(at(now)) == D(want), (now, cal.latest_settlement_date(at(now)))


def test_latest_settlement_date_from_utc():
    from datetime import timezone
    # 07:30 UTC on Mon 16 Nov 2026 is 18:30 AEDT
    assert cal.latest_settlement_date(datetime(2026, 11, 16, 7, 30, tzinfo=timezone.utc)) == D('2026-11-16')
    # 02:00 UTC (the old schedule) is 13:00 AEDT: Friday's settlement
    assert cal.latest_settlement_date(datetime(2026, 11, 16, 2, 0, tzinfo=timezone.utc)) == D('2026-11-13')


def test_settlement_date_for_page():
    f = cal.settlement_date_for_page
    assert f(D('2026-11-16'), 'Open', at('2026-11-16 13:00')) == D('2026-11-13')
    assert f(D('2026-11-16'), 'Closed', at('2026-11-16 18:00')) == D('2026-11-16')
    assert f(D('2026-11-15'), 'Weekend', at('2026-11-15 10:23')) == D('2026-11-13')
    assert f(D('2026-12-28'), 'Public Holiday', at('2026-12-28 18:00')) == D('2026-12-24')
    assert f(D('2026-11-17'), '', at('2026-11-17 00:30')) == D('2026-11-16')
    bad = [
        (D('2026-11-12'), 'Closed', at('2026-11-16 18:00')),   # page behind the clock
        (D('2026-11-18'), 'Open', at('2026-11-16 18:00')),     # page ahead by more than a trading day
        (D('2026-11-16'), 'Public Holiday', at('2026-11-16 18:00')),  # a closure the calendar lacks
    ]
    for args in bad:
        try:
            f(*args)
        except ValueError:
            continue
        raise AssertionError(f'expected ValueError for {args}')


if __name__ == '__main__':
    tests = [v for k, v in sorted(globals().items()) if k.startswith('test_')]
    for t in tests:
        t()
        print('ok', t.__name__)
    print(f'{len(tests)} tests passed')

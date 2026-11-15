"""
ASX 24 trading days and settlement timing for the daily futures update (standard
library only, so the checks in CI can use it without installing anything).

Holidays are the days ASX 24's day session is closed, from ASX's T24 trading
calendars (checked against the 2026, 2027 and 2028 calendars):
  New Year's Day, Australia Day, Good Friday, Easter Monday, King's Birthday (second
  Monday of June), Christmas Day and Boxing Day, each moved to the next weekday when
  it falls on a weekend. Anzac Day is a trading day on ASX 24.
One-off closures go in EXTRA_CLOSURES.

Settlement: ASX publishes the day's settlement prices at about 4:20 pm Sydney time
(observed between 4:06 and 4:21 pm). Until then the futures page's Settle column
still shows the previous trading day's prices, under today's date, which is how
rows came to be saved under the wrong day. So the date a scrape is saved under is
worked out from the clock, not from the page: the latest trading day whose
settlement time (SETTLEMENT_TIME, with a margin) has passed.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

SYDNEY = ZoneInfo('Australia/Sydney')
SETTLEMENT_TIME = time(17, 0)

EXTRA_CLOSURES = {
    date(2022, 9, 22): 'National Day of Mourning',
}


def _easter(y):
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return date(y, (h + l - 7 * m + 114) // 31, (h + l - 7 * m + 114) % 31 + 1)


def _next_weekday(d):
    return d + timedelta(days={5: 2, 6: 1}.get(d.weekday(), 0))


def holidays(year):
    """{date: name} of the weekdays ASX 24's day session is closed in `year`."""
    out = {
        _next_weekday(date(year, 1, 1)): "New Year's Day",
        _next_weekday(date(year, 1, 26)): 'Australia Day',
    }
    easter = _easter(year)
    out[easter - timedelta(days=2)] = 'Good Friday'
    out[easter + timedelta(days=1)] = 'Easter Monday'
    june = date(year, 6, 1)
    out[june + timedelta(days=(0 - june.weekday()) % 7 + 7)] = "King's Birthday"
    christmas = _next_weekday(date(year, 12, 25))
    out[christmas] = 'Christmas Day'
    boxing = _next_weekday(christmas + timedelta(days=1))
    out[boxing] = 'Boxing Day'
    out.update({d: n for d, n in EXTRA_CLOSURES.items() if d.year == year})
    return out


def holiday_name(d):
    return holidays(d.year).get(d)


def is_trading_day(d):
    return d.weekday() < 5 and d not in holidays(d.year)


def previous_trading_day(d):
    d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def next_trading_day(d):
    d += timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def latest_settlement_date(now):
    """
    The latest trading day whose settlement prices are out at `now` (an aware
    datetime, or a naive one taken as Sydney time).
    """
    now = now.astimezone(SYDNEY) if now.tzinfo else now.replace(tzinfo=SYDNEY)
    d = now.date()
    if not is_trading_day(d) or now.time() < SETTLEMENT_TIME:
        d = previous_trading_day(d)
    return d


def settlement_date_for_page(page_date, status, now):
    """
    The date a scrape taken at `now` is saved under, given the date and market
    status the page shows. The page's Settle column always holds the latest
    published settlement, so this is latest_settlement_date(now), after checking
    the page agrees with it:
      - the page date must fall between that day and the next trading day (the
        page moves to the new date at midnight, before the new day settles);
      - the page must not call a day this calendar treats as trading a holiday.
    Raises ValueError when they disagree (a calendar gap or a page change), so the
    update fails loudly instead of saving under a wrong date.
    """
    settled = latest_settlement_date(now)
    if not (settled <= page_date <= next_trading_day(settled)):
        raise ValueError(f'page date {page_date} does not follow the latest settlement '
                         f'day {settled} (now {now:%Y-%m-%d %H:%M %Z})')
    if 'holiday' in (status or '').lower() and is_trading_day(page_date):
        raise ValueError(f'page says "{status}" on {page_date}, which this calendar '
                         f'treats as a trading day: add it to asx_calendar.EXTRA_CLOSURES')
    return settled


def now_sydney():
    return datetime.now(SYDNEY)

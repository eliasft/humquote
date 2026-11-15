#!/usr/bin/env python
# coding: utf-8

"""
ASX Futures Data Updater
========================
Reads https://www.asxenergy.com.au/futures/au_electricity and saves every base-load
contract with a settlement price in all four states (NSW, VIC, QLD, SA): quarters
from the Base Load tables, CY and FY strips from the Base Strip tables. They go to
data/asx_futures.csv (see futures_store.py).

Which date the prices are saved under
  The page's Settle column always shows the latest published settlement, but the
  page's own date is simply today: before about 4:20 pm Sydney time it shows the
  previous trading day's settlement under today's date. So the date comes from the
  clock and the ASX 24 calendar (asx_calendar.settlement_date_for_page): the latest
  trading day whose settlement is out. A run at any time of day, or late at night
  after a GitHub delay, saves under the right date, and never on a weekend or
  holiday.

Guards
  - Stale prices: if the scraped prices equal the last saved trading day's, the
    day's settlement isn't out yet (or the page is stuck): nothing is saved.
  - A run that saves a date again changes it only where prices differ, so a later
    run corrects an early one and an unchanged rerun leaves the file alone.
  - The run fails (exit 1, so GitHub emails) when the page can't be fetched or
    read, when the page's date disagrees with the calendar, or when no new prices
    have been saved for more than one trading day.

Backfill from a saved copy of the page (it shows the settlement of the latest
trading day before it was saved):
    python update_db.py --html saved_page.html --date 2026-11-13
"""

import argparse
import sys
from datetime import datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup

import asx_calendar as cal
import futures_store as store

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')  # the log uses ✓/⚠ (Windows consoles default to cp1252)


# ── Configuration ──────────────────────────────────────────────────────────────

ASX_URL = 'https://www.asxenergy.com.au/futures/au_electricity'

# H = Base Strip product (CY and FY rows); suffix = state code
BASE_STRIP_CODES = {'HN': 'NSW', 'HV': 'VIC', 'HQ': 'QLD', 'HS': 'SA'}
# B = Base Load quarterly product; suffix = state code
BASE_QUARTER_CODES = {'BN': 'NSW', 'BV': 'VIC', 'BQ': 'QLD', 'BS': 'SA'}

REQUEST_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    )
}


class UpdateError(Exception):
    """A failure the workflow should report (exit 1)."""


# ── Scraping ───────────────────────────────────────────────────────────────────

def fetch_page(url: str = ASX_URL) -> BeautifulSoup:
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        raise UpdateError(f'HTTP error: {e}')
    return BeautifulSoup(response.content, 'html.parser')


def parse_market_banner(soup: BeautifulSoup) -> tuple:
    """
    (page date, market status) from the #refresh-container-market_date widget,
    whose <pre> reads like "\\xa0Sun 15 Nov 2026\\n\\xa0Weekend\\n". Raises
    UpdateError when it is missing or unreadable (the page has changed).
    """
    container = soup.find(id='refresh-container-market_date')
    pre = container.find('pre') if container else None
    if not pre:
        raise UpdateError('market date widget not found: the page layout may have changed')
    lines = [ln.replace('\xa0', ' ').strip() for ln in pre.get_text().split('\n')]
    lines = [ln for ln in lines if ln]
    try:
        page_date = datetime.strptime(lines[0], '%a %d %b %Y').date()
    except (IndexError, ValueError):
        raise UpdateError(f'could not read the market date from {lines!r}')
    return page_date, (lines[1] if len(lines) > 1 else '')


def settlement_date(soup: BeautifulSoup, now: datetime) -> tuple:
    """(date the page's prices belong to, page date, status); see asx_calendar."""
    page_date, status = parse_market_banner(soup)
    try:
        return cal.settlement_date_for_page(page_date, status, now), page_date, status
    except ValueError as e:
        raise UpdateError(str(e))


def extract_settles(soup: BeautifulSoup, data_code: str) -> dict:
    """
    {period label: settle price} for every row of the table that belongs to the
    contract-btn with this data-code. Rows without a settle price are left out.
    Table columns: Period | Bid | Ask | Last | +/- | Vol | Settle (index 6).
    """
    settles = {}
    btn = soup.find('button', class_='contract-btn', attrs={'data-code': data_code})
    outer = btn.find_parent(
        'div',
        class_=lambda c: c and 'shadow-md' in (c if isinstance(c, str) else ' '.join(c))
    ) if btn else None
    container = outer.find('div', class_='data-table-container') if outer else None
    tbody = container.find('tbody') if container else None
    if not tbody:
        print(f"  ✗ No table found for data-code='{data_code}'")
        return settles

    for row in tbody.find_all('tr'):
        cells = row.find_all('td')
        if len(cells) < 7:
            continue
        label = cells[0].get_text(strip=True)
        try:
            settles[label] = round(float(cells[6].get_text(strip=True)), 2)
        except ValueError:
            continue
    return settles


def contract_name(label: str) -> Optional[str]:
    """The page's period label as a contract name: Q426 → 'Q4 2026', CY27 → 'CY2027', FY28 → 'FY2028'."""
    try:
        if label.startswith('Q') and len(label) == 4:
            return f'Q{int(label[1])} {2000 + int(label[2:])}'
        if label[:2] in ('CY', 'FY') and len(label) == 4:
            return f'{label[:2]}{2000 + int(label[2:])}'
    except ValueError:
        pass
    return None


def parse_page(soup: BeautifulSoup, quote_date) -> list:
    """
    Rows for futures_store (quote date, contract, start, months, NSW, VIC, QLD, SA):
    every contract with a settle price in all four states. Raises UpdateError when
    there are no FY strips (the page has changed).
    """
    by_contract: dict = {}
    for codes in (BASE_QUARTER_CODES, BASE_STRIP_CODES):
        for code, state in codes.items():
            for label, price in extract_settles(soup, code).items():
                name = contract_name(label)
                if name and store.contract_period(name):
                    by_contract.setdefault(name, {})[state] = price

    rows = []
    for name, prices in by_contract.items():
        missing = [s for s in store.STATES if s not in prices]
        if missing:
            print(f"  ⚠  {name} missing {missing}: skipped")
            continue
        rows.append((quote_date.isoformat(), name, *store.contract_period(name), *(prices[s] for s in store.STATES)))
    if not any(r[1].startswith('FY') for r in rows):
        raise UpdateError('no FY strips with prices for all four states: the page layout may have changed')
    for r in sorted(rows, key=lambda r: (r[2], -r[3])):
        print(f"  ✓ {r[1]:8} " + '  '.join(f'{s} {p:7.2f}' for s, p in zip(store.STATES, r[4:])))
    return rows


# ── Saving ─────────────────────────────────────────────────────────────────────

def save_scrape(rows: list, quote_date, path: str = store.PATH) -> dict:
    """
    Merges a scrape into the history unless its prices are a stale copy of the
    previous saved date's. Returns what happened:
    {'stale': bool, 'previous': date or None, 'inserted': n, 'corrected': [...]}.
    """
    history = store.load(path)
    previous, prev_prices = store.last_date_before(history, quote_date.isoformat())
    if store.is_stale(rows, prev_prices):
        return {'stale': True, 'previous': previous, 'inserted': 0, 'corrected': []}
    merged, inserted, corrected = store.merge(history, rows)
    if inserted or corrected:
        store.save(merged, path)
    return {'stale': False, 'previous': previous, 'inserted': inserted, 'corrected': corrected}


def latest_saved_date(path: str = store.PATH) -> Optional[str]:
    rows = store.load(path)
    return rows[-1][0] if rows else None


# ── Entry point ────────────────────────────────────────────────────────────────

def run(args) -> None:
    if args.html:
        if not args.date:
            raise UpdateError('--html needs --date: the settlement day the saved page shows')
        quote_date = datetime.strptime(args.date, '%Y-%m-%d').date()
        if not cal.is_trading_day(quote_date):
            raise UpdateError(f'{quote_date} is not an ASX 24 trading day')
        with open(args.html, encoding='utf-8') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')
    else:
        print(f"📡 Fetching: {ASX_URL}")
        soup = fetch_page()
        now = cal.now_sydney()
        quote_date, page_date, status = settlement_date(soup, now)
        print(f"  Sydney time : {now:%a %d %b %Y %H:%M %Z}")
        print(f"  Page shows  : {page_date:%a %d %b %Y} ({status or 'no status'})")
    print(f"✓ Prices are the settlement of {quote_date:%a %d %b %Y}\n")

    rows = parse_page(soup, quote_date)
    result = save_scrape(rows, quote_date, args.data)
    if result['stale']:
        print(f"\n⏸  Prices are identical to {result['previous']}'s: the settlement for {quote_date} "
              f"isn't out yet. Nothing saved; a later run will pick it up.")
    else:
        for key, old, new in result['corrected']:
            print(f"  ↻ {key[0]} {key[1]}: {old} → {new}")
        unchanged = len(rows) - result['inserted'] - len(result['corrected'])
        print(f"\n✓ {args.data}: {result['inserted']} inserted, {len(result['corrected'])} corrected, "
              f"{unchanged} unchanged")

    # Alarm: fail when the newest saved prices are more than one trading day behind
    # (the page has stopped updating, or something above keeps skipping).
    latest = latest_saved_date(args.data)
    if not args.html and (latest is None or latest < cal.previous_trading_day(quote_date).isoformat()):
        raise UpdateError(f'no prices saved since {latest}; expected {quote_date}')


def main():
    parser = argparse.ArgumentParser(description='Save the latest ASX base-load futures settlements.')
    parser.add_argument('--html', help='parse a saved copy of the page instead of fetching it')
    parser.add_argument('--date', help='with --html: the settlement day the page shows (YYYY-MM-DD)')
    parser.add_argument('--data', default=store.PATH, help=f'the history file (default {store.PATH})')
    args = parser.parse_args()

    print("🚀 ASX Futures Data Update")
    print("=" * 50)
    try:
        run(args)
    except UpdateError as e:
        print(f"\n✗ Update failed: {e}")
        print("=" * 50)
        sys.exit(1)
    print("\n✅ Done")
    print("=" * 50)


if __name__ == "__main__":
    main()

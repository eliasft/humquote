#!/usr/bin/env python
# coding: utf-8

"""
ASX Futures Data Updater — Refactored for new ASX Energy site structure
=======================================================================
Targets : https://www.asxenergy.com.au/futures/au_electricity
Extracts: FY (Financial Year) Base Strip settle prices for NSW, VIC, QLD, SA
          into futures_data, plus every quoted base contract (quarters, CY and
          FY strips) into futures_strips

Changes from previous version:
  - New URL: /futures/au_electricity (homepage no longer carries price table)
  - Date parsed from #refresh-container-market_date <pre> widget
  - Tables located via contract-btn[data-code] attribute (HN/HV/HQ/HS)
  - FY rows identified by "FY" prefix in period label (e.g. FY27, FY28, FY29)
  - Three FY data points per state (vs two CY), matching original data volume
  - Weekend guard: exits cleanly if market date falls on Saturday or Sunday
  - futures_strips: quarterly (Q4 26), calendar-year (CY27) and financial-year
    (FY28) base contracts, so a quote can price any 12-month supply period

Backfill from a saved copy of the page (a weekend snapshot shows the previous
trading day's settlements):
    python update_db.py --html saved_page.html --date 2026-11-13
"""

import argparse
import requests
from bs4 import BeautifulSoup
import pandas as pd
from datetime import datetime, date
import sqlite3
import os
import warnings
from typing import Optional

warnings.simplefilter(action='ignore', category=FutureWarning)


# ── Configuration ──────────────────────────────────────────────────────────────

CSV_FILE_PATH = '_old/historical-futures-data.csv'
DB_FILE_PATH  = 'futures_prices.db'
TABLE_NAME    = 'futures_data'
STRIPS_TABLE  = 'futures_strips'
ASX_URL       = 'https://www.asxenergy.com.au/futures/au_electricity'

# H = Base Strip product; suffix = state code
BASE_STRIP_CODES = {
    'HN': 'NSW',
    'HV': 'VIC',
    'HQ': 'QLD',
    'HS': 'SA',
}

# B = Base Load quarterly product; suffix = state code
BASE_QUARTER_CODES = {
    'BN': 'NSW',
    'BV': 'VIC',
    'BQ': 'QLD',
    'BS': 'SA',
}

REQUEST_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    )
}


# ── Database helpers ───────────────────────────────────────────────────────────

def create_db_connection(db_file: str):
    try:
        conn = sqlite3.connect(db_file)
        print(f"✓ Connected: {db_file}")
        return conn
    except sqlite3.Error as e:
        print(f"✗ DB connection error: {e}")
        return None


def setup_database_schema(db_file: str, table_name: str):
    conn = create_db_connection(db_file)
    if conn is None:
        return
    cursor = conn.cursor()
    cursor.execute(f'''
        CREATE TABLE IF NOT EXISTS {table_name} (
            "Quote Date" TEXT,
            "Year"       INTEGER,
            "NSW"        REAL,
            "QLD"        REAL,
            "SA"         REAL,
            "VIC"        REAL,
            PRIMARY KEY ("Quote Date", "Year")
        )
    ''')
    cursor.execute(f'''
        CREATE TABLE IF NOT EXISTS {STRIPS_TABLE} (
            "Quote Date" TEXT,
            "Contract"   TEXT,
            "Start"      TEXT,
            "Months"     INTEGER,
            "NSW"        REAL,
            "VIC"        REAL,
            "QLD"        REAL,
            "SA"         REAL,
            PRIMARY KEY ("Quote Date", "Contract")
        )
    ''')
    conn.commit()
    conn.close()
    print(f"✓ Schema verified: {table_name}, {STRIPS_TABLE}")


# ── Scraping ───────────────────────────────────────────────────────────────────

def parse_quote_date(soup: BeautifulSoup) -> Optional[date]:
    """
    Extracts the market date from the #refresh-container-market_date widget.

    The <pre> tag contains text like: "\\xa0Sat 20 Jun 2026\\n\\xa0Weekend\\n"

    Returns None in two cases:
      - The date element cannot be found / parsed
      - The parsed date falls on a weekend (ASX does not trade Sat/Sun)
    """
    container = soup.find(id='refresh-container-market_date')
    if not container:
        print("✗ Could not find market date container")
        return None

    pre = container.find('pre')
    if not pre:
        print("✗ Could not find date <pre> tag")
        return None

    # Strip non-breaking spaces and grab the first line only
    raw        = pre.get_text()
    first_line = raw.split('\n')[0].replace('\xa0', '').replace('\u00a0', '').strip()

    try:
        parsed = datetime.strptime(first_line, '%a %d %b %Y').date()
    except ValueError as e:
        print(f"✗ Date parse failed for '{first_line}': {e}")
        return None

    # Weekend guard — return None so the caller exits without touching the DB
    if parsed.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        print(f"⏸  ASX closed on {parsed.strftime('%A %d %b %Y')} — nothing to save.")
        return None

    print(f"✓ Quote date: {parsed}")
    return parsed


def extract_fy_prices_for_state(soup: BeautifulSoup, data_code: str, state: str) -> dict:
    """
    Locates the Base Strip table for a given data-code and returns
    Financial Year (FY) settle prices keyed by integer year.

    In the HTML, FY rows have labels like "FY27", "FY28", "FY29" and title
    attributes like "HNM2027" (M = July = FY start month). Three FY rows are
    consistently available for all four states, giving 3 data points per scrape.

    Strategy:
      1. Find the unique contract-btn button with the matching data-code.
      2. Walk up to the outer shadow-md card wrapper div.
      3. Find the sibling data-table-container → table.
      4. Iterate tbody rows, skip any that do not start with "FY".
      5. Parse year from label (FY27 → 2027) and settle from column index 6.

    Returns: {2027: 83.24, 2028: 84.73, 2029: 92.91, ...}
    """
    prices = {}

    btn = soup.find('button', class_='contract-btn', attrs={'data-code': data_code})
    if not btn:
        print(f"  ✗ No contract-btn found for data-code='{data_code}' ({state})")
        return prices

    outer = btn.find_parent(
        'div',
        class_=lambda c: c and 'shadow-md' in (c if isinstance(c, str) else ' '.join(c))
    )
    if not outer:
        print(f"  ✗ Could not find outer wrapper for {data_code} ({state})")
        return prices

    container = outer.find('div', class_='data-table-container')
    if not container:
        print(f"  ✗ No data-table-container for {data_code} ({state})")
        return prices

    table = container.find('table')
    tbody = table.find('tbody') if table else None
    if not tbody:
        print(f"  ✗ No table/tbody for {data_code} ({state})")
        return prices

    # Table columns: Period | Bid | Ask | Last | +/- | Vol | Settle (index 6)
    for row in tbody.find_all('tr'):
        cells = row.find_all('td')
        if len(cells) < 7:
            continue

        label = cells[0].get_text(strip=True)   # e.g. "CY27", "FY27", "FY29"

        # Only Financial Year strips — skip CY and any other contract types
        if not label.startswith('FY'):
            continue

        try:
            year = int('20' + label[2:])         # FY27 → 2027, FY28 → 2028, FY29 → 2029
        except (ValueError, IndexError):
            print(f"  ⚠  Could not parse year from label '{label}'")
            continue

        settle_text = cells[6].get_text(strip=True)
        if settle_text == '-' or not settle_text:
            print(f"  ⚠  No settle price for {state} {label} — skipping")
            continue

        try:
            prices[year] = round(float(settle_text), 2)
            print(f"  ✓ {state} {label} ({year}): {prices[year]}")
        except ValueError:
            print(f"  ⚠  Could not parse price '{settle_text}' for {state} {label}")

    return prices


def extract_settles(soup: BeautifulSoup, data_code: str) -> dict:
    """
    Returns {period label: settle price} for every row of the table belonging to
    the contract-btn with this data-code (same page structure as
    extract_fy_prices_for_state). Rows without a settle price are left out.
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


def parse_period(label: str) -> Optional[tuple]:
    """
    Maps a period label to (contract name, start month, months):
      Q426 → ('Q4 2026', '2026-10', 3)   quarters are calendar quarters
      CY27 → ('CY2027',  '2027-01', 12)
      FY28 → ('FY2028',  '2027-07', 12)  FY28 runs Jul 2027 – Jun 2028
    """
    try:
        if label.startswith('Q') and len(label) == 4:
            q, year = int(label[1]), 2000 + int(label[2:])
            return f'Q{q} {year}', f'{year}-{(q - 1) * 3 + 1:02d}', 3
        if label.startswith('CY'):
            year = 2000 + int(label[2:])
            return f'CY{year}', f'{year}-01', 12
        if label.startswith('FY'):
            year = 2000 + int(label[2:])
            return f'FY{year}', f'{year - 1}-07', 12
    except ValueError:
        pass
    return None


def scrape_strips(soup: BeautifulSoup, quote_date: date) -> pd.DataFrame:
    """
    Every base contract with a settle price for all four states: quarters from
    the Base Load tables (BN/BV/BQ/BS), CY and FY strips from the Base Strip
    tables (HN/HV/HQ/HS).
    """
    by_contract: dict = {}
    for codes in (BASE_QUARTER_CODES, BASE_STRIP_CODES):
        for code, state in codes.items():
            for label, price in extract_settles(soup, code).items():
                period = parse_period(label)
                if period:
                    by_contract.setdefault(period, {})[state] = price

    rows = []
    for (contract, start, months), prices in sorted(by_contract.items(), key=lambda kv: (kv[0][1], kv[0][2])):
        missing = [s for s in ('NSW', 'VIC', 'QLD', 'SA') if s not in prices]
        if missing:
            print(f"  ⚠  {contract} missing {missing} — row skipped")
            continue
        rows.append({'Quote Date': quote_date, 'Contract': contract, 'Start': start, 'Months': months, **prices})
    print(f"✓ Scraped {len(rows)} contracts (quarters and strips) for {quote_date}")
    return pd.DataFrame(rows)


def scrape_asx_futures_data(url: str):
    """
    Fetches the AU Electricity futures page and returns (fy_df, strips_df):
    fy_df matches the existing DB schema (Quote Date | Year | NSW | QLD | SA | VIC);
    strips_df holds every quoted base contract for futures_strips.

    Returns None on any failure or when the market is closed (weekend).
    Only rows where all four states carry a settle price are included.
    """
    try:
        print(f"📡 Fetching: {url}")
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"✗ HTTP error: {e}")
        return None
    return parse_page(BeautifulSoup(response.content, 'html.parser'))


def parse_page(soup: BeautifulSoup, quote_date: Optional[date] = None):
    """
    Parses the page into (fy_df, strips_df); see scrape_asx_futures_data.
    quote_date overrides the page's own date (when backfilling from a saved page).
    """
    try:
        # Date — also enforces the weekend guard
        if quote_date is None:
            quote_date = parse_quote_date(soup)
        if quote_date is None:
            return None

        # Collect prices per year across all four states
        prices_by_year: dict = {}
        for code, state in BASE_STRIP_CODES.items():
            print(f"\n  [{state}] Base Strip FY rows (data-code='{code}')")
            for year, price in extract_fy_prices_for_state(soup, code, state).items():
                prices_by_year.setdefault(year, {})[state] = price

        if not prices_by_year:
            print("✗ No price data extracted")
            return None

        # Build rows, dropping any year that is missing one or more states
        rows = []
        for year in sorted(prices_by_year):
            sd      = prices_by_year[year]
            missing = [s for s in ('NSW', 'VIC', 'QLD', 'SA') if s not in sd]
            if missing:
                print(f"\n  ⚠  Year {year} missing {missing} — row skipped")
                continue
            rows.append({
                'Quote Date': quote_date,
                'Year': year,
                'NSW':  sd['NSW'],
                'QLD':  sd['QLD'],
                'SA':   sd['SA'],
                'VIC':  sd['VIC'],
            })

        if not rows:
            print("✗ No complete year/state rows to save")
            return None

        df = pd.DataFrame(rows)
        print(f"\n✓ Scraped {len(df)} records for {quote_date}")
        return df, scrape_strips(soup, quote_date)

    except Exception as e:
        print(f"✗ Unexpected error during scrape: {e}")
        import traceback
        traceback.print_exc()
        return None


# ── Persistence ────────────────────────────────────────────────────────────────

def update_csv_file(new_data: pd.DataFrame, csv_file: str):
    """Append new records to the CSV file, deduplicating on Quote Date + Year."""
    try:
        if os.path.dirname(csv_file):
            os.makedirs(os.path.dirname(csv_file), exist_ok=True)

        if os.path.exists(csv_file):
            existing = pd.read_csv(csv_file)
            existing['Quote Date'] = pd.to_datetime(existing['Quote Date']).dt.date
            combined = pd.concat([existing, new_data], ignore_index=True)
            combined = combined.drop_duplicates(subset=['Quote Date', 'Year'], keep='last')
        else:
            combined = new_data.copy()

        combined = combined.sort_values('Quote Date', ascending=False)
        combined['Quote Date'] = pd.to_datetime(combined['Quote Date']).dt.strftime('%Y-%m-%d')
        combined.to_csv(csv_file, index=False)
        print(f"✓ CSV updated: {csv_file}")

    except Exception as e:
        print(f"✗ CSV update error: {e}")


def update_database(new_data: pd.DataFrame, db_file: str, table_name: str):
    """Insert new rows into the database, skipping any that already exist."""
    conn = create_db_connection(db_file)
    if conn is None:
        return
    try:
        cursor   = conn.cursor()
        inserted = 0
        skipped  = 0

        for _, row in new_data.iterrows():
            qd   = row['Quote Date']
            qd_s = qd.strftime('%Y-%m-%d') if hasattr(qd, 'strftime') else str(qd)
            yr   = int(row['Year'])

            cursor.execute(
                f'SELECT COUNT(*) FROM {table_name} WHERE "Quote Date"=? AND "Year"=?',
                (qd_s, yr)
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    f'INSERT INTO {table_name} ("Quote Date","Year","NSW","QLD","SA","VIC") '
                    f'VALUES (?,?,?,?,?,?)',
                    (qd_s, yr,
                     float(row['NSW']), float(row['QLD']),
                     float(row['SA']),  float(row['VIC']))
                )
                print(f"  ✓ Inserted: {qd_s}, Year {yr}")
                inserted += 1
            else:
                print(f"  ⏭  Skipped: {qd_s}, Year {yr} (already exists)")
                skipped += 1

        conn.commit()
        print(f"✓ DB: {inserted} inserted, {skipped} skipped")

    except Exception as e:
        print(f"✗ DB update error: {e}")
        conn.rollback()
    finally:
        conn.close()


def update_strips(strips: pd.DataFrame, db_file: str):
    """Insert quarterly, CY and FY contract rows, skipping any that already exist."""
    if strips is None or strips.empty:
        return
    conn = create_db_connection(db_file)
    if conn is None:
        return
    try:
        before = conn.total_changes
        for _, row in strips.iterrows():
            qd = row['Quote Date']
            conn.execute(
                f'INSERT OR IGNORE INTO {STRIPS_TABLE} '
                f'("Quote Date","Contract","Start","Months","NSW","VIC","QLD","SA") VALUES (?,?,?,?,?,?,?,?)',
                (qd.strftime('%Y-%m-%d') if hasattr(qd, 'strftime') else str(qd),
                 row['Contract'], row['Start'], int(row['Months']),
                 float(row['NSW']), float(row['VIC']), float(row['QLD']), float(row['SA']))
            )
        conn.commit()
        inserted = conn.total_changes - before
        print(f"✓ Strips: {inserted} inserted, {len(strips) - inserted} skipped")
    except Exception as e:
        print(f"✗ Strips update error: {e}")
        conn.rollback()
    finally:
        conn.close()


def verify_record_count(db_file: str, table_name: str):
    conn = create_db_connection(db_file)
    if conn is None:
        return
    try:
        df = pd.read_sql_query(f'SELECT COUNT(*) as n FROM {table_name}', conn)
        print(f"✓ DB total records: {df['n'].iloc[0]}")
    except Exception as e:
        print(f"✗ Verification error: {e}")
    finally:
        conn.close()


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Update futures_prices.db from ASX Energy.')
    parser.add_argument('--html', help='parse a saved copy of the page instead of fetching it')
    parser.add_argument('--date', help='quote date for --html (YYYY-MM-DD); defaults to the page date')
    args = parser.parse_args()

    print("🚀 ASX Futures Data Update")
    print("=" * 50)
    print(f"  URL : {ASX_URL}")
    print(f"  DB  : {DB_FILE_PATH}")
    print(f"  CSV : {CSV_FILE_PATH}\n")

    setup_database_schema(DB_FILE_PATH, TABLE_NAME)

    if args.html:
        with open(args.html, encoding='utf-8') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')
        override = datetime.strptime(args.date, '%Y-%m-%d').date() if args.date else None
        scraped = parse_page(soup, override)
    else:
        scraped = scrape_asx_futures_data(ASX_URL)
    new_data, strips = scraped if scraped else (None, None)

    if new_data is not None and not new_data.empty:
        print(f"\n📊 Processing {len(new_data)} records...")
        update_csv_file(new_data, CSV_FILE_PATH)
        update_database(new_data, DB_FILE_PATH, TABLE_NAME)
        update_strips(strips, DB_FILE_PATH)
        verify_record_count(DB_FILE_PATH, TABLE_NAME)
        print("\n✅ Update complete!")
    else:
        print("\n⏹  Nothing to update.")

    print("=" * 50)


if __name__ == "__main__":
    main()
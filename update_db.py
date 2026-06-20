#!/usr/bin/env python
# coding: utf-8

"""
ASX Futures Data Updater — Refactored for new ASX Energy site structure
=======================================================================
Targets : https://www.asxenergy.com.au/futures/au_electricity
Extracts: CY (Calendar Year) Base Strip settle prices for NSW, VIC, QLD, SA

Changes from previous version:
  - New URL: /futures/au_electricity (homepage no longer carries price table)
  - Date parsed from #refresh-container-market_date <pre> widget
  - Tables located via contract-btn[data-code] attribute (HN/HV/HQ/HS)
  - CY rows identified by "CY" prefix in period label (e.g. CY27, CY28)
  - Weekend guard: exits cleanly if market date falls on Saturday or Sunday
"""

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
ASX_URL       = 'https://www.asxenergy.com.au/futures/au_electricity'

# H = Base Strip product; suffix = state code
BASE_STRIP_CODES = {
    'HN': 'NSW',
    'HV': 'VIC',
    'HQ': 'QLD',
    'HS': 'SA',
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
    conn.commit()
    conn.close()
    print(f"✓ Schema verified: {table_name}")


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


def extract_cy_prices_for_state(soup: BeautifulSoup, data_code: str, state: str) -> dict:
    """
    Locates the Base Strip table for a given data-code and returns
    Calendar Year (CY) settle prices keyed by integer year.

    Strategy:
      1. Find the unique contract-btn button with the matching data-code.
      2. Walk up to the outer shadow-md card wrapper div.
      3. Find the sibling data-table-container → table.
      4. Iterate tbody rows, skip any that do not start with "CY".
      5. Parse year from label (CY27 → 2027) and settle from column index 6.

    Returns: {2027: 84.60, 2028: 87.65, ...}
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

        # Only Calendar Year strips — skip FY and any other contract types
        if not label.startswith('CY'):
            continue

        try:
            year = int('20' + label[2:])         # CY27 → 2027, CY28 → 2028
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


def scrape_asx_futures_data(url: str) -> Optional[pd.DataFrame]:
    """
    Fetches the AU Electricity futures page and returns a DataFrame that
    matches the existing DB schema:

        Quote Date | Year | NSW | QLD | SA | VIC

    Returns None on any failure or when the market is closed (weekend).
    Only rows where all four states carry a settle price are included.
    """
    try:
        print(f"📡 Fetching: {url}")
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')

        # Date — also enforces the weekend guard
        quote_date = parse_quote_date(soup)
        if quote_date is None:
            return None

        # Collect prices per year across all four states
        prices_by_year: dict = {}
        for code, state in BASE_STRIP_CODES.items():
            print(f"\n  [{state}] Base Strip (data-code='{code}')")
            for year, price in extract_cy_prices_for_state(soup, code, state).items():
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
        return df

    except requests.RequestException as e:
        print(f"✗ HTTP error: {e}")
        return None
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
    print("🚀 ASX Futures Data Update")
    print("=" * 50)
    print(f"  URL : {ASX_URL}")
    print(f"  DB  : {DB_FILE_PATH}")
    print(f"  CSV : {CSV_FILE_PATH}\n")

    setup_database_schema(DB_FILE_PATH, TABLE_NAME)

    new_data = scrape_asx_futures_data(ASX_URL)

    if new_data is not None and not new_data.empty:
        print(f"\n📊 Processing {len(new_data)} records...")
        update_csv_file(new_data, CSV_FILE_PATH)
        update_database(new_data, DB_FILE_PATH, TABLE_NAME)
        verify_record_count(DB_FILE_PATH, TABLE_NAME)
        print("\n✅ Update complete!")
    else:
        print("\n⏹  Nothing to update.")

    print("=" * 50)


if __name__ == "__main__":
    main()
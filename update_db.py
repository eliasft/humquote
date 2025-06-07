#!/usr/bin/env python
# coding: utf-8

"""
Consolidated ASX Futures Data Updater
=====================================
This script scrapes daily ASX energy futures data and updates both a CSV file 
and SQLite database with the latest pricing information.

Author: Generated for energy market data management
Purpose: Automated daily data collection for Streamlit app
"""

import requests
from bs4 import BeautifulSoup
import pandas as pd
from datetime import datetime
import sqlite3
import os
from typing import Optional
import warnings

warnings.simplefilter(action='ignore', category=FutureWarning)

# Configuration
CSV_FILE_PATH = '_old/historical-futures-data.csv'
DB_FILE_PATH = 'futures_prices.db'  # Now relative to repository root
TABLE_NAME = 'futures_data'
ASX_URL = 'https://www.asxenergy.com.au'

def create_database_connection(db_file: str):
    """Create and return a connection to the SQLite database."""
    try:
        conn = sqlite3.connect(db_file)
        print(f"✓ Database connection established: {db_file}")
        return conn
    except sqlite3.Error as e:
        print(f"✗ Error connecting to database: {e}")
        return None

def setup_database_schema(db_file: str, table_name: str):
    """Create the database table if it doesn't exist."""
    conn = create_database_connection(db_file)
    if conn is not None:
        cursor = conn.cursor()
        
        # Create table with wide format schema
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS {table_name} (
                "Quote Date" TEXT,
                "Year" INTEGER,
                "NSW" REAL,
                "QLD" REAL,
                "SA" REAL,
                "VIC" REAL,
                PRIMARY KEY ("Quote Date", "Year")
            )
        ''')
        
        conn.commit()
        conn.close()
        print(f"✓ Database schema verified for table: {table_name}")
    else:
        print("✗ Failed to setup database schema")

def scrape_asx_futures_data(url: str) -> Optional[pd.DataFrame]:
    """
    Scrape futures data from ASX Energy website and return in wide format.
    
    Args:
        url: The ASX Energy website URL
        
    Returns:
        DataFrame with columns: Quote Date, Year, NSW, QLD, SA, VIC
    """
    try:
        print("📡 Scraping ASX futures data...")
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the prices div
        prices_div = soup.find('div', id='home-prices')
        if not prices_div:
            raise ValueError("Could not find prices div in the page")
            
        # Extract date
        date_cell = prices_div.find('td', style="color: #6c6c6c; font-size: 8pt; text-align: center;")
        if not date_cell:
            raise ValueError("Could not find date cell in the page")
            
        date_str = date_cell.get_text().strip()
        quote_date = datetime.strptime(date_str, '%a %d %b %Y').date()
        
        # Extract prices table
        prices_table = prices_div.find('table')
        if not prices_table:
            raise ValueError("Could not find prices table in the page")
        
        # Parse table rows
        rows = prices_table.find_all('tr')[1:]  # Skip header
        data = []
        
        for row in rows:
            cells = row.find_all('td')
            if not cells or len(cells) < 5:
                continue
                
            try:
                year = int(cells[0].get_text().strip())
                nsw_price = float(cells[1].get_text().strip())
                vic_price = float(cells[2].get_text().strip())
                qld_price = float(cells[3].get_text().strip())
                sa_price = float(cells[4].get_text().strip())
                
                row_data = {
                    'Quote Date': quote_date,
                    'Year': year,
                    'NSW': round(nsw_price, 2),
                    'QLD': round(qld_price, 2),
                    'SA': round(sa_price, 2),
                    'VIC': round(vic_price, 2)
                }
                data.append(row_data)
                
            except (ValueError, IndexError) as e:
                print(f"⚠️  Warning: Skipping row due to parsing error: {e}")
                continue
        
        if not data:
            raise ValueError("No valid data rows found")
            
        df = pd.DataFrame(data)
        df['Quote Date'] = pd.to_datetime(df['Quote Date']).dt.date
        
        print(f"✓ Successfully scraped {len(df)} records for {quote_date}")
        return df
        
    except requests.RequestException as e:
        print(f"✗ Error fetching data from website: {e}")
        return None
    except ValueError as e:
        print(f"✗ Error processing scraped data: {e}")
        return None
    except Exception as e:
        print(f"✗ Unexpected error during scraping: {e}")
        return None

def load_existing_csv(csv_file: str) -> pd.DataFrame:
    """Load existing CSV data or create empty DataFrame with correct schema."""
    if os.path.exists(csv_file):
        try:
            df = pd.read_csv(csv_file)
            df['Quote Date'] = pd.to_datetime(df['Quote Date']).dt.date
            print(f"✓ Loaded existing CSV: {len(df)} records")
            return df
        except Exception as e:
            print(f"⚠️  Error loading CSV, creating new one: {e}")
    
    # Create empty DataFrame with correct schema
    print("📄 Creating new CSV file")
    return pd.DataFrame(columns=['Quote Date', 'Year', 'NSW', 'QLD', 'SA', 'VIC'])

def update_csv_file(new_data: pd.DataFrame, csv_file: str):
    """Update CSV file with new data, avoiding duplicates."""
    try:
        # Load existing data
        existing_df = load_existing_csv(csv_file)
        
        # Combine and remove duplicates
        if not existing_df.empty:
            combined_df = pd.concat([existing_df, new_data], ignore_index=True)
            # Remove duplicates based on Quote Date and Year
            combined_df = combined_df.drop_duplicates(subset=['Quote Date', 'Year'], keep='last')
        else:
            combined_df = new_data.copy()
        
        # Sort by Quote Date descending
        combined_df = combined_df.sort_values('Quote Date', ascending=False)
        
        # Convert Quote Date to string for CSV output
        combined_df['Quote Date'] = pd.to_datetime(combined_df['Quote Date']).dt.strftime('%Y-%m-%d')
        
        # Save to CSV
        combined_df.to_csv(csv_file, index=False)
        
        new_records = len(new_data)
        total_records = len(combined_df)
        print(f"✓ CSV updated: {new_records} new records, {total_records} total records")
        
    except Exception as e:
        print(f"✗ Error updating CSV file: {e}")

def update_database(new_data: pd.DataFrame, db_file: str, table_name: str):
    """Update database with new data, avoiding duplicates."""
    conn = create_database_connection(db_file)
    if conn is None:
        return
    
    try:
        cursor = conn.cursor()
        new_records_count = 0
        skipped_records_count = 0
        
        for _, row in new_data.iterrows():
            quote_date_str = row['Quote Date'].strftime('%Y-%m-%d')
            year = int(row['Year'])
            
            # Check if record already exists
            cursor.execute(
                f'SELECT COUNT(*) FROM {table_name} WHERE "Quote Date" = ? AND "Year" = ?',
                (quote_date_str, year)
            )
            exists = cursor.fetchone()[0]
            
            if exists == 0:
                # Insert new record
                cursor.execute(f'''
                    INSERT INTO {table_name} 
                    ("Quote Date", "Year", "NSW", "QLD", "SA", "VIC") 
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    quote_date_str,
                    year,
                    float(row['NSW']),
                    float(row['QLD']),
                    float(row['SA']),
                    float(row['VIC'])
                ))
                new_records_count += 1
                print(f"  ✓ Added: {quote_date_str}, Year {year}")
            else:
                skipped_records_count += 1
                print(f"  ⏭️  Skipped: {quote_date_str}, Year {year} (already exists)")
        
        conn.commit()
        print(f"✓ Database updated: {new_records_count} new records, {skipped_records_count} skipped")
        
    except Exception as e:
        print(f"✗ Error updating database: {e}")
        conn.rollback()
    finally:
        conn.close()

def verify_data_sorting(db_file: str, table_name: str):
    """Verify that database data is sorted correctly and re-sort if needed."""
    conn = create_database_connection(db_file)
    if conn is None:
        return
    
    try:
        # Check if we need to re-sort the data
        df = pd.read_sql_query(f'SELECT * FROM {table_name} ORDER BY "Quote Date" DESC', conn)
        print(f"✓ Database contains {len(df)} total records, sorted by Quote Date (descending)")
        
    except Exception as e:
        print(f"✗ Error verifying data sorting: {e}")
    finally:
        conn.close()

def main():
    """Main execution function."""
    print("🚀 Starting ASX Futures Data Update Process")
    print("=" * 50)
    
    # Setup database schema
    setup_database_schema(DB_FILE_PATH, TABLE_NAME)
    
    # Scrape new data
    new_data = scrape_asx_futures_data(ASX_URL)
    
    if new_data is not None and not new_data.empty:
        print(f"\n📊 Processing {len(new_data)} new records...")
        
        # Update CSV file
        update_csv_file(new_data, CSV_FILE_PATH)
        
        # Update database
        update_database(new_data, DB_FILE_PATH, TABLE_NAME)
        
        # Verify sorting
        verify_data_sorting(DB_FILE_PATH, TABLE_NAME)
        
        print("\n✅ Data update process completed successfully!")
        
    else:
        print("\n❌ No new data to process. Update process terminated.")
    
    print("=" * 50)

if __name__ == "__main__":
    main()

import streamlit as st
import sqlite3
import pandas as pd
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import matplotlib.pyplot as plt

# Function to create a database connection
def create_connection(db_file):
    conn = None
    try:
        conn = sqlite3.connect(db_file)
    except sqlite3.Error as e:
        st.error(f"Error connecting to database: {e}")
    return conn

# Function to save data to SQL database
def save_to_sql_database(df, db_file, table_name='futures_data'):
    conn = create_connection(db_file)
    if conn is not None:
        df.to_sql(table_name, conn, if_exists='append', index=False)
        conn.close()
        st.success("Data saved to database successfully.")
    else:
        st.error("Connection to database failed.")

# Scraper function that fetches data and saves it to the SQL database
def scrape_and_save():
    # The target URL
    url = 'https://www.asxenergy.com.au'
    # Use the 'requests' library to perform an HTTP GET request
    response = requests.get(url)

    # Check if the request was successful
    if response.status_code == 200:
        # Use BeautifulSoup to parse the HTML content
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the date of the quotes
        date_tag = soup.find('h3', string=lambda t: t and 'Cal Base Future Prices' in t)
        if date_tag:
            date_str = date_tag.get_text().replace('Cal Base Future Prices ', '')
            quote_date = datetime.strptime(date_str, '%a %d %b %Y').date()
        else:
            quote_date = datetime.now().date()
        
        # Find the futures prices table by its unique attributes or structure
        prices_table = soup.find('div', class_='dataset')
        
        if prices_table:
            rows = prices_table.find_all('tr')
            data = []
            
            for row in rows[1:]:  # Skip the header row
                cells = row.find_all('td')
                year_of_instrument = ''.join(filter(str.isdigit, cells[0].get_text().strip()))
                row_data = [quote_date, int(year_of_instrument)] + [cell.get_text().strip() for cell in cells[1:]]
                data.append(row_data)

            headers = ['quote_date', 'instrument_year', 'NSW', 'VIC', 'QLD', 'SA']
            df = pd.DataFrame(data, columns=headers)
            df = df.apply(pd.to_numeric, errors='ignore')

            df['instrument_year'] = df['instrument_year'].astype(int)  # Convert to int to remove comma
            
            for state in ['NSW', 'VIC', 'QLD', 'SA']:
                df[state] = df[state].astype(float).round(2)  # Format to two decimal places
            
            print(df)

            # Save the data to the SQL database
            save_to_sql_database(df, 'futures_prices.db')
        else:
            st.error("The futures prices table was not found.")
    else:
        st.error(f"Failed to retrieve the page. Status code: {response.status_code}")

    return df

# # Set up the Streamlit interface
# st.title("Peak Energy Price Estimator for Large Contracts")

# # Use columns to create a right-side area in the main part of the app
# left_column, right_column = st.columns([3, 1])

# # Place the escalation factors in the right column
# with right_column:
#     st.write("## Escalation Factors")
#     load_factor = st.number_input('Load Escalation Factor', value=0.15)
#     retail_factor = st.number_input('Retail Escalation Factor', value=0.20)

# # Fetch button in the left column
# with left_column:
#     st.write("Left Column")
# #    if st.button('Fetch Data'):
# #        fetched_data = scrape_and_save()
# #        # Display fetched data
# #        if not fetched_data.empty:
# #            st.write(fetched_data)
# #        else:
# #            st.write("No data fetched or data is empty.")

# st.sidebar.header("Latest ASX Futures Data")

# # Fetch Button
# if st.sidebar.button('Fetch Data'):
#     fetched_data = scrape_and_save()
#     if not fetched_data.empty:
#         st.sidebar.write("Fetched Data", fetched_data)
#     else:
#         st.sidebar.write("No data fetched or data is empty.")


# Set up the Streamlit interface
st.title("Peak Energy Price Estimator for Large Contracts")

# Initialize session state for fetched data if not already set
if 'fetched_data' not in st.session_state:
    st.session_state['fetched_data'] = pd.DataFrame()

# Use columns to create a right-side area in the main part of the app
left_column, right_column = st.columns([3, 1])

# Place the escalation factors in the right column
with right_column:
    st.write("## Escalation Factors")
    load_factor = st.number_input('Load Escalation Factor', value=0.15)
    retail_factor = st.number_input('Retail Escalation Factor', value=0.15)

st.sidebar.header("Latest ASX Futures Data")

# Fetch Button
if st.sidebar.button('Fetch Data'):
    st.session_state['fetched_data'] = scrape_and_save()

# Display fetched data in the sidebar
if not st.session_state['fetched_data'].empty:
    st.sidebar.write("Fetched Data", st.session_state['fetched_data'])
else:
    st.sidebar.write("No data fetched or data is empty.")
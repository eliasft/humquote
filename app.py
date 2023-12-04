
import streamlit as st
import sqlite3
import pandas as pd
import requests
from bs4 import BeautifulSoup
from datetime import datetime

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
            #save_to_sql_database(df, 'futures_prices.db')
        else:
            st.error("The futures prices table was not found.")
    else:
        st.error(f"Failed to retrieve the page. Status code: {response.status_code}")

    return df

# Function to apply escalation factors and format the table for display
def apply_escalation_and_format(df, load_factor, retail_factor):
    # Apply escalation factors
    escalation_columns = ['NSW', 'VIC', 'QLD', 'SA']
    for col in escalation_columns:
        df[col] = df[col] * (1 + load_factor) * (1 + retail_factor)
        df[col] = df[col].round(2)  # Format to two decimal places
    
    # Format the instrument_year column to remove commas (if displayed as string with commas)
    df['instrument_year'] = df['instrument_year'].apply(lambda x: f"{x:.0f}")
    
    return df
    

# # Set up the Streamlit interface
# st.title("Peak Energy Price Estimator for Large Contracts")

# # Initialize session state for fetched data if not already set
# if 'fetched_data' not in st.session_state:
#     st.session_state['fetched_data'] = pd.DataFrame()

# # Use columns to create a right-side area in the main part of the app
# left_column, right_column = st.columns([3, 1])

# # Place the escalation factors in the right column
# with right_column:
#     st.write("## Escalation Factors")
#     load_factor = st.number_input('Load Escalation Factor', value=0.15)
#     retail_factor = st.number_input('Retail Escalation Factor', value=0.15)


# with left_column:
#     st.write("### Peak Electricity Price Quote as of Today")
#     # If data is fetched, apply escalation factors and display in the right column
#     if not st.session_state['fetched_data'].empty:
#         updated_df = apply_escalation_and_format(st.session_state['fetched_data'].copy(), load_factor, retail_factor)
#         st.dataframe(updated_df)  

# st.sidebar.header("Latest ASX Futures Data")

# # Fetch Button
# if st.sidebar.button('Fetch Data'):
#     st.session_state['fetched_data'] = scrape_and_save()

# # Display fetched data in the sidebar
# if not st.session_state['fetched_data'].empty:
#     st.sidebar.write("Fetched Data", st.session_state['fetched_data'])
# else:
#     st.sidebar.write("No data fetched or data is empty.")

# ... [rest of your imports and functions]

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

# Fetch Button and display the fetched data in the sidebar
st.sidebar.header("Latest ASX Futures Data")
if st.sidebar.button('Fetch Data'):
    st.session_state['fetched_data'] = scrape_and_save()
    # Apply escalation factors and format immediately after fetching
    st.session_state['updated_df'] = apply_escalation_and_format(st.session_state['fetched_data'].copy(), 
                                                                 load_factor, 
                                                                 retail_factor)
    # Display updated dataframe
    with left_column:
        st.dataframe(st.session_state['updated_df'])

# If data is fetched, show it in the sidebar and provide an option to export it
if not st.session_state['fetched_data'].empty:
    st.sidebar.dataframe(st.session_state['fetched_data'])
    # Export updated dataframe to Excel
    with left_column:
        st.write("## Export to Excel")
        export_df = st.session_state['updated_df']
        towrite = export_df.to_excel(index=False)
        st.download_button(label="📥 Download Excel", data=towrite, file_name='escalated_prices.xlsx', mime="application/vnd.ms-excel")



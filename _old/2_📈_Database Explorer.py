import streamlit as st
import sqlite3
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from io import BytesIO
from xlsxwriter import Workbook


st.set_page_config(
    page_title='HUMQuote - Database Explorer', 
    page_icon='📈', 
    initial_sidebar_state="auto",
    layout='wide',
    menu_items={
        'Get Help': 'https://www.humenergy.com.au/',
        'Report a bug': "https://www.humenergy.com.au/contact",
        'About': "# Bulk Electricity Pricing tool for Large Contracts"
    }
)

#########################################################################################################
#########################################################################################################
# DATABASE EXPLORER
#########################################################################################################
#########################################################################################################


# Function to get a list of tables from a database
def get_tables_from_db(db_file):
    conn = sqlite3.connect(db_file)
    query = "SELECT name FROM sqlite_master WHERE type='table';"
    tables = pd.read_sql_query(query, conn)
    conn.close()
    return tables['name'].tolist()

# Function to read data from a selected table in the database
def read_table_data(db_file, table_name):
    conn = sqlite3.connect(db_file)
    data = pd.read_sql_query(f"SELECT * FROM {table_name}", conn)
    conn.close()
    return data

# Streamlit UI for Database Explorer
st.title("Database Explorer")

#save_bulk_prices_db(summary_of_rates, 'bulk_price_tracker.db')

# Database selection
db_choice = st.radio("Select Database", ['ASX Futures', 'Bulk Prices'])
db_file = 'futures_prices.db' if db_choice == 'ASX Futures' else 'bulk_price_tracker.db'

# Table selection
tables = get_tables_from_db(db_file)
#table_choice = st.selectbox("Select Table", tables)
table_choice = tables[0]

# # Query DB button
if st.button('Query DB'):
    if table_choice:
        data = read_table_data(db_file, table_choice)
        st.write(f"Data from {table_choice} table:")
        st.dataframe(data)

        # Optional: Download button for the data
        csv = data.to_csv(index=False).encode('utf-8')
        st.download_button("Download as CSV", csv, "table_data.csv", "text/csv", key='download-csv')



import streamlit as st
import sqlite3
import pandas as pd

# Function to fetch data from the database, sorted by "Quote Date" in descending order
def fetch_data_from_database(db_path):
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)
    # Modify the query to include an ORDER BY clause for "Quote Date" in descending order
    query = "SELECT * FROM futures_data ORDER BY `Quote Date` DESC"
    # Execute the query and fetch the data
    df = pd.read_sql_query(query, conn)
    # Close the database connection
    conn.close()
    return df

# Function to initialize and store the DataFrame in session state
def initialize_data():
    # Check if 'futures_data' is not in session state or you need to refresh it
    if 'futures_data' not in st.session_state:
        # Fetch the data from the database and store it in session state
        st.session_state['futures_data'] = fetch_data_from_database('futures_prices.db')

# Call the function to initialize the data on app start or when needed
initialize_data()

# Example of using the DataFrame in your Streamlit app
def display_data():
    # Access the DataFrame from the session state
    df = st.session_state['futures_data']
    # Display the DataFrame in the app
    st.table(df)

# Assuming this is a multi-page app, you can call display_data on any page
display_data()

import streamlit as st
import pandas as pd
import plotly.express as px

# Assuming the DataFrame is already stored in the session state as 'futures_data'
# Make sure this function is called after 'initialize_data()' is called
def display_data_with_chart():
    df = st.session_state['futures_data']

    # Dropdown for selecting the column to plot
    selected_column = st.selectbox("Select column to plot:", ["NSW", "SA", "QLD", "VIC"])

    # Create a Plotly line chart
    fig = px.line(df, x="Quote Date", y=selected_column, color="Year",
                  labels={"Quote Date": "Quote Date", selected_column: selected_column},
                  title=f"{selected_column} Prices Over Time")

    # Display the Plotly chart
    st.plotly_chart(fig)

    # Display the DataFrame
    st.write(df)

# Ensure to call initialize_data() before this if it's not already done
# Example of using the DataFrame and chart in your Streamlit app
display_data_with_chart()

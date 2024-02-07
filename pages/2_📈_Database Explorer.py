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
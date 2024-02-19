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
    page_title='HUMQuote - Futures Price Tracker', 
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
# FUTURES PRICE TRACKER
#########################################################################################################
#########################################################################################################

# Streamlit UI for Database Explorer
st.title("📈 Futures Price Tracker")

st.sidebar.image("logo_hum.png", use_column_width=True)


#########################################################################################################
#########################################################################################################
# FUNCTIONS
#########################################################################################################
#########################################################################################################

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



# Example of using the DataFrame in your Streamlit app
def display_data_table():
    # Access the DataFrame from the session state
    df = st.session_state['futures_data']
    # Display the DataFrame in the app
    expander_futures = st.expander(f"# Historical Futures Data", expanded=False)
    with expander_futures:
        st.table(df)

    # Optional: Download button for the data
    csv = df.to_csv(index=True).encode('utf-8')
    st.download_button("Download as CSV", csv, "historical-futures-data.csv", "text/csv", key='download-csv')


# Assuming the DataFrame is already stored in the session state as 'futures_data'
# Make sure this function is called after 'initialize_data()' is called
def display_chart():
    df = st.session_state['futures_data']

    # Dropdown for selecting the column to plot
    selected_column = st.selectbox("Select State to plot:", ["NSW", "VIC", "QLD", "SA"])

    # Create a Plotly line chart
    fig = px.line(df, x="Quote Date", y=selected_column, color="Year",
                  labels={"Quote Date": "Quote Date", selected_column: "$AUD/MWh"},
                  title=f"{selected_column} Futures Prices Over Time")

    # Increase the height of the chart here
    fig.update_layout(height=500)

    # Display the Plotly chart
    st.plotly_chart(fig, use_container_width=True)

    # Display the DataFrame
    #st.write(df)


#########################################################################################################
#########################################################################################################
# WORKFLOW
#########################################################################################################
#########################################################################################################


# Call the function to initialize the data on app start or when needed
initialize_data()

# Ensure to call initialize_data() before this if it's not already done
# Example of using the DataFrame and chart in your Streamlit app
display_chart()

# Assuming this is a multi-page app, you can call display_data on any page
display_data_table()
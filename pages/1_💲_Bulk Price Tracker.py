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
    page_title='HUMQuote - Bulk Price Tracker', 
    page_icon='💲', 
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
# BULK PRICE TRACKER
#########################################################################################################
#########################################################################################################

# Streamlit UI for Database Explorer
st.title("💲 Bulk Price Tracker")

st.sidebar.image("logo_hum.png", use_column_width=True)

#########################################################################################################
#########################################################################################################
# FUNCTIONS
#########################################################################################################
#########################################################################################################


def calculate_bulk_price_index(db_path='futures_prices.db'):
    conn = sqlite3.connect(db_path)
    # Assuming "Rate" needs to be calculated differently now as we don't have a "State" column
    states = ["NSW", "VIC", "QLD", "SA"]
    results = []

    for state in states:
        # Construct SQL query for each state
        query = f"SELECT `Quote Date`, AVG(`{state}`) as `Peak Rate` FROM futures_data GROUP BY `Quote Date` ORDER BY `Quote Date` DESC"
        df = pd.read_sql_query(query, conn)

        if df.empty:
            continue  # Skip this state if no data

        for _, row in df.iterrows():
            quote_date = row['Quote Date']
            peak_rate = row['Peak Rate'] /10
            off_peak_rate = peak_rate * 0.85  # 85% of the peak_rate

            
            # Calculation based on the provided logic...
            # Assuming the rest of the calculation logic remains the same
            # This is where you would calculate bulk_price_index using peak_rate and off_peak_rate

            # Constants
            total_consumption = 400000
            peak_consumption = total_consumption * 0.50
            off_peak_consumption = total_consumption * 0.50
            transmission_loss_factor = 1.00860
            distribution_loss_factor = 1.04344
            net_loss_factor = transmission_loss_factor * distribution_loss_factor
            load_factor = 0.55
            peak_demand = total_consumption / 8760 / load_factor

            peak_volume = 14.67
            network_volume = 0.96
            ancillary = 0.09910
            participant = 0.09910
            srec = 1.09040
            lrec = 1.0000
            service = 5.38
            metering = 100.00
            retail = 0.00
            admin = 0.00


            # Adjusted rates
            peak_energy_adj = peak_rate * net_loss_factor
            off_peak_energy_adj = off_peak_rate * net_loss_factor

            # Costs
            peak_energy_costs = peak_consumption * (peak_energy_adj / 100)
            off_peak_energy_costs = off_peak_consumption * (off_peak_energy_adj / 100)
            peak_demand_costs = peak_demand * peak_volume * 12
            network_volume_costs = total_consumption * network_volume / 100
            other_volume_costs = total_consumption * (ancillary + participant + srec + lrec) / 100
            fixed_costs = (service + ((metering + retail + admin) / 30)) * 365

            # Bulk price index calculation
            energy = (peak_energy_costs + off_peak_energy_costs) / total_consumption
            network = (peak_demand_costs + network_volume_costs) / total_consumption
            other = other_volume_costs / total_consumption
            fixed = fixed_costs / total_consumption
            bulk_price_index = energy + network + other + fixed
            
            # Append the result for this date and state
            results.append((quote_date, state, bulk_price_index))

    bulk_price_df = pd.DataFrame(results, columns=["Quote Date", "State", "Bulk Price Index"])
    bulk_price_pivoted_df = bulk_price_df.pivot(index='Quote Date', columns='State', values='Bulk Price Index').reset_index()

    return bulk_price_pivoted_df

def save_bulk_price_index_to_db(bulk_price_index_df, db_path='bulk_price_index.db'):
    conn = sqlite3.connect(db_path)
    bulk_price_index_df.to_sql('bulk_price_index', conn, if_exists='replace', index=False)
    conn.close()

# Function to initialize and store the DataFrame in session state
def initialize_data():
    # Check if 'futures_data' is not in session state or you need to refresh it
    if 'bulk_price_index' not in st.session_state:
        # Fetch the data from the database and store it in session state
        st.session_state['bulk_price_index'] = calculate_bulk_price_index(db_path='futures_prices.db')
        
        # Optionally, save the DataFrame to the database for persistence
        save_bulk_price_index_to_db(st.session_state['bulk_price_index'])

def display_index_table():
    df = st.session_state['bulk_price_index'].set_index('Quote Date')

    expander_index = st.expander(f"# Historical Bulk Price Index", expanded=False)
    with expander_index:
        st.table(df)

    # Optional: Download button for the data
    csv = df.to_csv(index=True).encode('utf-8')
    st.download_button("Download as CSV", csv, "historical_bulk_price_index.csv", "text/csv", key='download-csv')


def display_index_chart():

        df = st.session_state['bulk_price_index']

        # Create and display a Plotly chart
        fig = px.line(df.melt(id_vars=["Quote Date"], value_vars=["NSW", "QLD", "VIC", "SA"], 
                                               var_name="State", value_name="Bulk Price Index"), 
                      x="Quote Date", y="Bulk Price Index", color='State', 
                      title="Bulk Price Index Over Time")
        fig.update_layout(
            height=600,  # Customize the size as needed
            yaxis_title="AUD$/MWh"  # Set the y-axis label
        ) # Customize the size as needed
        st.plotly_chart(fig, use_container_width=True)


#########################################################################################################
#########################################################################################################
# WORKFLOW
#########################################################################################################
#########################################################################################################

initialize_data()

display_index_chart() 

display_index_table()   



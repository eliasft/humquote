import streamlit as st
from datetime import datetime
import pandas as pd
import numpy as np

def calculate_bulk_price_index(df_updated, df_fetched):
    states = ["NSW", "QLD", "VIC", "SA"]
    #today = datetime.now().date()
    results = []

    # Extract the most recent Quote Date from updated_df
    df_updated = df_updated.reset_index()
    # Assuming all rows have the same Quote Date, which is the case for freshly fetched data
    if not df_updated.empty and 'Quote Date' in df_updated.columns:
        quote_date = df_updated['Quote Date'].iloc[0]
    else:
        st.error("Quote Date is missing from updated_df.")
        return pd.DataFrame()  # Return an empty DataFrame if the Quote Date is missing


    for state in states:
        # Average rates for peak and off-peak
        peak_rate = df_updated[state].mean()
        off_peak_rate = df_fetched[state].mean() / 10

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

        results.append((quote_date, state, bulk_price_index))

    bulk_price_df = pd.DataFrame(results, columns=["Quote Date", "State", "Bulk Price Index"])

    bulk_price_pivoted_df = bulk_price_df.pivot(index='Quote Date', columns='State', values='Bulk Price Index').reset_index()

    return bulk_price_pivoted_df

def display_bulk_price_index():
    # Check if the session states are initialized and not empty
    if 'updated_df' in st.session_state and not st.session_state['updated_df'].empty and 'fetched_data' in st.session_state and not st.session_state['fetched_data'].empty:
        bulk_price_index_df = calculate_bulk_price_index(st.session_state['updated_df'], st.session_state['fetched_data'])
        st.session_state['bulk_price_index_df'] = bulk_price_index_df
        st.write("Bulk Price Index for All States:")
        st.dataframe(bulk_price_index_df)
    else:
        st.write("Data not available. Please make sure to fetch and prepare data on the home page.")

# Check if data has been fetched on the Home page
if 'data_fetched' in st.session_state and st.session_state['data_fetched']:
    # Optionally, you might want to calculate the Bulk Price Index here if it's not already done
    # This could involve calling a function similar to calculate_and_add_index_date_bulk_price_index()
    
    # Now, call the display function
    display_bulk_price_index()
else:
    st.info("Please fetch the data from the Home page.")
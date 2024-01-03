
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

        date = quote_date
        
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

            headers = ['Quote Date', 'Year', 'NSW', 'VIC', 'QLD', 'SA']
            df = pd.DataFrame(data, columns=headers)
            #df = df.apply(pd.to_numeric, errors='ignore')

            df['Year'] = df['Year'].astype(int)  # Convert to int to remove comma
            
            for state in ['NSW', 'VIC', 'QLD', 'SA']:
                df[state] = df[state].astype(float).round(2)  # Format to two decimal places
            
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
        df[col] = df[col]/10 * (load_factor) * (retail_factor)
        df[col] = df[col].round(2)  # Format to two decimal places
    
    # Format the instrument_year column to remove commas (if displayed as string with commas)
    df['Year'] = df['Year'].apply(lambda x: f"{x:.2f}")
    
    return df


def update_escalated_data(load, retail):
    if not st.session_state['fetched_data'].empty:

        st.session_state['updated_df'] = apply_escalation_and_format(
            st.session_state['fetched_data'].copy(), load, retail
        )


# Apply formatting for two decimal places to the main and sidebar tables
def format_data(df):
    decimal_columns = ['NSW', 'VIC', 'QLD', 'SA']
    for col in decimal_columns:
        df[col] = df[col].astype(float).round(2)
    
    # Ensure 'instrument_year' is numeric before formatting
    df['Year'] = pd.to_numeric(df['Year'], errors='coerce').fillna(0).astype(int)
    df['Year'] = df['Year'].apply(lambda x: f"{x}")

    return df


# Function to calculate off-peak consumption
def calculate_off_peak(peak_consumption, shoulder_consumption):
    return 100 - peak_consumption - shoulder_consumption

# Function to create input boxes for various charges
def create_input_boxes():
    with st.sidebar:
        with st.expander("Consumption Profile"):
            total_consumption = st.number_input("Total Consumption (MWh)", min_value=0.00, value=120000.00, format="%.2f", step=10000.00)
            peak_consumption = st.number_input("Peak Consumption (%)", value=50.00, format="%.2f", min_value=0.00, max_value=100.00, step=1.0)
            shoulder_consumption = st.number_input("Shoulder Consumption (%)", value=00.00, format="%.2f", min_value=0.00, max_value=100.00, step=1.0)
            off_peak_consumption = calculate_off_peak(peak_consumption, shoulder_consumption)
            st.write(f"Off-Peak Consumption: {off_peak_consumption}%")
            load_factor = st.number_input("Load Factor", format="%.2f", value=0.55)

        with st.expander("Network Charges"):
            network=0.9640
            demand=14.6670
            service=5.3790
            peak_charge = st.number_input("Peak Charge (c/kWh)", format="%.2f", value=network)
            off_peak_charge = st.number_input("Off-Peak Charge (c/kWh)", format="%.2f", value=network)
            shoulder_charge = st.number_input("Shoulder Charge (c/kWh)", format="%.2f", value=network)
            nuos_charge = st.number_input("NUOS Charge ($/kVA)", format="%.2f", value=demand, step=1.0)
            service_availability_charge = st.number_input("Service Availability Charge ($/day)", format="%.2f", value=service)

        with st.expander("System Charges"):
            aemo=0.09910
            srec=1.09040
            lrec=1.0000
            aemo_participant_charge = st.number_input("AEMO Participant Charge (c/kWh)", format="%.2f", value=aemo)
            aemo_ancillary_services_charge = st.number_input("AEMO Ancillary Services Charge (c/kWh)", format="%.2f", value=aemo)
            srec_charge = st.number_input("SREC Charge (c/kWh)", format="%.2f", value=srec)
            lrec_charge = st.number_input("LREC Charge (c/kWh)", format="%.2f", value=lrec)

        with st.expander("Service Charges"):
            metering=100.00
            retail_service=0.00
            admin=0.00
            metering_charge = st.number_input("Metering Charge ($/month)", format="%.2f", value=metering)
            retail_service_charge = st.number_input("Retail Service Charge ($/month)", format="%.2f", value=retail_service)
            admin_charge = st.number_input("Admin Charge ($/month)", format="%.2f", value=admin)

        with st.expander('Escalation Factors'):
            load = st.number_input('Load Escalation Factor', value=1.15, key="load_factor")
            retail = st.number_input('Retail Escalation Factor', value=1.15, key="retail_factor")

    # Automatically update escalated data when the factors change
    if 'load_factor' in st.session_state and 'retail_factor' in st.session_state:
        update_escalated_data(st.session_state['load_factor'], st.session_state['retail_factor'])


    # Placeholder for now, replace with the actual calculations and storing in session_state later
    st.session_state['calculation_results'] = {
        'total_consumption': total_consumption,
        'peak_consumption': peak_consumption,
        'shoulder_consumption': shoulder_consumption,
        'off_peak_consumption': off_peak_consumption,
        'load_factor': load_factor,
        'peak_charge': peak_charge,
        'off_peak_charge': off_peak_charge,
        'shoulder_charge': shoulder_charge,
        'nuos_charge': nuos_charge,
        'service_availability_charge': service_availability_charge,
        'aemo_participant_charge': aemo_participant_charge,
        'aemo_ancillary_services_charge': aemo_ancillary_services_charge,
        'srec_charge': srec_charge,
        'lrec_charge': lrec_charge,
        'metering_charge': metering_charge,
        'retail_service_charge': retail_service_charge,
        'admin_charge': admin_charge,
        'load_factor_escalation': load,
        'retail_factor_escalation': retail
    }


# Function to display summary tables vertically
def display_summary_tables():
    # Placeholder DataFrame, replace with actual calculated data

    global energy_rates, summary_of_consumption, summary_of_charges, summary_of_costs, summary_of_rates, selected_state

     # Add a selection widget for the user to choose a state
    selected_state = st.sidebar.selectbox("Select State", ["NSW", "QLD", "VIC", "SA"])

    energy_rates = pd.DataFrame({
        'Tariffs & Factors': [
                            'Peak Tariff',
                            'Shoulder Tariff',
                            'Off Peak Tariff',
                            'Transmission Loss Factor',
                            'Distribution Loss Factor',
                            'Net Loss Factor',
                            'Peak Energy (Adj by Loss Factor)',
                            'Shoulder Energy (Adj by Loss Factor)',
                            'Off Peak Energy (Adj by Loss Factor)'],
                                'Year 1': [0] * 9, 'Year 2': [0] * 9, 'Year 3': [0] * 9,
                                'Year 4': [0] * 9, 'Year 5': [0] * 9,
                                })

    summary_of_consumption = pd.DataFrame({
    'Energy Consumption': [
                            'Total Consumption',
                            'Peak Consumption',
                            'Shoulder Consumption',
                            'Off Peak Consumption',
                            'Load Factor',
                            'Average Monthly Peak Demand'],
                                'Year 1': [0] * 6, 'Year 2': [0] * 6, 'Year 3': [0] * 6,
                                'Year 4': [0] * 6, 'Year 5': [0] * 6,
                                })

    summary_of_charges = pd.DataFrame({
        'Unit Summary': [
                         'Peak Energy Charge', 
                         'Shoulder Energy Charge', 
                         'Off Peak Energy Charge', 
                         'Peak Demand Charge',
                         'Network Volume Charge', 
                         'Other Volume Charge', 
                         'Fixed Charge'],
                                'Year 1': [0] * 7, 'Year 2': [0] * 7, 'Year 3': [0] * 7,
                                'Year 4': [0] * 7, 'Year 5': [0] * 7,
                            })

    summary_of_costs = pd.DataFrame({
        'Annual Summary': [
                            'Peak Energy Costs', 
                            'Shoulder Energy Costs', 
                            'Off Peak Energy Costs',
                            'Peak Demand', 
                            'Network Volume', 
                            'Other Volume', 
                            'Fixed', 
                            'Total', 
                            'kWh/year',
                            'Bundled Bulk Cost'],
                                'Year 1': [0] * 10, 'Year 2': [0] * 10, 'Year 3': [0] * 10,
                                'Year 4': [0] * 10, 'Year 5': [0] * 10,
                            })

    summary_of_rates = pd.DataFrame({
        'Rates Summary': [
                          'Energy', 
                          'Network', 
                          'Other', 
                          'Fixed', 
                          'Total'],
                                'Year 1': [0] * 5, 'Year 2': [0] * 5, 'Year 3': [0] * 5,
                                'Year 4': [0] * 5, 'Year 5': [0] * 5,
                            })

        # Calculate values for energy_rates DataFrame based on user-selected state
    if not st.session_state['updated_df'].empty:
        for year in range(1, 5):

            # Summary of Rates

            # Fetch values from the updated_df DataFrame for the selected state
            peak_rate = st.session_state['updated_df'][selected_state].iloc[year - 1]
            shoulder_rate = st.session_state['updated_df'][selected_state].iloc[year - 1]
            off_peak_rate = st.session_state['fetched_data'][selected_state].iloc[year - 1]/10

            # Format the values as floats with three decimals
            #peak_rate = f"{peak_rate:.3f}"
            #shoulder_rate = f"{shoulder_rate:.3f}"
            #off_peak_rate = f"{off_peak_rate:.3f}"
            
            # Calculate other factors
            transmission_loss_factor = 1.00860
            distribution_loss_factor = 1.04344
            net_loss_factor = transmission_loss_factor * distribution_loss_factor
            peak_energy_adj = peak_rate * net_loss_factor
            shoulder_energy_adj = shoulder_rate * net_loss_factor
            off_peak_energy_adj = off_peak_rate * net_loss_factor

            #Placeholder for format rest of variables

            # Populate the energy_rates DataFrame
            energy_rates.at[0, f'Year {year}'] = float(peak_rate)
            energy_rates.at[1, f'Year {year}'] = float(shoulder_rate)
            energy_rates.at[2, f'Year {year}'] = float(off_peak_rate)
            energy_rates.at[3, f'Year {year}'] = float(transmission_loss_factor)
            energy_rates.at[4, f'Year {year}'] = float(distribution_loss_factor)
            energy_rates.at[5, f'Year {year}'] = float(net_loss_factor)
            energy_rates.at[6, f'Year {year}'] = float(peak_energy_adj)
            energy_rates.at[7, f'Year {year}'] = float(shoulder_energy_adj)
            energy_rates.at[8, f'Year {year}'] = float(off_peak_energy_adj)

            
            #Summary of Consumption

            total_consumption = st.session_state['calculation_results'].get('total_consumption', 0)  # Get the total consumption from the calculation results
            load_factor = st.session_state['calculation_results'].get('load_factor', 0)  # Get the load factor from the calculation results
            peak_consumption_percentage = st.session_state['calculation_results'].get('peak_consumption', 0)  # Get the peak consumption percentage from the calculation results
            shoulder_consumption_percentage = st.session_state['calculation_results'].get('shoulder_consumption', 0)  # Get the shoulder consumption percentage from the calculation results
            off_peak_consumption_percentage = st.session_state['calculation_results'].get('off_peak_consumption', 0)  # Get the off-peak consumption percentage from the calculation results
            peak_demand=total_consumption / 8760 / load_factor

            peak_consumption=total_consumption * (peak_consumption_percentage / 100)
            shoulder_consumption=total_consumption * (shoulder_consumption_percentage / 100)
            off_peak_consumption=total_consumption * (off_peak_consumption_percentage / 100)

            summary_of_consumption.at[0, f'Year {year}'] = total_consumption
            summary_of_consumption.at[1, f'Year {year}'] = peak_consumption
            summary_of_consumption.at[2, f'Year {year}'] = shoulder_consumption
            summary_of_consumption.at[3, f'Year {year}'] = off_peak_consumption
            summary_of_consumption.at[4, f'Year {year}'] = load_factor
            summary_of_consumption.at[5, f'Year {year}'] = peak_demand


            #Summary of Charges

            peak_volume=st.session_state['calculation_results'].get('nuos_charge',0)
            network_volume=st.session_state['calculation_results'].get('peak_charge',0)
            ancillary=st.session_state['calculation_results'].get('aemo_ancillary_services_charge',0)
            participant=st.session_state['calculation_results'].get('aemo_participant_charge',0)
            srec=st.session_state['calculation_results'].get('srec_charge',0)
            lrec=st.session_state['calculation_results'].get('lrec_charge',0)
            service=st.session_state['calculation_results'].get('service_availability_charge',0)
            metering=st.session_state['calculation_results'].get('metering_charge',0)
            retail=st.session_state['calculation_results'].get('retail_service_charge',0)
            admin=st.session_state['calculation_results'].get('admin_charge',0)

            other_volume = participant + ancillary + srec + lrec
            fixed = service + (metering + retail + admin) / 30

            summary_of_charges.at[0, f'Year {year}'] = peak_energy_adj
            summary_of_charges.at[1, f'Year {year}'] = shoulder_energy_adj
            summary_of_charges.at[2, f'Year {year}'] = off_peak_energy_adj
            summary_of_charges.at[3, f'Year {year}'] = peak_volume
            summary_of_charges.at[4, f'Year {year}'] = network_volume
            summary_of_charges.at[5, f'Year {year}'] = other_volume
            summary_of_charges.at[6, f'Year {year}'] = fixed


            #Summary of Costs

            peak_energy_costs = peak_consumption * (peak_energy_adj / 100)
            shoulder_energy_costs = shoulder_consumption * (shoulder_energy_adj / 100)
            off_peak_energy_costs = off_peak_consumption * (off_peak_energy_adj / 100)
            peak_demand_costs = peak_demand * peak_volume * 12
            network_volume_costs = total_consumption * (network_volume / 100)
            other_volume_costs = total_consumption * (other_volume / 100)
            fixed_costs = fixed * 365
            total_costs = peak_energy_costs + shoulder_energy_costs + off_peak_energy_costs + peak_demand_costs + network_volume_costs + other_volume_costs + fixed_costs
            bundled_cost = total_costs / total_consumption

            summary_of_costs.at[0, f'Year {year}'] = float(peak_energy_costs)
            summary_of_costs.at[1, f'Year {year}'] = float(shoulder_energy_costs)
            summary_of_costs.at[2, f'Year {year}'] = float(off_peak_energy_costs)
            summary_of_costs.at[3, f'Year {year}'] = float(peak_demand_costs)
            summary_of_costs.at[4, f'Year {year}'] = float(network_volume_costs)
            summary_of_costs.at[5, f'Year {year}'] = float(other_volume_costs)
            summary_of_costs.at[6, f'Year {year}'] = float(fixed_costs)
            summary_of_costs.at[7, f'Year {year}'] = float(total_costs)
            summary_of_costs.at[8, f'Year {year}'] = float(total_consumption)
            summary_of_costs.at[9, f'Year {year}'] = float(bundled_cost)

            #Summary of Rates
            energy = (peak_energy_costs + shoulder_energy_costs + off_peak_energy_costs) / total_consumption
            network = (peak_demand_costs + network_volume_costs) / total_consumption
            other = (other_volume_costs) / total_consumption
            fixed = (fixed_costs) / total_consumption
            total = (energy + network + other + fixed)

            summary_of_rates.at[0, f'Year {year}'] = float(energy)
            summary_of_rates.at[1, f'Year {year}'] = float(network)
            summary_of_rates.at[2, f'Year {year}'] = float(other)
            summary_of_rates.at[3, f'Year {year}'] = float(fixed)
            summary_of_rates.at[4, f'Year {year}'] = float(total)


    # Repeat values for "Year 5" from the values of "Year 4"
    for factor in range(9):
        energy_rates.at[factor, 'Year 5'] = energy_rates.at[factor, f'Year 4']

    for factor in range(6):
        summary_of_consumption.at[factor, 'Year 5'] = summary_of_consumption.at[factor, f'Year 4']

    for factor in range(7):
        summary_of_charges.at[factor, 'Year 5'] = summary_of_charges.at[factor, f'Year 4']

    for factor in range(10):
        summary_of_costs.at[factor, 'Year 5'] = summary_of_costs.at[factor, f'Year 4']

    for factor in range(5):
        summary_of_rates.at[factor, 'Year 5'] = summary_of_rates.at[factor, f'Year 4']

    # Display tables vertically
    st.header(f"Summary for {selected_state}")


    def create_table_figure(dataframe, font_size=14, cell_height=40):
        # Create an empty list to store the format strings for each column
        formats = []

        # Create an empty list to store the alignment for each column
        alignments = []

        # Iterate over columns and determine the appropriate format and alignment
        for i, col in enumerate(dataframe.columns):
            if np.issubdtype(dataframe[col].dtype, np.number):
                # Numeric column, apply numeric format
                formats.append(',.2f' if i > 0 else '0')  # Apply different format for the first column
                alignments.append('right')
            else:
                # Non-numeric column, apply default format
                formats.append('')
                alignments.append('center' if i == 0 else 'right')  # Align the first column to the left

        # Create the Table trace
        fig = go.Figure()
        fig.add_trace(go.Table(
            header=dict(values=list(dataframe.columns),
                        font=dict(size=18, color=['black'] + ['black'] * (len(dataframe.columns) - 1)),
                        fill_color='yellow',
                        height=cell_height,
                        line=dict(width=2),
                        align='center'),
            cells=dict(values=dataframe.values.T,
                       font=dict(size=[16] + [font_size], color=['black'] + ['white'] * (len(dataframe.columns) - 1)),
                       fill_color=['yellow'] + ['rgba(0,0,0,0)'],
                       height=cell_height,
                       line=dict(width=1),
                       format=formats,
                       align=alignments,  # Use the custom formats list
                       ),
            #columnwidth=[font_size] * len(dataframe.columns),
            columnwidth=[font_size] + [font_size / 2] * (len(dataframe.columns) - 1),
        ))

        fig.update_layout(margin=dict(l=10, r=10, t=10, b=10))

        return fig


    expander_tariffs = st.expander(f"### Summary of Tariffs & Factors", expanded=False)
    with expander_tariffs:
        st.plotly_chart(create_table_figure(energy_rates, font_size=16, cell_height=40), use_container_width=True)  # Adjust font size

    st.write(f"### Summary of Tariffs & Factors")
    st.plotly_chart(create_table_figure(energy_rates, font_size=16, cell_height=40), use_container_width=True)  # Adjust font size
    
    st.write(f"### Summary of Energy Consumption")
    st.plotly_chart(create_table_figure(summary_of_consumption, font_size=16, cell_height=40), use_container_width=True)

    st.write("### Summary of Charges")
    st.plotly_chart(create_table_figure(summary_of_charges, font_size=16, cell_height=40), use_container_width=True)

    st.write("### Summary of Costs")
    st.plotly_chart(create_table_figure(summary_of_costs, font_size=16, cell_height=40), use_container_width=True)

    st.write("### Summary of Rates")
    st.plotly_chart(create_table_figure(summary_of_rates, font_size=16, cell_height=40), use_container_width=True)


    # st.write(f"Summary of Tariffs & Factors")
    # st.dataframe(energy_rates.set_index('Tariffs & Factors'))

    # st.write(f"Summary of Energy Consumption")
    # st.dataframe(summary_of_consumption.set_index('Energy Consumption'))

    # st.write("Summary of Charges")
    # st.dataframe(summary_of_charges.set_index('Unit Summary'))

    # st.write("Summary of Costs")
    # st.dataframe(summary_of_costs.set_index('Annual Summary'))

    # st.write("Summary of Rates")
    # st.dataframe(summary_of_rates.set_index('Rates Summary'))

    return energy_rates, summary_of_consumption, summary_of_charges, summary_of_costs, summary_of_rates, selected_state

# Set up the Streamlit interface
st.set_page_config(layout="wide")
st.image("logo_hum.png", width=300)
st.title("Bulk Electricity Pricing for Large Contracts")

# Initialize session state for fetched data and updated data if not already set
if 'fetched_data' not in st.session_state:
    st.session_state['fetched_data'] = pd.DataFrame()
if 'updated_df' not in st.session_state:
    st.session_state['updated_df'] = pd.DataFrame()

create_input_boxes()  # Call the function to create input boxes


# Fetch Button and display the fetched data in the sidebar
st.sidebar.header("Latest ASX Futures Data")
if st.sidebar.button('Fetch Data'):
    fetched_data = scrape_and_save()
    st.session_state['fetched_data'] = fetched_data.set_index('Quote Date')  # Set 'quote_date' as index
    update_escalated_data(st.session_state['load_factor'], st.session_state['retail_factor'])  # Update the escalated data after fetching

if not st.session_state['updated_df'].empty:

    st.subheader(f"Electricity Prices as of {st.session_state['fetched_data'].index[0]}")
    
    c1, c2 = st.columns(2)

    with st.container():
        c1.write(f"### Peak Electricity Prices")
        c2.write(f"### Base Electricity Prices")

    with c1:
        formatted_main_df = format_data(st.session_state['updated_df'].copy())
        st.dataframe(formatted_main_df)

    with c2:
        off_peak_df = st.session_state['fetched_data'].copy() / 10  # Divide by 10 for Off Peak
        off_peak_df = format_data(off_peak_df)
        st.dataframe(off_peak_df)

    display_summary_tables()

    st.write("## Export to Excel")

    peak_df = st.session_state['updated_df'].copy()

    combined_df = pd.concat([peak_df,
                             off_peak_df,
                             energy_rates,
                             summary_of_consumption,
                             summary_of_charges,
                             summary_of_costs,
                             summary_of_rates],
                             axis=0)

    towrite = BytesIO()
    combined_df.to_excel(towrite, index=True)
    towrite.seek(0,0)
    st.download_button(label="📥 Download Excel", 
                       data=towrite, 
                       file_name=f"bulk-electricity-pricing-{selected_state}-{st.session_state['fetched_data'].index[0]}.xlsx",
                       mime="application/vnd.ms-excel")
    # export_df = st.session_state['updated_df']
    # towrite = BytesIO()
    # export_df.to_excel(towrite, index=True)  # Keep the index in the export
    # towrite.seek(0)
    # st.download_button(label="📥 Download Excel", data=towrite, file_name='escalated_prices.xlsx',
    #                    mime="application/vnd.ms-excel")

# Display formatted fetched data in the sidebar
if not st.session_state['fetched_data'].empty:
    formatted_sidebar_df = format_data(st.session_state['fetched_data'].copy())
    st.sidebar.dataframe(formatted_sidebar_df)
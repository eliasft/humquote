
import streamlit as st
import sqlite3
import pandas as pd
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
            #df = df.apply(pd.to_numeric, errors='ignore')

            df['instrument_year'] = df['instrument_year'].astype(int)  # Convert to int to remove comma
            
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
    df['instrument_year'] = df['instrument_year'].apply(lambda x: f"{x:.0f}")
    
    return df

# Function to update the escalated data
def update_escalated_data(load_factor, retail_factor):
    if not st.session_state['fetched_data'].empty:
        st.session_state['updated_df'] = apply_escalation_and_format(
            st.session_state['fetched_data'].copy(), load_factor, retail_factor
        )

# Apply formatting for two decimal places to the main and sidebar tables
def format_data(df):
    decimal_columns = ['NSW', 'VIC', 'QLD', 'SA']
    for col in decimal_columns:
        df[col] = df[col].astype(float).round(2)
    
    # Ensure 'instrument_year' is numeric before formatting
    df['instrument_year'] = pd.to_numeric(df['instrument_year'], errors='coerce').fillna(0).astype(int)
    df['instrument_year'] = df['instrument_year'].apply(lambda x: f"{x}")

    return df


# Function to calculate off-peak consumption
def calculate_off_peak(peak_consumption):
    return 100 - peak_consumption

# Function to create input boxes for various charges
def create_input_boxes():
    with st.sidebar:
        with st.expander("Consumption Profile"):
            total_consumption = st.number_input("Total Consumption (MWh)", format="%.2f")
            peak_consumption = st.number_input("Peak Consumption (%)", format="%.2f")
            off_peak_consumption = calculate_off_peak(peak_consumption)
            st.text(f"Off-Peak Consumption: {off_peak_consumption}%")
            load_factor = st.number_input("Load Factor", format="%.2f")

        with st.expander("Network Charges"):
            peak_charge = st.number_input("Peak Charge (c/kWh)", format="%.2f")
            off_peak_charge = st.number_input("Off-Peak Charge (c/kWh)", format="%.2f")
            shoulder_charge = st.number_input("Shoulder Charge (c/kWh)", format="%.2f")
            nuos_charge = st.number_input("NUOS Charge ($/kVA)", format="%.2f")
            service_availability_charge = st.number_input("Service Availability Charge ($/day)", format="%.2f")

        with st.expander("System Charges"):
            aemo_participant_charge = st.number_input("AEMO Participant Charge (c/kWh)", format="%.2f")
            aemo_ancillary_services_charge = st.number_input("AEMO Ancillary Services Charge (c/kWh)", format="%.2f")
            srec_charge = st.number_input("SREC Charge (c/kWh)", format="%.2f")
            lrec_charge = st.number_input("LREC Charge (c/kWh)", format="%.2f")

        with st.expander("Service Charges"):
            metering_charge = st.number_input("Metering Charge ($/month)", format="%.2f")
            retail_service_charge = st.number_input("Retail Service Charge ($/month)", format="%.2f")
            admin_charge = st.number_input("Admin Charge ($/month)", format="%.2f")

    # Placeholder for now, replace with the actual calculations and storing in session_state later
    st.session_state['calculation_results'] = {}

# Function to display summary tables
def display_summary_tables():
    # Placeholder DataFrame, replace with actual calculated data
    summary_of_charges = pd.DataFrame({
        'Summary': ['Peak Energy Costs', 'Shoulder Energy Costs', 'Off Peak Energy Costs',
                    'Peak Demand', 'Network Volume', 'Other Volume', 'Fixed'],
        'Year 1': [0]*7, 'Year 2': [0]*7, 'Year 3': [0]*7,
        'Year 4': [0]*7, 'Year 5': [0]*7,
    })

    summary_of_costs = pd.DataFrame({
        'Summary': ['Peak Energy Costs', 'Shoulder Energy Costs', 'Off Peak Energy Costs',
                    'Peak Demand', 'Network Volume', 'Other Volume', 'Fixed', 'Total', 'kWh/year'],
        'Year 1': [0]*9, 'Year 2': [0]*9, 'Year 3': [0]*9,
        'Year 4': [0]*9, 'Year 5': [0]*9,
    })

    summary_of_rates = pd.DataFrame({
        'Summary': ['Energy', 'Network', 'Other', 'Fixed', 'Total'],
        'Year 1': [0]*5, 'Year 2': [0]*5, 'Year 3': [0]*5,
        'Year 4': [0]*5, 'Year 5': [0]*5,
    })

    # Use Streamlit columns to display tables side by side
    col1, col2, col3 = st.columns(3)
    with col1:
        st.write("Summary of Charges")
        st.dataframe(summary_of_charges)

    with col2:
        st.write("Summary of Costs")
        st.dataframe(summary_of_costs)

    with col3:
        st.write("Summary of Rates")
        st.dataframe(summary_of_rates)

# Set up the Streamlit interface
st.title("Peak Energy Price Estimator for Large Contracts")

# Initialize session state for fetched data and updated data if not already set
if 'fetched_data' not in st.session_state:
    st.session_state['fetched_data'] = pd.DataFrame()
if 'updated_df' not in st.session_state:
    st.session_state['updated_df'] = pd.DataFrame()

create_input_boxes()  # Call the function to create input boxes

# Use columns to adjust the layout
left_column, right_column = st.columns([0.80, 0.20])  # Adjust the ratio as needed

# Place the escalation factors in the right column
with right_column:
    st.header('Escalation Factors')
    #st.write("### Escalation Factors")
    # Update the updated_df when the factors change
    load_factor = st.number_input('Load Escalation Factor', value=1.15, key="load_factor")
    retail_factor = st.number_input('Retail Escalation Factor', value=1.15, key="retail_factor")

# Automatically update escalated data when the factors change
if 'load_factor' in st.session_state and 'retail_factor' in st.session_state:
    update_escalated_data(st.session_state['load_factor'], st.session_state['retail_factor'])


# Fetch Button and display the fetched data in the sidebar
st.sidebar.header("Latest ASX Futures Data")
if st.sidebar.button('Fetch Data'):
    fetched_data = scrape_and_save()
    st.session_state['fetched_data'] = fetched_data.set_index('quote_date')  # Set 'quote_date' as index
    update_escalated_data(load_factor, retail_factor)  # Update the escalated data after fetching

# Display updated dataframe in the left column and provide an option to export it
with left_column:
    if not st.session_state['updated_df'].empty:
        formatted_main_df = format_data(st.session_state['updated_df'].copy())
        st.write("### Peak Electricity Quote Prices as of Today")
        st.dataframe(formatted_main_df)
        display_summary_tables()
        st.write("## Export to Excel")
        export_df = st.session_state['updated_df']
        towrite = BytesIO()
        export_df.to_excel(towrite, index=True)  # Keep the index in the export
        towrite.seek(0)
        st.download_button(label="📥 Download Excel", data=towrite, file_name='escalated_prices.xlsx', mime="application/vnd.ms-excel")

# Display formatted fetched data in the sidebar
if not st.session_state['fetched_data'].empty:
    formatted_sidebar_df = format_data(st.session_state['fetched_data'].copy())
    st.sidebar.dataframe(formatted_sidebar_df)
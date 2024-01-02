
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
            total_consumption = st.number_input("Total Consumption (MWh)", format="%.2f")
            peak_consumption = st.number_input("Peak Consumption (%)", format="%.2f", min_value=0.00, max_value=100.00)
            shoulder_consumption = st.number_input("Shoulder Consumption (%)", format="%.2f", min_value=0.00, max_value=100.00)
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
            nuos_charge = st.number_input("NUOS Charge ($/kVA)", format="%.2f", value=demand)
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
    st.session_state['calculation_results'] = {}


# Function to display summary tables vertically
def display_summary_tables():
    # Placeholder DataFrame, replace with actual calculated data

     # Add a selection widget for the user to choose a state
    selected_state = st.sidebar.selectbox("Select State", ["NSW", "QLD", "VIC", "SA"])

    energy_rates = pd.DataFrame({
        'Rates & Factors': ['Peak Rate',
                            'Shoulder Rate',
                            'Off Peak Rate',
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
        'Energy Consumption': ['Total Consumption',
                            'Peak Consumption',
                            'Shoulder Consumption',
                            'Off Peak Consumption',
                            'Distribution Loss Factor',
                            'Average Monthly Peak Demand',
                            'Peak Energy (Adj by Loss Factor)'],
        'Year 1': [0] * 7, 'Year 2': [0] * 7, 'Year 3': [0] * 7,
        'Year 4': [0] * 7, 'Year 5': [0] * 7,
        })

    summary_of_charges = pd.DataFrame({
        'Unit Summary': ['Peak Energy Costs', 'Shoulder Energy Costs', 'Off Peak Energy Costs',
                    'Peak Demand', 'Network Volume', 'Other Volume', 'Fixed'],
        'Year 1': [0] * 7, 'Year 2': [0] * 7, 'Year 3': [0] * 7,
        'Year 4': [0] * 7, 'Year 5': [0] * 7,
    })

    summary_of_costs = pd.DataFrame({
        'Annual Summary': ['Peak Energy Costs', 'Shoulder Energy Costs', 'Off Peak Energy Costs',
                    'Peak Demand', 'Network Volume', 'Other Volume', 'Fixed', 'Total', 'kWh/year'],
        'Year 1': [0] * 9, 'Year 2': [0] * 9, 'Year 3': [0] * 9,
        'Year 4': [0] * 9, 'Year 5': [0] * 9,
    })

    summary_of_rates = pd.DataFrame({
        'Rates Summary': ['Energy', 'Network', 'Other', 'Fixed', 'Total'],
        'Year 1': [0] * 5, 'Year 2': [0] * 5, 'Year 3': [0] * 5,
        'Year 4': [0] * 5, 'Year 5': [0] * 5,
    })

    # Display tables vertically
    st.write("Summary of Rates & Factors")
    st.dataframe(energy_rates.set_index('Rates & Factors'))

    st.write("Summary of Energy Consumption")
    st.dataframe(summary_of_consumption.set_index('Energy Consumption'))

    st.write("Summary of Charges")
    st.dataframe(summary_of_charges.set_index('Unit Summary'))

    st.write("Summary of Costs")
    st.dataframe(summary_of_costs.set_index('Annual Summary'))

    st.write("Summary of Rates")
    st.dataframe(summary_of_rates.set_index('Rates Summary'))


# Set up the Streamlit interface
st.title("Peak Energy Price Estimator for Large Contracts")

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
    formatted_main_df = format_data(st.session_state['updated_df'].copy())
    st.write(f"### Peak Electricity Quote Prices as of Today")
    st.dataframe(formatted_main_df)
    display_summary_tables()
    st.write("## Export to Excel")
    export_df = st.session_state['updated_df']
    towrite = BytesIO()
    export_df.to_excel(towrite, index=True)  # Keep the index in the export
    towrite.seek(0)
    st.download_button(label="📥 Download Excel", data=towrite, file_name='escalated_prices.xlsx',
                       mime="application/vnd.ms-excel")

# Display formatted fetched data in the sidebar
if not st.session_state['fetched_data'].empty:
    formatted_sidebar_df = format_data(st.session_state['fetched_data'].copy())
    st.sidebar.dataframe(formatted_sidebar_df)
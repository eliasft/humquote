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


#########################################################################################################
#########################################################################################################
# ASX FUTURES DATA SCRAPER
#########################################################################################################
#########################################################################################################

# Maps contract-btn data-code → DB column name.
# H = Base Strip product; N/V/Q/S = NSW/VIC/QLD/SA
_BASE_STRIP_CODES = {
    'HN': 'NSW',
    'HV': 'VIC',
    'HQ': 'QLD',
    'HS': 'SA',
}

_ASX_URL = 'https://www.asxenergy.com.au/futures/au_electricity'

_REQUEST_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    )
}


def scrape_and_save():
    """
    Fetches FY (Financial Year) Base Strip settle prices from the ASX Energy
    futures page and returns a DataFrame with columns:
        Quote Date | Year | NSW | VIC | QLD | SA

    FY rows (FY27, FY28, FY29) provide three data points per state, matching
    the original data volume from the old homepage scraper.

    Returns an empty DataFrame on failure or on weekends (ASX closed).

    New site structure (vs old homepage):
      - URL: /futures/au_electricity
      - Date: parsed from #refresh-container-market_date <pre> widget
      - Tables: located via contract-btn[data-code] (HN / HV / HQ / HS)
      - FY rows: identified by "FY" prefix in the period label (FY27, FY28, FY29)
    """
    try:
        response = requests.get(_ASX_URL, headers=_REQUEST_HEADERS, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')

        # ── Parse market date ──────────────────────────────────────────────────
        date_container = soup.find(id='refresh-container-market_date')
        if not date_container:
            st.error("Could not find the market date on the ASX page.")
            return pd.DataFrame()

        pre = date_container.find('pre')
        if not pre:
            st.error("Could not find the date <pre> element on the ASX page.")
            return pd.DataFrame()

        raw        = pre.get_text()
        first_line = raw.split('\n')[0].replace('\xa0', '').replace('\u00a0', '').strip()

        try:
            quote_date = datetime.strptime(first_line, '%a %d %b %Y').date()
        except ValueError:
            st.error(f"Could not parse market date: '{first_line}'")
            return pd.DataFrame()

        # ── Weekend guard ──────────────────────────────────────────────────────
        # ASX does not trade on Saturday (5) or Sunday (6).
        # Return an empty DataFrame so nothing is written to the DB or session state.
        if quote_date.weekday() >= 5:
            st.warning(
                f"ASX does not trade on weekends. "
                f"No data fetched for {quote_date.strftime('%A %d %b %Y')}."
            )
            return pd.DataFrame()

        # ── Extract FY prices per state ────────────────────────────────────────
        prices_by_year: dict = {}

        for code, state in _BASE_STRIP_CODES.items():

            btn = soup.find('button', class_='contract-btn', attrs={'data-code': code})
            if not btn:
                st.warning(f"Could not find Base Strip table for {state} (code: {code})")
                continue

            outer = btn.find_parent(
                'div',
                class_=lambda c: c and 'shadow-md' in (c if isinstance(c, str) else ' '.join(c))
            )
            if not outer:
                continue

            container = outer.find('div', class_='data-table-container')
            if not container:
                continue

            table = container.find('table')
            tbody = table.find('tbody') if table else None
            if not tbody:
                continue

            # Columns: Period | Bid | Ask | Last | +/- | Vol | Settle (index 6)
            for row in tbody.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) < 7:
                    continue

                label = cells[0].get_text(strip=True)   # e.g. "FY27", "CY27"
                if not label.startswith('FY'):
                    continue                              # skip CY strips

                try:
                    year = int('20' + label[2:])         # FY27 → 2027, FY28 → 2028, FY29 → 2029
                except (ValueError, IndexError):
                    continue

                settle_text = cells[6].get_text(strip=True)
                if settle_text == '-' or not settle_text:
                    continue

                try:
                    price = round(float(settle_text), 2)
                    prices_by_year.setdefault(year, {})[state] = price
                except ValueError:
                    continue

        # ── Build DataFrame ────────────────────────────────────────────────────
        rows = []
        for year in sorted(prices_by_year):
            sd      = prices_by_year[year]
            missing = [s for s in ('NSW', 'VIC', 'QLD', 'SA') if s not in sd]
            if missing:
                st.warning(f"Year {year} missing data for {missing} — row skipped.")
                continue
            rows.append({
                'Quote Date': quote_date,
                'Year':       year,
                'NSW':        sd['NSW'],
                'VIC':        sd['VIC'],
                'QLD':        sd['QLD'],
                'SA':         sd['SA'],
            })

        if not rows:
            st.error("No complete year/state data found on the ASX page.")
            return pd.DataFrame()

        return pd.DataFrame(rows)

    except requests.RequestException as e:
        st.error(f"Failed to retrieve ASX page: {e}")
        return pd.DataFrame()
    except Exception as e:
        st.error(f"Unexpected error during scrape: {e}")
        return pd.DataFrame()


# Function to apply escalation factors and format the table for display
def apply_escalation_and_format(df, load_factor, retail_factor):
    # Apply escalation factors
    escalation_columns = ['NSW', 'VIC', 'QLD', 'SA']
    for col in escalation_columns:
        df[col] = df[col]/10 * (load_factor) * (retail_factor)
        df[col] = df[col].round(2)  # Format to two decimal places
    
    # Format the instrument_year column to remove commas (if displayed as string with commas)
    df['Year'] = df['Year'].apply(lambda x: f"{x:.0f}")
    
    return df

# Apply formatting for two decimal places to the main and sidebar tables
def format_data(df):
    decimal_columns = ['NSW', 'VIC', 'QLD', 'SA']
    for col in decimal_columns:
        df[col] = df[col].astype(float).round(2)
    
    # Ensure 'instrument_year' is numeric before formatting
    df['Year'] = pd.to_numeric(df['Year'], errors='coerce').fillna(0).astype(int)
    df['Year'] = df['Year'].apply(lambda x: f"{x}")

    return df

def update_escalated_data(load, retail):
    if not st.session_state['fetched_data'].empty:
        st.session_state['updated_df'] = apply_escalation_and_format(
            st.session_state['fetched_data'].copy(), load, retail
        )


#########################################################################################################
#########################################################################################################
# SIDEBAR BOXES
#########################################################################################################
#########################################################################################################

# Function to calculate off-peak consumption
def calculate_off_peak(peak_consumption, shoulder_consumption):
    return 100 - peak_consumption - shoulder_consumption

# Function to create input boxes for various charges
def create_input_boxes():
    with st.sidebar:
        with st.expander("Consumption Data"):
            total_consumption = st.number_input("Total Consumption (MWh)", min_value=0.00, value=400000.00, format="%.2f", step=10000.00)
            peak_consumption = st.number_input("Peak Consumption (%)", value=50.00, format="%.2f", min_value=0.00, max_value=100.00, step=1.0)
            shoulder_consumption = st.number_input("Shoulder Consumption (%)", value=00.00, format="%.2f", min_value=0.00, max_value=100.00, step=1.0)
            off_peak_consumption = calculate_off_peak(peak_consumption, shoulder_consumption)
            st.write(f"Off-Peak Consumption: {off_peak_consumption}%")
            load_factor = st.number_input("Load Factor", format="%.2f", value=0.55)

        with st.expander("Network Charges"):
        
            # Dropdown list for network charges options
            network_options = {
                "Energex 8300": {"Peak Charge": 2.8140, 
                                 "Off-Peak Charge": 2.8140, 
                                 "Shoulder Charge": 2.8140,
                                 "NUOS Charge": 13.4270, 
                                 "Service Availability Charge": 7.7240},

                "Energex 8100": {"Peak Charge": 1.3010, 
                                 "Off-Peak Charge": 1.3010, 
                                 "Shoulder Charge": 1.3010,
                                 "NUOS Charge": 15.7730, 
                                 "Service Availability Charge": 37.7400},

                "BLNT1AO":{"Peak Charge": 20.4161, 
                                "Off-Peak Charge": 8.4967, 
                                "Shoulder Charge": 15.9733,
                                "NUOS Charge": 0.0000, 
                                "Service Availability Charge": 2.2229},

                "BLND3AO":{"Peak Charge": 6.1763, 
                                "Off-Peak Charge": 3.2273, 
                                "Shoulder Charge": 4.9580,
                                "NUOS Charge": 0.0000, 
                                "Service Availability Charge": 20.8017},
                                
            }

            selected_network = st.selectbox("Select Network", list(network_options.keys()))

            # Set default values based on selected network
            default_values = network_options[selected_network]

            peak_charge = st.number_input("Peak Charge (c/kWh)", format="%.2f", value=default_values["Peak Charge"])
            off_peak_charge = st.number_input("Off-Peak Charge (c/kWh)", format="%.2f", value=default_values["Off-Peak Charge"])
            shoulder_charge = st.number_input("Shoulder Charge (c/kWh)", format="%.2f", value=default_values["Shoulder Charge"])
            nuos_charge = st.number_input("NUOS Charge ($/kVA)", format="%.2f", value=default_values["NUOS Charge"], step=1.0)
            service_availability_charge = st.number_input("Service Availability Charge ($/day)", format="%.2f", value=default_values["Service Availability Charge"])


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
            metering_charge = st.number_input("Metering Charge ($/month)", format="%.2f", value=metering, step=1.0)
            retail_service_charge = st.number_input("Retail Service Charge ($/month)", format="%.2f", value=retail_service, step=1.0)
            admin_charge = st.number_input("Admin Charge ($/month)", format="%.2f", value=admin, step=1.0)

        with st.expander('Escalation Factors'):
            load = st.number_input('Load Escalation Factor', value=1.15, key="load_factor")
            retail = st.number_input('Retail Escalation Factor', value=1.15, key="retail_factor")

    # Automatically update escalated data when the factors change
    if 'load_factor' in st.session_state and 'retail_factor' in st.session_state:
        update_escalated_data(st.session_state['load_factor'], st.session_state['retail_factor'])

    # Store all input values in session state for use in calculations
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

#########################################################################################################
#########################################################################################################
# CALCULATE BULK PRICES
#########################################################################################################
#########################################################################################################

# Function to display summary tables vertically
def calculate_bulk_prices():

    global energy_rates, summary_of_consumption, summary_of_charges, summary_of_costs, summary_of_rates, selected_state, bulk_price

    selected_state = st.selectbox(
        "Select State",
        ["NSW", "QLD", "VIC", "SA"],
        key='selected_state'
    )

    energy_rates = pd.DataFrame({
        'Tariffs & Factors': [
                            'Peak Tariff (c/kWh)',
                            'Shoulder Tariff (c/kWh)',
                            'Off Peak Tariff (c/kWh)',
                            'Transmission Loss Factor',
                            'Distribution Loss Factor',
                            'Net Loss Factor (NLF)',
                            'Peak Tariff (Adj for Losses) (c/kWh)',
                            'Shoulder Tariff (Adj for Losses) (c/kWh)',
                            'Off Peak Tariff (Adj for Losses) (c/kWh)'],
                                'Year 1': [0.0] * 9, 'Year 2': [0.0] * 9, 'Year 3': [0.0] * 9, 'Average': [0.0] * 9,
                                })

    summary_of_consumption = pd.DataFrame({
    'Energy Consumption': [
                            'Total Consumption (kWh)',
                            'Peak Consumption (kWh)',
                            'Shoulder Consumption (kWh)',
                            'Off Peak Consumption (kWh)',
                            'Load Factor',
                            'Avg. Monthly Peak Demand (kVA)'],
                                'Year 1': [0.0] * 6, 'Year 2': [0.0] * 6, 'Year 3': [0.0] * 6, 'Average': [0.0] * 6,
                                })

    summary_of_charges = pd.DataFrame({
        'Costs per Unit': [
                         'Peak Energy Charge (c/kWh)', 
                         'Shoulder Energy Charge (c/kWh)', 
                         'Off Peak Energy Charge (c/kWh)', 
                         'Peak Demand Charge ($/kVA)',
                         'Network Volume Charge (c/kWh)', 
                         'Other Volume Charge (c/kWh)', 
                         'Fixed Charge ($/day)'],
                                'Year 1': [0.0] * 7, 'Year 2': [0.0] * 7, 'Year 3': [0.0] * 7, 'Average': [0.0] * 7,
                            })

    summary_of_costs = pd.DataFrame({
        'Annual Costs': [
                            'Peak Energy Costs ($/year)', 
                            'Shoulder Energy Costs ($/year)', 
                            'Off Peak Energy Costs ($/year)',
                            'Peak Demand Costs ($/year)', 
                            'Network Volume Costs ($/year)', 
                            'Other Volume Costs ($/year)', 
                            'Fixed Costs ($/year)', 
                            'Total Costs ($/year)', 
                            'kWh/year',
                            'Bundled Bulk Cost ($/kWh)'],
                                'Year 1': [0.0] * 10, 'Year 2': [0.0] * 10, 'Year 3': [0.0] * 10, 'Average': [0.0] * 10,
                            })

    summary_of_rates = pd.DataFrame({
        'Rates Summary': [
                          'Energy ($/kWh)', 
                          'Network ($/kWh)', 
                          'Other ($/kWh)', 
                          'Fixed ($/kWh)', 
                          'Total ($/kWh)'],
                                'Year 1': [0.0] * 5, 'Year 2': [0.0] * 5, 'Year 3': [0.0] * 5, 'Average': [0.0] * 5,
                            })

    if not st.session_state['updated_df'].empty:

        # How many FY years were returned by the scraper (typically 3: FY27, FY28, FY29).
        # iloc_idx clamps Year 3 to the last available row as a safety net
        # in case fewer than 3 rows are returned on any given day.
        num_available = len(st.session_state['updated_df'])

        for year in range(1, 4):

            iloc_idx = min(year - 1, num_available - 1)

            # Summary of Rates

            peak_rate     = st.session_state['updated_df'][selected_state].iloc[iloc_idx]
            shoulder_rate = st.session_state['updated_df'][selected_state].iloc[iloc_idx]
            off_peak_rate = st.session_state['fetched_data'][selected_state].iloc[iloc_idx] / 10
            
            # Calculate other factors
            transmission_loss_factor = 1.00860
            distribution_loss_factor = 1.04344
            net_loss_factor          = transmission_loss_factor * distribution_loss_factor
            peak_energy_adj          = peak_rate     * net_loss_factor
            shoulder_energy_adj      = shoulder_rate * net_loss_factor
            off_peak_energy_adj      = off_peak_rate * net_loss_factor

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

            
            # Summary of Consumption

            total_consumption            = st.session_state['calculation_results'].get('total_consumption', 0)
            load_factor                  = st.session_state['calculation_results'].get('load_factor', 0)
            peak_consumption_percentage  = st.session_state['calculation_results'].get('peak_consumption', 0)
            shoulder_consumption_percentage = st.session_state['calculation_results'].get('shoulder_consumption', 0)
            off_peak_consumption_percentage = st.session_state['calculation_results'].get('off_peak_consumption', 0)
            peak_demand                  = total_consumption / 8760 / load_factor

            peak_consumption     = total_consumption * (peak_consumption_percentage / 100)
            shoulder_consumption = total_consumption * (shoulder_consumption_percentage / 100)
            off_peak_consumption = total_consumption * (off_peak_consumption_percentage / 100)

            summary_of_consumption.at[0, f'Year {year}'] = total_consumption
            summary_of_consumption.at[1, f'Year {year}'] = peak_consumption
            summary_of_consumption.at[2, f'Year {year}'] = shoulder_consumption
            summary_of_consumption.at[3, f'Year {year}'] = off_peak_consumption
            summary_of_consumption.at[4, f'Year {year}'] = load_factor
            summary_of_consumption.at[5, f'Year {year}'] = peak_demand


            # Summary of Charges

            peak_volume    = st.session_state['calculation_results'].get('nuos_charge', 0)
            network_volume = st.session_state['calculation_results'].get('peak_charge', 0)
            ancillary      = st.session_state['calculation_results'].get('aemo_ancillary_services_charge', 0)
            participant    = st.session_state['calculation_results'].get('aemo_participant_charge', 0)
            srec           = st.session_state['calculation_results'].get('srec_charge', 0)
            lrec           = st.session_state['calculation_results'].get('lrec_charge', 0)
            service        = st.session_state['calculation_results'].get('service_availability_charge', 0)
            metering       = st.session_state['calculation_results'].get('metering_charge', 0)
            retail         = st.session_state['calculation_results'].get('retail_service_charge', 0)
            admin          = st.session_state['calculation_results'].get('admin_charge', 0)

            other_volume = participant + ancillary + srec + lrec
            fixed        = service + ((metering + retail + admin) / 30)

            summary_of_charges.at[0, f'Year {year}'] = peak_energy_adj
            summary_of_charges.at[1, f'Year {year}'] = shoulder_energy_adj
            summary_of_charges.at[2, f'Year {year}'] = off_peak_energy_adj
            summary_of_charges.at[3, f'Year {year}'] = peak_volume
            summary_of_charges.at[4, f'Year {year}'] = network_volume
            summary_of_charges.at[5, f'Year {year}'] = other_volume
            summary_of_charges.at[6, f'Year {year}'] = fixed


            # Summary of Costs

            peak_energy_costs     = peak_consumption     * (peak_energy_adj     / 100)
            shoulder_energy_costs = shoulder_consumption * (shoulder_energy_adj / 100)
            off_peak_energy_costs = off_peak_consumption * (off_peak_energy_adj / 100)
            peak_demand_costs     = peak_demand * peak_volume * 12
            network_volume_costs  = total_consumption * (network_volume / 100)
            other_volume_costs    = total_consumption * (other_volume   / 100)
            fixed_costs           = fixed * 365
            total_costs           = (peak_energy_costs + shoulder_energy_costs +
                                     off_peak_energy_costs + peak_demand_costs +
                                     network_volume_costs + other_volume_costs + fixed_costs)
            bundled_cost          = total_costs / total_consumption

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

            # Summary of Rates
            energy  = (peak_energy_costs + shoulder_energy_costs + off_peak_energy_costs) / total_consumption
            network = (peak_demand_costs + network_volume_costs) / total_consumption
            other   = (other_volume_costs) / total_consumption
            fixed   = (fixed_costs) / total_consumption
            total   = (energy + network + other + fixed)

            summary_of_rates.at[0, f'Year {year}'] = float(energy)
            summary_of_rates.at[1, f'Year {year}'] = float(network)
            summary_of_rates.at[2, f'Year {year}'] = float(other)
            summary_of_rates.at[3, f'Year {year}'] = float(fixed)
            summary_of_rates.at[4, f'Year {year}'] = float(total)

    # Calculate the average across Years 1 through 3 for the Average column
    def calculate_year_4_average(df):
        for factor in range(len(df)):
            year_values   = [df.at[factor, f'Year {year}'] for year in range(1, 4)]
            average_value = sum(year_values) / len(year_values)
            df.at[factor, 'Average'] = average_value

    # Apply the function to each DataFrame
    calculate_year_4_average(energy_rates)
    calculate_year_4_average(summary_of_consumption)
    calculate_year_4_average(summary_of_charges)
    calculate_year_4_average(summary_of_costs)
    calculate_year_4_average(summary_of_rates)

    bulk_price = summary_of_rates.at[4, 'Average']

    return energy_rates, summary_of_consumption, summary_of_charges, summary_of_costs, summary_of_rates, selected_state, bulk_price


#########################################################################################################
#########################################################################################################
# DISPLAY SUMMARY TABLES
#########################################################################################################
#########################################################################################################

def display_summary_tables(energy_rates, summary_of_consumption, summary_of_charges, summary_of_costs, summary_of_rates, selected_state):

    def create_table_figure(dataframe, font_size=14, cell_height=25):
        formats    = []
        alignments = []

        for i, col in enumerate(dataframe.columns):
            if pd.api.types.is_numeric_dtype(dataframe[col]):
                formats.append(',.2f' if i > 0 else '0')
                alignments.append('right')
            else:
                formats.append('')
                alignments.append('center' if i == 0 else 'right')

        total_height = cell_height * (len(dataframe) + 1)

        fig = go.Figure()
        fig.add_trace(go.Table(
            header=dict(values=list(dataframe.columns),
                        font=dict(size=18, color=['#006FE7'] + ['#006FE7'] * (len(dataframe.columns) - 1)),
                        fill_color='yellow',
                        height=cell_height,
                        line=dict(width=1, color='blue'),
                        align='center'),
            cells=dict(values=dataframe.values.T,
                       font=dict(size=[16] + [font_size], color=['yellow'] + ['#006FE7'] * (len(dataframe.columns) - 1)),
                       fill_color=['#006FE7'] + ['white'],
                       height=cell_height,
                       line=dict(width=1, color='#006FE7'),
                       format=formats,
                       align=alignments,
                       ),
            columnwidth=[font_size] + [font_size / 3] * (len(dataframe.columns) - 1),
        ))

        fig.update_layout(
            margin=dict(l=0, r=0, t=0, b=0),
            height=total_height
        )

        return fig

    def create_rates_figure(dataframe, font_size=14, cell_height=25):
        formats    = []
        alignments = []

        for i, col in enumerate(dataframe.columns):
            if pd.api.types.is_numeric_dtype(dataframe[col]):
                formats.append(',.4f' if i > 0 else '0')
                alignments.append('right')
            else:
                formats.append('')
                alignments.append('center' if i == 0 else 'right')

        total_height = cell_height * (len(dataframe) + 1)

        fig = go.Figure()
        fig.add_trace(go.Table(
            header=dict(values=list(dataframe.columns),
                        font=dict(size=18, color=['#006FE7'] + ['#006FE7'] * (len(dataframe.columns) - 1)),
                        fill_color='yellow',
                        height=cell_height,
                        line=dict(width=1, color='blue'),
                        align='center'),
            cells=dict(values=dataframe.values.T,
                       font=dict(size=[16] + [font_size], color=['yellow'] + ['#006FE7'] * (len(dataframe.columns) - 1)),
                       fill_color=['#006FE7'] + ['white'],
                       height=cell_height,
                       line=dict(width=1, color='#006FE7'),
                       format=formats,
                       align=alignments,
                       ),
            columnwidth=[font_size] + [font_size / 3] * (len(dataframe.columns) - 1),
        ))

        fig.update_layout(
            margin=dict(l=0, r=0, t=0, b=0),
            height=total_height
        )
        return fig

    expander_consumption = st.expander("**Energy Consumption**", expanded=True)
    with expander_consumption:
       st.plotly_chart(create_table_figure(summary_of_consumption, font_size=16, cell_height=35), use_container_width=True)

    expander_rates = st.expander("**Bulk Electricity Prices**", expanded=False)
    with expander_rates:
       st.plotly_chart(create_rates_figure(summary_of_rates, font_size=16, cell_height=35), use_container_width=True)

    expander_costs = st.expander("**Yearly Costs**", expanded=False)
    with expander_costs:
       st.plotly_chart(create_table_figure(summary_of_costs, font_size=16, cell_height=35), use_container_width=True)

    expander_tariffs = st.expander("**Tariffs & Factors**", expanded=False)
    with expander_tariffs:
       st.plotly_chart(create_rates_figure(energy_rates, font_size=16, cell_height=35), use_container_width=True)

    expander_charges = st.expander("**Charges**", expanded=False)
    with expander_charges:
       st.plotly_chart(create_rates_figure(summary_of_charges, font_size=16, cell_height=35), use_container_width=True)

    return


#########################################################################################################
#########################################################################################################
# DATABASE FUNCTIONS
#########################################################################################################
#########################################################################################################

# Function to create a database connection
def create_connection(db_file):
    conn = None
    try:
        conn = sqlite3.connect(db_file)
    except sqlite3.Error as e:
        st.error(f"Error connecting to database {db_file}: {e}")
    return conn

# Function to create the table if it doesn't exist
def create_futures_table_if_not_exists(db_file, table_name):
    conn = create_connection(db_file)
    if conn is not None:
        create_table_query = f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                `Quote Date` DATE,
                `Year` INTEGER,
                `NSW` REAL,
                `VIC` REAL,
                `QLD` REAL,
                `SA` REAL,
                PRIMARY KEY (`Quote Date`, `Year`)
            );
        """
        try:
            conn.execute(create_table_query)
            conn.commit()
        except sqlite3.Error as e:
            st.error(f"Error creating table: {e}")
        finally:
            conn.close()

def save_to_sql_database(df, db_file, table_name='futures_data'):
    """Save DataFrame to SQL database, appending new entries and skipping duplicates, with 'Year' formatted as integer."""
    
    create_futures_table_if_not_exists(db_file, table_name)

    conn = create_connection(db_file)
    if conn is not None:
        cursor         = conn.cursor()
        data_appended  = False

        for index, row in df.iterrows():
            quote_date = row['Quote Date']
            year       = row['Year']
            
            query = f"SELECT COUNT(*) FROM {table_name} WHERE `Quote Date` = ? AND `Year` = ?"
            cursor.execute(query, (quote_date, year))
            exists = cursor.fetchone()[0]

            if exists == 0:
                row.to_frame().T.to_sql(table_name, conn, if_exists='append', index=False)
                data_appended = True

        conn.close()

        if data_appended:
            st.sidebar.success("New futures data appended to database successfully.")
        else:
            st.sidebar.info("No new futures data was appended to the database (all data already exists).")
    else:
        st.error("Connection to database failed.")


def create_bulk_price_index_table_if_not_exists(db_file, table_name='bulk_price_index'):
    conn = create_connection(db_file)
    if conn is not None:
        create_table_query = f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                "Quote Date" DATE PRIMARY KEY,
                "NSW" REAL,
                "QLD" REAL,
                "VIC" REAL,
                "SA" REAL
            );
        """
        try:
            conn.execute(create_table_query)
            conn.commit()
        except sqlite3.Error as e:
            st.error(f"Error creating table: {e}")
        finally:
            conn.close()


def save_bulk_prices_db(bulk_price_index_df, db_file, table_name='bulk_price_index'):
    create_bulk_price_index_table_if_not_exists(db_file, table_name)
    
    conn = create_connection(db_file)
    if conn is not None:
        try:
            bulk_price_index_df.to_sql(table_name, conn, if_exists='append', index=False, method="multi")
            st.success("Bulk Price Index data saved to database successfully.")
        except Exception as e:
            st.error(f"Error saving data to database: {e}")
        finally:
            conn.close()
    else:
        st.error("Connection to database failed.")


#########################################################################################################
#########################################################################################################
# STREAMLIT INTERFACE
#########################################################################################################
#########################################################################################################

st.set_page_config(
    page_title='HUMQuote - Bulk Electricity Pricing', 
    page_icon='⚡', 
    initial_sidebar_state="auto",
    layout='wide',
    menu_items={
        'Get Help': 'https://www.humenergy.com.au/',
        'Report a bug': "https://www.humenergy.com.au/contact",
        'About': "# Bulk Electricity Pricing tool for Large Contracts"
    }
)

st.image("hum-solar-header.jpg", use_container_width=True)

st.title("⚡ Bulk Electricity Pricing for Large Contracts")

# Apply custom CSS for table styling
st.markdown("""
    <style>
        .stPlotlyTable {
            border-style: dotted;
            border-width: 1px;
            border-color: blue;
        }
        table {
            border-collapse: collapse;
            width: 100%;
        }
        table, th, td {
            border: 1px dotted blue;
        }
    </style>
""", unsafe_allow_html=True)


# Initialise session state for fetched data and updated data if not already set
if 'fetched_data' not in st.session_state:
    st.session_state['fetched_data'] = pd.DataFrame()
if 'updated_df' not in st.session_state:
    st.session_state['updated_df'] = pd.DataFrame()

# Fetch button and display the fetched data in the sidebar
st.sidebar.header("Latest ASX Futures Data")

if st.sidebar.button('Fetch Data'):
    fetched_data = scrape_and_save()

    # Only update session state and DB if valid data was returned.
    # scrape_and_save() returns an empty DataFrame on weekends or errors,
    # which prevents stale or duplicate data entering the database.
    if not fetched_data.empty:
        st.session_state['fetched_data'] = fetched_data.set_index('Quote Date')
        st.session_state['data_fetched'] = True

        save_to_sql_database(fetched_data, 'futures_prices.db')

        if 'bulk_price_index_df' in st.session_state and not st.session_state['bulk_price_index_df'].empty:
            bulk_price_index_df = st.session_state['bulk_price_index_df']
            save_bulk_prices_db(bulk_price_index_df, 'bulk_price_tracker.db', 'bulk_price_index')

        update_escalated_data(st.session_state['load_factor'], st.session_state['retail_factor'])

# Display formatted fetched data in the sidebar
if not st.session_state['fetched_data'].empty:
    formatted_sidebar_df = format_data(st.session_state['fetched_data'].copy())
    st.sidebar.dataframe(formatted_sidebar_df)

create_input_boxes()


if not st.session_state['updated_df'].empty:

    update_escalated_data(st.session_state['load_factor'], st.session_state['retail_factor'])

    calculate_bulk_prices()

    c1, c2 = st.columns(2)

    with st.container():
        c1.write(f'<h3 style="text-align: center;">Bulk Electricity Price</h3>', unsafe_allow_html=True)
        c2.write(f'<h3 style="text-align: center;">Bulk Electricity Price Breakdown</h3>', unsafe_allow_html=True)

    with c1:
        formatted_price = "{:.4f}".format(bulk_price)
        st.markdown(
            f"""
            <div style="
                display: flex;
                justify-content: center;
                align-items: center;
                height: 200px;
            ">
                <h1>$/MWh {formatted_price}</h1>
            </div>
            """,
            unsafe_allow_html=True
        )

    with c2:
        st.table(summary_of_rates.set_index('Rates Summary'))

    st.header(f"Summary for {selected_state}")

    display_summary_tables(energy_rates, summary_of_consumption, summary_of_charges, summary_of_costs, summary_of_rates, selected_state)

    c3, c4 = st.columns(2)

    with st.container():
        c3.write(f"### Peak Electricity Prices (c/kWh)")
        c4.write(f"### Base Electricity Prices (c/kWh)")

    with c3:
        formatted_main_df = format_data(st.session_state['updated_df'].copy())
        st.table(formatted_main_df)

    with c4:
        off_peak_df = st.session_state['fetched_data'].copy()
        off_peak_df.iloc[:,1:5] = off_peak_df.iloc[:,1:5] / 10
        off_peak_df = format_data(off_peak_df)
        st.table(off_peak_df)


    st.write("## Export to Excel")

    peak_df = format_data(st.session_state['updated_df'].copy())

    # Create a BytesIO object to store the Excel file
    excel_buffer = BytesIO()

    # Create an Excel writer
    with pd.ExcelWriter(excel_buffer, engine='xlsxwriter') as writer:
        summary_of_rates.to_excel(writer, sheet_name='Bulk Prices', index=False)
        summary_of_consumption.to_excel(writer, sheet_name='Consumption', index=False)
        summary_of_costs.to_excel(writer, sheet_name='Yearly Costs', index=False)
        energy_rates.to_excel(writer, sheet_name='Energy Rates', index=False)
        summary_of_charges.to_excel(writer, sheet_name='Charges', index=False)
        peak_df.to_excel(writer, sheet_name='Peak Prices', index=True)
        off_peak_df.to_excel(writer, sheet_name='Off-Peak Prices', index=True)

    excel_buffer.seek(0)

    st.download_button(label="📥 Download Excel", 
                       data=excel_buffer, 
                       file_name=f"bulk-electricity-pricing-{selected_state}-{st.session_state['fetched_data'].index[0]}.xlsx",
                       mime="application/vnd.ms-excel")
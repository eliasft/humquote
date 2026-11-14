import sqlite3
from datetime import datetime, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

import humquote_core as core


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

SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
STATE_COLOURS = dict(zip(core.STATE_ORDER, SERIES))
COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed']
RANGES = {'3M': 3, '6M': 6, '1Y': 12, '2Y': 24, 'All': None}

#########################################################################################################
#########################################################################################################
# BULK PRICE TRACKER
#########################################################################################################
#########################################################################################################

st.image("hum-solar-header.jpg", width='stretch')

st.title("💲 Bulk Price Tracker")

#########################################################################################################
#########################################################################################################
# FUNCTIONS
#########################################################################################################
#########################################################################################################


@st.cache_data(ttl=3600, show_spinner=False)
def current_index(carry_rate):
    """
    Current method (humquote_core.bulk_price_index): on every settlement date, the
    reference customer's price for a three-year contract starting the next quarter,
    on the tariff each state's default network suggests for it. carry_rate (% a year) prices
    months beyond the last listed contract.
    """
    fy_rows, strip_rows = core.read_futures_db('futures_prices.db')
    return core.bulk_price_index(core.build_curves(fy_rows, strip_rows), carry_rate)


def calculate_bulk_price_index(db_path='futures_prices.db'):
    """Original method: fixed network and system charges, and the average of whichever FY strips were listed."""
    conn = sqlite3.connect(db_path)
    states = ["NSW", "VIC", "QLD", "SA"]
    results = []

    for state in states:
        query = f"SELECT `Quote Date`, AVG(`{state}`) as `Peak Rate` FROM futures_data GROUP BY `Quote Date` ORDER BY `Quote Date` DESC"
        df = pd.read_sql_query(query, conn)

        if df.empty:
            continue

        for _, row in df.iterrows():
            quote_date = row['Quote Date']
            peak_rate = row['Peak Rate'] / 10
            off_peak_rate = peak_rate * 0.85  # 85% of the peak_rate

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


def save_bulk_price_index_to_db(bulk_price_index_df, db_path='bulk_price_index.db'):
    conn = sqlite3.connect(db_path)
    bulk_price_index_df.to_sql('bulk_price_index', conn, if_exists='replace', index=False)
    conn.close()


def initialize_data():
    if 'bulk_price_index' not in st.session_state:
        st.session_state['bulk_price_index'] = calculate_bulk_price_index(db_path='futures_prices.db')
        save_bulk_price_index_to_db(st.session_state['bulk_price_index'])


def cutoff_for(range_key, latest):
    months = RANGES[range_key]
    if not months:
        return None
    d = datetime.strptime(latest, '%Y-%m-%d')
    return (d - timedelta(days=round(months * 30.44))).strftime('%Y-%m-%d')


def state_tiles(df):
    """Latest index per state, and its change over 30 days."""
    last = df.iloc[-1]
    month_ago = (datetime.strptime(last['Quote Date'], '%Y-%m-%d') - timedelta(days=30)).strftime('%Y-%m-%d')
    before = df[df['Quote Date'] <= month_ago]
    for col, s in zip(st.columns(4), core.STATE_ORDER):
        delta = f"{last[s] - before.iloc[-1][s]:+.4f} vs 30 days ago" if not before.empty else None
        col.metric(s, f"${last[s]:.4f}/kWh", delta, delta_color='inverse', border=True)


def index_chart(df, notes=None):
    fig = go.Figure()
    for s in core.STATE_ORDER:
        fig.add_scatter(
            x=df['Quote Date'], y=df[s], mode='lines', name=s, line=dict(color=STATE_COLOURS[s], width=2),
            customdata=notes if notes is not None else [''] * len(df),
            hovertemplate=f'{s}: $%{{y:.4f}}/kWh%{{customdata}}<extra></extra>',
        )
    fig.update_layout(height=520, hovermode='x unified', yaxis_title='AUD$/kWh', yaxis_tickprefix='$',
                      margin=dict(l=0, r=0, t=10, b=0), legend=dict(orientation='h', y=1.08, x=0))
    return fig


#########################################################################################################
#########################################################################################################
# WORKFLOW
#########################################################################################################
#########################################################################################################

c1, c2 = st.columns([1, 2])
method = c1.segmented_control('Method', ['Current', 'Original'], default='Current',
                              help='Current: a three-year contract from the next quarter, on each state\'s default '
                                   'network\'s suggested tariff. Original: the tracker\'s previous method.') or 'Current'
range_key = c2.segmented_control('Date range', list(RANGES), default='All') or 'All'

if method == 'Current':
    carry_rate = st.number_input(
        'Carry-forward escalation (% a year)', value=core.DEFAULT_CARRY_FORWARD_RATE, step=0.5,
        min_value=-50.0, max_value=50.0, format='%.2f',
        help='Applied to months beyond the last ASX contract listed on each date. '
             'Changing it only affects dates flagged as estimates.')
    index = current_index(carry_rate)
    df = pd.DataFrame([{'Quote Date': p['quote_date'], **p['prices'], 'Estimated': bool(p['estimates'])} for p in index])
    cutoff = cutoff_for(range_key, df['Quote Date'].iloc[-1])
    shown = df[df['Quote Date'] >= cutoff] if cutoff else df

    state_tiles(df)
    st.subheader('Bulk Price Index Over Time')
    st.plotly_chart(index_chart(shown, ['  ⚠️ includes estimated months' if e else '' for e in shown['Estimated']]),
                    width='stretch')
    st.caption(
        f"Reference customer: 400,000 kWh a year, 50% peak, load factor 0.55, low voltage, on the tariff each "
        f"state's default network suggests for it; network charges at the rates in force on each date: Essential "
        f"BLND3AO and Energex 7200 from each financial year's price list, FY22 onwards; VIC and SA are placeholders "
        f"at {core.TARIFF_YEAR} rates. Each date prices a three-year contract starting the next quarter."
    )
    estimated = int(shown['Estimated'].sum())
    if estimated:
        st.warning(f"{estimated} of {len(shown)} dates include estimated months: ASX didn't list a contract for part "
                   f"of the three years, so those months were carried forward (at {carry_rate:g}% a year) or back-filled.", icon='⚠️')

    st.subheader('What makes up the index')
    comp_state = st.segmented_control('State', core.STATE_ORDER, default='NSW', key='components_state') or 'NSW'
    points = [p for p in index if not cutoff or p['quote_date'] >= cutoff]
    fig = go.Figure()
    for i, name in enumerate(COMPONENTS):
        fig.add_scatter(x=[p['quote_date'] for p in points], y=[p['components'][comp_state][i] for p in points],
                        name=name, mode='lines', stackgroup='one', line=dict(width=0.5, color='white'),
                        fillcolor=SERIES[i], hovertemplate=f'{name}: $%{{y:.4f}}/kWh<extra></extra>')
    fig.update_layout(height=380, hovermode='x unified', yaxis_title='AUD$/kWh', yaxis_tickprefix='$',
                      margin=dict(l=0, r=0, t=10, b=0), legend=dict(orientation='h', y=1.1, x=0, traceorder='normal'))
    st.plotly_chart(fig, width='stretch')
    st.caption(f"Network: {core.tariff_label(core.index_inputs(comp_state)['tariff_id'])}.")

    table = df.set_index('Quote Date').sort_index(ascending=False)
    with st.expander("**Historical Bulk Price Index**", expanded=False):
        st.dataframe(table, width='stretch')
    parts = ['energy', 'network', 'other', 'fixed']
    csv_df = pd.DataFrame([{
        'Quote Date': p['quote_date'],
        **{s: p['prices'][s] for s in ['NSW', 'QLD', 'SA', 'VIC']},
        **{f'{s} {part}': p['components'][s][j] for s in ['NSW', 'QLD', 'SA', 'VIC'] for j, part in enumerate(parts)},
        'Estimated periods': ' + '.join(core.estimate_label(e) for e in p['estimates']),
    } for p in reversed(index)])
    st.download_button("Download as CSV", csv_df.to_csv(index=False).encode('utf-8'), "bulk_price_index.csv", "text/csv",
                       key='download-csv')
else:
    initialize_data()
    df = st.session_state['bulk_price_index']
    cutoff = cutoff_for(range_key, str(df['Quote Date'].max()))
    shown = df[df['Quote Date'] >= cutoff] if cutoff else df
    st.subheader('Bulk Price Index Over Time · original method')
    fig = px.line(shown.melt(id_vars=["Quote Date"], value_vars=["NSW", "QLD", "VIC", "SA"],
                             var_name="State", value_name="Bulk Price Index"),
                  x="Quote Date", y="Bulk Price Index", color='State', color_discrete_map=STATE_COLOURS)
    fig.update_layout(height=520, yaxis_title="AUD$/kWh", margin=dict(l=0, r=0, t=10, b=0))
    st.plotly_chart(fig, width='stretch')
    st.caption('400,000 kWh, 50% peak, fixed network and system charges, and the average of whichever FY strips ASX listed that day.')

    table = df.set_index('Quote Date').sort_values(by='Quote Date', ascending=False)
    with st.expander("**Historical Bulk Price Index**", expanded=False):
        st.table(table)
    st.download_button("Download as CSV", table.to_csv(index=True).encode('utf-8'), "historical_bulk_price_index.csv",
                       "text/csv", key='download-csv')

import sqlite3

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import humquote_core as core


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

SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
NO_LONGER_QUOTED = '#b9b7b0'

#########################################################################################################
#########################################################################################################
# FUTURES PRICE TRACKER
#########################################################################################################
#########################################################################################################

st.image("hum-solar-header.jpg", width='stretch')

st.title("📈 Futures Price Tracker")

#########################################################################################################
#########################################################################################################
# FUNCTIONS
#########################################################################################################
#########################################################################################################

def fetch_data_from_database(db_path):
    """FY strip history, newest date first."""
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query("SELECT * FROM futures_data ORDER BY `Quote Date` DESC", conn)
    conn.close()
    return df


def initialize_data():
    if 'futures_data' not in st.session_state:
        st.session_state['futures_data'] = fetch_data_from_database('futures_prices.db')


def display_chart(df, state):
    """One line per FY strip; strips ASX no longer lists are grey."""
    latest = df['Quote Date'].max()
    quoted = sorted(df.loc[df['Quote Date'] == latest, 'Year'].astype(int))
    fig = go.Figure()
    for year in sorted(df['Year'].astype(int).unique()):
        rows = df[df['Year'].astype(int) == year].sort_values('Quote Date')
        active = year in quoted
        colour = SERIES[quoted.index(year) % len(SERIES)] if active else NO_LONGER_QUOTED
        fig.add_scatter(x=rows['Quote Date'], y=rows[state], mode='lines', name=f"FY{str(year)[-2:]}{'' if active else ' (no longer quoted)'}",
                        line=dict(color=colour, width=2 if active else 1.5),
                        hovertemplate=f"FY{str(year)[-2:]}: $%{{y:.2f}}/MWh<extra></extra>")
    fig.update_layout(height=500, hovermode='x unified', yaxis_title='$AUD/MWh', yaxis_tickprefix='$',
                      margin=dict(l=0, r=0, t=10, b=0), title=f"{state} Futures Prices Over Time")
    st.plotly_chart(fig, width='stretch')
    st.caption("Grey strips are no longer quoted: ASX stops listing a financial year once it's in delivery "
               "(or, since its 2026 site change, once its first quarter has passed).")


def display_contracts():
    """Every base contract quoted on the latest date: quarters, calendar years and financial years."""
    fy_rows, strip_rows = core.read_futures_db('futures_prices.db')
    curves = core.build_curves(fy_rows, strip_rows)
    latest = next(reversed(curves))
    st.subheader(f"All contracts quoted on {latest}")
    st.dataframe(pd.DataFrame([{
        'Contract': core.short_contract(c['contract']),
        'Months': core.period_range(c['start'], c['months']),
        **{s: c[s] for s in core.STATE_ORDER},
    } for c in curves[latest]]), hide_index=True, width='stretch',
        column_config={s: st.column_config.NumberColumn(format='%.2f') for s in core.STATE_ORDER})
    st.caption('$/MWh. Quotes use these to price any 12-month supply period. Quarterly and calendar-year '
               'contracts are collected daily from 13 Nov 2026.')


def display_data_table(df):
    table = df.set_index('Quote Date')
    with st.expander("**Historical Futures Data**", expanded=False):
        st.table(table)
    csv = table.to_csv(index=True).encode('utf-8')
    st.download_button("Download as CSV", csv, "historical-futures-data.csv", "text/csv", key='download-csv')


#########################################################################################################
#########################################################################################################
# WORKFLOW
#########################################################################################################
#########################################################################################################

initialize_data()

selected_state = st.selectbox("Select State to plot:", core.STATE_ORDER)

display_chart(st.session_state['futures_data'], selected_state)

display_contracts()

display_data_table(st.session_state['futures_data'])

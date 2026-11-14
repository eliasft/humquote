import sqlite3
from datetime import datetime, timedelta

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

# Chart series: the validated colour-blind-safe palette (five slots for quarters).
SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']
NO_LONGER_QUOTED = '#b9b7b0'
CURVE_STYLES = {'Q': dict(color=SERIES[0], width=3), 'CY': dict(color=SERIES[1], width=2, dash='dash'),
                'FY': dict(color=SERIES[2], width=2)}
KIND_NAMES = {'FY': 'FY', 'CY': 'CY', 'Q': 'Quarters'}
RANGES = {'3M': 3, '6M': 6, '1Y': 12, '2Y': 24, 'All': None}
STRIPS_FROM = '13 Nov 2026'

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

@st.cache_data(ttl=3600, show_spinner=False)
def load_curves():
    """Every contract quoted on each date: FY strips back to 2021, plus CY and quarters from 13 Nov 2026."""
    return core.build_curves(*core.read_futures_db('futures_prices.db'))


def fetch_fy_history(db_path):
    """FY strip history, newest date first (the original CSV download)."""
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query("SELECT * FROM futures_data ORDER BY `Quote Date` DESC", conn)
    conn.close()
    return df


def shift(iso, days):
    return (datetime.strptime(iso, '%Y-%m-%d') + timedelta(days=days)).strftime('%Y-%m-%d')


def cutoff_for(range_key, latest):
    months = RANGES[range_key]
    return shift(latest, -round(months * 30.44)) if months else None


def first_of_month(i):
    return f"{core.month_key(i)}-01"


def display_tiles(history, state, latest):
    """One tile per contract still quoted, with its change over 30 days."""
    active = [c for c in history if c['active']]
    month_ago = shift(latest, -30)
    for col, c in zip(st.columns(max(len(active), 1)), active):
        now = c['points'][-1][state]
        before = [p for p in c['points'] if p['quote_date'] <= month_ago]
        delta = f"{now - before[-1][state]:+.2f} vs 30 days ago" if before else None
        col.metric(f"{core.short_contract(c['contract'])} · {state}", f"${now:,.2f}/MWh", delta, delta_color='inverse',
                   border=True, help=None if before else f"New since {c['points'][0]['quote_date']}")


def display_history(history, kind, state, cutoff):
    """One line per contract of the chosen type; contracts ASX no longer lists are grey."""
    active = [c for c in history if c['active']]
    fig = go.Figure()
    dates = []
    for c in [c for c in history if not c['active']] + active:
        points = [p for p in c['points'] if not cutoff or p['quote_date'] >= cutoff]
        if not points:
            continue
        dates += [p['quote_date'] for p in points]
        colour = SERIES[active.index(c) % len(SERIES)] if c['active'] else NO_LONGER_QUOTED
        name = core.short_contract(c['contract'])
        fig.add_scatter(x=[p['quote_date'] for p in points], y=[p[state] for p in points],
                        mode='lines' if len(points) >= 5 else 'lines+markers',
                        name=name if c['active'] else f'{name} (no longer quoted)',
                        line=dict(color=colour, width=2 if c['active'] else 1.5), marker=dict(size=8),
                        hovertemplate=f"{name}: $%{{y:.2f}}/MWh<extra></extra>")
    xaxis = {}
    if dates and shift(max(dates), -30) < min(dates):
        # Only a few days of history: show a month so the axis reads in days.
        xaxis = dict(range=[shift(min(dates), -7), shift(max(dates), 21)], tickformat='%d %b %Y')
    fig.update_layout(height=500, hovermode='x unified', yaxis_title='$AUD/MWh', yaxis_tickprefix='$', xaxis=xaxis,
                      margin=dict(l=0, r=0, t=40, b=0), title=f"{state} {core.KIND_LABELS[kind].lower()}: settlement prices over time")
    st.plotly_chart(fig, width='stretch')
    if kind == 'FY':
        st.caption("Grey strips are no longer quoted: ASX stops listing a financial year once it's in delivery "
                   "(or, since its 2026 site change, once its first quarter has passed).")
    else:
        days = len({p['quote_date'] for c in history for p in c['points']})
        st.warning(f"{core.KIND_LABELS[kind]} are collected from {STRIPS_FROM}, so there "
                   f"{'is 1 day' if days == 1 else f'are {days} days'} of history so far. Financial years go back to 2021.",
                   icon='⚠️')


def display_forward_curve(curve, state, latest):
    """What the market prices each delivery period at: quarters as steps, CY and FY strips across their 12 months."""
    st.subheader(f"{state} forward curve")
    fig = go.Figure()
    for kind, label, contracts in core.group_by_kind(curve):
        x, y, names = [], [], []
        for c in contracts:
            x += [first_of_month(c['start']), first_of_month(c['start'] + c['months']), None]
            y += [c[state], c[state], None]
            names += [core.short_contract(c['contract'])] * 2 + [None]
        fig.add_scatter(x=x, y=y, customdata=names, mode='lines', name=label, line=CURVE_STYLES[kind],
                        connectgaps=False, hovertemplate=f"%{{customdata}}: $%{{y:.2f}}/MWh<extra>{label}</extra>")
    fig.update_layout(height=380, hovermode='closest', yaxis_title='$AUD/MWh', yaxis_tickprefix='$',
                      xaxis=dict(type='date', tickformat='%b %Y'), margin=dict(l=0, r=0, t=10, b=0),
                      legend=dict(orientation='h', y=1.1, x=0))
    st.plotly_chart(fig, width='stretch')
    st.caption(f"Quoted on {latest}. Quarters are steps; calendar- and financial-year strips span their 12 months. "
               "A quote prices each year from a matching strip, or from its quarters.")


def display_contracts(curve, latest):
    """The latest contracts in sections: financial years, calendar years, quarters."""
    st.subheader(f"All contracts quoted on {latest}")
    for kind, label, contracts in core.group_by_kind(curve):
        st.markdown(f"**{label}**")
        st.dataframe(pd.DataFrame([{
            'Contract': core.short_contract(c['contract']),
            'Months': core.period_range(c['start'], c['months']),
            **{s: c[s] for s in core.STATE_ORDER},
        } for c in contracts]), hide_index=True, width='stretch',
            column_config={s: st.column_config.NumberColumn(format='%.2f') for s in core.STATE_ORDER})
    st.caption('$/MWh. Quotes use these to price any 12-month supply period. Calendar years and quarters are '
               f'collected daily from {STRIPS_FROM}.')


def display_history_table(history, cutoff):
    rows = [{'Quote Date': p['quote_date'], 'Contract': core.short_contract(c['contract']), 'Start': c['start'],
             **{s: p[s] for s in core.STATE_ORDER}}
            for c in history for p in c['points'] if not cutoff or p['quote_date'] >= cutoff]
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values(['Quote Date', 'Start'], ascending=[False, False]).drop(columns='Start')
    with st.expander("**Historical Futures Data**", expanded=False):
        st.dataframe(df, hide_index=True, width='stretch',
                     column_config={s: st.column_config.NumberColumn(format='%.2f') for s in core.STATE_ORDER})


def all_contracts_csv(curves):
    rows = [{'Quote Date': date, 'Contract': c['contract'], 'Type': kind, 'Start': core.month_key(c['start']),
             'Months': c['months'], **{s: c[s] for s in core.STATES}}
            for date in reversed(curves) for kind, _, contracts in core.group_by_kind(curves[date]) for c in contracts]
    return pd.DataFrame(rows).to_csv(index=False).encode('utf-8')


#########################################################################################################
#########################################################################################################
# WORKFLOW
#########################################################################################################
#########################################################################################################

curves = load_curves()
latest = next(reversed(curves))

c1, c2, c3 = st.columns([1, 1.2, 1.4])
kind = c1.segmented_control('Contract type', core.KIND_ORDER, format_func=KIND_NAMES.get, default='FY') or 'FY'
state = c2.segmented_control('State', core.STATE_ORDER, default='NSW') or 'NSW'
range_key = c3.segmented_control('Date range', list(RANGES), default='2Y') or '2Y'
cutoff = cutoff_for(range_key, latest)

history = core.contract_history(curves, kind)
display_tiles(history, state, latest)
display_history(history, kind, state, cutoff)
display_history_table(history, cutoff)

d1, d2, _ = st.columns([1, 1, 3])
d1.download_button("FY history CSV", fetch_fy_history('futures_prices.db').set_index('Quote Date').to_csv(index=True).encode('utf-8'),
                   "historical-futures-data.csv", "text/csv", key='download-csv',
                   help='Financial-year strips back to 2021, as before.')
d2.download_button("All contracts CSV", all_contracts_csv(curves), "all-futures-contracts.csv", "text/csv",
                   key='download-all', help='Every contract on every date, with its type.')

display_forward_curve(curves[latest], state, latest)
display_contracts(curves[latest], latest)

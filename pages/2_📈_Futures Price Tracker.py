from datetime import datetime, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import futures_store
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
    """Every contract quoted on each date (see futures_store.py for what was collected when)."""
    return core.load_curves()


@st.cache_data(ttl=3600, show_spinner=False)
def load_estimates():
    """Estimated CY prices for the 2026 gap (only FY strips were collected): chart only."""
    return futures_store.load_estimates()


def estimates_for(estimates, contract, state, cutoff):
    i = 4 + futures_store.STATES.index(state)
    return sorted((r[0], r[i]) for r in estimates if r[1] == contract and (not cutoff or r[0] >= cutoff))


def nice_date(iso):
    return datetime.strptime(iso, '%Y-%m-%d').strftime('%d %b %Y').lstrip('0')


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
    month_ago, window_start = shift(latest, -30), shift(latest, -40)
    for col, c in zip(st.columns(max(len(active), 1)), active):
        now = c['points'][-1][state]
        # A price from 30–40 days ago, so a gap in collection (CY strips, Jun–Nov 2026)
        # doesn't turn into a months-long change labelled "30 days".
        before = [p for p in c['points'] if window_start <= p['quote_date'] <= month_ago]
        delta = f"{now - before[-1][state]:+.2f} vs 30 days ago" if before else None
        first = c['points'][0]['quote_date']
        col.metric(f"{core.short_contract(c['contract'])} · {state}", f"${now:,.2f}/MWh", delta, delta_color='inverse',
                   border=True, help=None if before else
                   f"New since {first}" if first > month_ago else 'No price 30 days ago')


def display_history(history, kind, state, cutoff, estimates):
    """One line per contract of the chosen type; contracts ASX no longer lists are grey.
    Calendar years also get their estimated prices for the 2026 gap, dashed, over a shaded band."""
    active = [c for c in history if c['active']]
    fig = go.Figure()
    dates = []
    est_dates = sorted(r[0] for r in estimates if kind == 'CY' and (not cutoff or r[0] >= cutoff))
    gap = (est_dates[0], est_dates[-1]) if est_dates else None
    for c in [c for c in history if not c['active']] + active:
        points = [p for p in c['points'] if not cutoff or p['quote_date'] >= cutoff]
        if not points:
            continue
        dates += [p['quote_date'] for p in points]
        colour = SERIES[active.index(c) % len(SERIES)] if c['active'] else NO_LONGER_QUOTED
        name = core.short_contract(c['contract'])
        est = estimates_for(estimates, c['contract'], state, cutoff) if kind == 'CY' else []
        solid, dashed = core.split_estimates([(p['quote_date'], p[state]) for p in points], est, gap)
        line = dict(color=colour, width=2 if c['active'] else 1.5)
        # A point with a break (or nothing) on both sides would be invisible as a line.
        lone = [v is not None and (i == 0 or solid[i - 1][1] is None) and (i + 1 == len(solid) or solid[i + 1][1] is None)
                for i, (_, v) in enumerate(solid)]
        fig.add_scatter(x=[d for d, _ in solid], y=[v for _, v in solid], mode='lines+markers',
                        name=name if c['active'] else f'{name} (no longer quoted)',
                        line=line, marker=dict(size=[8 if l or len(points) < 5 else 0 for l in lone]),
                        hovertemplate=f"{name}: $%{{y:.2f}}/MWh<extra></extra>")
        if dashed:
            fig.add_scatter(x=[d for d, _ in dashed], y=[v for _, v in dashed], mode='lines',
                            name=f'{name} (estimated from FY prices)', line=dict(**line, dash='dash'),
                            hovertemplate=f"{name} estimate: $%{{y:.2f}}/MWh<extra></extra>")
    if gap:
        fig.add_vrect(x0=gap[0], x1=gap[1], fillcolor='rgba(120, 117, 100, 0.12)', line_width=0,
                      layer='below', annotation_text='Not collected · estimated', annotation_position='top',
                      annotation_font_size=11)
    xaxis = {}
    if dates and shift(max(dates), -30) < min(dates):
        # Only a few days of history: show a month so the axis reads in days.
        xaxis = dict(range=[shift(min(dates), -7), shift(max(dates), 21)], tickformat='%d %b %Y')
    fig.update_layout(height=500, hovermode='x unified', yaxis_title='$AUD/MWh', yaxis_tickprefix='$', xaxis=xaxis,
                      margin=dict(l=0, r=0, t=40, b=0), title=f"{state} {core.KIND_LABELS[kind].lower()}: settlement prices over time")
    st.plotly_chart(fig, width='stretch')
    days = sorted({p['quote_date'] for c in history for p in c['points']})
    if not days:
        return
    first = nice_date(days[0])
    if kind == 'FY':
        st.caption(f"Financial years are collected from {first}. Before then ASX's page listed calendar years: "
                   "see CY. Grey strips are no longer quoted: ASX stops listing a strip once its first quarter is over.")
    elif kind == 'CY':
        st.caption(f"Calendar years go back to {first} (sparse before 2024). From 22 June to 12 November 2026 only "
                   "financial years were collected (plus every contract on 22 July): the dashed lines estimate CY2027 "
                   "and CY2028 from the FY prices, typically within $1–2/MWh. They're for the chart only and aren't "
                   "used in any price or index. Grey strips are no longer quoted: ASX stops listing a strip once its "
                   "first quarter is over.")
    else:
        st.warning(f"Quarters are collected from {first}, so there "
                   f"{'is 1 day' if len(days) == 1 else f'are {len(days)} days'} of history so far.", icon='⚠️')


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
    st.caption('$/MWh. Quotes use these to price any 12-month supply period.')


def display_history_table(history, kind, cutoff, estimates):
    rows = [{'Quote Date': p['quote_date'], 'Contract': core.short_contract(c['contract']), 'Start': c['start'],
             **{s: p[s] for s in core.STATE_ORDER}}
            for c in history for p in c['points'] if not cutoff or p['quote_date'] >= cutoff]
    if kind == 'CY':
        names = {c['contract']: c for c in history}
        rows += [{'Quote Date': r[0], 'Contract': f"{core.short_contract(r[1])} (estimate)", 'Start': names[r[1]]['start'],
                  **dict(zip(futures_store.STATES, r[4:8]))}
                 for r in estimates if r[1] in names and (not cutoff or r[0] >= cutoff)]
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
estimates = load_estimates()
latest = next(reversed(curves))

c1, c2, c3 = st.columns([1, 1.2, 1.4])
kind = c1.segmented_control('Contract type', core.KIND_ORDER, format_func=KIND_NAMES.get, default='FY') or 'FY'
state = c2.segmented_control('State', core.STATE_ORDER, default='NSW') or 'NSW'
range_key = c3.segmented_control('Date range', list(RANGES), default='2Y') or '2Y'
cutoff = cutoff_for(range_key, latest)

history = core.contract_history(curves, kind)
display_tiles(history, state, latest)
display_history(history, kind, state, cutoff, estimates)
display_history_table(history, kind, cutoff, estimates)

d1, _ = st.columns([1, 4])
d1.download_button("All contracts CSV", all_contracts_csv(curves), "all-futures-contracts.csv", "text/csv",
                   key='download-all', help='Every contract on every date, with its type, start and length.')

display_forward_curve(curves[latest], state, latest)
display_contracts(curves[latest], latest)

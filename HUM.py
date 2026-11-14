import contextlib
import io
from datetime import datetime, timedelta
from urllib.parse import urlencode

import pandas as pd
import plotly.graph_objects as go
import requests
import streamlit as st
from bs4 import BeautifulSoup

import humquote_core as core
import update_db
from humquote_pdf import build_quote_pdf

# HUMQuote: bulk electricity pricing for large contracts.
#
# Prices come from futures_prices.db, which the daily GitHub Action keeps up to
# date (FY strips, plus quarterly and calendar-year contracts from 13 Nov 2026).
# "Fetch latest from ASX" refreshes it from the ASX Energy page on demand.
# The calculations live in humquote_core.py, shared logic with the web versions.

DB_FILE = 'futures_prices.db'

# Chart series: the validated colour-blind-safe palette the web versions use.
SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
COMPONENTS = ['Energy', 'Network', 'Other', 'Fixed']


#########################################################################################################
#########################################################################################################
# MARKET DATA
#########################################################################################################
#########################################################################################################

@st.cache_data(ttl=3600, show_spinner=False)
def load_curves():
    """Every contract quoted on each settlement date: {date: [contract, ...]}."""
    fy_rows, strip_rows = core.read_futures_db(DB_FILE)
    return core.build_curves(fy_rows, strip_rows)


def page_date(soup):
    """The calendar date the ASX page shows (on weekends it still shows Friday's settlements)."""
    pre = soup.find(id='refresh-container-market_date').find('pre')
    first_line = pre.get_text().split('\n')[0].replace('\xa0', '').strip()
    return datetime.strptime(first_line, '%a %d %b %Y').date()


def fetch_from_asx():
    """
    Reads the ASX Energy page and saves its FY strips, quarters and calendar-year
    contracts to the database (rows already there are skipped). On weekends the
    page shows the last trading day's settlements, so they're saved under that date.
    Returns (quote date, was it a weekend), or raises on failure.
    """
    response = requests.get(update_db.ASX_URL, headers=update_db.REQUEST_HEADERS, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    shown = page_date(soup)
    weekend = shown.weekday() >= 5
    quote_date = shown - timedelta(days=shown.weekday() - 4) if weekend else shown

    # update_db logs progress to stdout; keep it out of the app (and away from
    # consoles that can't print its emoji).
    with contextlib.redirect_stdout(io.StringIO()):
        update_db.setup_database_schema(DB_FILE, update_db.TABLE_NAME)
        parsed = update_db.parse_page(soup, quote_date)
        if not parsed:
            raise ValueError('No prices found on the ASX page.')
        fy_df, strips = parsed
        update_db.update_database(fy_df, DB_FILE, update_db.TABLE_NAME)
        update_db.update_strips(strips, DB_FILE)
    return quote_date, weekend


#########################################################################################################
#########################################################################################################
# INPUTS
#########################################################################################################
#########################################################################################################

# Every input lives in st.session_state['in_<name>'], so a tariff, network, voltage
# or state change can fill in the network charges before the widgets are drawn.
# st.session_state['network'] is the network whose tariffs are on offer.

def _set_tariff(tariff):
    for key, value in core.apply_tariff({}, tariff).items():
        st.session_state[f'in_{key}'] = value
    st.session_state['network'] = tariff['network']


def _site_mwh():
    return st.session_state['in_total_consumption'] / 1000


def init_inputs():
    """Defaults on first load, or the quote in a share link (?v=2&s=QLD&tc=...)."""
    if st.session_state.get('inputs_ready'):
        return
    inputs, state = core.DEFAULT_INPUTS, 'NSW'
    shared = core.decode_quote(st.query_params) if 's' in st.query_params else None
    if shared:
        inputs, state = shared
        # Tidy the address so a reload doesn't look like an unchanged shared quote.
        st.query_params.clear()
        st.toast('Opened a shared quote')
    for key, value in inputs.items():
        st.session_state[f'in_{key}'] = value
    st.session_state['network'] = core.tariff_by_id(inputs['tariff_id'])['network']
    st.session_state['selected_state'] = state
    st.session_state['_last_state'] = state
    st.session_state['inputs_ready'] = True


def share_url(inputs, state):
    """A link that reopens this quote (same parameters as version B's share links)."""
    base = (st.context.url or '').split('?')[0]
    return f"{base}?{urlencode(core.encode_quote(inputs, state))}"


def current_inputs():
    return {key: st.session_state[f'in_{key}'] for key in core.DEFAULT_INPUTS}


def on_state_change():
    state = st.session_state['selected_state']
    if state is None:  # clicking the selected state again deselects it; keep it
        st.session_state['selected_state'] = st.session_state['_last_state']
        return
    st.session_state['_last_state'] = state
    # A tariff only applies in its own state: switch to the tariff the state's
    # default network suggests for the site.
    if core.tariff_state(st.session_state['in_tariff_id']) != state:
        tariff = core.suggest_tariff(core.default_network(state)['id'], _site_mwh(), st.session_state['in_voltage'])
        _set_tariff(tariff)
        st.toast(f"Network tariff changed to {core.tariff_label(tariff['id'])} for {state}")


def use_state_default_network():
    state = st.session_state['selected_state']
    _set_tariff(core.suggest_tariff(core.default_network(state)['id'], _site_mwh(), st.session_state['in_voltage']))


def on_voltage_change():
    if st.session_state['in_voltage'] is None:  # clicking the selected voltage again deselects it; keep it
        st.session_state['in_voltage'] = core.tariff_by_id(st.session_state['in_tariff_id'])['voltage']
        return
    # A tariff is for one voltage, so changing it picks the network's tariff for the site.
    _set_tariff(core.suggest_tariff(st.session_state['network'], _site_mwh(), st.session_state['in_voltage']))


def on_network_change():
    _set_tariff(core.suggest_tariff(st.session_state['network'], _site_mwh(), st.session_state['in_voltage']))


def use_suggested_tariff():
    _set_tariff(core.suggest_tariff(st.session_state['network'], _site_mwh(), st.session_state['in_voltage']))


def on_tariff_change():
    _set_tariff(core.tariff_by_id(st.session_state['in_tariff_id']))


def restore_tariff():
    _set_tariff(core.tariff_by_id(st.session_state['in_tariff_id']))


def reset_inputs():
    defaults = core.inputs_for_state(core.DEFAULT_INPUTS, st.session_state['selected_state'])
    for key, value in defaults.items():
        st.session_state[f'in_{key}'] = value
    st.session_state['network'] = core.tariff_by_id(defaults['tariff_id'])['network']


def number(label, key, fmt='%.2f', step=None, min_value=None, max_value=None, help=None):
    st.number_input(label, key=f'in_{key}', format=fmt, step=step, min_value=min_value, max_value=max_value, help=help)


def create_input_boxes(state, latest_date):
    with st.sidebar:
        st.button('Reset inputs', on_click=reset_inputs, width='stretch')

        with st.expander('Contract', expanded=True):
            first = core.next_quarter(latest_date)
            # The next quarter by default, or any month in the next three years.
            options = ['auto'] + [core.month_key(m) for m in range(core.month_index(latest_date) + 1, core.month_index(latest_date) + 37)
                                  if m != first]
            if st.session_state['in_supply_start'] not in options:
                options.append(st.session_state['in_supply_start'])
            st.selectbox(
                'Supply start', options, key='in_supply_start',
                format_func=lambda v: f'Next quarter ({core.month_label(first)})' if v == 'auto' else core.month_label(core.month_index(v)),
                help='Three 12-month periods from this date. A start part-way through a quarter weights each part quarter by its days.',
            )
            number('Carry-forward escalation (% a year)', 'carry_forward_rate', step=0.5,
                   help='An assumption, used only for months beyond the last listed ASX contract. '
                        'Those periods are flagged as estimates.')

        with st.expander('Consumption Data'):
            number('Total Consumption (kWh)', 'total_consumption', step=10000.0, min_value=0.0)
            number('Peak Consumption (%)', 'peak_consumption', step=1.0, min_value=0.0, max_value=100.0)
            number('Shoulder Consumption (%)', 'shoulder_consumption', step=1.0, min_value=0.0, max_value=100.0)
            off_peak = 100 - st.session_state['in_peak_consumption'] - st.session_state['in_shoulder_consumption']
            st.write(f'Off-Peak Consumption: {off_peak:.2f}%')
            number('Load Factor', 'load_factor', step=0.01)

        tariff = core.tariff_by_id(st.session_state['in_tariff_id'])
        t_state = core.tariff_state(tariff['id'])
        mismatch = t_state != state
        issues = [] if mismatch else core.fit_issues(tariff, _site_mwh(), st.session_state['in_voltage'])
        with st.expander('Network Charges', expanded=tariff['status'] == 'placeholder' or mismatch or bool(issues)):
            st.segmented_control('Connection voltage', [v for v, _ in core.VOLTAGES], key='in_voltage',
                                 format_func=dict(core.VOLTAGES).get, on_change=on_voltage_change)
            networks = [n['id'] for n in core.networks_for(state)]
            if st.session_state['network'] not in networks:
                st.session_state['network'] = core.default_network(state)['id']
            st.selectbox(
                f'Network · {state}', networks, key='network', on_change=on_network_change,
                format_func=lambda n: core.network_by_id(n)['name']
                + (' (placeholder tariffs)' if all(t['status'] == 'placeholder' for t in core.tariffs_of(n)) else ''),
            )
            options = [t['id'] for t in core.tariffs_of(st.session_state['network'])]
            if st.session_state['in_tariff_id'] not in options:
                options.append(st.session_state['in_tariff_id'])

            def option_label(i):
                t = core.tariff_by_id(i)
                if core.tariff_state(i) != state:
                    return f'{core.tariff_label(i)} (other state)'
                return core.tariff_option_label(t) + (" (doesn't fit this site)" if core.fit_issues(t, _site_mwh(), st.session_state['in_voltage']) else '')

            st.selectbox(
                'Tariff code', options, key='in_tariff_id', on_change=on_tariff_change, format_func=option_label,
                help=f"As shown on the site's bill. {core.TARIFF_YEAR} rates; choosing a tariff fills in its network charges.",
            )
            if mismatch:
                st.error(f'This tariff is for {t_state}, but the quote is for {state}.')
                st.button(f"Use {state}'s default network", on_click=use_state_default_network, width='stretch')
            if issues:
                st.warning(' '.join(issues))
                suggestion = core.suggest_tariff(st.session_state['network'], _site_mwh(), st.session_state['in_voltage'])
                if suggestion['id'] != tariff['id']:
                    st.button(f"Use {core.tariff_option_label(suggestion)}", on_click=use_suggested_tariff, width='stretch')
            if tariff['status'] == 'placeholder':
                st.warning("Placeholder rates: this tariff hasn't been researched yet, "
                           'so its charges are stand-ins and the quote is indicative only.')
            number('Peak Charge (c/kWh)', 'peak_charge', fmt='%.4f')
            number('Shoulder Charge (c/kWh)', 'shoulder_charge', fmt='%.4f')
            number('Off-Peak Charge (c/kWh)', 'off_peak_charge', fmt='%.4f')
            number('NUOS Demand Charge ($/kVA/month)', 'nuos_charge', fmt='%.4f', step=1.0)
            number('Service Availability Charge ($/day)', 'service_availability_charge', fmt='%.4f')
            if not core.tariff_matches(current_inputs()):
                st.button('Restore tariff rates', on_click=restore_tariff, width='stretch')

        with st.expander('System Charges'):
            number('AEMO Participant Charge (c/kWh)', 'aemo_participant_charge', fmt='%.4f')
            number('AEMO Ancillary Services Charge (c/kWh)', 'aemo_ancillary_services_charge', fmt='%.4f')
            number('SREC Charge (c/kWh)', 'srec_charge', fmt='%.4f')
            number('LREC Charge (c/kWh)', 'lrec_charge', fmt='%.4f')

        with st.expander('Service Charges'):
            number('Metering Charge ($/month)', 'metering_charge', step=1.0)
            number('Retail Service Charge ($/month)', 'retail_service_charge', step=1.0)
            number('Admin Charge ($/month)', 'admin_charge', step=1.0)

        with st.expander('Escalation Factors'):
            number('Load Escalation Factor', 'load_escalation', step=0.01)
            number('Retail Escalation Factor', 'retail_escalation', step=0.01)


#########################################################################################################
#########################################################################################################
# DISPLAY
#########################################################################################################
#########################################################################################################

def table_df(table):
    """A core summary table as a DataFrame: label column, Year 1–3, Average."""
    return pd.DataFrame([[label, *values, avg] for label, values, avg in table['rows']],
                        columns=[table['header'], 'Year 1', 'Year 2', 'Year 3', 'Average'])


def create_table_figure(dataframe, decimals=2, font_size=16, cell_height=35):
    """HUMQuote's blue-and-yellow table."""
    formats = [''] + [f',.{decimals}f'] * (len(dataframe.columns) - 1)
    alignments = ['center'] + ['right'] * (len(dataframe.columns) - 1)
    fig = go.Figure(go.Table(
        header=dict(values=list(dataframe.columns), font=dict(size=18, color='#006FE7'),
                    fill_color='yellow', height=cell_height, line=dict(width=1, color='blue'), align='center'),
        cells=dict(values=dataframe.values.T,
                   font=dict(size=[16] + [font_size], color=['yellow'] + ['#006FE7'] * (len(dataframe.columns) - 1)),
                   fill_color=['#006FE7'] + ['white'], height=cell_height, line=dict(width=1, color='#006FE7'),
                   format=formats, align=alignments),
        columnwidth=[font_size] + [font_size / 3] * (len(dataframe.columns) - 1),
    ))
    fig.update_layout(margin=dict(l=0, r=0, t=0, b=0), height=cell_height * (len(dataframe) + 1))
    return fig


WARNING_TITLES = {
    'invalid': 'Check inputs', 'mismatch': 'Tariff from another state', 'eligibility': "Tariff doesn't fit the site",
    'placeholder': 'Placeholder tariff', 'estimate': 'Estimated price',
}


def display_warnings(warnings):
    for kind, message in warnings:
        text = f'**{WARNING_TITLES[kind]}.** {message}'
        if kind in ('invalid', 'mismatch'):
            st.error(text, icon='⚠️')
        else:
            st.warning(text, icon='⚠️')


def display_headline(result, periods, state, inputs, latest_date):
    c1, c2 = st.columns([1, 1.6], vertical_alignment='center')
    with c1:
        st.markdown(
            f"""
            <div style="padding:8px 0 8px 16px; border-left:6px solid #ffe600;">
              <div style="font-size:15px; opacity:.75;">Bulk electricity price · {state} · 3-year average from {core.month_label(periods[0]['start'])}</div>
              <div style="font-size:56px; font-weight:700; line-height:1.15;">${result['bulk_price']:.4f}<span style="font-size:22px; font-weight:500;"> /kWh</span></div>
              <div style="font-size:14px; opacity:.75;">${result['bulk_price'] * 1000:,.2f}/MWh · {core.tariff_label(inputs['tariff_id'])} · ASX settlement {latest_date}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with c2:
        cols = st.columns(3)
        totals = result['tables']['rates']['rows'][4][1]
        for i, (col, p) in enumerate(zip(cols, periods)):
            with col:
                st.metric(
                    f"Year {i + 1} · {p['label']}", f'${totals[i]:.4f}/kWh', border=True,
                    help=core.period_range(p['start']) + (f". {p['note']}." if p['note'] else ''),
                )
                st.caption('⚠️ Estimate' if p['estimates'] else f'${totals[i] * 1000:,.2f}/MWh')

    others = core.compare_states(periods, inputs)
    cheapest = min(o['result']['bulk_price'] for o in others)
    st.caption(
        'Same inputs in each state, on its default tariff: ' + ' · '.join(
            f"**{o['state']} ${o['result']['bulk_price']:.4f}**" + (' (lowest)' if o['result']['bulk_price'] == cheapest else '')
            for o in others),
    )


def breakdown_chart(result, periods):
    cats = [f"Year {i + 1} · {p['label']}{'*' if p['estimates'] else ''}" for i, p in enumerate(periods)] + ['Average']
    rows = result['tables']['rates']['rows']
    fig = go.Figure()
    for i, name in enumerate(COMPONENTS):
        fig.add_bar(y=cats, x=[*rows[i][1], rows[i][2]], name=name, orientation='h', marker_color=SERIES[i],
                    marker_line=dict(color='white', width=2), hovertemplate=f'{name}: $%{{x:.4f}}/kWh<extra></extra>')
    totals = [*rows[4][1], rows[4][2]]
    fig.add_scatter(y=cats, x=totals, mode='text', text=[f'${t:.4f}' for t in totals], textposition='middle right',
                    showlegend=False, hoverinfo='skip')
    fig.update_layout(barmode='stack', height=280, margin=dict(l=0, r=60, t=10, b=0), bargap=0.45,
                      legend=dict(orientation='h', y=1.15, x=0, traceorder='normal'), xaxis=dict(tickprefix='$', tickformat='.2f'),
                      yaxis=dict(autorange='reversed'))
    return fig


def periods_table(result, periods, view):
    """One row per contract period: where its price came from and the price per state."""
    rows = []
    for i, p in enumerate(periods):
        row = {
            'Period': f"Year {i + 1} · {p['label']}",
            'Months': core.period_range(p['start']),
            'Priced from': ', '.join(core.short_contract(s) for s in p['sources']),
            'Estimate': '⚠️ ' + p['note'] if p['note'] else '',
        }
        for s in core.STATE_ORDER:
            if view == 'Settle ($/MWh)':
                row[s] = p[s]
            elif view == 'Peak (c/kWh)':
                row[s] = result['updated'][i][s]
            else:
                row[s] = round(p[s] / 10, 2)
        rows.append(row)
    return pd.DataFrame(rows)


def quarters_table(periods):
    rows = []
    for i, p in enumerate(periods):
        for q in p['quarters'] or []:
            source = core.short_contract(q['source'])
            if q['estimate']:
                source += f" ({core.estimate_label(q['estimate']).lower()})"
            months = core.period_range(q['from'], q['months'])
            rows.append({'Year': f"Year {i + 1}", 'Months': months + (' (part)' if q['months'] < 3 else ''), 'Days': q['days'],
                         'Priced from': source,
                         **{s: q[s] for s in core.STATE_ORDER}})
    return pd.DataFrame(rows)


def excel_export(result, periods, inputs, state, latest_date, warnings):
    """The original seven sheets plus Inputs and Contract Periods, so the file records how the quote was built."""
    buffer = io.BytesIO()
    tables = result['tables']
    tariff = core.tariff_by_id(inputs['tariff_id'])
    with pd.ExcelWriter(buffer, engine='xlsxwriter') as writer:
        for key, sheet in [('rates', 'Bulk Prices'), ('consumption', 'Consumption'), ('costs', 'Yearly Costs'),
                           ('energy_rates', 'Energy Rates'), ('charges', 'Charges')]:
            table_df(tables[key]).to_excel(writer, sheet_name=sheet, index=False)
        pd.DataFrame([{'Quote Date': latest_date, 'Period': periods[i]['label'], **{s: u[s] for s in core.STATES}}
                      for i, u in enumerate(result['updated'])]).to_excel(writer, sheet_name='Peak Prices', index=False)
        pd.DataFrame([{'Quote Date': latest_date, 'Period': p['label'], **{s: round(p[s] / 10, 2) for s in core.STATES}}
                      for p in periods]).to_excel(writer, sheet_name='Off-Peak Prices', index=False)
        inputs_rows = [
            ('State', state), ('ASX settlement date', latest_date),
            ('Supply start', core.month_label(periods[0]['start'])),
            ('Network tariff', core.tariff_label(inputs['tariff_id'])),
            ('Tariff status', f"{tariff['status']}: {tariff['source']}"),
            *[(k, v) for k, v in inputs.items() if k not in ('tariff_id', 'supply_start')],
            ('', ''), ('Warnings', '' if warnings else 'None'),
            *[('', message) for _, message in warnings],
        ]
        pd.DataFrame(inputs_rows, columns=['Input', 'Value']).to_excel(writer, sheet_name='Inputs', index=False)
        pd.DataFrame([{
            'Year': f'Year {i + 1}', 'Period': p['label'], 'Months': core.period_range(p['start']),
            'Priced from': ', '.join(p['sources']), 'Estimate': p['note'] or 'No',
            **{f'{s} ($/MWh)': p[s] for s in core.STATES},
        } for i, p in enumerate(periods)]).to_excel(writer, sheet_name='Contract Periods', index=False)
    buffer.seek(0)
    return buffer


#########################################################################################################
#########################################################################################################
# STREAMLIT INTERFACE
#########################################################################################################
#########################################################################################################

st.set_page_config(
    page_title='HUMQuote - Bulk Electricity Pricing',
    page_icon='⚡',
    initial_sidebar_state='auto',
    layout='wide',
    menu_items={
        'Get Help':    'https://www.humenergy.com.au/',
        'Report a bug': 'https://www.humenergy.com.au/contact',
        'About':       '# Bulk Electricity Pricing tool for Large Contracts'
    }
)

st.image('hum-solar-header.jpg', width='stretch')
st.title('⚡ Bulk Electricity Pricing for Large Contracts')

init_inputs()

# ── Sidebar: market data ───────────────────────────────────────────────────────
st.sidebar.header('Latest ASX Futures Data')
if st.sidebar.button('Fetch latest from ASX', width='stretch',
                     help='Refreshes the prices from the ASX Energy website. They also update automatically each weekday.'):
    try:
        with st.spinner('Fetching ASX prices…'):
            fetched_date, weekend = fetch_from_asx()
        load_curves.clear()
        st.session_state['fetch_note'] = (fetched_date, weekend)
    except Exception as e:  # noqa: BLE001 - shown to the user
        st.sidebar.error(f'Could not fetch ASX prices: {e}')

curves = load_curves()
if not curves:
    st.error('No futures data found in the database.')
    st.stop()
latest_date = next(reversed(curves))
curve = curves[latest_date]

st.sidebar.caption(f'ASX settlement **{datetime.strptime(latest_date, "%Y-%m-%d").strftime("%a %d %b %Y")}** · '
                   'base futures, $/MWh')
for _, label, contracts in core.group_by_kind(curve):
    st.sidebar.markdown(f'**{label}**')
    st.sidebar.dataframe(
        pd.DataFrame([{'Contract': core.short_contract(c['contract']), **{s: c[s] for s in core.STATE_ORDER}} for c in contracts]),
        hide_index=True, width='stretch',
        column_config={s: st.column_config.NumberColumn(format='%.2f', width='small') for s in core.STATE_ORDER},
    )

if st.session_state.get('fetch_note'):
    fetched_date, weekend = st.session_state['fetch_note']
    if weekend:
        st.info(f"🗓️ **Market closed — weekend.** Showing settlement prices from the last trading day: "
                f"**{fetched_date.strftime('%A %d %b %Y')}**.")

# ── State and inputs ───────────────────────────────────────────────────────────
state = st.segmented_control('State', core.STATE_ORDER, key='selected_state', on_change=on_state_change)
create_input_boxes(state, latest_date)
inputs = current_inputs()

# ── Results ────────────────────────────────────────────────────────────────────
periods = core.quote_periods(curve, inputs)
result = core.calculate_bulk_prices(periods, inputs, state)
warnings = [('invalid', message) for _, message in core.validate_inputs(inputs)] + core.quote_warnings(inputs, state, periods)

display_warnings(warnings)
display_headline(result, periods, state, inputs, latest_date)

tab_breakdown, tab_details, tab_periods = st.tabs(['📊 Price breakdown', '🧮 Calculation details', '📅 Contract periods'])

with tab_breakdown:
    st.plotly_chart(breakdown_chart(result, periods), width='stretch')
    st.plotly_chart(create_table_figure(table_df(result['tables']['rates']), decimals=4), width='stretch')
    if any(p['estimates'] for p in periods):
        st.caption('\\* Includes estimated months: see Contract periods.')

with tab_details:
    st.header(f'Summary for {state}')
    for title, key, decimals, expanded in [
        ('**Energy Consumption**', 'consumption', 2, True),
        ('**Yearly Costs**', 'costs', 2, False),
        ('**Tariffs & Factors**', 'energy_rates', 4, False),
        ('**Charges**', 'charges', 4, False),
    ]:
        with st.expander(title, expanded=expanded):
            st.plotly_chart(create_table_figure(table_df(result['tables'][key]), decimals=decimals), width='stretch')

with tab_periods:
    view = st.segmented_control('Price type', ['Settle ($/MWh)', 'Peak (c/kWh)', 'Base (c/kWh)'], default='Settle ($/MWh)',
                                help='Peak: settle price with load and retail escalation (the peak and shoulder energy rate). '
                                     'Base: settle price without escalation (the off-peak energy rate).') or 'Settle ($/MWh)'
    st.dataframe(periods_table(result, periods, view), hide_index=True, width='stretch',
                 column_config={s: st.column_config.NumberColumn(format='%.2f') for s in core.STATE_ORDER})
    quarters = quarters_table(periods)
    if not quarters.empty:
        with st.expander('Quarter by quarter ($/MWh)'):
            st.dataframe(quarters, hide_index=True, width='stretch',
                         column_config={s: st.column_config.NumberColumn(format='%.2f') for s in core.STATE_ORDER})
    st.caption('A period without a matching annual ASX strip averages its four quarters. '
               'Carried forward: beyond the last listed contract, its price escalated by the carry-forward rate for each year beyond it. '
               'Back-filled: before the first listed contract, the earliest listed price, unescalated.')

st.write('## Export and share')
e1, e2, e3, _ = st.columns([1, 1, 1, 2])
e1.download_button(
    label='📥 Download Excel',
    data=excel_export(result, periods, inputs, state, latest_date, warnings),
    file_name=f'bulk-electricity-pricing-{state}-{latest_date}.xlsx',
    mime='application/vnd.ms-excel',
    width='stretch',
)
e2.download_button(
    label='📄 Download PDF quote',
    data=build_quote_pdf(result, periods, inputs, state, latest_date, warnings),
    file_name=f'bulk-electricity-quote-{state}-{latest_date}.pdf',
    mime='application/pdf',
    width='stretch',
    help='A one-page quote sheet: price, any warnings, the price by year and component, and the inputs.',
)
with e3.popover('🔗 Share link', width='stretch'):
    st.caption('Copy this link to reopen the quote with the same state and inputs.')
    st.code(share_url(inputs, state), language=None, wrap_lines=True)

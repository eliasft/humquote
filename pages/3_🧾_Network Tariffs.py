import pandas as pd
import streamlit as st

import humquote_core as core


st.set_page_config(
    page_title='HUMQuote - Network Tariffs',
    page_icon='🧾',
    initial_sidebar_state="auto",
    layout='wide',
    menu_items={
        'Get Help': 'https://www.humenergy.com.au/',
        'Report a bug': "https://www.humenergy.com.au/contact",
        'About': "# Bulk Electricity Pricing tool for Large Contracts"
    }
)

#########################################################################################################
#########################################################################################################
# NETWORK TARIFFS
# The tariff catalogue (reference-data/tariffs.json), read-only: every network's tariffs
# with their rates, time windows, notes, past years' rates and sources.
#########################################################################################################
#########################################################################################################

PERIODS = [('Peak', 'peak'), ('Shoulder', 'shoulder'), ('Off-peak', 'offPeak')]
RATE = st.column_config.NumberColumn(format='%.4f')

# The tariff each state's bulk price index prices its reference customer on.
INDEX_TARIFFS = {core.index_inputs(s)['tariff_id']: s for s in core.STATES}


def code_of(t):
    return 'Placeholder' if t['status'] == 'placeholder' else t['code']


def overview(tariffs):
    """One row per tariff: its rates."""
    return pd.DataFrame([{
        'Tariff': f"{code_of(t)} · {t['name']}", 'Voltage': t['voltage'],
        'Peak c/kWh': t['energy']['peak'], 'Shoulder c/kWh': t['energy']['shoulder'],
        'Off-peak c/kWh': t['energy']['offPeak'], 'Demand $/kVA/mo': t['demand']['rate'], 'Fixed $/day': t['fixed'],
    } for t in tariffs])


def tariff_details(t):
    if t['status'] == 'placeholder':
        st.warning(f"Placeholder: these are stand-in rates until this network's {core.TARIFF_YEAR} tariff is "
                   "researched. Quotes on it are indicative only.")
    left, right = st.columns(2)
    flat = t['energy']['peak'] == t['energy']['shoulder'] == t['energy']['offPeak']
    windows = t.get('energyWindows')
    if flat:
        energy = [{'Period': 'All times', 'Network window': '', 'Rate': t['energy']['peak']}]
    else:
        energy = [{'Period': label, 'Network window': (windows or {}).get(key) or '', 'Rate': t['energy'][key]}
                  for label, key in PERIODS if not windows or windows[key] is not None]
    left.markdown('**Energy (c/kWh)**')
    left.dataframe(pd.DataFrame(energy), hide_index=True, width='stretch', column_config={'Rate': RATE})

    right.markdown('**Demand ($/kVA/month)**')
    if t['demand']['lines']:
        right.dataframe(pd.DataFrame([{
            'Charge': line['label'], 'Window': line['window'], 'How the kVA is set': core.DEMAND_BASIS[line['basis']],
            'Rate': line['rate'],
        } for line in t['demand']['lines']]), hide_index=True, width='stretch', column_config={'Rate': RATE})
    else:
        right.caption('No demand charge.')
    right.markdown(f"Fixed charge: **${t['fixed']:.4f}** a day")

    notes = ([t['periods']] if t['periods'] else []) + t['notes']
    if t['id'] in INDEX_TARIFFS:
        notes.append(f"The bulk price index prices {INDEX_TARIFFS[t['id']]}'s reference customer on this tariff.")
    if notes:
        st.markdown('**Time windows and notes**')
        st.markdown('\n'.join(f'- {n}' for n in notes))
    st.markdown('**Source**')
    st.caption(t['source'])
    if t.get('toConfirm'):
        st.markdown(f":orange[To confirm: {', '.join(t['toConfirm'])}.]")

    years = core.rate_history(t)
    if len(years) > 1:
        st.markdown('**Rates by financial year**')
        st.dataframe(pd.DataFrame([{
            'Year': r['year'], 'Peak c/kWh': r['energy']['peak'], 'Shoulder c/kWh': r['energy']['shoulder'],
            'Off-peak c/kWh': r['energy']['offPeak'], 'Demand $/kVA/mo': r['demand']['rate'], 'Fixed $/day': r['fixed'],
        } for r in years]), hide_index=True, width='stretch',
            column_config={c: RATE for c in ['Peak c/kWh', 'Shoulder c/kWh', 'Off-peak c/kWh', 'Demand $/kVA/mo', 'Fixed $/day']})
        st.caption("Demand is the sum of the tariff's demand charges. Sources: "
                   + '; '.join(f"{r['year']}: {r['source']}" for r in years[1:]))


#########################################################################################################
#########################################################################################################
# PAGE
#########################################################################################################
#########################################################################################################

st.image("hum-solar-header.jpg", width='stretch')

st.title("🧾 Network Tariffs")
st.write(f"{core.TARIFF_YEAR} network tariffs from the networks' published price lists, excluding GST. "
         "Choosing one on the quote page fills in its network charges.")

researched = sum(t['status'] != 'placeholder' for t in core.TARIFFS)
st.caption(f"{researched} researched · {len(core.TARIFFS) - researched} placeholders (stand-in rates, flagged wherever "
           "they're used). Open a tariff for its time windows, demand charges, notes and sources.")

state = st.segmented_control('State', ['All', *core.STATE_ORDER], default='All') or 'All'

for s in core.STATE_ORDER:
    if state not in ('All', s):
        continue
    for network in core.networks_for(s):
        tariffs = core.tariffs_of(network['id'])
        sub = [s]
        if core.default_network(s)['id'] == network['id']:
            sub.append(f'default network for {s}')
        if all(t['status'] == 'placeholder' for t in tariffs):
            sub.append('placeholder rates until researched')
        with st.container(border=True):
            st.subheader(network['name'])
            st.caption(' · '.join(sub))
            st.dataframe(overview(tariffs), hide_index=True, width='stretch',
                         column_config={c: RATE for c in ['Peak c/kWh', 'Shoulder c/kWh', 'Off-peak c/kWh',
                                                          'Demand $/kVA/mo', 'Fixed $/day']})
            for t in tariffs:
                status = ':orange[Placeholder]' if t['status'] == 'placeholder' else 'Researched'
                with st.expander(f"**{code_of(t)}** · {t['name']} · {t['voltage']} · {core.eligibility_text(t)} · {status}"):
                    tariff_details(t)

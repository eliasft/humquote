import streamlit as st

# HUMQuote's entry point (the main file Streamlit Cloud runs): the page menu, with each
# page's title and icon. The pages themselves are quote.py and the files in pages/;
# their url_paths keep the addresses they had before the menu was defined here.

# Streamlit discards a widget's value when a run doesn't draw it, so visiting another
# page would wipe the quote page's inputs (and its callbacks would then fail on the
# missing keys). Storing them again on every run, before the page draws, keeps them.
for _key in list(st.session_state):
    if _key.startswith('in_') or _key in ('network', 'selected_state'):
        st.session_state[_key] = st.session_state[_key]

st.navigation([
    st.Page('quote.py', title='HUM Quote', icon='⚡', default=True),
    st.Page('pages/1_💲_Bulk Price Tracker.py', title='Bulk Price Tracker', icon='💲', url_path='Bulk_Price_Tracker'),
    st.Page('pages/2_📈_Futures Price Tracker.py', title='Futures Price Tracker', icon='📈', url_path='Futures_Price_Tracker'),
    st.Page('pages/3_🧾_Network Tariffs.py', title='Network Tariffs', icon='🧾', url_path='Network_Tariffs'),
]).run()

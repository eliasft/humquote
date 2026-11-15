"""
Regenerates the parity-test fixtures in app-b/test/fixtures/ from the Python app.

The expected values come from the Python/Streamlit code itself, run against
data/asx_futures.csv (the legacy app reads it as the futures_prices.db it was
written for: each date's yearly strips in futures_data):
  - expected_quotes.json: the five summary tables from test/legacy/app/HUM.py (the
    database-reading copy of HUM.py, verified to match the live-scraping original)
    for a set of states, inputs and network presets.
  - expected_bulk_index.csv: the Bulk Price Tracker's original-method CSV download,
    using the page's own code and pandas.
  - futures.json: the frozen data, in the same format the site loads.

Needs streamlit, pandas and plotly (pip install streamlit pandas plotly xlsxwriter).
Run from the repo root:  python app-b/test/generate_fixtures.py
"""

import ast
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

import pandas as pd
from streamlit.testing.v1 import AppTest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
import futures_store  # noqa: E402
OUT = os.path.join(ROOT, 'app-b', 'test', 'fixtures')

LABEL_TO_KEY = {
    'Total Consumption (kWh)': 'totalConsumption', 'Peak Consumption (%)': 'peakConsumption',
    'Shoulder Consumption (%)': 'shoulderConsumption', 'Load Factor': 'loadFactor',
    'Metering Charge ($/month)': 'meteringCharge', 'Load Escalation Factor': 'loadEscalation',
    'Retail Escalation Factor': 'retailEscalation', 'NUOS Charge ($/kVA)': 'nuosCharge',
    'SREC Charge (c/kWh)': 'srecCharge', 'Admin Charge ($/month)': 'adminCharge',
}

CASES = [({}, None, s) for s in ['NSW', 'QLD', 'VIC', 'SA']] + [
    ({'Total Consumption (kWh)': 1234567.0, 'Peak Consumption (%)': 62.5, 'Shoulder Consumption (%)': 10.0,
      'Load Factor': 0.7, 'Metering Charge ($/month)': 250.0, 'Load Escalation Factor': 1.2}, None, 'QLD'),
    ({'SREC Charge (c/kWh)': 1.5, 'Admin Charge ($/month)': 40.0, 'Retail Escalation Factor': 1.07}, 'BLNT1AO', 'SA'),
    ({'NUOS Charge ($/kVA)': 9.5}, 'Energex 8100', 'VIC'),
    ({'Peak Consumption (%)': 30.0, 'Shoulder Consumption (%)': 25.0}, 'BLND3AO', 'NSW'),
]


def quote_cases(work):
    app_dir = os.path.join(work, 'app')
    shutil.copytree(os.path.join(ROOT, 'app-b', 'test', 'legacy', 'app'), app_dir)
    shutil.copy(os.path.join(work, 'futures_prices.db'), app_dir)
    shutil.copy(os.path.join(ROOT, 'hum-solar-header.jpg'), app_dir)
    os.chdir(app_dir)

    out = []
    for overrides, network, state in CASES:
        at = AppTest.from_file(os.path.join(app_dir, 'HUM.py'), default_timeout=60).run()
        if network:
            at.sidebar.selectbox[0].set_value(network).run()
        for label, value in overrides.items():
            next(n for n in at.sidebar.number_input if n.label == label).set_value(value)
        at.selectbox(key='selected_state').set_value(state).run()
        assert not at.exception, at.exception
        tables = {}
        for chart in at.get('plotly_chart'):
            fig = json.loads(chart.proto.spec)
            cells = fig['data'][0]['cells']['values']
            header = fig['data'][0]['header']['values'][0]
            tables[header] = [[cells[c][r] for c in range(1, 5)] for r in range(len(cells[0]))]
        out.append({'state': state, 'network': network,
                    'inputs': {LABEL_TO_KEY[k]: v for k, v in overrides.items()}, 'tables': tables})
    return out


def legacy_db(csv_path, db_path):
    """futures_prices.db as the legacy app reads it: each date's yearly strips in futures_data."""
    conn = sqlite3.connect(db_path)
    conn.execute('CREATE TABLE futures_data ("Quote Date" DATE, "Year" INTEGER, "NSW" REAL, "VIC" REAL, '
                 '"QLD" REAL, "SA" REAL, PRIMARY KEY ("Quote Date", "Year"))')
    conn.executemany('INSERT INTO futures_data VALUES (?, ?, ?, ?, ?, ?)',
                     futures_store.headline_rows(futures_store.load(csv_path)))
    conn.commit()
    conn.close()


def bulk_index_csv(csv_path):
    page = os.path.join(ROOT, 'pages', '1_💲_Bulk Price Tracker.py')
    tree = ast.parse(open(page, encoding='utf-8').read())
    fns = [n for n in tree.body if isinstance(n, ast.FunctionDef)
           and n.name in ('calculate_bulk_price_index', 'yearly_strips_table')]
    ns = {'sqlite3': sqlite3, 'pd': pd, 'futures_store': futures_store}
    exec(compile(ast.Module(fns, []), 'bulk_price_tracker', 'exec'), ns)
    index = ns['calculate_bulk_price_index'](csv_path).set_index('Quote Date').sort_values(by='Quote Date', ascending=False)
    # pandas uses os.linesep; normalise so the fixtures are identical on every OS.
    return index.to_csv(index=True).replace('\r\n', '\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as work:
        csv_path = os.path.join(ROOT, futures_store.PATH)
        legacy_db(csv_path, os.path.join(work, 'futures_prices.db'))

        subprocess.run([sys.executable, os.path.join(ROOT, '.github', 'scripts', 'export_futures_json.py'),
                        csv_path, os.path.join(OUT, 'futures.json')], check=True)
        with open(os.path.join(OUT, 'expected_bulk_index.csv'), 'w', encoding='utf-8', newline='') as f:
            f.write(bulk_index_csv(csv_path))

        cases = quote_cases(work)
        os.chdir(ROOT)
    with open(os.path.join(OUT, 'expected_quotes.json'), 'w', encoding='utf-8') as f:
        json.dump(cases, f, indent=1)
    print(f'Wrote fixtures for {len(cases)} quote cases to {OUT}')


if __name__ == '__main__':
    main()

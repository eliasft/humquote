"""
Writes test/fixtures/core_cases.json from the Streamlit app's pricing core
(humquote_core.py), so test/core-python.test.ts can check the TypeScript core
gives the same contract periods, tables, prices and index.

Pure Python, no extra packages. Run from the repo root after changing either core:
    python app-b/test/generate_core_cases.py
"""

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
import humquote_core as core  # noqa: E402

FIXTURES = os.path.join(ROOT, 'app-b', 'test', 'fixtures')

# Python input names → TypeScript (QuoteInputs) names.
CAMEL = {
    'total_consumption': 'totalConsumption', 'peak_consumption': 'peakConsumption',
    'shoulder_consumption': 'shoulderConsumption', 'load_factor': 'loadFactor', 'tariff_id': 'tariffId',
    'peak_charge': 'peakCharge', 'off_peak_charge': 'offPeakCharge', 'shoulder_charge': 'shoulderCharge',
    'nuos_charge': 'nuosCharge', 'service_availability_charge': 'serviceAvailabilityCharge',
    'aemo_participant_charge': 'aemoParticipantCharge', 'aemo_ancillary_services_charge': 'aemoAncillaryServicesCharge',
    'srec_charge': 'srecCharge', 'lrec_charge': 'lrecCharge', 'metering_charge': 'meteringCharge',
    'retail_service_charge': 'retailServiceCharge', 'admin_charge': 'adminCharge',
    'load_escalation': 'loadEscalation', 'retail_escalation': 'retailEscalation',
    'supply_start': 'supplyStart', 'carry_forward_rate': 'carryForwardRate',
}

# The contracts ASX listed on 13 Nov 2026.
NOV13 = [
    ['2026-11-13', 'Q4 2026', '2026-10', 3, 121.68, 66.96, 91.75, 70.0],
    ['2026-11-13', 'Q1 2027', '2027-01', 3, 102.25, 74.83, 89.25, 86.0],
    ['2026-11-13', 'CY2027', '2027-01', 12, 98.98, 75.36, 80.41, 85.36],
    ['2026-11-13', 'Q2 2027', '2027-04', 3, 107.31, 90.33, 81.75, 98.25],
    ['2026-11-13', 'Q3 2027', '2027-07', 3, 97.02, 84.0, 75.3, 97.1],
    ['2026-11-13', 'FY2028', '2027-07', 12, 95.68, 73.76, 79.12, 87.41],
    ['2026-11-13', 'Q4 2027', '2027-10', 3, 89.5, 52.41, 75.53, 60.25],
    ['2026-11-13', 'CY2028', '2028-01', 12, 96.33, 79.62, 80.33, 95.12],
    ['2026-11-13', 'FY2029', '2028-07', 12, 99.21, 84.0, 82.35, 101.52],
    ['2026-11-13', 'CY2029', '2029-01', 12, 101.14, 84.29, 84.27, 106.19],
]
NOV13_FY = [['2026-11-13', 2028, 95.68, 73.76, 79.12, 87.41], ['2026-11-13', 2029, 99.21, 84.0, 82.35, 101.52]]

# (curve name, state, tariff id or None for the default, input overrides)
CASES = [
    ('nov13', 'NSW', None, {}),
    ('nov13', 'QLD', 'energex-8100', {'supply_start': '2027-04'}),
    ('nov13', 'VIC', 'powercor-large-lv-placeholder', {'supply_start': '2027-10', 'carry_forward_rate': 3.0}),
    ('nov13', 'SA', 'essential-blnt1ao', {'peak_consumption': 40.0, 'shoulder_consumption': 20.0, 'supply_start': '2028-01'}),
    ('nov13', 'NSW', 'essential-blnt1ao', {'total_consumption': 1234567.0, 'load_factor': 0.62, 'supply_start': '2029-04', 'carry_forward_rate': 0.25}),
    ('fy_only', 'QLD', 'energex-8300', {}),
    ('fy_only', 'NSW', None, {'supply_start': '2027-07', 'nuos_charge': 9.5}),
    ('fy_only', 'VIC', 'citipower-small-placeholder', {'supply_start': '2028-04', 'carry_forward_rate': 4.0, 'shoulder_consumption': 15.0}),
]


def period_out(p):
    return {
        'label': p['label'], 'start': p['start'], 'sources': p['sources'], 'estimates': p['estimates'], 'note': p['note'],
        'prices': {s: p[s] for s in core.STATES},
        'quarters': None if p['quarters'] is None else [
            {'start': q['start'], 'source': q['source'], 'estimate': q['estimate'], 'prices': {s: q[s] for s in core.STATES}}
            for q in p['quarters']],
    }


def main():
    with open(os.path.join(FIXTURES, 'futures.json'), encoding='utf-8') as f:
        history = json.load(f)['rows']
    curves = {
        'nov13': core.build_curves(NOV13_FY, NOV13)['2026-11-13'],
        'fy_only': core.build_curves(NOV13_FY)['2026-11-13'],
    }

    cases = []
    for curve_name, state, tariff_id, overrides in CASES:
        inputs = dict(core.DEFAULT_INPUTS)
        if tariff_id:
            inputs = core.apply_tariff(inputs, core.tariff_by_id(tariff_id))
        inputs.update(overrides)
        periods = core.quote_periods(curves[curve_name], inputs)
        r = core.calculate_bulk_prices(periods, inputs, state)
        cases.append({
            'curve': curve_name, 'state': state,
            'inputs': {CAMEL[k]: v for k, v in inputs.items()},
            'periods': [period_out(p) for p in periods],
            'tables': {k: [[*v, avg] for _, v, avg in t['rows']] for k, t in r['tables'].items()},
            'bulkPrice': r['bulk_price'],
            'warnings': [list(w) for w in core.quote_warnings(inputs, state, periods)],
            'otherStates': {c['state']: [c['inputs']['tariff_id'], c['result']['bulk_price']] for c in core.compare_states(periods, inputs)},
        })

    index = core.bulk_price_index(core.build_curves([tuple(r) for r in history]))
    out = {
        'nov13': NOV13, 'nov13Fy': NOV13_FY, 'cases': cases,
        'index': [{'quoteDate': p['quote_date'], 'prices': p['prices'], 'components': p['components'], 'estimates': p['estimates']}
                  for p in index[-60:]],
    }
    with open(os.path.join(FIXTURES, 'core_cases.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, indent=1)
    print(f"Wrote {len(cases)} cases and {len(out['index'])} index points to core_cases.json")


if __name__ == '__main__':
    main()

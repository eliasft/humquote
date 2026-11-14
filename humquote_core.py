"""
HUMQuote pricing core for the Streamlit app: a line-for-line Python port of
app-b/src/core (calc.ts, periods.ts, tariffs.ts, analysis.ts), which the web
versions use. app-b/test/core-python.test.ts checks the two agree, using cases
written by app-b/test/generate_core_cases.py.

  - Network tariffs come from reference-data/tariffs.json. Each belongs to a
    network in one state; 'placeholder' entries are stand-ins (see
    reference-data/PLACEHOLDERS.md) and are flagged wherever they're used.
  - Network energy charges apply per consumption period (peak, shoulder,
    off-peak). A flat tariff reduces to one rate on all consumption.
  - A quote prices three 12-month periods from a supply start, each from the ASX
    contract that matches it or from its quarters. Months beyond the listed
    contracts are carried forward at an escalation rate; months before the first
    are back-filled. Both are flagged as estimates.

Pure Python (no pandas), so it's easy to test and reuse.
"""

import json
import os
import sqlite3

STATES = ['NSW', 'VIC', 'QLD', 'SA']
STATE_ORDER = ['NSW', 'QLD', 'VIC', 'SA']

TRANSMISSION_LOSS_FACTOR = 1.00860
DISTRIBUTION_LOSS_FACTOR = 1.04344

# PLACEHOLDER: the 2.5% carry-forward escalation is an assumption (PLACEHOLDERS.md).
DEFAULT_CARRY_FORWARD_RATE = 2.5


# ── Tariff catalogue ──────────────────────────────────────────────────────────

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference-data', 'tariffs.json'), encoding='utf-8') as _f:
    _CATALOGUE = json.load(_f)

TARIFF_YEAR = _CATALOGUE['financialYear']
SEGMENTS = _CATALOGUE['segments']
NETWORKS = _CATALOGUE['networks']
TARIFFS = _CATALOGUE['tariffs']
_DEFAULTS = _CATALOGUE['defaults']
_LEGACY_NAMES = _CATALOGUE['legacyNames']
_BY_ID = {t['id']: t for t in TARIFFS}
_NETWORK_BY_ID = {n['id']: n for n in NETWORKS}


def tariff_by_id(tariff_id):
    return _BY_ID.get(tariff_id)


def network_of(tariff):
    return _NETWORK_BY_ID[tariff['network']]


def tariff_state(tariff_id):
    t = _BY_ID.get(tariff_id)
    return network_of(t)['state'] if t else None


def segment_name(segment_id):
    return next((s['name'] for s in SEGMENTS if s['id'] == segment_id), segment_id)


def tariff_label(tariff_id):
    """'Essential Energy BLND3AO', or 'Ausgrid (placeholder)' for a stand-in."""
    t = _BY_ID.get(tariff_id)
    if not t:
        return tariff_id
    network = network_of(t)['name']
    return f"{network} (placeholder)" if t['status'] == 'placeholder' else f"{network} {t['code']}"


def default_tariff(state, segment):
    return _BY_ID[_DEFAULTS[state][segment]]


def tariffs_for(state, segment):
    """A state's tariffs for one segment, grouped by network: [(network, [tariff, ...]), ...]."""
    out = []
    for n in NETWORKS:
        if n['state'] != state:
            continue
        ts = [t for t in TARIFFS if t['network'] == n['id'] and t['segment'] == segment]
        if ts:
            out.append((n, ts))
    return out


def resolve_tariff_id(id_or_name):
    """Old quotes stored a preset name ('BLNT1AO'); map it to its tariff id."""
    return id_or_name if id_or_name in _BY_ID else _LEGACY_NAMES.get(id_or_name)


# ── Inputs ────────────────────────────────────────────────────────────────────

def apply_tariff(inputs, tariff):
    return {
        **inputs,
        'tariff_id': tariff['id'],
        'peak_charge': tariff['energy']['peak'],
        'off_peak_charge': tariff['energy']['offPeak'],
        'shoulder_charge': tariff['energy']['shoulder'],
        'nuos_charge': tariff['demand']['rate'],
        'service_availability_charge': tariff['fixed'],
    }


def tariff_matches(inputs):
    """True when the network charges are still the tariff's own (not edited)."""
    t = _BY_ID.get(inputs['tariff_id'])
    return bool(t) and inputs['peak_charge'] == t['energy']['peak'] and inputs['off_peak_charge'] == t['energy']['offPeak'] \
        and inputs['shoulder_charge'] == t['energy']['shoulder'] and inputs['nuos_charge'] == t['demand']['rate'] \
        and inputs['service_availability_charge'] == t['fixed']


DEFAULT_INPUTS = apply_tariff({
    'total_consumption': 400000.00,
    'peak_consumption': 50.00,
    'shoulder_consumption': 0.00,
    'load_factor': 0.55,
    'tariff_id': '',
    'peak_charge': 0,
    'off_peak_charge': 0,
    'shoulder_charge': 0,
    'nuos_charge': 0,
    'service_availability_charge': 0,
    'aemo_participant_charge': 0.09910,
    'aemo_ancillary_services_charge': 0.09910,
    'srec_charge': 1.09040,
    'lrec_charge': 1.0000,
    'metering_charge': 100.00,
    'retail_service_charge': 0.00,
    'admin_charge': 0.00,
    'load_escalation': 1.15,
    'retail_escalation': 1.15,
    'supply_start': 'auto',  # 'auto' (the quarter after the settlement date) or 'YYYY-MM'
    'carry_forward_rate': DEFAULT_CARRY_FORWARD_RATE,
}, default_tariff('NSW', 'large-lv'))


def segment_of(inputs):
    t = _BY_ID.get(inputs['tariff_id'])
    return t['segment'] if t else 'large-lv'


def inputs_for_state(inputs, state):
    """The state's default tariff for the same segment, unless the tariff is already that state's."""
    if tariff_state(inputs['tariff_id']) == state:
        return inputs
    return apply_tariff(inputs, default_tariff(state, segment_of(inputs)))


# ── Calculation ───────────────────────────────────────────────────────────────

TABLES = {
    'energy_rates': ('Tariffs & Factors', [
        'Peak Tariff (c/kWh)',
        'Shoulder Tariff (c/kWh)',
        'Off Peak Tariff (c/kWh)',
        'Transmission Loss Factor',
        'Distribution Loss Factor',
        'Net Loss Factor (NLF)',
        'Peak Tariff (Adj for Losses) (c/kWh)',
        'Shoulder Tariff (Adj for Losses) (c/kWh)',
        'Off Peak Tariff (Adj for Losses) (c/kWh)',
    ]),
    'consumption': ('Energy Consumption', [
        'Total Consumption (kWh)',
        'Peak Consumption (kWh)',
        'Shoulder Consumption (kWh)',
        'Off Peak Consumption (kWh)',
        'Load Factor',
        'Avg. Monthly Peak Demand (kVA)',
    ]),
    'charges': ('Costs per Unit', [
        'Peak Energy Charge (c/kWh)',
        'Shoulder Energy Charge (c/kWh)',
        'Off Peak Energy Charge (c/kWh)',
        'Peak Demand Charge ($/kVA)',
        'Network Volume Charge (avg c/kWh)',
        'Other Volume Charge (c/kWh)',
        'Fixed Charge ($/day)',
    ]),
    'costs': ('Annual Costs', [
        'Peak Energy Costs ($/year)',
        'Shoulder Energy Costs ($/year)',
        'Off Peak Energy Costs ($/year)',
        'Peak Demand Costs ($/year)',
        'Network Volume Costs ($/year)',
        'Other Volume Costs ($/year)',
        'Fixed Costs ($/year)',
        'Total Costs ($/year)',
        'kWh/year',
        'Bundled Bulk Cost ($/kWh)',
    ]),
    'rates': ('Rates Summary', [
        'Energy ($/kWh)',
        'Network ($/kWh)',
        'Other ($/kWh)',
        'Fixed ($/kWh)',
        'Total ($/kWh)',
    ]),
}


def escalate(rows, load_escalation, retail_escalation):
    """Settle $/MWh → escalated c/kWh peak price (apply_escalation_and_format)."""
    return [{**r, **{s: round((r[s] / 10) * load_escalation * retail_escalation, 2) for s in STATES}} for r in rows]


def calculate_bulk_prices(rows, inputs, state):
    """
    The five summary tables and the bulk price ($/kWh) for three contract
    periods (rows: one settle price per state each). Returns
    {'updated', 'tables': {key: {'header', 'rows': [(label, [y1, y2, y3], average)]}}, 'bulk_price'}.
    """
    updated = escalate(rows, inputs['load_escalation'], inputs['retail_escalation'])
    values = {key: [[0.0, 0.0, 0.0] for _ in labels] for key, (_, labels) in TABLES.items()}
    off_peak_pct = 100 - inputs['peak_consumption'] - inputs['shoulder_consumption']

    if rows:
        for y in range(3):
            i = min(y, len(updated) - 1)
            peak_rate = updated[i][state]
            shoulder_rate = updated[i][state]
            off_peak_rate = rows[i][state] / 10

            net_loss_factor = TRANSMISSION_LOSS_FACTOR * DISTRIBUTION_LOSS_FACTOR
            peak_adj = peak_rate * net_loss_factor
            shoulder_adj = shoulder_rate * net_loss_factor
            off_peak_adj = off_peak_rate * net_loss_factor
            for r, v in enumerate([peak_rate, shoulder_rate, off_peak_rate, TRANSMISSION_LOSS_FACTOR,
                                   DISTRIBUTION_LOSS_FACTOR, net_loss_factor, peak_adj, shoulder_adj, off_peak_adj]):
                values['energy_rates'][r][y] = v

            total = inputs['total_consumption']
            peak_demand = total / 8760 / inputs['load_factor']
            peak_cons = total * (inputs['peak_consumption'] / 100)
            shoulder_cons = total * (inputs['shoulder_consumption'] / 100)
            off_peak_cons = total * (off_peak_pct / 100)
            for r, v in enumerate([total, peak_cons, shoulder_cons, off_peak_cons, inputs['load_factor'], peak_demand]):
                values['consumption'][r][y] = v

            peak_volume = inputs['nuos_charge']
            # Each consumption period pays its own network rate; a flat tariff
            # reduces to one rate on all consumption, as in the original app.
            flat = inputs['peak_charge'] == inputs['shoulder_charge'] == inputs['off_peak_charge']
            if flat:
                network_volume_costs = total * (inputs['peak_charge'] / 100)
                network_volume = inputs['peak_charge']
            else:
                network_volume_costs = (peak_cons * inputs['peak_charge'] + shoulder_cons * inputs['shoulder_charge']
                                        + off_peak_cons * inputs['off_peak_charge']) / 100
                network_volume = (network_volume_costs / total) * 100
            other_volume = inputs['aemo_participant_charge'] + inputs['aemo_ancillary_services_charge'] \
                + inputs['srec_charge'] + inputs['lrec_charge']
            fixed = inputs['service_availability_charge'] \
                + ((inputs['metering_charge'] + inputs['retail_service_charge'] + inputs['admin_charge']) / 30)
            for r, v in enumerate([peak_adj, shoulder_adj, off_peak_adj, peak_volume, network_volume, other_volume, fixed]):
                values['charges'][r][y] = v

            peak_energy_costs = peak_cons * (peak_adj / 100)
            shoulder_energy_costs = shoulder_cons * (shoulder_adj / 100)
            off_peak_energy_costs = off_peak_cons * (off_peak_adj / 100)
            peak_demand_costs = peak_demand * peak_volume * 12
            other_volume_costs = total * (other_volume / 100)
            fixed_costs = fixed * 365
            total_costs = peak_energy_costs + shoulder_energy_costs + off_peak_energy_costs + peak_demand_costs \
                + network_volume_costs + other_volume_costs + fixed_costs
            for r, v in enumerate([peak_energy_costs, shoulder_energy_costs, off_peak_energy_costs, peak_demand_costs,
                                   network_volume_costs, other_volume_costs, fixed_costs, total_costs, total,
                                   total_costs / total]):
                values['costs'][r][y] = v

            energy = (peak_energy_costs + shoulder_energy_costs + off_peak_energy_costs) / total
            network = (peak_demand_costs + network_volume_costs) / total
            other = other_volume_costs / total
            fixed_rate = fixed_costs / total
            for r, v in enumerate([energy, network, other, fixed_rate, energy + network + other + fixed_rate]):
                values['rates'][r][y] = v

    tables = {}
    for key, (header, labels) in TABLES.items():
        tables[key] = {
            'header': header,
            'rows': [(label, v, (v[0] + v[1] + v[2]) / 3) for label, v in zip(labels, values[key])],
        }
    return {'updated': updated, 'tables': tables, 'bulk_price': tables['rates']['rows'][4][2]}


# ── Contract periods ──────────────────────────────────────────────────────────

_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def month_index(ym):
    """Months since year 0: '2027-01' → 2027 * 12. Quarter starts are multiples of 3."""
    y, m = ym[:7].split('-')
    return int(y) * 12 + int(m) - 1


def month_key(i):
    return f"{i // 12}-{i % 12 + 1:02d}"


def month_label(i):
    return f"{_MONTHS[i % 12]} {i // 12}"


def _short_month(i):
    return f"{_MONTHS[i % 12]} {str(i // 12)[-2:]}"


def period_range(start, months=12):
    return f"{month_label(start)} – {month_label(start + months - 1)}"


def short_contract(c):
    """'FY2028' → 'FY28', 'CY2027' → 'CY27', 'Q1 2027' → 'Q1 27'."""
    return c[:-4] + c[-2:] if c[-4:].isdigit() else c


def next_quarter(quote_date):
    """The first quarter that starts after the settlement date."""
    return (month_index(quote_date) // 3 + 1) * 3


def resolve_start(supply_start, quote_date):
    if supply_start == 'auto' or len(supply_start) != 7:
        return next_quarter(quote_date)
    return month_index(supply_start) // 3 * 3


def _prices(row):
    return {s: row[s] for s in STATES}


def build_curves(fy_rows, strip_rows=()):
    """
    Every contract quoted on each date, sorted by start then length:
    {quote_date: [contract, ...]}. fy_rows: (quote_date, year, NSW, VIC, QLD, SA);
    strip_rows: (quote_date, contract, 'YYYY-MM', months, NSW, VIC, QLD, SA).
    """
    by_date = {}
    for quote_date, year, nsw, vic, qld, sa in fy_rows:
        c = {'quote_date': quote_date, 'contract': f"FY{year}", 'start': (year - 1) * 12 + 6, 'months': 12,
             'NSW': nsw, 'VIC': vic, 'QLD': qld, 'SA': sa}
        by_date.setdefault(quote_date, {})[c['contract']] = c
    for quote_date, contract, start, months, nsw, vic, qld, sa in strip_rows:
        c = {'quote_date': quote_date, 'contract': contract, 'start': month_index(start), 'months': months,
             'NSW': nsw, 'VIC': vic, 'QLD': qld, 'SA': sa}
        by_date.setdefault(quote_date, {})[contract] = c
    return {d: sorted(by_date[d].values(), key=lambda c: (c['start'], c['months'])) for d in sorted(by_date)}


def read_futures_db(db_path):
    """
    (fy_rows, strip_rows) for build_curves from futures_prices.db. The strips
    table (quarterly and CY contracts, collected from 13 Nov 2026) may not exist.
    """
    conn = sqlite3.connect(db_path)
    try:
        fy = [(str(d)[:10], int(y), nsw, vic, qld, sa) for d, y, nsw, vic, qld, sa in conn.execute(
            'SELECT "Quote Date", "Year", "NSW", "VIC", "QLD", "SA" FROM futures_data')]
        has_strips = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'futures_strips'").fetchone()
        strips = [(str(r[0])[:10], *r[1:]) for r in conn.execute(
            'SELECT "Quote Date", "Contract", "Start", "Months", "NSW", "VIC", "QLD", "SA" FROM futures_strips')] if has_strips else []
    finally:
        conn.close()
    return fy, strips


def _scaled(c, f):
    return {s: c[s] * f for s in STATES}


def _price_quarter(curve, q, period_start, carry_rate):
    quarter = next((c for c in curve if c['months'] == 3 and c['start'] == q), None)
    if quarter:
        return {**_scaled(quarter, 1), 'start': q, 'source': quarter['contract'], 'estimate': None}

    def overlap(c):
        return min(c['start'] + 12, period_start + 12) - max(c['start'], period_start)
    annual = sorted((c for c in curve if c['months'] == 12 and c['start'] <= q < c['start'] + 12), key=lambda c: -overlap(c))
    if annual:
        return {**_scaled(annual[0], 1), 'start': q, 'source': annual[0]['contract'], 'estimate': None}

    last = curve[0]
    for b in curve[1:]:
        if b['start'] + b['months'] > last['start'] + last['months'] or \
                (b['start'] + b['months'] == last['start'] + last['months'] and b['months'] > last['months']):
            last = b
    if q >= last['start'] + last['months']:
        years = max(1, (q - last['start']) // 12)
        return {**_scaled(last, (1 + carry_rate / 100) ** years), 'start': q, 'source': last['contract'], 'estimate': 'carried'}
    nxt = next((c for c in curve if c['start'] > q), last)
    return {**_scaled(nxt, 1), 'start': q, 'source': nxt['contract'], 'estimate': 'backfilled'}


def price_contract(curve, start, carry_rate, years=3):
    """Three 12-month periods from `start` (a month index), priced from one day's curve."""
    if not curve:
        return []
    quote_date = curve[0]['quote_date']
    out = []
    for y in range(years):
        ps = start + y * 12
        exact = next((c for c in curve if c['months'] == 12 and c['start'] == ps), None)
        if exact:
            out.append({**_prices(exact), 'quote_date': quote_date, 'label': short_contract(exact['contract']), 'start': ps,
                        'sources': [exact['contract']], 'estimates': [], 'quarters': None, 'note': None})
            continue
        quarters = [_price_quarter(curve, ps + m, ps, carry_rate) for m in (0, 3, 6, 9)]
        row = {}
        for s in STATES:
            acc = 0
            for q in quarters:
                acc = acc + q[s]
            row[s] = acc / 4
        estimates = list(dict.fromkeys(q['estimate'] for q in quarters if q['estimate']))
        notes = []
        carried = [q for q in quarters if q['estimate'] == 'carried']
        backfilled = [q for q in quarters if q['estimate'] == 'backfilled']
        if carried:
            notes.append(f"{len(carried)} of 4 quarters carried forward from {short_contract(carried[0]['source'])} at {_num(carry_rate)}% a year")
        if backfilled:
            notes.append(f"{len(backfilled)} of 4 quarters back-filled from {short_contract(backfilled[0]['source'])} (no ASX price listed for them)")
        out.append({**row, 'quote_date': quote_date, 'label': f"{_short_month(ps)}–{_short_month(ps + 11)}", 'start': ps,
                    'sources': list(dict.fromkeys(q['source'] for q in quarters)), 'estimates': estimates,
                    'quarters': quarters, 'note': '; '.join(notes) if notes else None})
    return out


def _num(x):
    """Number as JavaScript prints it (2.5, 3, 0.25), so notes read the same in every version."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def estimate_label(e):
    return 'Carried forward' if e == 'carried' else 'Back-filled'


# ── Features ──────────────────────────────────────────────────────────────────

def quote_periods(curve, inputs):
    if not curve:
        return []
    return price_contract(curve, resolve_start(inputs['supply_start'], curve[0]['quote_date']), inputs['carry_forward_rate'])


def union_estimates(periods):
    return list(dict.fromkeys(e for p in periods for e in p['estimates']))


def compare_states(periods, inputs):
    out = []
    for state in STATE_ORDER:
        state_inputs = inputs_for_state(inputs, state)
        out.append({'state': state, 'inputs': state_inputs, 'result': calculate_bulk_prices(periods, state_inputs, state)})
    return out


def index_inputs(state):
    """
    Bulk price index reference customer: the default quote on the state's default
    large low-voltage tariff. PLACEHOLDER: profile to be confirmed (PLACEHOLDERS.md).
    """
    return apply_tariff(DEFAULT_INPUTS, default_tariff(state, 'large-lv'))


def bulk_price_index(curves, carry_rate=DEFAULT_CARRY_FORWARD_RATE):
    """
    Current method: on every settlement date, the reference customer's price for
    a three-year contract starting the next quarter. Returns
    [{'quote_date', 'prices': {state: $/kWh}, 'components': {state: [energy, network, other, fixed]}, 'estimates'}].
    """
    inputs = {s: index_inputs(s) for s in STATES}
    out = []
    for quote_date, curve in curves.items():
        periods = price_contract(curve, next_quarter(quote_date), carry_rate)
        point = {'quote_date': quote_date, 'prices': {}, 'components': {}, 'estimates': union_estimates(periods)}
        for s in STATES:
            r = calculate_bulk_prices(periods, inputs[s], s)
            point['prices'][s] = r['bulk_price']
            point['components'][s] = [r['tables']['rates']['rows'][i][2] for i in range(4)]
        out.append(point)
    return out


def validate_inputs(i):
    issues = []
    if not i['total_consumption'] > 0:
        issues.append(('total_consumption', 'Annual consumption must be more than zero.'))
    if i['peak_consumption'] + i['shoulder_consumption'] > 100:
        issues.append(('shoulder_consumption', 'Peak and shoulder shares add up to more than 100%.'))
    if not (0 < i['load_factor'] <= 1):
        issues.append(('load_factor', 'Load factor should be between 0 and 1.'))
    if not i['load_escalation'] > 0:
        issues.append(('load_escalation', 'Load escalation must be more than zero.'))
    if not i['retail_escalation'] > 0:
        issues.append(('retail_escalation', 'Retail escalation must be more than zero.'))
    if not i['carry_forward_rate'] > -100:
        issues.append(('carry_forward_rate', 'Carry-forward escalation must be more than −100%.'))
    return issues


def quote_warnings(inputs, state, periods):
    """[(kind, message)]: a tariff from another state, a placeholder tariff, or estimated periods."""
    out = []
    t = _BY_ID.get(inputs['tariff_id'])
    t_state = tariff_state(inputs['tariff_id'])
    if t_state and t_state != state:
        out.append(('mismatch', f"The network tariff is for {t_state}, but the quote is for {state}."))
    if t and t['status'] == 'placeholder':
        out.append(('placeholder', 'The network tariff is a placeholder, not a researched tariff. Network charges are indicative only.'))
    for i, p in enumerate(periods):
        if p['note']:
            out.append(('estimate', f"Year {i + 1} ({p['label']}): {p['note']}."))
    return out

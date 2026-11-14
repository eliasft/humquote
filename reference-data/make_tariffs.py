"""Builds reference-data/tariffs.json from the networks' published FY27 price lists.

Run from the repo root: python reference-data/make_tariffs.py

Each researched tariff is entered below in the units its price list uses, so every
number can be checked against the source document. The script converts them to the
units the quote model uses:

- energy: c/kWh for the peak, shoulder and off-peak periods (NUOS: distribution,
  transmission and jurisdictional scheme charges). A tariff without a shoulder period
  charges its shoulder at the off-peak rate (Endeavour N91 is the exception: its
  solar soak rate goes in the shoulder slot; see `periods`).
- demand: $/kVA/month. The model has one demand charge on the site's monthly peak
  demand, so a tariff that charges demand in several windows (peak, shoulder,
  off-peak) gets the sum of those rates, which assumes the site's peak demand occurs
  in each window: conservative for sites whose evening or overnight demand is lower.
  Daily rates (c/kVA/day) are converted at 365/12 days a month; seasonal rates are
  averaged by the months each season covers; per-kW rates are used as per-kVA.
- fixed: $/day, including the network's metering charge where it is listed apart.

Not modelled (noted on each tariff): connection unit charges (site-specific), and
pricing zones other than Ergon's East zone.
"""
import json
from pathlib import Path

OUT = Path(__file__).with_name('tariffs.json')
DAYS_PER_MONTH = 365 / 12

networks = [
    ("ausgrid", "Ausgrid", "NSW"), ("endeavour", "Endeavour Energy", "NSW"), ("essential", "Essential Energy", "NSW"),
    ("energex", "Energex", "QLD"), ("ergon", "Ergon Energy", "QLD"),
    ("citipower", "CitiPower", "VIC"), ("powercor", "Powercor", "VIC"), ("jemena", "Jemena", "VIC"),
    ("ausnet", "AusNet Services", "VIC"), ("united", "United Energy", "VIC"),
    ("sapn", "SA Power Networks", "SA"),
]

SOURCES = {
    'ausgrid': 'Ausgrid Network Price List 2026-27 (updated 27 Apr 2026), p1, prices excl. GST',
    'endeavour': 'Endeavour Energy Network Price List: Network Tariffs 2026-27, Table 1a (NUOS, excl. GST), sections 6.1 and 9',
    'essential': 'Essential Energy Network Price List and Explanatory Notes 2026-27 (V2), pp1-2 and section 5',
    'energex': 'Energex 2026-27 Network Price List (updated for Sch 8), NUOS and Metering tables; Energex Network Tariff Guide 2026-27',
    'ergon': 'Ergon Energy 2026-27 Network Price List (updated for Sch 8), NUOS and Metering tables, East zone; Ergon Energy Network Tariff Guide 2026-27',
}


def cents_per_day_to_dollars(c):
    return c / 100


def daily_to_monthly(c_per_day):
    """c/kVA/day -> $/kVA/month."""
    return c_per_day * DAYS_PER_MONTH / 100


def seasonal(high, low, high_months):
    return (high * high_months + low * (12 - high_months)) / 12


def r(x, n=4):
    return round(x + 0.0, n)


def tariff(id, net, code, name, voltage, min_mwh, max_mwh, peak, shoulder, off_peak, demand, fixed, periods, notes=(), confirm=()):
    return {
        "id": id, "network": net, "code": code, "name": name, "voltage": voltage,
        "eligibility": {"minMWh": min_mwh, "maxMWh": max_mwh}, "status": "verified",
        "energy": {"peak": r(peak), "shoulder": r(shoulder), "offPeak": r(off_peak)},
        "demand": {"rate": r(demand), "unit": "kVA", "per": "month"},
        "fixed": r(fixed), "periods": periods, "notes": list(notes),
        "source": SOURCES[net], "toConfirm": list(confirm),
    }


# --- Ausgrid (c/kWh, c/day, c/kW/day or c/kVA/day). Metering service + network access = fixed.
AUSGRID_TOU = 'Peak 3pm-9pm working weekdays, Nov-Mar and Jun-Aug (no peak in Apr, May, Sep, Oct); off-peak all other times. No shoulder period.'
ausgrid = [
    tariff('ausgrid-ea225', 'ausgrid', 'EA225', 'Small business time-of-use', 'LV', None, 100,
           39.7570, 5.8997, 5.8997, 0, cents_per_day_to_dollars(10.8329 + 218.6472), AUSGRID_TOU,
           ['Small business sites up to 100 MWh a year (the 2026-27 threshold for moving to EA302).']),
    tariff('ausgrid-ea302', 'ausgrid', 'EA302', 'LV business 100-160 MWh', 'LV', 100, 160,
           8.8231, 1.9685, 1.9685, daily_to_monthly(48.3397), cents_per_day_to_dollars(15.7260 + 653.3697),
           AUSGRID_TOU + ' Demand: highest 30-minute demand in the peak window.',
           ['Demand charge is 48.3397 c/kW/day, used here as per kVA and applied every month.']),
    tariff('ausgrid-ea305', 'ausgrid', 'EA305', 'LV business 160-750 MWh', 'LV', 160, 750,
           8.2347, 1.8459, 1.8459, daily_to_monthly(57.7962), cents_per_day_to_dollars(2546.5371), AUSGRID_TOU,
           ['Capacity charge 57.7962 c/kVA/day on the site\'s peak-window demand.']),
    tariff('ausgrid-ea310', 'ausgrid', 'EA310', 'LV business over 750 MWh', 'LV', 750, None,
           6.4889, 1.6914, 1.6914, daily_to_monthly(59.5298), cents_per_day_to_dollars(5118.1674), AUSGRID_TOU,
           ['Capacity charge 59.5298 c/kVA/day on the site\'s peak-window demand.']),
    tariff('ausgrid-ea370', 'ausgrid', 'EA370', 'HV connection', 'HV', None, None,
           4.0147, 1.9792, 1.9792, daily_to_monthly(34.6232), cents_per_day_to_dollars(7979.2649), AUSGRID_TOU,
           ['Capacity charge 34.6232 c/kVA/day on the site\'s peak-window demand.']),
]

# --- Endeavour (c/day, c/kWh, c/kVA/day). High season Nov-Mar (5 months), low season Apr-Oct.
ENDEAVOUR_GS = ('Peak 4pm-8pm business days; solar soak 10am-2pm every day (charged as the shoulder rate here); '
                'off-peak all other times. Peak rate averages high season (Nov-Mar) and low season (Apr-Oct).')
ENDEAVOUR_LARGE = ('Peak 4pm-8pm business days; off-peak all other times (no shoulder). Peak energy and demand '
                   'average high season (Nov-Mar) and low season (Apr-Oct); demand is charged in the peak window only.')
endeavour = [
    tariff('endeavour-n91', 'endeavour', 'N91', 'General supply seasonal time-of-use', 'LV', None, 160,
           seasonal(25.1552, 16.9123, 5), 5.1696, 13.4421, 0, cents_per_day_to_dollars(98.8821), ENDEAVOUR_GS,
           ['Default for low-voltage business sites, including all new sites until 12 months of use show over 160 MWh.']),
    tariff('endeavour-n19', 'endeavour', 'N19', 'LV seasonal time-of-use demand', 'LV', 160, None,
           seasonal(6.1024, 5.5284, 5), 4.2432, 4.2432, daily_to_monthly(seasonal(53.11, 48.33, 5)),
           cents_per_day_to_dollars(2414.00), ENDEAVOUR_LARGE,
           ['Default for LV business sites over 160 MWh a year with kVA demand metering.']),
    tariff('endeavour-n29', 'endeavour', 'N29', 'HV seasonal time-of-use demand', 'HV', None, None,
           seasonal(2.9405, 2.8733, 5), 2.7231, 2.7231, daily_to_monthly(seasonal(41.96, 41.40, 5)),
           cents_per_day_to_dollars(8465.00), ENDEAVOUR_LARGE),
]

# --- Essential ($/day, c/kWh, $/kVA/month).
ESSENTIAL_PSO = 'Peak 5pm-8pm weekdays; shoulder 7am-5pm and 8pm-10pm weekdays; off-peak 10pm-7am weekdays and all weekend.'
ESSENTIAL_SS = 'Peak 7am-10am and 3pm-10pm every day; off-peak 10am-3pm and 10pm-7am. No shoulder period.'
essential = [
    tariff('essential-blnbss1', 'essential', 'BLNBSS1', 'Small business time-of-use (Sun Soaker)', 'LV', None, 160,
           18.9741, 8.5988, 8.5988, 0, 2.3784, ESSENTIAL_SS,
           ['Default for new and upgraded small business sites up to 160 MWh a year.']),
    tariff('essential-blnd3ao', 'essential', 'BLND3AO', 'LV large business demand', 'LV', 160, None,
           7.0201, 5.6141, 3.6450, 12.0390 + 10.8924 + 2.8541, 22.3346,
           ESSENTIAL_PSO + ' Demand: highest 30-minute kVA in each period, each month.',
           ['Default for LV business sites over 160 MWh a year.',
            'Demand rate is the sum of peak (12.0390), shoulder (10.8924) and off-peak (2.8541) $/kVA/month.']),
    tariff('essential-blnd3to', 'essential', 'BLND3TO', 'LV demand, alternative', 'LV', 160, None,
           19.2768, 14.6931, 6.7066, 15.4853, 22.3346,
           ESSENTIAL_PSO + ' Demand: highest 30-minute kVA in the peak or shoulder period, each month.',
           ['Optional instead of BLND3AO: higher energy rates, one lower demand charge.']),
    tariff('essential-bhnd3ao', 'essential', 'BHND3AO', 'HV business demand', 'HV', None, None,
           5.2283, 4.2238, 3.4717, 11.5026 + 10.4071 + 3.1143, 27.4319,
           ESSENTIAL_PSO + ' Demand: highest 30-minute kVA in each period, each month.',
           ['Default for business sites connected and metered at HV.',
            'Demand rate is the sum of peak (11.5026), shoulder (10.4071) and off-peak (3.1143) $/kVA/month.']),
    tariff('essential-blnt1ao', 'essential', 'BLNT1AO', 'Small business time-of-use (closed to new sites)', 'LV', None, 160,
           21.6514, 16.9328, 9.0349, 0, 2.3784, ESSENTIAL_PSO,
           ['Obsolete: existing sites only, not available for new connections or tariff changes.']),
]

# --- Energex ($/day, $/kWh, $/kVA/month). NUOS plus the separate metering charge ($0.123/day, SAC).
ENERGEX_SMALL = 'Peak 5pm-8pm weekdays; shoulder 1pm-5pm and 8pm-11am weekdays, 1pm-11am weekends; off-peak 11am-1pm every day.'
EX_MET = 0.123
energex = [
    tariff('energex-6800', 'energex', '6800', 'Small business time-of-use energy', 'LV', None, 100,
           26.318, 7.695, 1.627, 0, 1.344 + EX_MET, ENERGEX_SMALL,
           ['Default for small business sites (up to 100 MWh a year) with a smart meter.']),
    tariff('energex-7200', 'energex', '7200', 'Large time-of-use demand and energy', 'LV', 100, None,
           1.876, 2.947, 1.627, 13.913 + 3.672, 9.257 + EX_MET,
           ENERGEX_SMALL + ' Demand: highest 30-minute kVA in the peak and shoulder windows, each month.',
           ['Default for sites over 100 MWh a year with a smart meter.',
            'Demand rate is the sum of peak (13.913) and shoulder (3.672) $/kVA/month.']),
    tariff('energex-8300', 'energex', '8300', 'Demand small (anytime demand)', 'LV', 100, None,
           3.365, 3.365, 3.365, 13.913, 10.44 + EX_MET,
           'Flat energy rate at all times. Demand: highest 30-minute kVA at any time, each month.',
           ['Optional for sites over 100 MWh a year with kVA metering.']),
    tariff('energex-94300', 'energex', '94300', 'Large time-of-use energy', 'LV', 100, 160,
           25.876, 19.54, 1.627, 0, 7.9 + EX_MET, ENERGEX_SMALL,
           ['Optional for sites using 100-160 MWh a year with monthly peak demand over 120 kVA.']),
    tariff('energex-7400', 'energex', '7400', '11kV time-of-use demand (line connected)', 'HV', None, None,
           2.23, 2.23, 2.23, 12.018, 25.986,
           'Flat energy rate at all times. Demand: highest 30-minute kVA 9am-9pm weekdays, each month.',
           ['Default for sites connected to an 11 kV line.', 'Connection unit charges ($7.525/unit/day) are site-specific and not included.']),
    tariff('energex-4000', 'energex', '4000', '11kV bus (dedicated feeder)', 'HV', None, None,
           1.379, 1.379, 1.379, 8.495, 110.27,
           'Peak 7am-11pm weekdays, off-peak other times (same energy rate). Demand: highest 30-minute kVA, each month.',
           ['Default for sites on a dedicated 11 kV feeder from a zone substation bus.',
            'Connection unit charges ($7.525/unit/day) are site-specific and not included.']),
]

# --- Ergon, East zone ($/day, $/kWh, $/kVA/month). Metering $0.116/day (SAC).
ERGON_SMALL = ENERGEX_SMALL
ER_MET = 0.116
ergon = [
    tariff('ergon-ebtouet1', 'ergon', 'EBTOUET1', 'Small business time-of-use energy', 'LV', None, 100,
           25.594, 6.971, 1.47, 0, 3.445 + ER_MET, ERGON_SMALL,
           ['Default for small business sites (up to 100 MWh a year) with a smart meter.', 'East pricing zone.']),
    tariff('ergon-eltoudt1', 'ergon', 'ELTOUDT1', 'Large time-of-use demand and energy', 'LV', 100, None,
           26.485, 5.247, 4.485, 13.52 + 5.632, 53.46 + ER_MET,
           ERGON_SMALL + ' Demand: highest 30-minute kVA in the peak and shoulder windows, each month.',
           ['Default for sites over 100 MWh a year with a smart meter.', 'East pricing zone.',
            'Demand rate is the sum of peak (13.52) and shoulder (5.632) $/kVA/month.']),
    tariff('ergon-edstt1', 'ergon', 'EDSTT1', 'Demand small (anytime demand)', 'LV', 100, None,
           4.477, 4.477, 4.477, 21.858, 56.898 + ER_MET,
           'Flat energy rate at all times. Demand: highest 30-minute kVA at any time, each month.',
           ['Optional for sites over 100 MWh a year.', 'East pricing zone.']),
    tariff('ergon-eltouet1', 'ergon', 'ELTOUET1', 'Large time-of-use energy', 'LV', 100, 160,
           26.485, 20.333, 4.485, 0, 268.962 + ER_MET, ERGON_SMALL,
           ['Optional for sites using 100-160 MWh a year.', 'East pricing zone.'], ['eligibility']),
    tariff('ergon-ec22lt1', 'ergon', 'EC22LT1', '22/11 kV line', 'HV', None, None,
           2.897, 2.897, 2.897, 11.092 + 8.579, 113.779,
           'Flat energy rate at all times. Demand: highest 30-minute kVA, each month; capacity on authorised demand.',
           ['Default for sites connected to a 22 or 11 kV line.', 'East pricing zone.',
            'Demand rate is demand (11.092) plus capacity (8.579) $/kVA/month, taking authorised demand as the peak demand.',
            'Connection unit charges ($7.463/unit/day) are site-specific and not included.']),
]

# --- Past years' rates, for the bulk price index (each index date uses the rates of
# the financial year it falls in). Only the index's reference tariffs (each state's
# default network, the tariff it suggests for the default profile) have them; every
# other tariff, and every year without an entry, uses the current year's rates.
# Entered in each price list's own units, like the current rates above.
ESSENTIAL_HISTORY_SOURCES = {
    'FY22': 'Essential Energy Network Price List 2021-22 (AER, annual pricing 2021-22, Att. 5), excl. GST',
    'FY23': 'Essential Energy Network price list 2022-23 (AER, annual pricing 2022-23, Att. 1a), excl. GST',
    'FY24': 'Essential Energy Network Price List 2023-24 (AER, annual pricing 2023-24), excl. GST',
    'FY25': 'Essential Energy Network Price List and Explanatory Notes 2024-25, p1, excl. GST',
    'FY26': 'Essential Energy Network Price List and Explanatory Notes 2025-26 (V2), p1, excl. GST',
}
ENERGEX_HISTORY_SOURCES = {
    'FY22': 'Energex 2021-22 Network Price List (AER, annual pricing 2021-22, Att. 1), SAC and Metering Services sheets',
    'FY23': 'Energex 2022-23 Network Price List updated 11 May 2022 (AER), SAC and Metering Services sheets',
    'FY24': 'Energex 2023-24 Network Price List 27 Apr 2023 (AER), SAC Large and ACS Metering sheets',
    'FY25': 'Energex 2024-25 Network Price List 28 Mar 2024 (AER), SAC Large and ACS Metering sheets',
    'FY26': 'Energex 2025-26 Network Price List (updated for Sch 8), SAC Large sheet incl. metering',
}


def year_rates(source, peak, shoulder, off_peak, demand, fixed):
    return {"energy": {"peak": r(peak), "shoulder": r(shoulder), "offPeak": r(off_peak)},
            "demand": {"rate": r(demand), "unit": "kVA", "per": "month"}, "fixed": r(fixed), "source": source}


def essential_year(fy, access, peak, shoulder, off_peak, d_peak, d_shoulder, d_off):
    # $/day, c/kWh, $/kVA/month in each window (summed, as for the current year)
    return year_rates(ESSENTIAL_HISTORY_SOURCES[fy], peak, shoulder, off_peak, d_peak + d_shoulder + d_off, access)


def energex_flat_year(fy, fixed, metering, volume, peak_demand):
    # $/day, $/day, $/kWh, $/kVA/month. Until FY25, 7200 had one volume rate and charged
    # demand in the peak window plus "excess demand" above it at any other time. With the
    # model's single demand (the same in every window) the excess is zero, so only the
    # peak-window rate counts; that matches summing the windows from FY26.
    return year_rates(ENERGEX_HISTORY_SOURCES[fy], volume * 100, volume * 100, volume * 100, peak_demand, fixed + metering)


HISTORY = {
    'essential-blnd3ao': {
        'FY22': essential_year('FY22', 15.4796, 4.8933, 4.1494, 2.7476, 10.1188, 9.1551, 2.2584),
        'FY23': essential_year('FY23', 15.8085, 5.0624, 4.1956, 2.7850, 10.2257, 9.2519, 2.3064),
        'FY24': essential_year('FY24', 17.7679, 4.8555, 3.9090, 2.5321, 10.9642, 9.9200, 2.5993),
        'FY25': essential_year('FY25', 19.1811, 5.4893, 4.4186, 2.8850, 11.0681, 10.0140, 2.6240),
        'FY26': essential_year('FY26', 20.8017, 6.1763, 4.9580, 3.2273, 11.7932, 10.6700, 2.7959),
    },
    'energex-7200': {
        # FY22 and FY23 lists show no daily charge for 7200, only ACS capital metering.
        'FY22': energex_flat_year('FY22', 0, 0.07106, 0.02746, 12.582),
        'FY23': energex_flat_year('FY23', 0, 0.07353, 0.01709, 13.555),
        'FY24': energex_flat_year('FY24', 4.881, 0.07907, 0.01784, 14.18),
        'FY25': energex_flat_year('FY25', 4.994, 0.08249, 0.02484, 15.254),
        # FY26: time-of-use energy and peak + shoulder demand, as in FY27.
        'FY26': year_rates(ENERGEX_HISTORY_SOURCES['FY26'], 1.736, 2.611, 0.476, 13.427 + 3.0, 7.665 + 0.121),
    },
}

researched = {'ausgrid': ausgrid, 'endeavour': endeavour, 'essential': essential, 'energex': energex, 'ergon': ergon}

# Networks not yet researched (VIC and SA) keep three placeholder kinds, copying the
# rates of an Essential tariff of the same kind so their charges are stand-ins.
KINDS = {
    'lv-demand': {'name': 'LV business demand', 'voltage': 'LV', 'eligibility': {'minMWh': 100, 'maxMWh': None}, 'copy': 'essential-blnd3ao'},
    'lv-tou': {'name': 'LV business time-of-use', 'voltage': 'LV', 'eligibility': {'minMWh': None, 'maxMWh': 160}, 'copy': 'essential-blnbss1'},
    'hv-demand': {'name': 'HV demand', 'voltage': 'HV', 'eligibility': {'minMWh': None, 'maxMWh': None}, 'copy': 'essential-bhnd3ao'},
}
PLACEHOLDER_ID = {'lv-demand': '{n}-large-lv-placeholder', 'lv-tou': '{n}-small-placeholder', 'hv-demand': '{n}-hv-placeholder'}

by_id = {t['id']: t for ts in researched.values() for t in ts}
for tid, years in HISTORY.items():
    by_id[tid]['history'] = years
tariffs = []
for nid, name, state in networks:
    if nid in researched:
        tariffs.extend(researched[nid])
        continue
    for kind, k in KINDS.items():
        tmpl = by_id[k['copy']]
        tariffs.append({
            "id": PLACEHOLDER_ID[kind].format(n=nid), "network": nid, "code": "TBC", "name": k['name'],
            "voltage": k['voltage'], "eligibility": dict(k['eligibility']), "status": "placeholder",
            "energy": dict(tmpl['energy']), "demand": dict(tmpl['demand']), "fixed": tmpl['fixed'],
            "periods": "", "notes": [],
            "source": f"PLACEHOLDER: copy of {tmpl['id']} rates until this network's FY27 tariff is researched",
            "toConfirm": ["code", "rates", "eligibility"],
        })

# Ids and preset names that no longer exist, mapped to today's nearest tariff so saved
# quotes and share links still open (their own rates are kept).
retired = {
    "Energex 8300": "energex-8300", "Energex 8100": "energex-7200", "BLNT1AO": "essential-blnt1ao", "BLND3AO": "essential-blnd3ao",
    "energex-8100": "energex-7200", "energex-hv-placeholder": "energex-7400", "essential-hv-placeholder": "essential-bhnd3ao",
}
for nid, small, large, hv in [
    ('ausgrid', 'ausgrid-ea225', 'ausgrid-ea305', 'ausgrid-ea370'),
    ('endeavour', 'endeavour-n91', 'endeavour-n19', 'endeavour-n29'),
    ('ergon', 'ergon-ebtouet1', 'ergon-eltoudt1', 'ergon-ec22lt1'),
]:
    retired.update({f'{nid}-small-placeholder': small, f'{nid}-large-lv-placeholder': large, f'{nid}-hv-placeholder': hv})

doc = {
    "_readme": ("Network tariff catalogue used by every version, generated by make_tariffs.py from the networks' "
                "published price lists (edit that script, not this file). Rates are for the financial year below. "
                "status 'placeholder' entries are NOT real tariffs, and fields named in toConfirm are unverified: "
                "see PLACEHOLDERS.md. Units: energy c/kWh (peak/shoulder/offPeak; a flat tariff has all three equal), "
                "demand $/kVA/month on average monthly peak demand, fixed $/day. Eligibility: annual MWh bounds "
                "(null = no bound) and connection voltage (LV or HV); the app suggests the first tariff of a network "
                "that fits a site and warns when the chosen one doesn't. history (index reference tariffs only) holds past "
                "financial years' rates, used by the bulk price index for dates in those years. periods describes the network's time windows; "
                "notes lists how the published tariff was simplified for the model."),
    "financialYear": "FY27",
    "networks": [{"id": i, "name": n, "state": s} for i, n, s in networks],
    "defaults": {"NSW": "essential", "QLD": "energex", "VIC": "powercor", "SA": "sapn"},
    "legacyNames": retired,
    "tariffs": tariffs,
}
OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
print(len(tariffs), 'tariffs,', sum(t['status'] == 'verified' for t in tariffs), 'researched')

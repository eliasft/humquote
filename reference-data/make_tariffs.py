"""Builds reference-data/tariffs.json from the networks' published FY27 price lists.

Run from the repo root: python reference-data/make_tariffs.py

Each researched tariff is entered below in the units its price list uses, so every
number can be checked against the source document. The script converts them to the
units the quote model uses:

- energy: c/kWh for the peak, shoulder and off-peak periods (NUOS: distribution,
  transmission and jurisdictional scheme charges). A tariff without a shoulder period
  charges its shoulder at the off-peak rate (Endeavour N91 is the exception: its
  solar soak rate goes in the shoulder slot; see `periods`).
- demand: $/kVA/month, one rate per demand charge on the bill (see demand lines).
  Without bill figures, every line is charged on the same estimated demand, which
  assumes the site's maximum occurs in each window: conservative for sites whose
  evening or overnight demand is lower. Daily rates (c/kVA/day) are converted at 365/12 days a month; seasonal rates are
  averaged by the months each season covers; per-kW rates are used as per-kVA.
- fixed: $/day, including the network's metering charge where it is listed apart.
- demand lines: each demand charge as it appears on a bill (e.g. Essential's peak,
  shoulder and off-peak kVA), with its window and how its kVA is set ('month': the
  highest 30-minute kVA in the window each month; '12 months': the highest over the
  previous 12 months; 'agreed': authorised demand). The quote can price each line
  from the bill's kVA; `rate` is their sum, which is the cost when every line takes
  the same estimated demand.
- energy windows: the network's own peak, shoulder and off-peak windows (null where
  the tariff has no such window, or for a flat tariff), so the quote can split the
  site's kWh the way the bill does.

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
    'ausgrid': 'Ausgrid Network Price List 2026-27 (updated 27 Apr 2026), p1, prices excl. GST; time windows and '
               'charge definitions: Ausgrid 2026-27 Pricing Proposal, Attachment A Statement of compliance, section 3.1',
    'endeavour': 'Endeavour Energy Network Price List: Network Tariffs 2026-27, Table 1a (NUOS, excl. GST), sections 6.1 and 9',
    'essential': 'Essential Energy Network Price List and Explanatory Notes 2026-27 (V2), pp1-2 and section 5',
    'energex': 'Energex 2026-27 Network Price List (updated for Sch 8), NUOS and Metering tables; Energex Network Tariff Guide 2026-27',
    'ergon': 'Ergon Energy 2026-27 Network Price List (updated for Sch 8), NUOS and Metering tables, East zone; Ergon Energy Network Tariff Guide 2026-27; '
             'large time-of-use energy eligibility: AER final decision, 2025-30 tariff structure statements, Attachment 19, section 19.4.5.1',
    'powercor': 'Powercor 2026-27 Pricing (7 May 2026, public), tariff classes and criteria, Tables 5 and 6, section 2.5; '
                'Powercor FINAL 2026-27 Tariff Summary (7 May 2026, public), sheet PAL_2026-27_NUOS (DUoS + TUoS + JSA, excl. GST); '
                'Powercor large business tariffs fact sheet',
    'sapn': 'SA Power Networks Annual Pricing Proposal Overview 2026-27 (July 2026), Table 9 NUoS Tariff Schedule (excl. GST), '
            'Tables 3-6 tariff structures and charging parameters',
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


def tariff(id, net, code, name, voltage, min_mwh, max_mwh, peak, shoulder, off_peak, demand, fixed, periods, notes=(), confirm=(),
           min_kva=None):
    # min_kva: a monthly demand the site must exceed (Energex 94300, Ergon ELTOUET1).
    eligibility = {"minMWh": min_mwh, "maxMWh": max_mwh, **({"minKva": min_kva} if min_kva else {})}
    return {
        "id": id, "network": net, "code": code, "name": name, "voltage": voltage,
        "eligibility": eligibility, "status": "verified",
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
           AUSGRID_TOU + ' Capacity: highest 30-minute kW from 3pm to 9pm on working weekdays (any month) over the previous 12 months.',
           ['Capacity charge 48.3397 c/kW/day on the highest peak-window kW of the previous 12 months, charged every day '
            'of the year (it is not the summer/winter "high season" demand charge). Used here as per kVA.']),
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
            'Three demand charges, each on its own monthly maximum: peak (12.0390), shoulder (10.8924) and off-peak (2.8541) $/kVA/month.']),
    tariff('essential-blnd3to', 'essential', 'BLND3TO', 'LV demand, alternative', 'LV', 160, None,
           19.2768, 14.6931, 6.7066, 15.4853, 22.3346,
           ESSENTIAL_PSO + ' Demand: highest 30-minute kVA in the peak or shoulder period, each month.',
           ['Optional instead of BLND3AO: higher energy rates, one lower demand charge.']),
    tariff('essential-bhnd3ao', 'essential', 'BHND3AO', 'HV business demand', 'HV', None, None,
           5.2283, 4.2238, 3.4717, 11.5026 + 10.4071 + 3.1143, 27.4319,
           ESSENTIAL_PSO + ' Demand: highest 30-minute kVA in each period, each month.',
           ['Default for business sites connected and metered at HV.',
            'Three demand charges, each on its own monthly maximum: peak (11.5026), shoulder (10.4071) and off-peak (3.1143) $/kVA/month.']),
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
            'Two demand charges, each on its own monthly maximum: peak (13.913) and shoulder (3.672) $/kVA/month.']),
    tariff('energex-8300', 'energex', '8300', 'Demand small (anytime demand)', 'LV', 100, None,
           3.365, 3.365, 3.365, 13.913, 10.44 + EX_MET,
           'Flat energy rate at all times. Demand: highest 30-minute kVA at any time, each month.',
           ['Optional for sites over 100 MWh a year with kVA metering.']),
    tariff('energex-94300', 'energex', '94300', 'Large time-of-use energy', 'LV', 100, 160,
           25.876, 19.54, 1.627, 0, 7.9 + EX_MET, ENERGEX_SMALL,
           ['Optional for sites using 100-160 MWh a year with monthly peak demand over 120 kVA.'], min_kva=120),
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
            'Two demand charges, each on its own monthly maximum: peak (13.52) and shoulder (5.632) $/kVA/month.']),
    tariff('ergon-edstt1', 'ergon', 'EDSTT1', 'Demand small (anytime demand)', 'LV', 100, None,
           4.477, 4.477, 4.477, 21.858, 56.898 + ER_MET,
           'Flat energy rate at all times. Demand: highest 30-minute kVA at any time, each month.',
           ['Optional for sites over 100 MWh a year.', 'East pricing zone.']),
    tariff('ergon-eltouet1', 'ergon', 'ELTOUET1', 'Large time-of-use energy', 'LV', 100, 160,
           26.485, 20.333, 4.485, 0, 268.962 + ER_MET, ERGON_SMALL,
           ['Optional, on request, for sites with a smart meter that used under 160 MWh in the previous 12 months '
            'and have monthly demand over 120 kVA; Ergon reviews eligibility each year.', 'East pricing zone.'],
           min_kva=120),
    tariff('ergon-ec22lt1', 'ergon', 'EC22LT1', '22/11 kV line', 'HV', None, None,
           2.897, 2.897, 2.897, 11.092 + 8.579, 113.779,
           'Flat energy rate at all times. Demand: highest 30-minute kVA, each month; capacity on authorised demand.',
           ['Default for sites connected to a 22 or 11 kV line.', 'East pricing zone.',
            'Demand (11.092) on the monthly maximum, plus capacity (8.579) $/kVA/month on authorised demand.',
            'Connection unit charges ($7.463/unit/day) are site-specific and not included.']),
]

# --- Powercor (VIC). Prices from the NUOS sheet (DUoS + TUoS + JSA), c/day, c/kWh, $/kVA/month.
# Local time (AEDT). Metering charges are not in the NUOS schedule and are not included.
PC_SMALL = 'Peak 9am-9pm workdays; off-peak all other times. No shoulder period.'
PC_MED = 'One energy rate at all times (the bill shows peak 7am-11pm workdays and off-peak otherwise at the same rate). Demand: highest 30-minute kW 10am-6pm workdays, each month; summer Dec-Mar, non-summer Apr-Nov.'
PC_LARGE = ('Peak 7am-7pm workdays; off-peak all other times. Demand: 12-month rolling maximum 15-minute kVA 7am-7pm workdays, '
            'plus an incentive demand on the maximum kVA in a three-hour window in four months of the year '
            '(1-4pm or 4-7pm workdays in Dec-Mar, or 4-7pm workdays in May-Aug, by zone substation).')
PC_INCENTIVE_MONTHS = 4
powercor = [
    tariff('powercor-ndtou', 'powercor', 'NDTOU', 'Small business time-of-use', 'LV', None, 40,
           19.66, 4.91, 4.91, 0, cents_per_day_to_dollars(71.24), PC_SMALL,
           ['Default for small business sites up to 40 MWh a year, and for new connections and solar or battery upgrades.',
            'Metering charges are not in the NUOS schedule and are not included.']),
    tariff('powercor-ndm', 'powercor', 'NDM', 'Medium business demand', 'LV', 40, 160,
           6.82, 6.82, 6.82, seasonal(23.11, 10.20, 4), cents_per_day_to_dollars(410.96), PC_MED,
           ['Default for sites using 40-160 MWh a year. Demand 23.11 $/kW/month in summer (Dec-Mar) and 10.20 in '
            'non-summer (Apr-Nov), averaged by month and used here as per kVA.',
            'Metering charges are not in the NUOS schedule and are not included.']),
    tariff('powercor-ndmo', 'powercor', 'NDMO21', 'Medium business opt-out (time-of-use)', 'LV', 40, 160,
           19.27, 6.49, 6.49, 0, cents_per_day_to_dollars(410.96),
           'Peak 10am-6pm workdays; off-peak all other times. No shoulder period.',
           ['Optional for NDM sites using under 160 MWh a year (opt-out of the demand tariff).',
            'Metering charges are not in the NUOS schedule and are not included.']),
    tariff('powercor-llv', 'powercor', 'LLV1/2/3', 'Large low voltage demand', 'LV', 160, None,
           4.34, 3.08, 3.08, r(12.10) + r(10.60 * PC_INCENTIVE_MONTHS / 12), 0, PC_LARGE,
           ['Default for LV sites over 160 MWh a year. LLV1, LLV2 and LLV3 have the same prices and differ only in the incentive window.',
            'Rolling demand 12.10 $/kVA/month; incentive demand 10.60 $/kVA/month in four months a year (shown averaged over 12).',
            'No daily supply charge in the NUOS schedule; metering charges are not included.']),
    tariff('powercor-hv', 'powercor', 'HV1/2/3', 'High voltage demand', 'HV', None, None,
           2.64, 2.10, 2.10, r(8.21) + r(8.80 * PC_INCENTIVE_MONTHS / 12), 0, PC_LARGE,
           ['Default for HV sites (1 kV to 66 kV). HV1, HV2 and HV3 have the same prices and differ only in the incentive window.',
            'Rolling demand 8.21 $/kVA/month, with a minimum chargeable demand of 500 kVA (not modelled); incentive demand 8.80 '
            '$/kVA/month in four months a year (shown averaged over 12).',
            'No daily supply charge in the NUOS schedule; metering charges are not included.']),
]

# --- SA Power Networks ($/day, $/kWh, $/kVA/day). NUoS schedule, non-CBD codes. Meter charge ($0.0262/day) is in
# the fixed charge where the schedule lists one. Local time (ACST/ACDT).
SAPN_SMALL = ('Peak 5pm-9pm every day Nov-Mar (no peak Apr-Oct); shoulder 7am-5pm workdays Nov-Mar and 7am-9pm workdays Apr-Oct; '
              'off-peak all other times.')
SAPN_LARGE = 'Peak 7am-9pm workdays; off-peak all other times. No shoulder period.'
SA_MET = 0.0262


def dollars_per_day_to_monthly(d_per_day):
    """$/kVA/day -> $/kVA/month."""
    return d_per_day * DAYS_PER_MONTH


def monthly_sum(*d_per_day):
    """Sum of several $/kVA/day demand charges as $/kVA/month; each is rounded first, as it is on its own demand line."""
    return sum(r(dollars_per_day_to_monthly(d)) for d in d_per_day)


sapn = [
    tariff('sapn-sbtou', 'sapn', 'SBTOU', 'Small business time-of-use', 'LV', None, 160,
           28.72, 19.98, 10.79, 0, 0.6645 + SA_MET, SAPN_SMALL,
           ['Default for small business sites up to 40 MWh a year and under 120 kVA; any site up to 160 MWh may choose it.']),
    tariff('sapn-mbtoud', 'sapn', 'MBTOUD', 'Medium business time-of-use demand', 'LV', 40, 160,
           20.73, 14.42, 7.80, dollars_per_day_to_monthly(0.0861), 1.5082 + SA_MET, SAPN_SMALL +
           ' Demand: highest 30-minute kVA in the last 12 months.',
           ['Default for sites using 40-160 MWh a year with demand over 120 kVA; a site up to 160 MWh may choose SBTOU instead.'],
           min_kva=120),
    tariff('sapn-lbad', 'sapn', 'LBAD', 'Large LV business annual demand', 'LV', 160, None,
           10.19, 6.37, 6.37, monthly_sum(0.3408, 0.0630), 8.6002, SAPN_LARGE +
           ' Demand: peak demand (highest daily average 5pm-9pm every day, Nov-Mar, billed all year) and anytime demand '
           '(highest 30-minute kVA), each over the last 12 months.',
           ['Default for LV sites over 160 MWh a year.',
            'Two demand charges: peak 0.3408 and anytime 0.0630 $/kVA/day.']),
    tariff('sapn-lbmd', 'sapn', 'LBMD', 'Large LV business monthly demand', 'LV', 160, None,
           10.19, 6.37, 6.37, monthly_sum(1.2357 * 5 / 12, 0.0630), 8.6002, SAPN_LARGE +
           ' Demand: peak demand billed each month Nov-Mar only; anytime demand over the last 12 months.',
           ['Optional (customer choice) instead of LBAD.',
            'Peak demand 1.2357 $/kVA/day in Nov-Mar only (5 months, averaged over 12); anytime 0.0630 $/kVA/day.']),
    tariff('sapn-hvad', 'sapn', 'HVAD', 'HV business annual demand', 'HV', None, None,
           7.30, 4.56, 4.56, monthly_sum(0.2696, 0.0849), 45.3698, SAPN_LARGE +
           ' Demand: peak demand (highest daily average 5pm-9pm every day, Nov-Mar, billed all year) and anytime demand '
           '(highest 30-minute kVA), each over the last 12 months.',
           ['Default for sites connected at HV.', 'Two demand charges: peak 0.2696 and anytime 0.0849 $/kVA/day.',
            'HVAD500 (annual demand under 500 kVA) is not included.']),
]

# --- Demand lines as they appear on a bill, and the network's energy windows.


def line(label, window, rate, basis='month'):
    return {"label": label, "window": window, "rate": r(rate), "basis": basis}


def demand_of(lines):
    return {"rate": r(sum(l['rate'] for l in lines)), "unit": "kVA", "per": "month", "lines": lines}


def essential_lines(peak, shoulder, off_peak):
    return [line('Peak demand', '5pm-8pm weekdays', peak),
            line('Shoulder demand', '7am-5pm and 8pm-10pm weekdays', shoulder),
            line('Off-peak demand', '10pm-7am weekdays and all weekend', off_peak)]


def energex_lines(peak, shoulder):
    # Energex and Ergon: off-peak (11am-1pm) demand is charged at $0.
    return [line('Peak demand', '5pm-8pm weekdays', peak),
            line('Shoulder demand', 'all times except 11am-1pm and the peak window', shoulder)]


def capacity(c_per_kva_day):
    return [line('Capacity', '3pm-9pm working weekdays', daily_to_monthly(c_per_kva_day), '12 months')]


LINES = {
    'ausgrid-ea302': [line('Capacity (kW)', '3pm-9pm working weekdays', daily_to_monthly(48.3397), '12 months')],
    'ausgrid-ea305': capacity(57.7962),
    'ausgrid-ea310': capacity(59.5298),
    'ausgrid-ea370': capacity(34.6232),
    'endeavour-n19': [line('Peak demand', '4pm-8pm business days', daily_to_monthly(seasonal(53.11, 48.33, 5)))],
    'endeavour-n29': [line('Peak demand', '4pm-8pm business days', daily_to_monthly(seasonal(41.96, 41.40, 5)))],
    'essential-blnd3ao': essential_lines(12.0390, 10.8924, 2.8541),
    'essential-blnd3to': [line('Peak/shoulder demand', '7am-10pm weekdays', 15.4853)],
    'essential-bhnd3ao': essential_lines(11.5026, 10.4071, 3.1143),
    'energex-7200': energex_lines(13.913, 3.672),
    'energex-8300': [line('Anytime demand', 'any time', 13.913)],
    'energex-7400': [line('Demand', '9am-9pm workdays', 12.018)],
    'energex-4000': [line('Demand', 'any time', 8.495)],
    'ergon-eltoudt1': energex_lines(13.52, 5.632),
    'ergon-edstt1': [line('Anytime demand', 'any time', 21.858)],
    'ergon-ec22lt1': [line('Demand', 'any time', 11.092), line('Capacity', 'authorised demand', 8.579, 'agreed')],
    'powercor-ndm': [line('Demand', '10am-6pm workdays (summer Dec-Mar 23.11, non-summer 10.20 $/kW/month)', seasonal(23.11, 10.20, 4))],
    'powercor-llv': [line('Rolling peak demand', '7am-7pm workdays', 12.10, '12 months'),
                     line('Incentive demand', '3-hour window, four months a year', 10.60 * PC_INCENTIVE_MONTHS / 12)],
    'powercor-hv': [line('Rolling peak demand', '7am-7pm workdays', 8.21, '12 months'),
                    line('Incentive demand', '3-hour window, four months a year', 8.80 * PC_INCENTIVE_MONTHS / 12)],
    'sapn-mbtoud': [line('Anytime demand', 'any time', dollars_per_day_to_monthly(0.0861), '12 months')],
    'sapn-lbad': [line('Peak demand', '5pm-9pm every day Nov-Mar, billed all year', dollars_per_day_to_monthly(0.3408), '12 months'),
                  line('Anytime demand', 'any time', dollars_per_day_to_monthly(0.0630), '12 months')],
    'sapn-lbmd': [line('Peak demand', '5pm-9pm every day, Nov-Mar only', dollars_per_day_to_monthly(1.2357 * 5 / 12)),
                  line('Anytime demand', 'any time', dollars_per_day_to_monthly(0.0630), '12 months')],
    'sapn-hvad': [line('Peak demand', '5pm-9pm every day Nov-Mar, billed all year', dollars_per_day_to_monthly(0.2696), '12 months'),
                  line('Anytime demand', 'any time', dollars_per_day_to_monthly(0.0849), '12 months')],
}


def windows(peak, shoulder, off_peak):
    return {"peak": peak, "shoulder": shoulder, "offPeak": off_peak}


AUSGRID_W = windows('3pm-9pm working weekdays (Nov-Mar, Jun-Aug)', None, 'all other times')
ENDEAVOUR_W = windows('4pm-8pm business days', None, 'all other times')
ESSENTIAL_W = windows('5pm-8pm weekdays', '7am-5pm and 8pm-10pm weekdays', '10pm-7am weekdays and all weekend')
ENERGEX_W = windows('5pm-8pm weekdays', '8pm-11am and 1pm-5pm weekdays, 1pm-11am weekends', '11am-1pm every day')
PC_LARGE_W = windows('7am-7pm workdays', None, 'all other times')
SAPN_SMALL_W = windows('5pm-9pm every day Nov-Mar', '7am-5pm workdays Nov-Mar, 7am-9pm workdays Apr-Oct', 'all other times')
SAPN_LARGE_W = windows('7am-9pm workdays', None, 'all other times')
ENERGY_WINDOWS = {
    'powercor-ndtou': windows('9am-9pm workdays', None, 'all other times'),
    'powercor-ndmo': windows('10am-6pm workdays', None, 'all other times'),
    'powercor-llv': PC_LARGE_W, 'powercor-hv': PC_LARGE_W,
    'sapn-sbtou': SAPN_SMALL_W, 'sapn-mbtoud': SAPN_SMALL_W,
    **{t: SAPN_LARGE_W for t in ('sapn-lbad', 'sapn-lbmd', 'sapn-hvad')},
    **{t: AUSGRID_W for t in ('ausgrid-ea225', 'ausgrid-ea302', 'ausgrid-ea305', 'ausgrid-ea310', 'ausgrid-ea370')},
    'endeavour-n91': windows('4pm-8pm business days', 'solar soak 10am-2pm every day', 'all other times'),
    'endeavour-n19': ENDEAVOUR_W, 'endeavour-n29': ENDEAVOUR_W,
    'essential-blnbss1': windows('7am-10am and 3pm-10pm every day', None, '10am-3pm and 10pm-7am'),
    **{t: ESSENTIAL_W for t in ('essential-blnd3ao', 'essential-blnd3to', 'essential-bhnd3ao', 'essential-blnt1ao')},
    **{t: ENERGEX_W for t in ('energex-6800', 'energex-7200', 'energex-94300', 'ergon-ebtouet1', 'ergon-eltoudt1', 'ergon-eltouet1')},
    # Flat energy (one rate at all times): powercor-ndm, energex-8300, -7400, -4000, ergon-edstt1, -ec22lt1.
}

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


def year_rates(source, peak, shoulder, off_peak, lines, fixed):
    return {"energy": {"peak": r(peak), "shoulder": r(shoulder), "offPeak": r(off_peak)},
            "demand": demand_of(lines), "fixed": r(fixed), "source": source}


def essential_year(fy, access, peak, shoulder, off_peak, d_peak, d_shoulder, d_off):
    # $/day, c/kWh, $/kVA/month in each window
    return year_rates(ESSENTIAL_HISTORY_SOURCES[fy], peak, shoulder, off_peak, essential_lines(d_peak, d_shoulder, d_off), access)


def energex_flat_year(fy, fixed, metering, volume, peak_demand):
    # $/day, $/day, $/kWh, $/kVA/month. Until FY25, 7200 had one volume rate and charged
    # demand in the peak window plus "excess demand" above it at any other time. With the
    # model's single demand (the same in every window) the excess is zero, so only the
    # peak-window rate counts; that matches summing the windows from FY26.
    return year_rates(ENERGEX_HISTORY_SOURCES[fy], volume * 100, volume * 100, volume * 100,
                      [line('Peak demand', 'peak window', peak_demand)], fixed + metering)


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
        'FY26': year_rates(ENERGEX_HISTORY_SOURCES['FY26'], 1.736, 2.611, 0.476, energex_lines(13.427, 3.0), 7.665 + 0.121),
    },
}

researched = {'ausgrid': ausgrid, 'endeavour': endeavour, 'essential': essential, 'energex': energex, 'ergon': ergon,
              'powercor': powercor, 'sapn': sapn}

# Networks not yet researched (CitiPower, Jemena, AusNet, United Energy) keep three placeholder kinds, copying the
# rates of an Essential tariff of the same kind so their charges are stand-ins.
KINDS = {
    'lv-demand': {'name': 'LV business demand', 'voltage': 'LV', 'eligibility': {'minMWh': 100, 'maxMWh': None}, 'copy': 'essential-blnd3ao'},
    'lv-tou': {'name': 'LV business time-of-use', 'voltage': 'LV', 'eligibility': {'minMWh': None, 'maxMWh': 160}, 'copy': 'essential-blnbss1'},
    'hv-demand': {'name': 'HV demand', 'voltage': 'HV', 'eligibility': {'minMWh': None, 'maxMWh': None}, 'copy': 'essential-bhnd3ao'},
}
PLACEHOLDER_ID = {'lv-demand': '{n}-large-lv-placeholder', 'lv-tou': '{n}-small-placeholder', 'hv-demand': '{n}-hv-placeholder'}

by_id = {t['id']: t for ts in researched.values() for t in ts}
for t in by_id.values():
    lines = LINES.get(t['id'], [])
    assert (t['demand']['rate'] == 0) == (not lines), t['id']
    assert demand_of(lines)['rate'] == t['demand']['rate'], (t['id'], demand_of(lines)['rate'], t['demand']['rate'])
    t['demand'] = demand_of(lines)
    t['energyWindows'] = ENERGY_WINDOWS.get(t['id'])
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
            "energyWindows": tmpl['energyWindows'],
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
    ('powercor', 'powercor-ndtou', 'powercor-llv', 'powercor-hv'),
    ('sapn', 'sapn-sbtou', 'sapn-lbad', 'sapn-hvad'),
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
                "financial years' rates, used by the bulk price index for dates in those years. demand.lines are the demand charges as a bill shows them (rate is their sum); energyWindows names the network's own peak/shoulder/offPeak windows (null for a flat tariff). periods describes the network's time windows; "
                "notes lists how the published tariff was simplified for the model."),
    "financialYear": "FY27",
    "networks": [{"id": i, "name": n, "state": s} for i, n, s in networks],
    "defaults": {"NSW": "essential", "QLD": "energex", "VIC": "powercor", "SA": "sapn"},
    "legacyNames": retired,
    "tariffs": tariffs,
}
OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
print(len(tariffs), 'tariffs,', sum(t['status'] == 'verified' for t in tariffs), 'researched')

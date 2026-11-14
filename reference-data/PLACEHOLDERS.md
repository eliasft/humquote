# Placeholders, assumptions and the research to-do list

Everything marked placeholder below is a stand-in, flagged in the web versions and
the Streamlit app wherever it affects a price. Replace each one in the file named,
then remove it from this list. Changing `tariffs.json` needs no code changes: the
next deploy picks it up.

## Research scope (decided 14 Nov 2026)

- **Customers:** C&I sites, not heavy industry: LV business tariffs and HV demand
  tariffs, not subtransmission or transmission connections.
- **States:** HUM operates in NSW, QLD, VIC and SA. **NSW and QLD come first**
  (Ausgrid, Endeavour, Essential; Energex, Ergon), then VIC and SA.
- **Network charges are passed through at cost** in HUM's contracts. The quote's
  network component is indicative; the modelling simplifications (one set of loss
  factors, network charges flat over the three years, no power factor) are accepted
  as the quoter's judgement.
- **Customer profile, to be filled in by HUM:** typical annual consumption range
  (MWh), typical peak demand (kVA), and how many sites are connected at HV. This
  decides which tariff codes are worth researching first.

## 1. Network tariffs (`reference-data/tariffs.json`)

A quote picks a **network** in its state, then one of its **tariff codes** (as shown on
the site's bill). Each tariff records its **connection voltage** (LV or HV) and the
**annual consumption it's for** (`eligibility`: minimum and maximum MWh), so the apps
suggest the tariff that fits a site and warn when the chosen one doesn't.

Each network has three entries for now, in the order the apps suggest them:

| Kind | Voltage | Placeholder eligibility |
|---|---|---|
| LV business demand | LV | 100 MWh a year or more |
| LV business time-of-use | LV | up to 160 MWh a year |
| HV demand | HV | none |

Only four tariffs are real (status `verified`, FY27 rates confirmed by HUM). Every
other entry has status `placeholder`, code `TBC`, and **copies the rates of a verified
tariff of the same kind** (Energex for Ergon; Essential elsewhere; HV entries copy the
LV demand tariff), so its charges are not that network's.

| Network | State | LV business demand | LV business time-of-use | HV demand |
|---|---|---|---|---|
| Ausgrid | NSW | placeholder | placeholder | placeholder |
| Endeavour Energy | NSW | placeholder | placeholder | placeholder |
| Essential Energy | NSW | **BLND3AO** (verified) | **BLNT1AO** (verified) | placeholder |
| Energex | QLD | **8100** (verified) | **8300** (verified) | placeholder |
| Ergon Energy | QLD | placeholder | placeholder | placeholder |
| CitiPower | VIC | placeholder | placeholder | placeholder |
| Powercor | VIC | placeholder | placeholder | placeholder |
| Jemena | VIC | placeholder | placeholder | placeholder |
| AusNet Services | VIC | placeholder | placeholder | placeholder |
| United Energy | VIC | placeholder | placeholder | placeholder |
| SA Power Networks | SA | placeholder | placeholder | placeholder |

For each network, from its AER-approved FY27 tariff schedule, record the 2–4 tariff
codes C&I sites are actually on (add or remove entries as needed; the three kinds
above are a starting point, not a rule):

- the tariff **code** and a short **name**;
- **voltage** (LV or HV) and **eligibility** (annual MWh bounds; note any kVA bounds
  in `source` until the model uses them);
- peak, shoulder and off-peak **energy rates** (c/kWh, NUOS: including TUOS and
  jurisdictional scheme charges);
- the **demand charge** ($/kVA/month on average monthly peak demand; note where a
  network charges per kW, uses a rolling 12-month peak, or has seasonal rates, as the
  model averages these to one monthly rate);
- the daily **fixed charge**, and the **source** (document and page).

Then set `status` to `verified` and clear `toConfirm`.

**To confirm for the four verified tariffs** (`toConfirm: ["name", "voltage",
"eligibility"]`): their kind, voltage and size thresholds. Assumed: BLND3AO and 8100
are LV business demand (100 MWh+); BLNT1AO and 8300 are LV business time-of-use (up
to 160 MWh).

## 2. Default network per state (`defaults` in `tariffs.json`)

Used when the state changes, by the state comparison and by the bulk price index
(each state's default network suggests the tariff).

- NSW: Essential Energy (the only researched NSW network). Consider Ausgrid, the
  largest, once researched.
- QLD: Energex.
- VIC: **Powercor (placeholder)**. Choose VIC's default network (research step).
- SA: SA Power Networks, the only SA network.

## 3. Carry-forward escalation: 2.5% a year (confirmed base case, 14 Nov 2026)

No longer a placeholder: kept here for reference. `app-b/src/core/calc.ts` and
`humquote_core.py`, `DEFAULT_CARRY_FORWARD_RATE` (keep both the same). Applied only to
months beyond the last listed ASX contract; every such period is flagged "Estimate".
Users can change it per quote, and for the bulk price index on its page.

## 4. Bulk price index reference customer (confirmed for now, 14 Nov 2026)

`app-b/src/core/analysis.ts` (`indexInputs`) and `humquote_core.py` (`index_inputs`).
The default quote (400,000 kWh, 50% peak, 0% shoulder, load factor 0.55, low voltage,
default system and service charges, load and retail escalation 1.15 × 1.15) on the
tariff each state's default network suggests for it.

## To-do: historical network charges for the index (on hold until research)

The index uses the FY27 tariffs on every date back to 2021. Planned approach: record
one network price change per network per financial year (FY22–FY26) from the AER's
annual pricing approvals, and scale today's rates back by them — about 25 numbers
rather than full tariff tables for each year.

## Not placeholders, but worth knowing

- **Quarterly and calendar-year contracts** are collected from 13 Nov 2026 onwards
  (`futures_strips`). Before then only FY strips exist, so historical quotes and the
  index fill months not covered by an FY strip by back-filling or carrying forward,
  and flag those dates.
- **Quarter averaging**: a 12-month period without a matching annual strip averages
  its quarters weighted by days. A supply start part-way through a quarter (any month
  can be chosen) gives a part quarter at each end, each weighted by its days.

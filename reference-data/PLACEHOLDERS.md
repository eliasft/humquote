# Placeholders and assumptions to research

Everything below is a stand-in, flagged in the web versions and the Streamlit app
wherever it affects a price. Replace each one in the file named, then remove it from this list. Changing
`tariffs.json` needs no code changes: the next deploy picks it up.

## 1. Network tariffs (`reference-data/tariffs.json`)

Only four tariffs are real (status `verified`, FY27 rates confirmed by HUM). Every
other entry has status `placeholder` and **copies the rates of a verified tariff in
the same segment**, so its charges are not that network's. The apps show a
"Placeholder" tag in the tariff list, a warning on the quote, and a note on the
printed sheet and in the Excel Inputs sheet.

| Network | State | Small business | Large low voltage | Placeholder rates copied from |
|---|---|---|---|---|
| Ausgrid | NSW | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| Endeavour Energy | NSW | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| Essential Energy | NSW | **BLNT1AO** (verified) | **BLND3AO** (verified) | — |
| Energex | QLD | **8300** (verified) | **8100** (verified) | — |
| Ergon Energy | QLD | placeholder | placeholder | Energex 8300 / 8100 |
| CitiPower | VIC | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| Powercor | VIC | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| Jemena | VIC | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| AusNet Services | VIC | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| United Energy | VIC | placeholder | placeholder | Essential BLNT1AO / BLND3AO |
| SA Power Networks | SA | placeholder | placeholder | Essential BLNT1AO / BLND3AO |

For each placeholder, from the network's AER-approved FY27 tariff schedule: the tariff
code; peak, shoulder and off-peak energy rates (c/kWh, NUOS, i.e. including TUOS and
jurisdictional scheme charges); demand charge ($/kVA/month on average monthly peak
demand: note where a network charges per kW, uses a rolling 12-month peak, or has
seasonal rates, as the model doesn't handle those yet); daily fixed charge; and the
`source` (document and page). Then set `status` to `verified`.

**To confirm for the verified tariffs** (`toConfirm: ["segment"]`): which segment each
belongs to. Assumed: Energex 8300 and Essential BLNT1AO are small business; Energex
8100 and Essential BLND3AO are large low voltage.

## 2. Default tariff per state (`defaults` in `tariffs.json`)

Used when the state changes, by the state comparison and by the bulk price index.

- NSW: Essential Energy (the only researched NSW network). Consider Ausgrid, the
  largest, once researched.
- QLD: Energex.
- VIC: **Powercor (placeholder)**. Choose the network to use as VIC's default.
- SA: **SA Power Networks (placeholder)**, the only SA network.

## 3. Carry-forward escalation: 2.5% a year

`app-b/src/core/calc.ts` and `humquote_core.py`, `DEFAULT_CARRY_FORWARD_RATE` (keep
both the same). Applied only to months beyond
the last listed ASX contract; every such period is flagged "Estimate". Users can
change it per quote; it's an input in every version.

## 4. Bulk price index reference customer

`app-b/src/core/analysis.ts` (`indexInputs`) and `humquote_core.py` (`index_inputs`). The default quote (400,000 kWh, 50% peak,
0% shoulder, load factor 0.55, default system and service charges, load and retail
escalation 1.15 × 1.15) on each state's default large low-voltage tariff. Replaced the
original method's fixed 14.67 $/kVA, 0.96 c/kWh and $5.38/day. Confirm the profile.

## 5. Historical network tariffs (not started)

The index uses the FY27 tariffs on every date back to 2021. The research step is to
add earlier years (FY22 to FY26) to `tariffs.json`, after which the index can use the
tariffs in force on each date.

## Not placeholders, but worth knowing

- **Quarterly and calendar-year contracts** are collected from 13 Nov 2026 onwards
  (`futures_strips`). Before then only FY strips exist, so historical quotes and the
  index fill months not covered by an FY strip by back-filling or carrying forward,
  and flag those dates.
- **Quarter averaging**: a 12-month period without a matching annual strip is the
  simple average of its four quarters (quarters differ slightly in hours).

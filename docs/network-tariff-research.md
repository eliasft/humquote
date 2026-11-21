# Network Tariff Research (NSW, QLD, VIC and SA, FY22–FY27)

Everything learnt while building HUMQuote's pricing (the Streamlit app and web versions A and B): network tariffs, how consumption and demand are modelled, how a quote and the bulk price index are built, and the ASX futures data behind them. Code and data live in the `humquote` repo:
- `reference-data/make_tariffs.py` holds every rate as printed in the price lists and generates `reference-data/tariffs.json`.
- `reference-data/PLACEHOLDERS.md` is the in-repo status list.
- `data/README.md` describes the futures data.

Last updated 21 Nov 2026.

**Keep this document current:** every new finding about tariffs, consumption, demand or the ASX data goes here, with its source.

## Summary

- **The old "verified" presets were stale.** HUM.py's presets were FY25–FY26 rates: Energex 8300 and Essential BLND3AO match the 2025-26 lists, and the "Energex 8100" preset matches 2024-25. Energex 8100 no longer exists (7200 replaced it as the large-business default).
- **Essential BLND3AO has demand charges** (FY27: peak 12.0390, shoulder 10.8924, off-peak 2.8541 $/kVA/month). The old preset set demand to zero, and BLND3AO is for sites over **160 MWh**, not 100. BLNT1AO is closed to new sites; BLNBSS1 is now Essential's small-business default.
- **24 real FY27 tariffs** across Ausgrid, Endeavour, Essential, Energex and Ergon (East zone) replace the placeholders for NSW and QLD. **VIC and SA FY27 followed on 21 Nov 2026**: 36 more tariffs across six networks (see *VIC and SA FY27 tariffs*).
- **Default quote (NSW, BLND3AO, 400 MWh):**
  - $0.2127/kWh on the old preset; **$0.2846/kWh** on official FY27 rates (all demand windows summed).
  - On 13 Nov 2026 prices: NSW 0.2846, QLD 0.1956, VIC 0.2613, SA 0.2806 $/kWh.
- **Bulk price index:** each date uses the network rates of its own financial year. FY22–FY26 come from each year's price list; FY27 is current.
- **Nothing left to confirm for NSW and QLD** (16 Nov 2026): Ausgrid EA302's charge, Ausgrid's time windows and Ergon ELTOUET1's eligibility are all settled from primary sources (below).
- **ASX data was cleaned and corrected** (15–16 Nov 2026): wrong dates fixed, the old yearly rows relabelled as calendar years, and the history moved to a text file. See *ASX futures data* below.

## Decisions (HUM)

| Topic | Decision |
|---|---|
| Customers | C&I, not heavy industry: LV business and HV demand tariffs (no subtransmission or transmission) |
| States | NSW and QLD first (14 Nov 2026), then VIC and SA FY27 and FY22–FY26 history (21 Nov 2026) |
| Network charges | Passed through at cost; the quote's network part is indicative. Accepted modelling gaps: fixed loss factors, flat network charges over 3 years, no power factor |
| Customer profiles | No profile data needed: the apps quote any profile. Default profile unchanged (see below) |
| NSW default network | **Essential Energy**: HUM operates in South East Queensland and northern NSW (Essential's area), even though Ausgrid is NSW's largest |
| QLD default network | Energex (South East Queensland) |
| VIC default network | Powercor, the largest Victorian network (over 930,000 customers) |
| SA default network | SA Power Networks (the only one) |
| Ausgrid EA302 demand | Applies all year: confirmed 16 Nov 2026, it's a 12-month capacity charge |
| Demand inputs | As the bill shows them: one rate per demand line; *Estimate* (default) or *Client's bill* (14 Nov 2026) |
| Carry-forward escalation | 2.5% a year (base case) |
| Historical index rates | Use each year's actual rates, not FY27 scaled back |
| Calendar-year history | Relabel the pre-June-2026 yearly rows as CY (15 Nov 2026) |
| Futures storage | Text file `data/asx_futures.csv` instead of the SQLite database (15 Nov 2026) |
| 2026 CY gap | Estimate CY from FY prices in a **separate** file, for the charts only; never mixed into settlement data (16 Nov 2026) |
| Editable tariff page | Parked until HUM raises it; edits would be saved by committing to the repo as a pull request |

## Consumption and demand: the default profile and assumptions

The default quote, which is also the index's reference customer:

| Input | Default |
|---|---|
| Annual consumption | 400 MWh |
| Peak / shoulder / off-peak share | 50% / 0% / 50% |
| Load factor | 0.55 |
| Connection | LV |
| Load escalation × retail escalation | 1.15 × 1.15 |
| AEMO participant and ancillary charges | 0.0991 c/kWh each |
| SREC / LREC | 1.0904 / 1.0 c/kWh |
| Metering | $100 a year |
| Supply start | Auto: the next calendar quarter |
| Carry-forward escalation | 2.5% a year |

- **Estimated maximum demand** = annual kWh ÷ 8,760 ÷ load factor. At 400 MWh and 0.55 that's about 83 kVA. The load factor carries the whole demand estimate, so it's the most sensitive demand assumption.
- **Effect of demand rates:** on the default profile, each $1/kVA/month of demand rate adds about **0.25c/kWh**.
- **Power factor:** demand is charged per kVA, and the model has no power factor (accepted gap). A site at 0.9 power factor pays about 11% more demand than its kW suggests. Bill kVA already includes it.
- **Minimum-demand tariffs:** a site under 160 MWh a year only exceeds 120 kVA if its load factor is below about 0.15. So Ergon ELTOUET1 and Energex 94300 rarely fit (see eligibility below).

## How a quote is built

- **ASX energy, per contract year** (from the ASX settle price in $/MWh):
  - Peak and shoulder: settle ÷ 10 × load escalation × retail escalation, in c/kWh.
  - Off-peak: settle ÷ 10, with no escalation (the original app's rule).
  - Each is then multiplied by the loss factors: transmission **1.00860** × distribution **1.04344**, both fixed.
- **Contract periods:** three 12-month periods from the supply start. Each is priced from the futures curve of the quote date:
  - **Exact strip:** a period that matches a listed yearly strip (CY or FY) uses it.
  - **Quarters:** otherwise the period averages the calendar quarters it touches, weighted by days. A start part-way through a quarter gives a part quarter at each end.
  - **No quarter listed:** the overlapping yearly strip is used.
  - **Beyond the curve:** the last contract is carried forward at 2.5% a year ("carried").
  - **Before the first contract:** the next contract is used ("backfilled").
  - Estimated months are flagged on the quote and the index.
- **Network:**
  - Energy: each window's rate on the consumption shares (or the bill's kWh split).
  - Demand: each line's rate × kVA × 12.
  - Fixed: $/day × 365.
  - Network charges are held flat over the three years.

## How the model uses a tariff

The quote model has three network inputs:

- **Energy**: c/kWh in the peak, shoulder and off-peak windows, applied to the site's consumption shares.
- **Demand**: one rate per demand line on the bill ($/kVA/month), each on that line's kVA. *Estimate* puts every line on the estimated demand; *Client's bill* uses each line's kVA from the bill.
- **Fixed**: $/day, including the network's metering charge where it's listed separately.

### Conversion rules (from price list to model)

- **Several demand lines:** each keeps its own rate. On the estimate they effectively sum (see *Demand charges* below).
- **Daily rates:** c/kVA/day × 365/12 ÷ 100 gives $/kVA/month.
- **Endeavour seasonal rates:** weighted by month (high season Nov–Mar = 5 months, low season Apr–Oct = 7).
- **Ausgrid EA302:** its per-kW capacity rate is used as per-kVA.
- **No shoulder period:** shoulder is charged at the off-peak rate. Endeavour N91's solar-soak rate (10am–2pm) takes the shoulder slot.
- **Ergon EC22LT1:** demand includes its capacity charge (authorised demand taken as the peak).
- **Minimum demand:** Ergon ELTOUET1 and Energex 94300 carry `eligibility.minKva: 120`. The apps flag them as "doesn't fit" when the site's estimated demand is 120 kVA or less.
- **Not modelled:** connection unit charges (HV, site-specific), and Ergon's West and Mt Isa zones.

## FY27 tariffs (model units)

Energy c/kWh · demand $/kVA/month · fixed $/day. Listed in the order the apps suggest them (the first that fits the site's voltage and annual MWh).

| Tariff | Use | Peak | Shoulder | Off-peak | Demand | Fixed |
|---|---|---|---|---|---|---|
| **Ausgrid** EA225 | LV ≤100 MWh | 39.7570 | 5.8997 | 5.8997 | 0 | 2.2948 |
| Ausgrid EA302 | LV 100–160 MWh | 8.8231 | 1.9685 | 1.9685 | 14.7033 (capacity, kW) | 6.6910 |
| Ausgrid EA305 | LV 160–750 MWh | 8.2347 | 1.8459 | 1.8459 | 17.5797 | 25.4654 |
| Ausgrid EA310 | LV >750 MWh | 6.4889 | 1.6914 | 1.6914 | 18.1070 | 51.1817 |
| Ausgrid EA370 | HV | 4.0147 | 1.9792 | 1.9792 | 10.5312 | 79.7926 |
| **Endeavour** N91 | LV ≤160 MWh | 20.3468 | 5.1696 (solar soak) | 13.4421 | 0 | 0.9888 |
| Endeavour N19 | LV >160 MWh | 5.7676 | 4.2432 | 4.2432 | 15.3062 | 24.1400 |
| Endeavour N29 | HV | 2.9013 | 2.7231 | 2.7231 | 12.6635 | 84.6500 |
| **Essential** BLNBSS1 | LV ≤160 MWh | 18.9741 | 8.5988 | 8.5988 | 0 | 2.3784 |
| Essential **BLND3AO** | LV >160 MWh (**NSW default**) | 7.0201 | 5.6141 | 3.6450 | 25.7855 | 22.3346 |
| Essential BLND3TO | LV >160 MWh, alternative | 19.2768 | 14.6931 | 6.7066 | 15.4853 | 22.3346 |
| Essential BHND3AO | HV | 5.2283 | 4.2238 | 3.4717 | 25.0240 | 27.4319 |
| Essential BLNT1AO | LV ≤160 MWh, closed to new sites | 21.6514 | 16.9328 | 9.0349 | 0 | 2.3784 |
| **Energex** 6800 | LV ≤100 MWh | 26.318 | 7.695 | 1.627 | 0 | 1.467 |
| Energex **7200** | LV >100 MWh (**QLD default**) | 1.876 | 2.947 | 1.627 | 17.585 | 9.380 |
| Energex 8300 | LV >100 MWh, optional | 3.365 | 3.365 | 3.365 | 13.913 | 10.563 |
| Energex 94300 | LV 100–160 MWh and >120 kVA, optional | 25.876 | 19.540 | 1.627 | 0 | 8.023 |
| Energex 7400 | HV, 11 kV line | 2.230 | 2.230 | 2.230 | 12.018 | 25.986 |
| Energex 4000 | HV, dedicated 11 kV bus | 1.379 | 1.379 | 1.379 | 8.495 | 110.270 |
| **Ergon** EBTOUET1 | LV ≤100 MWh | 25.594 | 6.971 | 1.470 | 0 | 3.561 |
| Ergon ELTOUDT1 | LV >100 MWh | 26.485 | 5.247 | 4.485 | 19.152 | 53.576 |
| Ergon EDSTT1 | LV >100 MWh, optional | 4.477 | 4.477 | 4.477 | 21.858 | 57.014 |
| Ergon ELTOUET1 | LV <160 MWh and >120 kVA, optional | 26.485 | 20.333 | 4.485 | 0 | 269.078 |
| Ergon EC22LT1 | HV, 22/11 kV line | 2.897 | 2.897 | 2.897 | 19.671 | 113.779 |

### Time windows

- **Ausgrid** (confirmed 16 Nov 2026 from Ausgrid's FY27 statement of compliance, section 3.1):
  - Peak energy: 3pm–9pm on working weekdays (business customers), in summer (Nov–Mar) and winter (Jun–Aug). Off-peak at all other times; no shoulder.
  - Capacity (EA302, EA305, EA310, EA370): the 3pm–9pm working-weekday window in **any** month.
- **Endeavour**: peak 4pm–8pm business days; N91 solar soak 10am–2pm daily; off-peak other times. N19 and N29 charge demand in the peak window only.
- **Essential** (BLND3AO, BLND3TO, BHND3AO, BLNT1AO):
  - Peak 5pm–8pm weekdays; shoulder 7am–5pm and 8pm–10pm weekdays; off-peak 10pm–7am weekdays and all weekend.
  - BLND3AO and BHND3AO charge the highest 30-minute kVA **in each window** each month.
  - BLNBSS1 (Sun Soaker): peak 7am–10am and 3pm–10pm daily; off-peak 10am–3pm and 10pm–7am.
- **Energex and Ergon** (small and large time-of-use):
  - Peak 5pm–8pm weekdays; shoulder 1pm–5pm and 8pm–11am weekdays, 1pm–11am weekends; off-peak 11am–1pm daily.
  - 7200 and ELTOUDT1 charge demand in the peak and shoulder windows; 8300 and EDSTT1 charge anytime demand.

### Ausgrid's charges, explained (confirmed 16 Nov 2026)

Ausgrid's price list has three kinds of demand-type charge, and they behave differently:

| Price list column | Unit | What it charges | When |
|---|---|---|---|
| Network Demand Prices: **High Season Peak** | c/kW/day | Highest 30-minute kW, 3pm–9pm (working weekdays for business), resetting monthly | **Summer (Nov–Mar) and winter (Jun–Aug) months only** |
| Network Capacity Prices: **Peak** | c/kW/day | Highest 30-minute kW, 3pm–9pm working weekdays, over the **previous 12 months** | Every day, all year |
| Network Capacity Prices: **Peak** | c/kVA/day | Same, in kVA | Every day, all year |

- **EA302** (48.3397 c/kW/day) is in the **capacity** column. It applies all year on the 12-month maximum kW. There's no 8/12 factor, so HUM's "all year" assumption was right.
- **EA256** (small business demand, 44.5311) is the high-season one.
- **EA305, EA310 and EA370** use the c/kVA/day capacity charge.
- **Earlier misreading:** the 14 Nov note treated EA302 as a summer/winter monthly charge, based on the generic "peak demand" parameter in Ausgrid's 2024-25 statement. The FY27 price list's columns show it isn't.
- **What changed in the catalogue:** EA302's bill line is now "Capacity (kW)", 12-month maximum. The rate is unchanged, so no quote moved.
- **Thresholds:** in FY27 Ausgrid raised the threshold at which small business customers move to demand tariffs from 80 MWh to 100 MWh (stepping 20 MWh a year), hence EA225 ≤100 MWh.

### Eligibility rules worth knowing

- **Ergon ELTOUET1 and Energex 94300 (Large TOU Energy):**
  - Optional, on request, for large customers with a smart meter.
  - Annual consumption in the previous 12 months must be **below 160 MWh** and monthly demand **above 120 kVA**.
  - Ergon reviews eligibility each year and moves customers who no longer qualify back to the default (ELTOUDT1).
  - The regulator required these tariffs and limited them to over 120 kVA.
  - Sources: AER final decision on the 2025-30 tariff structure statements, Attachment 19, s19.4.5.1; Ergon amended 2025-30 TSS (May 2026), footnote 14; Energex business tariffs page.
- **Queensland's large-customer threshold** is 100 MWh a year (National Energy Retail Regulations, reg 7). Ergon and Energex may apply a 15% tolerance before reassigning a customer. If the Queensland Government raises the threshold to 160 MWh, sites between 100 and 160 MWh would move to small business tariffs.
- **Ergon default tariffs:**
  - Small business (smart meter): Small Business TOU Energy (EBTOUET1).
  - Large business (smart meter): Large TOU Demand and Energy (ELTOUDT1).
  - Demand Small (EDSTT1): optional, on request.

## How demand appears on the bill

All networks measure demand as the **highest 30-minute kVA** (from the meter's kWh and kvarh, so power factor is included); Ausgrid's EA302 uses kW. They differ in **which hours count** and **how long the maximum is held**:

| Tariff | Demand lines on the bill | Window(s) | Maximum over |
|---|---|---|---|
| Essential BLND3AO, BHND3AO | 3: peak, shoulder, off-peak kVA | Peak 5–8pm wkdays; shoulder 7am–5pm and 8–10pm wkdays; off-peak nights and weekends | Calendar month, each window separately |
| Essential BLND3TO | 1 | Peak or shoulder | Calendar month |
| Energex 7200 (and Ergon ELTOUDT1) | 2: peak, shoulder kVA (off-peak demand rate is $0) | Peak 5–8pm wkdays; shoulder all other hours except 11am–1pm | Calendar month, each window separately |
| Energex 8300, Ergon EDSTT1 | 1: anytime kVA | Any time | Calendar month |
| Energex 7400 | 1 | 9am–9pm workdays | Calendar month |
| Energex 4000 | 1 | Any time | Calendar month |
| Ausgrid EA305, EA310, EA370 (capacity) | 1: capacity kVA | 3–9pm working weekdays | **Rolling previous 12 months** |
| Ausgrid EA302 (capacity, kW) | 1: capacity kW | 3–9pm working weekdays, any month | **Rolling previous 12 months** (corrected 16 Nov 2026) |
| Endeavour N19, N29 | 1 | Peak 4–8pm business days | Calendar month (high/low season rate) |
| Ergon EC22LT1 | 2: actual demand + capacity | Any time; capacity on authorised (agreed) demand | Month; capacity fixed by agreement |

Sources:
- Essential price list and explanatory notes 2026-27 (p11, "Three rate demand").
- Energex Tariff Structure Statement 2025-30, amended May 2026 (AER), pp14 and 23.
- Ausgrid Network Price List 2026-27 and 2026-27 statement of compliance (AER), section 3.1.
- Endeavour price list 2026-27, section 5.3.

**Built (14 Nov 2026):**
- **The two modes:** the quote has one rate per demand line and a choice of *Estimate* or *Client's bill*.
  - *Estimate* puts every line on annual kWh ÷ 8,760 ÷ load factor, as before.
  - *Client's bill* takes each line's kVA from the bill (the average of the last 12 bills; for Ausgrid's capacity charges, the 12-month maximum). It also takes the kWh in the network's peak, shoulder and off-peak windows. Those split the annual consumption for network energy only; ASX energy keeps the consumption shares.
- **Switching:** moving to the bill starts from the estimate, so the price only moves as bill figures go in.
- **Example:** Essential BLND3AO at 58 / 83 / 33 kVA prices at $0.2713, against $0.2846 on the estimate.

**What this means for the model:** the annual demand cost on a bill is the sum, over months and windows, of that month's maximum kVA in the window × the rate.

## Demand charges: is summing the windows sensible?

**Short answer:** the estimate (every line at the site's maximum) is a conservative default. Use the client's bill when it's available.

**Why summing overstates.** It assumes the site hits its monthly maximum in every window. Essential's windows show the problem:
- **Shoulder** (7am–5pm weekdays) is where a daytime business usually peaks.
- **Peak** (5pm–8pm) is often lower, as sites wind down.
- **Off-peak** (nights and weekends) is usually much lower.

It matters most for Essential, HUM's NSW default: its three-window sum (25.79) is the largest demand rate among the LV defaults. Elsewhere it matters less. Ausgrid and Endeavour charge one line only, and Energex 7200 and Ergon ELTOUDT1 charge peak and shoulder only.

**How much (default NSW quote, FY27 BLND3AO):**

| Site's demand in peak / shoulder / off-peak windows | Demand rate | Price $/kWh |
|---|---|---|
| 100% / 100% / 100% (estimate) | 25.79 | 0.2846 |
| 100% / 100% / 50% | 24.36 | 0.2811 |
| 70% / 100% / 40% (typical daytime business) | 20.46 | 0.2714 |
| Peak window only | 12.04 | 0.2504 |

So the estimate can overstate a daytime business by about 1c/kWh in NSW. Charging only the peak window understates by about 3c, so "peak only" is the wrong fix. The bill-based input (built 14 Nov 2026) is the right one.

**Why it matters even though network is passed through.** The client pays actual network charges either way. But the headline quote is what clients compare against other retailers' offers, so an overstated network part makes HUM look dearer than it will be.

## VIC and SA FY27 tariffs (researched 21 Nov 2026)

All six VIC and SA networks now have researched FY27 tariffs in the catalogue (36 tariffs, merged as PRs #29 and #30). Before this, VIC and SA were placeholders copying Essential Energy rates. Prices are excl. GST, 1 July 2026 to 30 June 2027.

| Network | Small | Medium | LV large | HV |
|---|---|---|---|---|
| Powercor | NDTOU | NDM, NDMO21 | LLV1/2/3 | HV1/2/3 |
| CitiPower | CGTOU | CMG, CMGO21 | CLLV1/2/3 | CHV1/2/3 |
| United Energy | LVTOU | UMBD, UMBO | LVKVATOU 1/2/3 | HVKVATOU 1/2/3 |
| Jemena | A210 | A230, A23N | A30C to A37C | A40C |
| AusNet | NAST12 | NASN21 | NSP56 to NSP78 | NSP81 |
| SA Power Networks | SBTOU | MBTOUD | LBAD, LBMD | HVAD |

### Findings

- **Powercor, CitiPower and United Energy share one structure.** The numbered variants (1, 2, 3) have identical prices and differ only in the three-hour incentive demand window set by zone substation.
- **Their large LV and HV tariffs** charge a rolling 12-month maximum kVA (7am to 7pm workdays) plus an incentive demand in four months a year (Dec to Mar, or May to Aug for winter zones). The model averages the incentive rate over 12 months.
- **Large LV is over 160 MWh a year.** HV has a 500 kVA minimum chargeable demand (not modelled).
- **Medium business demand (40 to 160 MWh)** bills the highest 30-minute kW from 10am to 6pm on workdays each month, higher in summer (Dec to Mar). Customers under 160 MWh can opt out to a time-of-use tariff.
- **Jemena splits large LV by annual consumption:** A30C (0.4 to 0.8 GWh), A32C (0.8 to 2.2), A34C (2.2 to 6.0), A37C (6.0 and over). Demand is annual (8am to 8pm weekdays) plus a summer incentive demand.
- **AusNet moves to critical peak demand tariffs from 160 MWh:** a capacity charge plus a critical peak demand charge on the average of up to five values (3pm to 7pm on days nominated in advance). Banded by consumption.
- **SA Power Networks large tariffs** charge peak demand (5pm to 9pm every day, Nov to Mar, billed all year) and anytime demand, both over the last 12 months. LBMD bills the peak demand in Nov to Mar only. Medium (MBTOUD) needs demand over 120 kVA.

### Modelling choices and exclusions

- Seasonal and part-year demand rates are averaged into a monthly rate. Per-kW rates are used as per kVA.
- Metering charges are not in the Powercor, CitiPower, United Energy, Jemena or AusNet schedules and are not included. SA Power Networks' $0.0262 a day meter charge is included.
- Not included: minimum chargeable demands, flexible and generation tariffs, subtransmission, closed tariffs, site-specific codes, Jemena A200 and A48C, AusNet NASN19, NSP82, NSP83, SA Power Networks HVAD500 and HVMD.
- Jemena A230 has an upper bound of 399.9 MWh so the 400 MWh default profile lands on A30C.

### Sources (FY27)

- **Powercor:** 2026-27 Pricing (7 May 2026, public) and the 2026-27 Tariff Summary workbook, sheet PAL_2026-27_NUOS (DUoS, TUoS and JSA). Large business fact sheet for the demand rules.
- **CitiPower:** 2026-27 Pricing (7 May 2026, public) and Tariff Summary workbook, sheet CP_2026-27_NUOS.
- **United Energy:** 2026-27 Pricing (7 May 2026, public) and Tariff Summary workbook, sheet UE_2026-27_NUOS.
- **Jemena:** Network Tariffs effective 1 July 2026 (tariff schedule PDF, pages 1 to 5).
- **AusNet:** Network tariff schedule 2026-27 (15 May 2026), sheets "Network 2026-27" and "Tariff structures".
- **SA Power Networks:** Annual Pricing Proposal Overview 2026-27 (July 2026), Table 9 (NUoS schedule) and Tables 3 to 6 (tariff structures).

Index reference tariffs are Powercor LLV (VIC) and SA Power Networks LBAD (SA). Their FY22 to FY26 history is in *Historical rates for the bulk price index* below.

## Historical rates for the bulk price index

The index's reference customer is the default profile on each state's default tariff: Essential BLND3AO (NSW) and Energex 7200 (QLD).
- **Network rates:** each index date (Sep 2021 onwards) uses the rates of the financial year it falls in. VIC and SA use their reference tariffs' recorded history too (added 21 Nov 2026).
- **Contract:** each date prices a three-year contract starting the next quarter, from that date's futures curve.
- **Original method:** the index's "Original" method (each date's yearly strips averaged) is kept as an option. It gives byte-identical results to before the data clean-up.

### Essential BLND3AO (price list units)

| FY | Access $/day | Peak c/kWh | Shoulder | Off-peak | Peak demand $/kVA/mo | Shoulder demand | Off-peak demand | Model demand (sum) |
|---|---|---|---|---|---|---|---|---|
| FY22 | 15.4796 | 4.8933 | 4.1494 | 2.7476 | 10.1188 | 9.1551 | 2.2584 | 21.5323 |
| FY23 | 15.8085 | 5.0624 | 4.1956 | 2.7850 | 10.2257 | 9.2519 | 2.3064 | 21.7840 |
| FY24 | 17.7679 | 4.8555 | 3.9090 | 2.5321 | 10.9642 | 9.9200 | 2.5993 | 23.4835 |
| FY25 | 19.1811 | 5.4893 | 4.4186 | 2.8850 | 11.0681 | 10.0140 | 2.6240 | 23.7061 |
| FY26 | 20.8017 | 6.1763 | 4.9580 | 3.2273 | 11.7932 | 10.6700 | 2.7959 | 25.2591 |
| FY27 | 22.3346 | 7.0201 | 5.6141 | 3.6450 | 12.0390 | 10.8924 | 2.8541 | 25.7855 |

Same structure every year.

### Energex 7200

| FY | Fixed $/day | Metering $/day | Energy c/kWh (peak / shoulder / off-peak) | Peak demand $/kVA/mo | Shoulder or excess demand | Model demand |
|---|---|---|---|---|---|---|
| FY22 | 0 | 0.07106 | 2.746 flat | 12.582 | excess 2.516 | 12.582 |
| FY23 | 0 | 0.07353 | 1.709 flat | 13.555 | excess 2.654 | 13.555 |
| FY24 | 4.881 | 0.07907 | 1.784 flat | 14.180 | excess 2.198 | 14.180 |
| FY25 | 4.994 | 0.08249 | 2.484 flat | 15.254 | excess 2.358 | 15.254 |
| FY26 | 7.665 | 0.121 | 1.736 / 2.611 / 0.476 | 13.427 | shoulder 3.000 | 16.427 |
| FY27 | 9.257 | 0.123 | 1.876 / 2.947 / 1.627 | 13.913 | shoulder 3.672 | 17.585 |

- **Until FY25**, 7200 had one volume rate, a peak-window demand charge, and an "excess demand" charge on demand above the peak-window level at other times. The model has one demand figure, the same in every window, so the excess is zero and only the peak-window rate counts. This is consistent with summing the windows from FY26.
- **From FY26**, 7200 has time-of-use energy and peak plus shoulder demand.
- **FY22 and FY23** lists show no daily charge for 7200, only ACS capital metering.
- **The FY25 figures** are from the 28 March 2024 proposal list on the AER site. Energex later posted a list "updated for Sch 8", which may differ slightly. HUM closed this check; the tariff page will make such corrections easy.

### Powercor LLV1 (VIC; price list units)

| FY | Fixed | Peak c/kWh | Off-peak c/kWh | Rolling demand $/kVA/mo | Incentive demand $/kVA/mo (Dec–Mar) | Model demand (incentive ×4/12) |
|---|---|---|---|---|---|---|
| FY22 | 0 | 4.00 | 2.79 | 9.69 | 13.81 | 14.2933 |
| FY23 | 0 | 3.92 | 2.73 | 9.74 | 13.54 | 14.2533 |
| FY24 | 0 | 4.09 | 2.90 | 10.49 | 13.26 | 14.9100 |
| FY25 | 0 | 4.09 | 2.89 | 11.55 | 12.60 | 15.7500 |
| FY26 | 0 | 4.14 | 3.24 | 11.94 | 10.20 | 15.3400 |
| FY27 | 0 | 4.34 | 3.08 | 12.10 | 10.60 | 15.6333 |

- **Same structure every year** (the 2026–31 period kept the codes LLV1/2/3). Prices are the NUoS totals (DUoS + TUoS + JUoS).
- **Sources** (all on the AER annual pricing pages): FY22 Tariff Summary (Att. B, June 2021); FY23 Tariff Summary (6 Apr 2022); FY24 Tariff Summary (31 Mar 2023); FY25 Tariff Summary (28 Mar 2024), each sheet PAL_yyyy_yy_NUOS, row LLV1. FY26: the 2025-26 SCS Pricing Model (31 Mar 2025), sheet "Tariff schedule", 2025-26 prices, row LLV (the FY26 Tariff Summary file itself isn't on the AER page).
- **Rolling demand** was labelled Jan–Dec in the FY22 and FY23 lists and Jul–Jun from FY24; the rate is charged the same way (rolling 12-month maximum).
- **Shoulder** is set to the off-peak rate, as in the current tariff.

### SA Power Networks LBAD (SA)

| FY | Supply $/day | Peak $/kWh | Off-peak $/kWh | Peak demand $/kVA/day | Anytime demand $/kVA/day | Model demand $/kVA/mo |
|---|---|---|---|---|---|---|
| FY22 | 6.7950 | 0.0673 | 0.0420 | 0.2599 | 0.1028 | 11.0321 |
| FY23 | 6.7402 | 0.0685 | 0.0428 | 0.2681 | 0.1020 | 11.2572 |
| FY24 | 6.9417 | 0.0728 | 0.0458 | 0.2856 | 0.1050 | 11.8808 |
| FY25 | 7.7331 | 0.0805 | 0.0505 | 0.3215 | 0.1170 | 13.3378 |
| FY26 | 8.2192 | 0.0958 | 0.0599 | 0.3049 | 0.0630 | 11.1903 |
| FY27 | 8.6002 | 0.1019 | 0.0637 | 0.3408 | 0.0630 | 12.2823 |

- **Same structure every year** (LBAD, code LBADCBD): daily supply, two-rate energy, annual peak demand and anytime demand, both over 12 months. No metering charge in the NUoS schedule.
- **Sources:** Table 31 (NUoS Tariff Schedule) of each year's annual pricing proposal on the AER site: FY22 (29 Apr 2021), FY23 (updated 12 Apr 2022), FY24 (revised 8 May 2023), FY25 (19 Apr 2024); FY26 Table 9 of the Pricing Proposal Overview (14 May 2025). Values read from the printed tables.
- **FY26 anytime demand** fell from 0.1170 to 0.0630 $/kVA/day while the peak and energy rates rose, which is why FY26's model demand dips.

### Effect on the index, VIC and SA

Average over each year's index dates, $/kWh:

| FY | VIC, per-year rates | VIC, FY27 on every date | Difference | SA, per-year rates | SA, FY27 on every date | Difference |
|---|---|---|---|---|---|---|
| FY22 | 0.1663 | 0.1728 | −0.0065 | 0.2019 | 0.2348 | −0.0329 |
| FY23 | 0.2263 | 0.2336 | −0.0073 | 0.3031 | 0.3345 | −0.0314 |
| FY24 | 0.1819 | 0.1859 | −0.0040 | 0.2361 | 0.2621 | −0.0260 |
| FY25 | 0.1909 | 0.1928 | −0.0019 | 0.2542 | 0.2697 | −0.0155 |
| FY26 | 0.1940 | 0.1949 | −0.0009 | 0.2506 | 0.2587 | −0.0080 |
| FY27 | 0.1924 | 0.1924 | 0 | 0.2575 | 0.2575 | 0 |

SA's network charges rose much more than Victoria's (peak energy up about 50% from FY22 to FY27), so the history matters most there.

### Effect on the index

Average over each year's index dates, $/kWh:

| FY | NSW, per-year rates | NSW, FY27 on every date | Difference | QLD, per-year rates | QLD, FY27 on every date | Difference |
|---|---|---|---|---|---|---|
| FY22 | 0.2422 | 0.2741 | −0.0320 | 0.1797 | 0.1907 | −0.0110 |
| FY23 | 0.3264 | 0.3564 | −0.0300 | 0.2389 | 0.2578 | −0.0190 |
| FY24 | 0.2776 | 0.3039 | −0.0263 | 0.1982 | 0.2104 | −0.0122 |
| FY25 | 0.2918 | 0.3113 | −0.0195 | 0.2138 | 0.2162 | −0.0024 |
| FY26 | 0.2848 | 0.2938 | −0.0090 | 0.1926 | 0.2034 | −0.0108 |
| FY27 | 0.2765 | 0.2765 | 0 | 0.1914 | 0.1914 | 0 |

These figures predate the CY relabel of 15 Nov 2026, which moved pre-June-2026 index points by about 1% on average.
- **NSW:** network rates rose every year (BLND3AO's network component went from about 9.2c to 11.8c/kWh), so using FY27 rates on every date overstated the past.
- **QLD:** moved less evenly because 7200's structure changed. FY25's flat volume rate fell on all consumption, and FY26's off-peak rate is 0.476c.

## ASX futures data (audited 15–16 Nov 2026)

The quotes and the index are priced from ASX Energy base-load futures settlements ($/MWh, NSW, VIC, QLD, SA). What was learnt:

### When ASX publishes, and the date bug
- **Settlement timing:** ASX publishes each day's settlement at about **4:20pm Sydney time** (observed: stale at 16:06, fresh at 16:21).
- **The page:** asxenergy.com.au/futures/au_electricity always shows **today's** date, but before settlement its Settle column still holds the **previous** trading day's prices.
- **The bug:** any run before about 4:20pm saved yesterday's prices under today's date. That's how weekend, holiday and duplicate dates got into the history.
- **The fix (`asx_calendar.py`):** each scrape is dated by the latest trading day whose settlement (allowing until 5pm) has passed.
- **Safeguards:** the updater skips stale pages, refuses page dates that contradict the trading calendar, and fails if no new prices arrive for more than a trading day.
- **The page is blank before the open:** at 8:02am Sydney on Tue 17 Nov 2026 the page showed the new trading day (pre-open) with every table present but every Settle cell empty; by 8:27am the previous day's settlements were back. The 7:15am backup run hit that window and failed ("no FY strips"). Fix (PR #25, merged 17 Nov 2026): a page with all its tables but no prices at all now saves nothing without failing; missing tables still fail, and so does going more than a trading day without new prices.
- **GitHub's schedule:** it starts scheduled runs **5–7 hours late**. So the update runs three times a day (5:15pm, 9:15pm and 7:15am Sydney) and the runs queue rather than race.
  - Measured delays (191 runs on the old single daily schedule, Feb–Nov 2026): median about 3h50m late, 90% within about 6h, worst 15h; no day was missed.
  - It can also skip runs. On Monday 16 Nov 2026 only one of the two evening runs happened, and it started at 4:03am Tuesday (about 10 hours late). GitHub says it may drop queued scheduled runs under heavy load; a missing run doesn't show as cancelled or failed, it just never appears. That day's prices still arrived before the 7:15am backup, which is what the three runs a day are for.
  - **On-time trigger (PR #26, 17 Nov 2026):** a Cloudflare Worker (`trigger-worker/`, named `humquote-update-trigger`) starts the workflow through GitHub's API at 4:45pm and 6:45pm Sydney on weekdays and 9:45am Tue–Sat. It fires hourly and checks Sydney time itself, so daylight saving needs no change. It uses a fine-grained GitHub token (this repo only, Actions read and write) stored as the Worker secret `GITHUB_TOKEN`. GitHub's own schedule stays as a backup. Deployment waits on HUM creating the token. Since 16 Nov 2026 the job installs Python and packages with uv (`uv sync --locked`).

### ASX 24 trading calendar (day session)
- **Closed days:** New Year's Day, Australia Day, Good Friday, Easter Monday, King's Birthday (2nd Monday of June), Christmas Day and Boxing Day, each moved to the next weekday if it falls on a weekend. Also 22 Sep 2022 (National Day of Mourning).
- **Anzac Day is a trading day.**
- Verified against ASX's 2026–2028 ASX 24 trading calendars.

### Calendar years vs financial years
- **Before 22 Jun 2026:** ASX's old homepage listed **calendar-year (CY) strips**. The proof is that each year dropped out at the end of March, after its first quarter.
- **What the apps got wrong:** they had treated these rows as financial years, misplacing prices by six months. The effect on the index before June 2026 was 0.5–1.3% on average, and up to 5–10% in 2022.
- **The fix:** the rows were relabelled CY on 15 Nov 2026.
- **From 22 Jun 2026:** after ASX's site change, the scraper kept **FY strips only**. CY strips and quarters were on the page but were dropped, because the old database had a single "Year" column.
- **From 13 Nov 2026:** every contract is kept: CY, FY and quarters (10 contracts a day).
- **When strips drop out:** ASX stops listing a strip once its first quarter is over. FY2027 stopped after 30 Sep 2026; CY2027 will stop after 31 Mar 2027.

### Storage
- **The file:** `data/asx_futures.csv` has one line per date and contract (`Quote Date, Contract, Start, Months, NSW, VIC, QLD, SA`), named like `CY2027`, `FY2028`, `Q4 2026`. It's about 130 KB, and each day appends about 10 lines.
- **Why not the database:** the SQLite database was 65 MB of versions in git (0.35 MB packed), and the old CSV export was reshuffled on every run.
- **Rule: every row in `asx_futures.csv` is a real ASX settlement.**
- **Clean-up of 15 Nov 2026:** 7 bad dates removed and 42 rows (Jun–Aug 2026) moved to their real settlement day.
- **22 Jul 2026:** every contract was recovered from the **Wayback Machine**. It's the only full archived copy of the ASX page in the Jun–Nov gap; ASX's homepage snapshots only show the 7 most-traded contracts. Its FY prices matched ours exactly.

### The 2026 CY gap and its estimates
- **The method:** a calendar year overlaps two financial years by half each. So CY2027 is estimated as the average of FY2027 and FY2028.
  - **Correction:** the average is corrected by the error measured on the nearest real CY prices (22 Jul and 13 Nov), blended linearly between them.
  - **After 30 Sep:** once FY2027 stopped being listed, CY2027 follows FY2028 alone, continuing smoothly to the real 13 Nov price.
- **Accuracy:**
  - **Uncorrected average:** about $1/MWh typical error, $2.30 worst.
  - **Hold-out test on 22 Jul:** the corrected method was within **$0.39–0.78/MWh**.
  - **Scaling a single FY by a fixed ratio:** drifted $3–4, so it was ruled out.
- **CY2029** isn't estimated (FY2030 wasn't listed), so its gap stays.
- **Where they live:** `data/asx_futures_estimates.csv` (with a `Note` column per row). Only the futures charts read it: dashed lines over a shaded "Not collected · estimated" band. Quotes, the index and downloads never read it.
- **Why not in the main file:** the estimates add no information to the index (in the gap, the index already prices from the same FY strips). They would also risk being mistaken for, or mixed into, real settlements.

## Keeping it up to date (each 1 July)

Networks publish next year's prices once the AER approves them (late May or early June), effective 1 July. Some reissue a list mid-year (Energex's "updated for Sch 8").

1. **Keep the ending year's rates for the index.** In `make_tariffs.py`, add a `HISTORY` entry (e.g. `'FY27'`) for each index reference tariff (BLND3AO, 7200), copying its current figures, before overwriting them.
2. **Enter the new price lists.** For each network, update the figures in `make_tariffs.py`, the `SOURCES` names and `financialYear`. The figures are in each price list's own units, so you can check them line by line.
3. **Check codes, columns and eligibility.**
   - Tariffs get renamed, closed or re-thresholded (FY27 retired Energex 8100, and BLNT1AO closed).
   - Map a removed id to its successor in `retired`, so saved quotes and links still open.
   - Update eligibility bounds (including `minKva`), `periods` and `notes`.
   - For Ausgrid, check **which column** each demand rate is in: High Season demand or capacity.
4. **Regenerate and test.** Run `python reference-data/make_tariffs.py`, then `python app-b/test/generate_core_cases.py`, then `npm test` in `app-b`. Tests that pin specific rates need the new figures.
5. **Check the three apps.** Look at the default quote, the index's latest point, and that no tariff is flagged as not fitting the default profile.

**Where to find the lists:**
- **Current year:** each network's network-pricing page.
  - Ausgrid's links point to `aopt-p-001.sitecorecontenthub.cloud/api/public/content/...`; take the URL from the page's file list.
- **Past years:** the AER's "annual pricing" page for each network and year, under `aer.gov.au/industry/networks/pricing-proposals`. The networks' own sites keep only the last two or three years.
- **Definitions and eligibility:** each year's **statement of compliance** (in the pricing proposal on the AER site) and the AER's TSS decision. They define each charging parameter and the eligibility rules. Price lists often don't.
- **Download tips:**
  - Ergon's and Energex's sites block scripted downloads behind a bot check. Essential's links carry a `?rev=` parameter. Open these in a browser.
  - AER files download normally.

**Possible improvement:** have the apps warn when the catalogue's `financialYear` is older than today's financial year (after 1 July), as a reminder to update.

## Open items

- [x] Demand by time window: merged and deployed as PR #14, 14 Nov 2026
- [x] Merge PR #13 (14 Nov 2026)
- [x] Energex FY25 check: closed by HUM, 14 Nov 2026
- [x] Read-only Network tariffs page in every app (PR #16)
- [x] Ausgrid EA302 charge, Ausgrid time windows, Ergon ELTOUET1 eligibility: confirmed, PR #22, 16 Nov 2026
- [x] ASX data audit, date fix, CY relabel, text storage: PR #20, 15 Nov 2026
- [x] 2026 CY gap: 22 Jul recovered and chart-only estimates, PR #21, 16 Nov 2026
- [x] Blank pre-open page no longer fails the daily update: PR #25, 17 Nov 2026
- [x] Cloudflare Worker that starts the update on time: PR #26/#27, deployed 17 Nov 2026
- [x] VIC and SA FY27 tariffs (six networks), PRs #29/#30, 21 Nov 2026; note entry added 21 Nov 2026
- [x] FY22 to FY26 history of Powercor LLV and SA Power Networks LBAD for the index, 21 Nov 2026 (the AER files were unreachable from the cloud session but fetched fine locally)

The open items now live in the repo's `TODO.md` (since 17 Nov 2026, PR #28), so new Claude Code conversations find them; this document keeps what's been learnt.

## Sources

**FY27 price lists and definitions**
- [Ausgrid network prices](https://www.ausgrid.com.au/about-us/regulation-and-compliance/network-prices) · [Ausgrid 2026-27 statement of compliance (AER)](https://www.aer.gov.au/system/files/2026-04/Ausgrid%20%E2%80%93%202026%E2%80%9327%20%E2%80%93%20Statement%20of%20compliance%20%E2%80%93%2031%20March%202026.pdf) · [Ausgrid 2026-27 pricing proposal overview (AER)](https://www.aer.gov.au/system/files/2026-04/Ausgrid%20%E2%80%93%202026%E2%80%9327%20%E2%80%93%20Pricing%20Proposal%20Overview%20%E2%80%93%2031%20March%202026.pdf) · [Ausgrid time-of-use pricing](https://www.ausgrid.com.au/your-energy-use/smarter-energy-use/understanding-network-tariffs/time-of-use-pricing)
- [Endeavour Energy network price list](https://edge.sitecorecloud.io/endeavouren152b-endeavouren7772-production9ea5-b88d/media/Endeavour-Energy/Publications/Documents/NUOS-Price-List.pdf)
- [Essential Energy network pricing](https://www.essentialenergy.com.au/our-network/network-pricing-and-regulatory-reporting/network-pricing) · [Price list 2026-27](https://www.essentialenergy.com.au/-/media/Project/EssentialEnergy/Website/Files/Our-Network/PriceListAndExplanatoryNotes2026-27.pdf?rev=cb6ce080b4d84329bafed9eb8dd5ff02)
- [Energex network tariffs and pricing](https://www.energex.com.au/our-network/network-pricing-and-tariffs) · [Energex 2026-27 price list](https://www.energex.com.au/__data/assets/excel_doc/0010/1985968/Energex-2026-27-Network-Price-List-Updated-for-Sch-8.xlsx) · [Network Tariff Guide 2026-27](https://www.energex.com.au/__data/assets/pdf_file/0011/2058077/Energex-Network-Tariff-Guide-2026-27.pdf) · [Energex business tariffs](https://www.energex.com.au/manage-your-energy/tariffs/business-tariffs)
- [Ergon network tariffs and pricing](https://www.ergon.com.au/network/our-network/network-pricing-and-tariffs) · [Ergon Network Tariff Guide 2026-27](https://www.ergon.com.au/__data/assets/pdf_file/0009/2058084/Ergon-Energy-Network-Tariff-Guide-2026-27.pdf) · [Ergon amended 2025-30 TSS, May 2026 (AER)](https://www.aer.gov.au/system/files/2026-05/Ergon%20Energy%20-%20MARKED%20UP%20-%20Amended%202025-30%20Tariff%20Structure%20Statement%20-%20May%202026.pdf)
- [AER final decision, Attachment 19: Ergon Energy and Energex TSS 2025-30](https://aer.gov.au/system/files/2025-04/AER%20-%20Final%20Decision%20Attachment%2019%20-%20Tariff%20structure%20statement%20-%20Ergon%20Energy%20and%20Energex%20-%202025-30%20Distribution%20determination%20revenue%20proposal%20-%20April%202025.pdf)
- [Powercor 2026-31 regulatory proposal (customer numbers)](https://aer.gov.au/system/files/2025-02/Powercor%20Regulatory%20Proposal%202026-31%20-%20Part%20A%20-%20Overview%20-%20Jan2025.pdf)

**Essential Energy, FY22–FY26**
- FY22: [Network Price List 2021-22 (AER)](https://www.aer.gov.au/system/files/Att.5%20Essential%20Energy%20Network%20Price%20List%202021-22_0.xlsx)
- FY23: [Network price list 2022-23 (AER)](https://www.aer.gov.au/system/files/Essential%20Energy%20-%20Attachment%201a%20-%20Network%20price%20list%202022-23%20-%2031%20March%202022%20-%20PUBLIC.xlsx), matching the [updated pricing report, 29 Apr 2022](https://www.aer.gov.au/system/files/Essential%20Energy%20-%20Attachment%203%20-%202022-23%20Network%20Pricing%20Report%20-%20updated%20%2029%20April%202022.pdf)
- FY24: [Network Price List 2023-24 (AER)](https://www.aer.gov.au/system/files/Essential%20Energy%202023-24%20%20-%20Network%20Price%20List%202023-24%20-%2020230331%20-%20PUBLIC.xlsx), matching the [pricing report, 28 Apr 2023](https://www.aer.gov.au/system/files/Essential%20Energy%202023-24%20-%20Annual%20Network%20Pricing%20Report%202023-24%20-%2020230428%20-%20PUBLIC.pdf)
- FY25: [Price list 2024-25](https://www.essentialenergy.com.au/-/media/Project/EssentialEnergy/Website/Files/Our-Network/PriceListAndExplanatoryNotes2024-25.pdf?rev=1b3f27cf847e4f4ab903b59b257cd0ff)
- FY26: [Price list 2025-26](https://www.essentialenergy.com.au/-/media/Project/EssentialEnergy/Website/Files/Our-Network/PriceListAndExplanatoryNotes2025-26.pdf?rev=429a74eaf5a745bda3bf6965d7147cd2)

**Energex, FY22–FY26**
- FY22: [2021-22 Network Price List (AER)](https://www.aer.gov.au/system/files/EGX%20Attachment%201%20-%202021-22%20Network%20Price%20List_0.xlsx)
- FY23: [2022-23 Network Price List, updated 11 May 2022 (AER)](https://www.aer.gov.au/system/files/Energex%20-%20Attachment%201%20-%202022-23%20Network%20Price%20List%20updated%2011%20May%202022.xlsx)
- FY24: [2023-24 Network Price List, 27 Apr 2023 (AER)](https://www.aer.gov.au/system/files/Energex%202023-24%20-%20Network%20Price%20List%20%E2%80%93%2020230427%20%E2%80%93%20PUBLIC.xlsx)
- FY25: [2024-25 Network Price List, 28 Mar 2024 (AER)](https://www.aer.gov.au/system/files/2024-04/Energex%20-%202024-25%20Network%20Price%20List%20-%2028%20March%202024.xlsx)
- FY26: [2025-26 Network Price List, updated for Sch 8](https://www.energex.com.au/__data/assets/excel_doc/0005/1631165/Energex-2025-26-Network-Price-List-updated-for-Sch-8.xlsx)

**ASX data**
- [ASX Energy AU electricity futures](https://www.asxenergy.com.au/futures/au_electricity) · [Wayback Machine copy, 22 Jul 2026](https://web.archive.org/web/20260722080920/https://www.asxenergy.com.au/futures/au_electricity)

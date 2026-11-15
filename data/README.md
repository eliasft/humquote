# ASX futures data

## `asx_futures.csv`: settlement prices

One line per settlement date and contract: ASX Energy base-load settlement prices in
$/MWh for NSW, VIC, QLD and SA. **Every row is a real ASX settlement.** The daily
GitHub Action (`update_db.py`) adds each trading day's prices after settlement, and
`.github/scripts/check_futures_data.py` checks the file before every push.

| Period | What was collected |
|---|---|
| 10 Sep 2021 – 4 Jun 2026 | Calendar-year (CY) strips, from ASX Energy's old homepage. Sparse before 2024. |
| 22 Jun – 12 Nov 2026 | Financial-year (FY) strips only. CY strips and quarters were on the page but not kept. |
| 13 Nov 2026 onward | Every base contract on the page: quarters, CY and FY strips. |

Rows with an unusual source or history:

- **22 Jul 2026, all contracts**: recovered from the Wayback Machine's copy of
  <https://www.asxenergy.com.au/futures/au_electricity>, captured at 6:09 pm Sydney time,
  after settlement. Its FY prices matched the ones collected that day exactly. Loaded with
  `update_db.py --html <saved page> --date 2026-07-22`.
- **Clean-up of 15 Nov 2026**: 7 dates removed (weekend, holiday or duplicate copies of
  another day's prices), and 42 rows from 23 Jun – 26 Aug 2026 moved to the trading day
  they actually settled on. The one-off scripts that did this, and converted the old
  `futures_prices.db` into this file, are in PR #20's history.
- **Before 22 Jun 2026**, the yearly strips were stored as plain years. They are
  calendar years (each one stopped being listed at the end of March), and are named CY.

## `asx_futures_estimates.csv`: estimates, charts only

Estimated CY2027 and CY2028 prices for 22 Jun – 12 Nov 2026, when only FY strips were
collected. They're built from the FY prices by `futures_store.estimate_calendar_years`.
Each row's `Note` says how it was made. Typical error is $1–2/MWh, tested against the
real prices on 22 Jul and 13 Nov 2026.

**These are not ASX prices.** Only the futures charts read this file. They draw the
estimates dashed over a shaded band. Quotes, the bulk price index and the downloads use
`asx_futures.csv` alone. The daily update rebuilds this file
(`.github/scripts/make_cy_estimates.py`), and the data check fails if it is out of date.

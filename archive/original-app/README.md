# The original HUMQuote app (20 Jun 2026)

HUM.py, its two pages and the ASX scraper (update_db.py) exactly as they were in
commit 8ef5c96 (20 Jun 2026), the last version before the November 2026 rebuild.
Kept for reference only: nothing imports or runs these files, and Streamlit only loads
the `pages/` folder next to the app's entry point (`HUM.py` at the repo root).

To run it as it was, check out that commit: it reads the SQLite `futures_prices.db`
of the time, which was replaced by `data/asx_futures.csv` in November 2026. Earlier
versions (back to Nov 2023) are in git history: `git log -- HUM.py`.

What changed since, briefly: researched network tariffs by network and code (instead
of four presets), contract periods priced from quarters and calendar/financial-year
strips, demand charges as the bill shows them, a corrected settlement-date rule for
the ASX data, and the bulk price index's current method. The original index method
is still available in the Bulk Price Tracker (humquote_core.legacy_bulk_price_index).

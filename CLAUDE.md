# Working on HUMQuote

Start with `README.md` (what's here) and **`TODO.md` (the to-do list)**. Keep
`TODO.md` current: tick or remove items in the pull request that finishes them, add
new ones as they come up. Items marked paused or parked wait until HUM raises them.

## How changes land

- `main` is protected: every change goes through a pull request, and the
  `test-and-build` check must pass. Commit, push and merge only when asked.
- The daily data update pushes to `main` directly with a deploy key
  (`DAILY_UPDATE_DEPLOY_KEY`). Never print or log it.
- Network charges are passed through at cost; customers are commercial and
  industrial (C&I), not heavy industry.

## Commands

```sh
uv sync                                         # Python environment (.venv) from uv.lock
uv run streamlit run HUM.py                     # Streamlit app
uv run python .github/scripts/test_asx_calendar.py   # also test_futures_store.py, test_update_db.py
uv run python .github/scripts/check_futures_data.py data/asx_futures.csv
uv run python app-b/test/generate_core_cases.py # after changing either pricing core
cd app-b && npm test && npm run build           # web versions
cd trigger-worker && npm test                   # the update trigger's schedule
```

- The Python and TypeScript pricing cores (`humquote_core.py`, `app-b/src/core`)
  must agree: `app-b/test/core-python.test.ts` compares them.
- `data/asx_futures.csv` holds real ASX settlements only; estimates live in
  `data/asx_futures_estimates.csv` (charts only). See `data/README.md`.
- Tariffs are generated: edit `reference-data/make_tariffs.py`, then run it.
- Cloudflare: `trigger-worker/` is a `cf` CLI project (no Wrangler config). Use
  `npx cf deploy` there; Wrangler only for `wrangler secret put`.

## Knowledge

Findings about tariffs, consumption and demand, the quote and index method, and the
ASX data go in HUM's Obsidian note "Network Tariff Research.md" (vault folder
`HUMEnergy/Project-01`), with sources, in the same session they're found.

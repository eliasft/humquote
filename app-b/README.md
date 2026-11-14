# Bulk Quote (version B) and the shared calculation core

An unbranded rebuild of HUMQuote: React + TypeScript, Vite, Tailwind CSS, Radix UI
components and ECharts. Published at `/humquote/b/` by `.github/workflows/deploy-pages.yml`.

`src/core/` holds the calculations used by **both** web versions. It's built into
`dist-core/core.js` and published as `/humquote/a/core.js` for version A (`site/a/`,
plain JavaScript), so the two always give identical results.

## Features

- **Quote:** all HUMQuote inputs with checks, a supply start date, network tariffs
  linked to each state (small business or large low voltage), a headline price,
  Year 1–3, cost breakdown, calculation details and the contract periods used.
- **Contract periods:** each 12-month period is priced from the ASX contract that
  matches it, or from its quarters; months beyond the listed contracts are carried
  forward with an escalation rate and flagged as estimates.
- **Over time:** your inputs priced on every past settlement date.
- **Sensitivity:** how much the price moves when each input changes by ±5/10/20%.
- **Compare:** every state on its own default tariff, and up to three saved quotes.
- **Saved quotes:** stored in the browser, re-priced with the latest data.
- **Share links**, **Excel export** and a **print / PDF** quote sheet.
- **Market:** the bulk price index (current and original methods, with its parts) and
  ASX futures, with CSV downloads.

## Data

- `../futures_prices.db`, exported to `data/futures.json`: FY strips (`futures_data`)
  and, from 13 Nov 2026, quarterly and calendar-year contracts (`futures_strips`).
- `../reference-data/tariffs.json`: the network tariff catalogue, bundled at build time.
  Placeholders are listed in `../reference-data/PLACEHOLDERS.md`.

## Development

Requires Node.js 26 and Python 3 (for the data export).

```sh
npm ci
npm run dev     # builds .dev-data/ from ../futures_prices.db, then serves http://localhost:5173/humquote/b/
npm test        # parity tests against the Python app, plus the core tests
npm run build   # type-check, build version B into dist/ and the core into dist-core/
npm run site    # assemble the whole Pages site (both versions) into ../_site
```

To try both versions locally: `npm run build && npm run site`, then serve the folder
that contains `_site` under `/humquote/`, e.g. with a junction or symlink named
`humquote` pointing at `_site`.

## Tests

`test/parity.test.ts` checks the calculations against fixtures produced by the Python
app from a frozen copy of the data. Two differences are intended and pending in the
Streamlit app: network energy charged per consumption period (TOU tariffs only), and
the bulk price index method. The original index method still matches byte for byte.
`test/core.test.ts` covers contract periods, the tariff catalogue, migration of old
saved quotes and share links, and the index. `test/core-python.test.ts` checks that the
Streamlit app's Python port (`../humquote_core.py`) gives the same results, on cases
written by `test/generate_core_cases.py` (CI regenerates them on every pull request).

If the Python calculations change, regenerate the fixtures (needs `streamlit`, `pandas`
and `plotly`):

```sh
python app-b/test/generate_fixtures.py   # from the repo root
```

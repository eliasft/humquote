# Bulk Quote (Option C)

An unbranded rebuild of HUMQuote: React + TypeScript, Vite, Tailwind CSS, Radix UI
components and ECharts. Published at `/humquote/c/` by `.github/workflows/deploy-pages.yml`.

## Features

- **Quote:** all HUMQuote inputs with checks, network presets, headline price, Year 1–3,
  cost breakdown, calculation details and the ASX futures used.
- **Over time:** the current inputs priced on every past settlement date.
- **Sensitivity:** how much the price moves when each input changes by ±5/10/20%.
- **Compare:** the same inputs in every state, and up to three saved quotes side by side.
- **Saved quotes:** stored in the browser, re-priced with the latest data.
- **Share links** that reproduce a quote, **Excel export** (the Streamlit app's seven sheets
  plus an Inputs sheet) and a **print / PDF** quote sheet.
- **Market:** bulk price index and futures history with CSV downloads.

## Development

Requires Node.js 26 and Python 3 (for the data export).

```sh
npm ci
npm run dev     # builds .dev-data/ from ../futures_prices.db, then serves http://localhost:5173/humquote/c/
npm test        # parity tests against the Python app
npm run build   # type-check and build into dist/
```

## Parity tests

`src/lib/calc.ts` is a line-for-line port of the Python calculations. `test/parity.test.ts`
checks every value in the five summary tables, for several states, inputs and network
presets, plus both tracker CSV downloads byte for byte, against fixtures produced by the
Python app from a frozen copy of the data. The deploy runs these tests and stops on a mismatch.

If the Python calculations change, regenerate the fixtures (needs `streamlit`, `pandas`
and `plotly`):

```sh
python app-c/test/generate_fixtures.py   # from the repo root
```

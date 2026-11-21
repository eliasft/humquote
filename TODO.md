# To do

The project's to-do list. Tick items off (or delete them) in the same pull request
that finishes them, and add new ones as they come up. What's been learnt along the
way (tariffs, consumption and demand, the quote and index method, ASX data) goes in
HUM's Obsidian note "Network Tariff Research.md", not here.

## Checks

- [ ] **Streamlit Cloud after the move to uv** (PR #24, 16 Nov 2026): open the app
      once to confirm it installed from `uv.lock` and starts, and that its Python
      version (app settings) is 3.13 or later. Can't be checked from the repo; all
      four Streamlit pages pass a local smoke test (21 Nov 2026).

## Tariffs (paused by HUM on 16 Nov 2026; restart only when HUM asks)

- [ ] **Yearly 1 July update**: FY28 prices, once the AER approves them (around
      May–June 2027). Steps in `reference-data/PLACEHOLDERS.md`, "Keeping the
      tariffs up to date (each 1 July)".
- [ ] **Editable tariff page** (parked until HUM raises it): make the read-only
      Network tariffs page editable, saving edits by committing to the repo as a pull
      request (HUM's choice), so each change keeps its history and review and all
      three apps keep using the one catalogue. To work out: who can edit, recording
      each change's source, and that `main` is protected (the pull request needs the
      `test-and-build` check).

## Ideas

- Record FY22-FY26 history for tariffs other than the four index reference tariffs
  (Essential BLND3AO, Energex 7200, Powercor LLV, SA Power Networks LBAD), so the
  tariff pages show past rates for every tariff. The index doesn't need it.

- Have the apps warn when the tariff catalogue's `financialYear` is older than the
  current financial year (after 1 July), as a reminder to update.

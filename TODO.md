# To do

The project's to-do list. Tick items off (or delete them) in the same pull request
that finishes them, and add new ones as they come up. What's been learnt along the
way (tariffs, consumption and demand, the quote and index method, ASX data) goes in
HUM's Obsidian note "Network Tariff Research.md", not here.

## Checks

- [ ] **Obsidian note**: add the VIC and SA FY27 research (all six networks; method,
      sources, modelling choices: `reference-data/PLACEHOLDERS.md`, section 2) to
      "Network Tariff Research.md" in HUM's vault (`HUMEnergy/Project-01`). A ready-to-paste
      entry was sent in the 21 Nov 2026 session; no vault was reachable from the cloud session.

## Tariffs (paused by HUM on 16 Nov 2026; restart only when HUM asks)

- [ ] **FY22-FY26 history of Powercor LLV and SA Power Networks LBAD** for the index (until
      then the index uses their FY27 rates on every date). All VIC and SA networks' FY27
      tariffs are done (`reference-data/PLACEHOLDERS.md`, section 2). The AER's annual
      pricing pages hold the earlier price lists, but the AER site is not reachable from
      cloud sessions (the connection resets), and Powercor's older price list files return
      403. Needs the files supplied, or a session with a different network path. Note
      Powercor's structure changed with the 2026-31 period, so earlier years need care.
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

- Have the apps warn when the tariff catalogue's `financialYear` is older than the
  current financial year (after 1 July), as a reminder to update.

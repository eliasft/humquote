# To do

The project's to-do list. Tick items off (or delete them) in the same pull request
that finishes them, and add new ones as they come up. What's been learnt along the
way (tariffs, consumption and demand, the quote and index method, ASX data) goes in
HUM's Obsidian note "Network Tariff Research.md", not here.

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

- Have the apps warn when the tariff catalogue's `financialYear` is older than the
  current financial year (after 1 July), as a reminder to update.

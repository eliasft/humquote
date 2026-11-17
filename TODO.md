# To do

The project's to-do list. Tick items off (or delete them) in the same pull request
that finishes them, and add new ones as they come up. What's been learnt along the
way (tariffs, consumption and demand, the quote and index method, ASX data) goes in
HUM's Obsidian note "Network Tariff Research.md", not here.

## Checks

- [ ] **Cloudflare trigger Worker, first runs** (deployed 17 Nov 2026): confirm the
      "Update ASX Futures Data" runs at 4:45 pm and 6:45 pm Sydney show the event
      `workflow_dispatch`. If none appear, the GitHub token is wrong or expired: see
      `trigger-worker/README.md`.
- [ ] **Streamlit Cloud after the move to uv** (PR #24, 16 Nov 2026): open the app
      once to confirm it installed from `uv.lock` and starts, and that its Python
      version (app settings) is 3.13 or later.
- [ ] **Trigger Worker's GitHub token**: renew it before it expires (the expiry was
      chosen when it was created on 17 Nov 2026). Until then nothing breaks: GitHub's
      own schedule keeps the data updating, just later.

## Tariffs (paused by HUM on 16 Nov 2026; restart only when HUM asks)

- [ ] **VIC and SA FY27 tariffs**: Powercor first, then SA Power Networks and the
      other VIC networks, then their FY22–FY26 history for the index. VIC and SA are
      placeholders until then (`reference-data/PLACEHOLDERS.md`).
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

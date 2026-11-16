# humquote-update-trigger (Cloudflare Worker)

Starts the "Update ASX Futures Data" GitHub workflow at set Sydney times, because
GitHub's own schedule starts runs hours late and sometimes drops them. GitHub's
schedule in `.github/workflows/update-futures-data.yml` stays as a backup; extra
runs are harmless (each saves nothing new and pushes nothing).

| Sydney time | Days | Why |
|---|---|---|
| 4:45 pm | Mon–Fri | first run after ASX settlement (about 4:20 pm) |
| 6:45 pm | Mon–Fri | backup |
| 9:45 am | Tue–Sat | last backup for the previous trading day, after the page's blank pre-open spell |

The cron fires hourly at :45 (UTC) and `src/schedule.ts` picks the Sydney times,
so daylight saving needs no change.

## Commands (from this folder)

```sh
npm ci
npm test            # the schedule, in summer and winter time
npm run typecheck
npx cf deploy       # build and deploy (signed in with `cf auth login`)
```

## The GitHub token (secret `GITHUB_TOKEN`)

A fine-grained personal access token: resource owner `eliasft`, only the
`humquote` repository, repository permission **Actions: Read and write**
(Metadata: read is added automatically). Nothing else.

To set or replace it, put it in a file that git ignores (`.env.secrets` here
matches `.env*` in `.gitignore`), deploy with it, then delete the file:

```sh
# .env.secrets contains one line: GITHUB_TOKEN=github_pat_...
npx cf deploy --secrets-file .env.secrets
rm .env.secrets
```

When the token expires, GitHub's own schedule keeps the data updating; renew the
token and deploy again as above.

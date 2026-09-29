# Uptime monitoring (Better Stack)

External uptime checks for getmindy.ai. They run from Better Stack's network,
not from our Vercel deployment, so they still alert when the deployment itself
is down.

## What is monitored

`betterstack-monitors.json` defines 10 monitors (the Better Stack free-tier
limit), each checked every 5 minutes from the US and EU:

| Endpoint | Availability monitor | Latency monitor |
|---|---|---|
| `/` | keyword `Mindy` | slower than 3 s |
| `/today` | HTTP 2xx | slower than 3 s |
| `/sitemap.xml` | keyword `<urlset` | slower than 3 s |
| `/contractors/the-boeing-company` | keyword `The Boeing Company` | slower than 3 s |
| `/api/health` | HTTP 2xx (returns 503 when the database or KV fails) | slower than 3 s |

- **Down:** a failure must persist through a 300 s confirmation period (about 2
  consecutive checks) before an incident opens.
- **Slow:** a response over 3 s counts as a failure, and it must persist 900 s
  (about 3 consecutive checks) before an incident opens.
- Recovery needs 180 s of passing checks.

The server-side baseline measured on 2026-09-29 was 0.1–0.6 s to first byte.
These monitors measure the server, not the full browser page load; client-side
performance is tracked separately.

**Uptime results never change SEO state.** Nothing here edits the sitemap,
sets noindex, regenerates pages or calls IndexNow.

## `/api/health`

Public and read-only. It runs one single-row Supabase SELECT and one KV GET, each with a
2 s budget, in parallel. The public body is minimal: 200 `{"ok":true,"status":"ok"}` or
503 `{"ok":false,"status":"degraded"}`. No commit, region, dependency names, latency or
configuration state is published. Which dependency failed, and how, goes to the private
runtime log (`[health] degraded …`). It never writes and never touches BigQuery.

## Manual activation (one time)

1. Create a Better Stack account (free plan) and an **Uptime API token**
   (Settings → API tokens).
2. In Slack, create **#mindy-ops**. In Better Stack, go to Integrations →
   Slack, connect the workspace, and pick #mindy-ops. Then create an escalation
   policy that notifies that Slack integration and note its ID.
3. Dry run, which changes nothing:
   ```bash
   BETTERSTACK_API_TOKEN=... BETTERSTACK_POLICY_ID=... npm run monitoring:sync
   ```
4. Apply:
   ```bash
   BETTERSTACK_API_TOKEN=... BETTERSTACK_POLICY_ID=... npm run monitoring:sync -- --apply
   ```
5. Re-run the dry run. It should report `0 create, 0 update, 10 unchanged`.

The token is only used locally to run the sync. It is not a Vercel environment
variable and the app never reads it.

## Changing monitors

Edit `betterstack-monitors.json`, dry-run, then apply. The script never deletes:
a monitor removed from the config shows up as an `orphan` for you to delete in
the Better Stack UI.

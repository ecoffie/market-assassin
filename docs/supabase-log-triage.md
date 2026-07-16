# Supabase log triage — how to find what's actually generating warnings

Written after the 2026-07-16 pass, which spent a lot of effort on wrong theories
before landing. The method below is what actually worked; the anti-patterns are
mistakes made that day, recorded so they aren't repeated.

**This project uses the NEW unified Logs UI** (Dashboard → Logs). There is no query
editor there — it's filters + a detail panel. Older guidance telling you to paste
BigQuery SQL into "Logs Explorer" does not apply here; there is nowhere to paste it.

---

## The method (in order)

### 1. Filter by Status, not by reading the stream

Dashboard → **Logs** → the **Status** filter dropdown. It lists every status with
a count for the window — that ranking *is* the triage. Don't scroll the feed.

Note the Status list mixes **HTTP codes** (`200`, `400`, `406`) with **Postgres
SQLSTATEs** (`01000` = warning, `42703` = undefined_column, `42P10` = bad ON
CONFLICT, `00000` = success). The dashboard's "Warning" bucket sums the 4xx AND
the Postgres warning classes — so the "API Gateway warnings" and "Postgres
warnings" tiles can be counting the same events. Don't treat them as independent.

### 2. Click the row. Read the DETAIL.

**This is the step that solves it.** The table view truncates to the summary line;
the detail panel (click any row) has the full message plus:

| field | why it matters |
|---|---|
| **DETAIL** | the actual numbers/values — usually the whole answer |
| **COMMAND** | `startup` = fires per connection (explains huge, flat volume) |
| **USER** / **CONNECTION FROM** | `::1` = an agent local to the DB host, not your app |
| **BACKEND TYPE** | `client backend` vs `walsender`/`autovacuum` |
| **DATABASE** | which database — not always the one you're querying |

On 2026-07-16 the one-line message looked unactionable for hours. The DETAIL named
both version numbers and cracked the case in one read. **Click the row first.**

### 3. Check the cadence

Timestamps at a fixed interval (e.g. every minute at `:58`) mean a *monitoring
agent reconnecting*, not your app. Bursts mean a cron or batch job. Volume that
scales with traffic means a real request path.

---

## Anti-patterns (all real mistakes from 2026-07-16)

**Don't attribute a whole bucket to one row you happened to see.** One
`406 /rest/v1/sam_api_cache` row got reported as "~156/hr ≈ 12.6k/day, the bulk of
gateway warnings." The Status dropdown showed the real rate: **1/hr**. Check the
count before claiming a storm.

**Don't trust an aggregate over the thing it's aggregating.** `db_health_stats()`
reported a 9-day "longest query." It was a walsender (permanently `state='active'`
while idle). `max(age(backend_xmin))` was `0` — nothing pinned, nothing blocked.
For "is a query stuck?", `oldest_xmin_age` is the real signal. Fixed in
`20260716_db_health_stats_client_backends_only.sql`.

**Don't conclude from a truncated grep.** `grep ... | head -10` over a term that
also matches noise (searching "replica"/"oregon" against files full of US state
dropdowns) hid the real hits below the cutoff, producing a confident "the app
doesn't use the read replica." It does — 25 files, `src/lib/supabase/server-clients.ts`,
a PRD, and a Vercel env var. **`.env.local` is not production**; check
`vercel env ls production`.

**Don't stop at the node you're connected to.** The SQL editor's **Source**
dropdown selects primary vs read replica. A query on the primary showed no
mismatch while the server warned on every connection — because the *replica* was
the mismatched node. If the DB contradicts the logs, you may be looking at the
wrong node. `pg_is_in_recovery()` proves which one you're on.

---

## Baseline — 2026-07-16 (24h)

API Gateway 153,474 req / 12,652 warn / 2 err · Postgres 12,304 / 10,939 warn /
104 err · Auth 1,231 / 0 / 0.

Status breakdown for one representative hour: `200` 910 · `01000` 142 · `400` 63 ·
`00000` 60 · `204` 43 · `201` 35 · `206` 19 · `404` 8 · `42703` 1 · `406` 1.

## What each signal turned out to be

| signal | rate | cause | status |
|---|---|---|---|
| `01000` | 142/hr | Oregon read replica's host ICU (`153.121`) vs recorded (`153.120`). Supabase's local agent reconnects every minute; each startup warns. | Not fixable by us — see `supabase-ticket-replica-collation.md` |
| `42P10` | was ~3k/day | `alert_log` upsert targeting a constraint that didn't exist | Fixed `20260715_alert_log_conflict_constraint.sql` (verified) |
| `42703` | 1/hr | `purchases.bundle` — column doesn't exist in this instance; silently zeroed the Founders seat count | Fixed in PR #259 |
| `406` | 1/hr | `.single()` on a `sam_api_cache` miss | Fixed (minor) in `src/lib/sam/utils.ts` |
| `400` | 64/hr | HEAD/count queries on `agency_forecasts` + `sam_opportunities`, bursty | **Not yet investigated** |

## Still open

**`400` @ ~64/hr.** HEAD requests are count queries (`{ count: 'exact', head: true }`).
Bursty, which suggests a cron or an admin dashboard fanning out. Next step: filter
`Status = 400`, click a row, read the DETAIL for the actual PostgREST error.

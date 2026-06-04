# PRD: Cron Dispatcher — Scheduling That Scales to 100K Users

> Replace "one Vercel cron entry per job" with a single dispatcher tick that
> fires jobs from a Supabase schedule table. Reclaims the 100-cron cap as a
> ceiling we never touch again.

**Status:** Draft / scoping — 2026-06-04. No code yet.
**Trigger:** The gov-buyer feature deploy failed at the Vercel limit:
`Invalid vercel.json - crons should NOT have more than 100 items`. We were
at 101. Eric: *"we are looking at building a platform to support 100,000
users... I anticipate having to do this multiple times. What is the
long-term solution and strategy, not just solving for today?"*

---

## 1. The Problem

We schedule jobs by adding lines to `vercel.json`. Vercel caps that file at
**100 cron entries**. We are at the cap *today*, and the count grows with:

- **Features** — every new scheduled job wants a slot.
- **Timezone/batch coverage** — `daily-alerts` alone uses **21 entries** (one
  per send window); send/precompute pipelines use ~55 more.

Current distribution (101 entries, only **27 distinct routes**):

| Route | Entries | Why |
|---|---|---|
| daily-alerts | 21 | timezone send windows |
| weekly-alerts | 10 | Sun/Mon batch window |
| send-briefings-fast / -weekly / -pursuit | 10 each | 10-min send windows |
| precompute-* | 5 each | staggered template builds |
| sync-sam-opportunities | 3 | full/delta/resume |
| ...20 others | 1–3 each | |

**The cron count scales with features and users. It must not.** At 100K users
we'll want regional batches, per-segment sends, more data syncs — and we'll
hit this wall every few weeks. The gov-buyer chained-trigger workaround
(`sync-sam-opportunities` calls `sync-gov-buyer-data`) is a band-aid; it
doesn't generalize.

---

## 2. The Solution: Dispatcher + Schedule Table

Stop using Vercel cron entries as the unit of scheduling. Use a **small fixed
set of dispatcher ticks** that read a **schedule table** and fire whatever is
due.

```
vercel.json crons  (the 100 budget)        →  ~6 FIXED ticks, never grow
  * * * * *     /api/cron/dispatch?tick=minute
  0 * * * *     /api/cron/dispatch?tick=hour
  0 1 * * *     /api/cron/dispatch?tick=day
  (a few more for common cadences)

/api/cron/dispatch:
  1. SELECT jobs FROM cron_jobs WHERE enabled AND due(cron_expr, now, last_run)
  2. for each due job: fire it (internal fetch or inline handler), update last_run
  3. record run in cron_job_runs (status, duration, error)

cron_jobs table  (grows to thousands — INSERT a row to add a job)
  job_name, route_or_handler, cron_expr, enabled,
  last_run_at, next_due_at, timeout_ms, max_concurrency, payload jsonb
```

**Adding a scheduled job becomes an INSERT, not a vercel.json edit.** ~6 Vercel
slots support thousands of logical jobs. The 100-cap is never approached again.

This also dissolves the **21-entries-for-timezone** smell: instead of 21
hardcoded windows, one tick asks "whose local 7 AM is now?" and sends to just
those users. Batch windows become *data*, not config.

---

## 3. Why This Shape (vs. alternatives)

| Approach | What | When it fits |
|---|---|---|
| **Dispatcher + schedule table** (this PRD) | ~6 ticks → 1 route → Supabase job table | **Now → ~50K.** Minimal new infra; we already run Supabase. |
| Queue-based (QStash / Inngest / Vercel Queues) | jobs = durable messages; retries, fan-out, concurrency, per-job observability | 50K → 100K+, when sends need retries/backpressure |
| Dedicated worker (always-on service) | move heavy/long syncs off serverless | when one sync can't finish in a function timeout |

We **migrate through** these, not choose one forever. Dispatcher now buys
years. Queue when send orchestration gets complex. Worker when a single sync
(e.g. the 1.7M-row SAM entity backfill) exceeds the serverless timeout — which
it eventually will.

---

## 4. Scope

### Phase 1 — Dispatcher core (unblocks future growth)
- `cron_jobs` + `cron_job_runs` tables.
- `/api/cron/dispatch` with a cron-expression evaluator (e.g. a tiny
  `cron-parser`-style "is this due?" check; no new heavy dep if avoidable).
- ~6 fixed tick entries in `vercel.json`.
- Admin UI/endpoint to enable/disable/inspect jobs + recent runs.
- Idempotency + overlap guard (a job already running doesn't double-fire).

### Phase 2 — Migrate existing crons onto it
- Move the ~27 distinct routes into `cron_jobs` rows.
- **Collapse batch windows into data-driven dispatch** (timezone sends become
  "whose local time is now," not 21 entries).
- Delete the migrated `vercel.json` entries. Target: **~6 entries total**,
  reclaiming ~94 slots.
- Migrate one pipeline at a time, verify, then the next. Daily-alerts and the
  send-* pipelines are load-bearing (CLAUDE.md) — migrate them last, with the
  watchdogs watching.

### Phase 3 (later) — Queue/worker as load demands
- Introduce a durable queue for the high-fan-out sends.
- Move the SAM entity backfill to a worker when it outgrows serverless.

### Non-Goals
- Rewriting the job *logic* — jobs keep their existing handlers; only the
  *trigger* changes.
- A general workflow engine. This is scheduling, not orchestration.

---

## 5. Risks

- **Dispatcher is now a single point of failure** for all scheduling. Mitigate:
  keep a couple of critical jobs (briefing-watchdog) on their own native cron
  as a backstop; the watchdog can self-heal the dispatcher.
- **Migration touches load-bearing send pipelines.** Do it incrementally,
  last, with day-guards + watchdogs intact. Never big-bang.
- **Cron-expression evaluation correctness** (timezones, DST). Test hard;
  timezone sends are where bugs hide.
- **Overlap/double-fire** if a tick runs while the previous job instance is
  still going. Needs a run-lock per job.

---

## 6. Success Criteria

- `vercel.json` crons drop from ~100 to ~6 and **stop growing with features**.
- Adding a scheduled job = one INSERT, no deploy.
- All existing scheduled behavior (alerts, briefings, syncs) preserved,
  verified by the existing test suite + watchdog health.
- Headroom for 1,000s of logical jobs — the 100-cap is permanently behind us.

---

## 7. Decision Log

| Date | Decision | By |
|---|---|---|
| 2026-06-04 | Solve the 100-cron cap as architecture, not per-feature patches | Eric |
| 2026-06-04 | Today: chain gov-buyer sync off sync-sam-opportunities (band-aid). Real fix: this dispatcher PRD as a separate project. | Eric |

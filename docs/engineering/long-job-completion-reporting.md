# Long-job completion reporting (Workstream C, batch 2)

**Date:** 2026-09-21 · **No schema change. No new observability system.**

## C1 — the dispatcher contract, traced

`src/app/api/cron/dispatch/route.ts` fires every due job in one `Promise.all`, so
it cannot await a job that outlives `DISPATCH_AWAIT_CAP_MS` (55s). For any job
with `timeout_ms` above the cap it:

1. waits `LONG_JOB_ACK_MS` (**12,000ms**),
2. **aborts the client fetch** (`AbortController`) — the route keeps running on
   its own instance,
3. records `status='dispatched'`, `http_status=NULL`.

`dispatched` is a status the watchdog **deliberately ignores**, because a false
`timeout` would alert on every healthy long job.

**That timing is correct, and `dispatched` is not a failure — it is a truthful
handoff record.** The gap is that any outcome after the 12s mark was invisible:
the route had no way to speak once the dispatcher stopped listening.

**Raising the cap is not the fix:** 72 of 73 enabled jobs are "long" (up to
300s); awaiting them would time out the dispatcher itself and take every job
with it.

## C3 — the mechanism already exists

**`src/lib/cron-self-report.ts` → `reportCronOutcome(jobName, outcome, msg?)`**
was already shipped. It writes a terminal status directly to `cron_jobs` — which
is exactly what the watchdog reads — and closes out the matching
`cron_job_runs` row. Best-effort by design: a failure to report can never mask or
become the job's real outcome.

**It was wired into only 4 routes:** `sync-dibbs`, `sync-grants`,
`sync-forecasts`, `saved-search-alerts`.

**So this PR adds no table, no column and no second scheduler-observability
system.** It wires four more routes into the mechanism that already exists.

## Measured gap (30 days, enabled jobs, runs recorded `dispatched`)

| Job | Unconfirmed runs |
|---|---:|
| `sync-recompete-contracts` | 719 |
| `backfill-recipient-certs` | 709 |
| `enrich-recompete-detail` | 709 |
| `enrich-opportunity-seo` | 627 |
| `embed-sow-corpus` | 251 |
| `pursuit-changes` | 221 |
| `sync-decision-makers` | 71 |

## C2 — dispatch truth and completion truth stay separate

| Concept | Written by | Value |
|---|---|---|
| **handoff** | dispatcher | `dispatched` — preserved, never overwritten to mean success |
| **completion** | the callee, at the end of its real work | `success` / `partial` / `error` |

`dispatched` keeps meaning *"fired, outcome not yet reported"*. A run that never
reports stays `dispatched` — still honestly unknown, which is the correct
reading.

## Wired in this PR

| Route | Job | Outcome rule |
|---|---|---|
| `sync-gov-buyer-data` | **`sync-decision-makers`** | success / error; **`dry=1` reports nothing** |
| `institute-legislation-sync` | `institute-legislation-sync` | `partial` when any document failed or was blocked, even though the HTTP response is a detailed 200 |
| `precompute-opp-intel` | `precompute-opp-intel` | `partial` when every processed item failed — a 200 is not evidence |
| `snapshot-multisite` | nih / nsf / darpa | source→job map; **reports only a single-source run**; `partial` when 0 records were scraped |

Two hazards handled explicitly:

- **Route name ≠ job name.** `sync-gov-buyer-data` serves the job
  `sync-decision-makers`. The mapping is a stated constant, never inferred.
- **One route, three jobs.** `snapshot-multisite` picks its source from a query
  param, so a multi-source or unmapped run reports **nothing** — guessing would
  write a status onto the wrong job. This is exactly where DARPA and NSF looked
  green for 30 straight days.

## C4 — completion is still not advancement

Even with this, **job completion ≠ data advancement**:

- DARPA can complete successfully and write **0 rows forever** (Workstream B).
- Decision Makers completes with **0 mutations** in steady state, which is correct.

So the source clocks stay the authority on advancement
(`research_source_advancement()`, `sam_opportunities_advancement()`, the drain
cursor). This PR makes **execution outcome** observable; it does not make it a
proxy for data movement. They remain two questions with two answers.

## What did NOT change

- The dispatcher's timing, abort behaviour and `dispatched` semantics.
- The watchdog.
- `cron-self-report.ts` itself.
- Any schema.
- The other ~8 chronically-unconfirmed jobs — deliberately out of scope for a
  bounded first pass; the same one-line wiring extends to them.

## Post-merge

**No migration. No data write.** Verify by observation after the next scheduled runs:

```sql
select job_name, last_status, last_run_at
from cron_jobs
where job_name in ('sync-decision-makers','institute-legislation-sync',
                   'precompute-opp-intel','snapshot-multisite-nih');
```

Expect `last_status` to become `success` / `partial` / `error` instead of
remaining `dispatched`. `institute-legislation-sync` runs **weekly (Sunday)**, so
its first confirmation may take up to 7 days.

**Rollback:** revert. The calls are best-effort and additive.

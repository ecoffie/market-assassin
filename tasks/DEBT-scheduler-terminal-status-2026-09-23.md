# Debt — scheduler terminal-status observability (general reliability, #1593 follow-up)

**Recorded 2026-09-23 at the NDAA Legislative Intelligence freeze.** Not an NDAA defect; not scheduled.

## The defect
`src/lib/cron-self-report.ts` → `reportCronOutcome(jobName, …)` closes the job's **newest**
`cron_job_runs` row, whatever invocation wrote it. Any non-dispatched execution (manual/admin)
therefore stamps its outcome onto the last SCHEDULED run.

## Evidence
`institute-legislation-sync` row `3120e665-…` — `started_at 2026-09-20T13:58:27Z`,
`duration_ms 12002` (dispatched), `status success`, **`finished_at 2026-09-23T00:57:56Z`** — written
by a manual activation run three days later. The Sept 20 scheduled run's real outcome is unknown.
`cron_jobs.last_status` is overwritten the same way.

## Scope
All 8 routes wired to `reportCronOutcome` (sync-dibbs, sync-grants, sync-forecasts,
saved-search-alerts, sync-gov-buyer-data, institute-legislation-sync, precompute-opp-intel,
snapshot-multisite).

## Likely shape of the fix (not decided)
Report only for dispatcher invocations (`x-cron-dispatch: 1`) and scope the run-row close to the
invoking run (status `running|dispatched`, `started_at` within the invocation window) — never
"newest row". Also: a sub-12s route outcome can race the dispatcher's `dispatched` write.

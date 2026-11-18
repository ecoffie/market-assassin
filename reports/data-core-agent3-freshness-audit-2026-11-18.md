# Data Core freshness / duplicate / failed-job audit — Agent 3 (2026-11-18)

**Read-only.** No Gateway apply, no prune apply, no freshness stamps, no specialty-feed reopen.

Measured against live Supabase + `getmindy.ai` serving SHA `c6c9c0864`.

## Specialty feeds (PARKED policy unchanged)

| Job / store | enabled | last_run | last_status | Population | Verdict |
|---|---|---|---|---|---|
| `sync-dibbs` / `dibbs_rfqs` | **false** (disabled 2026-11-02, Apify cost) | 2026-11-02 | success | **103,076** rows | DOWN by decision; map parked; no MCP tool |
| `sync-grants` / `grants_cache` | true | 2026-11-18 09:00Z | success | advancing | GREEN (still parked from repair scope) |
| `sync-dod-sbir` / `dod_sbir_topics` | **true** | 2026-11-18 18:00Z | **success** | **0 rows** | FALSE GREEN — product park/block still open |
| DARPA/NSF multisite | disabled (prior park) | — | — | dormant | PARKED — do not reopen |

## Core pipelines checked

| Surface | Measured | Note |
|---|---|---|
| `extract-sam-events` | last 2026-11-18 07:00Z · HTTP **200** · 5477ms | #2147 code serving; only **103**/8,266 rows stamped `extracted_at` that run |
| `cron_logs` | **0 rows total** | Prune-report never persisted; fail-loud fix in this PR |
| Live prune replay | **53** proposed ids (within cap) | `tasks/events-prune-decision-pack-2026-11-18.*` |
| `agency_forecasts` | Gateway/manual slice still stale; tooling release CLOSED | DOI FCO packet **BLOCKED** (no export on disk) |
| Forecast PRs | #2159/#2161/#2160/#2162/#2164 on main | Do not reopen; dry-run only |

## Duplicates / false clocks

- Control-plane `current` with null advancement clocks still applies to DIBBS (and historically other automated instances) — Phase 0.1 from health audit remains open.
- `dod_sbir_topics=0` + cron `success` every 6h is the clearest false-green still firing.
- Specialty DIBBS/Grants/SBIR repair remains **PARKED** per `docs/data-core-reliability-dibbs-grants-sbir.md` unless Eric unparks.

## Failed cron_job_runs

`extract-sam-events` last 8 runs all `success`/HTTP 200. Broader 7d failure sweep was not exhaustively paged in this pass; DIBBS has no recent runs (disabled). Recommend Agent 5 authorize a follow-up `cron_job_runs` scan for `http_status>=400` if needed for the ops board.

# Cached open retrieval: fixes for Agent 5's review (2026-11-15)

Branch `agent3/cache-hardening`, based on the RC3 preview 34aad5828. All development only:
- `OPEN_SNAPSHOT_RETRIEVAL` stays off;
- nothing is deployed;
- no migration is applied;
- no bucket or cron row exists.

Review text: `/Users/ericcoffie/mindy-release-private/CACHE-ARCHITECTURE-REVIEW-2026-11-15.md` (private).

| # | finding | status on this branch |
|---|---|---|
| 1 | Post-sync self-disable: the sync stamps about 8,000 rows, so delta > 1,500, so the cache refuses for up to 6 h | Fixed in code. An overflow requests one rebuild or reload. It is single-flight, at most one per 10 min, and callers stay on SQL until it lands. Fixed at the source by #2 once the trigger exists. |
| 2 | Change markers are a convention | Draft trigger migration and rollback, **not applied**, kept out of `supabase/migrations/`. See `migration-draft/snapshot_changed_at.{up,down}.sql`. The code selects it with `OPEN_SNAPSHOT_CHANGE_MARKER=snapshot_changed_at`; unset means today's writer stamps. |
| 3 | Per-instance DB builds | `open-snapshot-store.ts` handles serialize, checksum, private-bucket write and load. It never creates the bucket and refuses a missing or public one. `/api/cron/build-open-snapshot` (CRON_SECRET bearer only) builds once and uploads. Instances download by default; `OPEN_SNAPSHOT_SOURCE=db` builds in-process for development only. |
| 4 | Unbounded parallel verify | At most 6 verify requests in flight (`VERIFY_CONCURRENCY`). |
| 5 | Regex dialect | Closed grammar: only the forms the planner emits are evaluated. Anything else makes the plan uncacheable, so the caller uses SQL. |
| 6 | Delta query cost after a sync | Addressed by #1 / #2. |
| 7 | Unmeasured: cold download + parse, memory, concurrency on Vercel | **Open.** Needs a preview deployment, Eric's call. |

Tests:
- `open-cache-hardening.unit.test.ts`: grammar over emitted patterns plus rejects, verify concurrency ≤ 6, rebuild single-flight/rate limit, marker selection, and trigger column coverage.
- `open-snapshot-store.unit.test.ts`: round-trip, tamper and truncate refused, public or missing bucket refused, no `createBucket`.
- `open-cache-integration.unit.test.ts`: default storage source makes one download and zero DB builds.

## Trigger review notes (Agent 5, 2026-11-15), applied

- **Cut-over:** rows that exist at install keep NULL, so any snapshot built before the install is refused.
  - `OPEN_SNAPSHOT_MARKER_SINCE` = install time (ISO), set before `OPEN_SNAPSHOT_CHANGE_MARKER`.
  - With the marker selected and no valid install time, every snapshot is refused.
  - A refused snapshot triggers a fresh load.
  - Covered by tests.
- **ACL:** `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` is in the draft.
- **Cost, still to measure:** `IS DISTINCT FROM` on description and sow_text compares full text on every UPDATE that
  rewrites them. Before approval, measure sync upsert latency before and after the trigger on a branch or preview
  database:
  - the same sync batch, with and without the trigger;
  - p50 and p95 per batch;
  - total sync duration;
  - statement timeouts.
  - Expectation: equal-length text compares are memcmp and the sync already writes these columns. The number must be
    measured, not assumed.

## Approval path for Eric (unchanged from the review)

1. A private `open-snapshots` bucket, service-role only.
2. A `cron_jobs` row for `/api/cron/build-open-snapshot` after each SAM sync, verified via `cron_job_runs.http_status`.
3. The `snapshot_changed_at` trigger migration (draft here), then `OPEN_SNAPSHOT_CHANGE_MARKER=snapshot_changed_at`.
4. A preview measurement (#7).
5. The FIND flag on a preview, then production. The Map comes in a separate PR.

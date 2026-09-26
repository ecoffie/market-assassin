# Grants cache reconcile — stale records only after a proven-complete ingest (2026-09-26)

Follows the read-only report **#1711** (`tasks/grants-gov-path-health-2026-09-26.md`).
**Stop before merge / deploy / migration.** The migration file is included and **not applied**.
No production write, no feed or cron change, no credits.

## The defect (measured, not assumed)

`sync-grants` only upserts, so a grant Grants.gov stops listing stays in `grants_cache` looking
actionable forever.
- **103** such rows render as actionable on the Grants map. Measured twice: in #1711, and again by
  this PR's read-only dry run (`tasks/evidence/grants-cache-reconcile/dry-run-2026-09-26.json`).
- **Checked against the official `fetchOpportunity` API:**
  - #1711's sample of 12: 8 archived synopses, 1 missing, and 3 then described as "forecasts no
    longer listed".
  - **Correction:** re-probing shows RFA-DK-27-102 is an **archived** forecast (archiveDate
    2026-09-17), and PAR-26-120 (cached as forecasted) is **live** as a posted synopsis (archive
    2030).
  - This PR's dry run sampled the first 20 of the 103 by opportunity number: **20/20 archived**.
- **The remaining ~83 of the 103 are unverified individually.** Nothing here claims otherwise; the
  confirmation step exists to verify them one by one.

## Design — two separate facts

| Column | Meaning | Written by | Cleared by |
|---|---|---|---|
| `last_seen_at` | last ingest snapshot that listed the row | every run that sees it | — |
| `absent_since` | **our evidence:** not listed by a **proven-complete** run | reconcile, only on a complete run | the next run that sees the row |
| `source_status` | **the source's statement:** `posted`/`forecast` (live) · `closed`/`archived`/`not_found` (gone) | confirmation step, only from a well-formed API answer | reset to NULL when a row becomes absent again |
| `source_checked_at` | when the source was asked | confirmation step | same |

Plus `grants_ingest_runs`: per run, per status `{expected hitCount, fetchedUnique, pages, degraded,
error, complete, reason}`, plus the reconcile and confirmation outcomes. Completeness is evidenced and
persisted, so a future 500 is diagnosable; the 2026-09-19 cause was lost.

**Records are never deleted.** A row seen again is restored (`absent_since` cleared).

## Completeness — the only condition under which anything is marked absent

A **status** is complete only if **all** of these hold:
- every page answered (no thrown fetch, no degraded page);
- the listing was exhausted, with no per-status cap reached;
- the upstream `hitCount` was reported **consistently** on every page, and is **> 0**;
- unique fetched == hitCount. **Tolerance: exact.**

A hitCount of 0 is never complete, because it can't be told apart from Grants.gov's silent-empty
answer.

**The run** must be complete for **every** status, and every upsert chunk must succeed. It is
run-level, not per-status, because grants move between statuses: a forecast becomes a posted
synopsis (PAR-26-120 did). If one status's fetch is partial, a transitioning grant could be missing
from both listings, and marking it absent would hide a live grant. So one incomplete status blocks
reconcile for the whole run, and the reason is recorded.

**Breaker:** even on a complete run, if the rows that would newly be hidden exceed **20%** of the
actionable rows present before, reconcile is refused and needs a supervised run
(`allowLargeReconcile`, never set by the cron). Today's backlog is 103 / 1,639 = **6.3%**, so the
first run would proceed.

## States and read-path treatment (map pins + `grants-map` counts)

| State | Condition | Map / headline count |
|---|---|---|
| present | `absent_since IS NULL` | shown (existing close-date rule still applies) |
| absent_from_snapshot, unconfirmed | `absent_since` set, `source_status` NULL | **hidden**, counted in `hidden.notInLatestSnapshotUnconfirmed` |
| confirmed live (`posted`/`forecast`) | absent but the source says live | **shown**, labelled by the confirmed status |
| confirmed_closed / confirmed_archived / not_found | absent and the source says gone | **hidden**, counted in `hidden.confirmedGone` |
| expired posted (close date past) | unchanged | hidden by the existing read-time filter (no marking, no delete) |

**Why absent-and-unconfirmed is hidden rather than labelled:** the absence is proven by a complete
snapshot, so presenting the row as actionable would repeat the defect. Hiding is reversible, and
the row comes back if:
- a later run sees it; or
- the source confirms it live (PAR-26-120 is exactly that case).

It is never shown as "closed". The `grants-map` response carries `hidden` counts so the headline
doesn't silently shrink. `hidden: null` means the migration isn't applied and no filter is active.

## Safe without the migration

The ingest probes for the columns and the runs table.
- **If missing:**
  - the upsert payload is byte-for-byte the old shape;
  - reconcile and confirmation are skipped with a recorded reason;
  - the run record is skipped with a warning.
- **The map reader and route:** if the filtered query fails with a missing-column error
  (42703/PGRST204), they re-run the old query. The map behaves exactly as before; nothing errors
  and nothing is hidden.

**Rollout order:** apply the migration first (`npm run migrate -- --only
20260926_grants_cache_reconcile.sql`, **never** a bare `--go`, because other pending migrations
exist), verify it through PostgREST, then deploy. Either order is safe.

## Tests (behavioural; only I/O faked)

`src/lib/grants/reconcile.unit.test.ts` (23) and `src/lib/grants/reconcile-read-path.unit.test.ts`
(5) drive the **real** `ingestGrants`, `reconcileAbsentGrants`, `confirmAbsentGrants`,
`getGrantsViewportPins` and `/api/app/grants-map` handler over an in-memory Supabase fake
(`grants-cache-fake.ts`) that simulates the migration being absent.

- **Complete run:** exactly the unlisted rows are marked absent; listed rows keep `last_seen_at`;
  nothing is deleted; run evidence is recorded.
- **Restoration:** a row seen again is restored and counted.
- **Incomplete runs mark nothing, for any status:**
  - a degraded page;
  - a thrown fetch;
  - unique ≠ hitCount;
  - hitCount 0;
  - hitCount changing mid-run;
  - a per-status cap;
  - one incomplete status blocking the other, complete status.
- **Breaker:** refuses a large absence.
- **Migration missing:** a safe no-op; the payload has no new columns, nothing is hidden, and the
  reason is recorded.
- **Classification:** archived synopsis / archived forecast / live synopsis / closed / live
  forecast / not_found; HTTP 500, errorcode ≠ 0, malformed body and unknown docType → **unconfirmed**.
- **Confirmation step:** writes only definitive answers; timeout or 503 leaves the row unconfirmed.
- **Map and route:** show present + confirmed-live; hide unconfirmed-absent and confirmed-gone;
  report `hidden` counts; the old behaviour when the migration is missing.

**Mutation proofs** (each turned tests red; restored → 28/28):
- M1 run-completeness check removed → 6 red;
- M2 exact count equality removed → 2 red;
- M3 map visibility filter removed → 2 red;
- M4 outage classified as not_found → 3 red;
- M5 schema guard on the upsert payload removed → 1 red.

## Verify after an authorized release

1. `npm run db:check -- grants_cache absent_since` and `npm run db:check -- grants_ingest_runs`.
2. **Before the first run:** `npx tsx scripts/grants-reconcile-dry-run.ts --confirm 20 --json`
   (read-only). Expect `complete: true`, `wouldMarkAbsentActionable` ≈ the measured 103, and the
   breaker not tripping.
3. **After the first nightly run:**
   - `grants_ingest_runs` newest row has `complete=true` and `reconcile.ran=true`, with
     `actionableMarkedAbsent` ≈ the dry-run number;
   - the `grants-map` response `hidden.notInLatestSnapshotUnconfirmed` ≈ that number, minus
     confirmations;
   - `totalForFilters` drops by the same amount.
4. **Over the next runs,** confirmation moves rows from `notInLatestSnapshotUnconfirmed` to
   `confirmedGone`, or back to visible if the source says they're live. The bound is 40 per run, so
   the ~103 backlog clears in about 3 runs.

## Unknown / open

- **The ~83 unverified rows:** the confirmation step will classify them; nothing is asserted about
  them before then.
- **Why a live grant can be missing from a complete listing:** PAR-26-120 is live per
  `fetchOpportunity`, yet it wasn't in today's posted or forecasted search. Until confirmed it would
  be hidden. Confirmation restores it, but the listing gap itself is unexplained.
- **hitCount availability:** the legacy search endpoint's `total` falls back to the page length if
  `hitCount` is absent. That's caught by the consistency rule for multi-page statuses, but a
  single-page status without `hitCount` would look complete. Both statuses are 7–10 pages today.
- **Data inventory** still counts all `grants_cache` rows, including expired and absent ones. Not
  changed here; it's a follow-up.

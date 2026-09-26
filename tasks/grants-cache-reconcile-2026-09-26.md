# Grants cache reconcile — stale records only after a proven-complete ingest (2026-09-26)

Follows the read-only report **#1711** (`tasks/grants-gov-path-health-2026-09-26.md`).
**Stop before merge / deploy / migration.** The migration file is included and **not applied**.
No production write, no feed or cron change, no credits.

> **REVISED 2026-09-26 (review blocker).** The first version HID a row when a complete listing omitted
> it. A complete listing proves the listing was fully retrieved, not that it contains every live grant,
> and a known-live grant (PAR-26-120) would have been hidden. **Absence now never hides a grant:**
> - absent → marked **absent/unverified**, still visible and labelled;
> - an official lookup of **closed** or **archived** → removed from actionable results, record kept;
> - an official lookup of **live** → visible;
> - a failed, timed-out or **not_found** lookup → visible, uncertainty kept.
>
> Measuring all 103 then found the real mechanism behind "live but missing". All **17** such rows are
> the **same Grants.gov opportunity re-listed under a new funding-opportunity number**. Examples:
> PAR-26-120 → PAR-28-056, FOR-RFA-AG-26-024 → PAR-27-096.
>
> So a separate identity state, **superseded**, hides only the stale duplicate row; the grant stays
> visible exactly once. The sections below are updated. The old hide-on-absence rule is mutation-tested
> as a failure (7 tests red).

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

## States and read-path treatment (map pins + `grants-map` counts) — REVISED

| State | Condition | Map pin | `grants-map` counts |
|---|---|---|---|
| listed | `absent_since IS NULL` | shown, `verification: 'listed'` | headline |
| absent / unverified | absent, `source_status` NULL (not looked up, **or lookup failed / timed out**) | **shown**, `'absent_unverified'` | headline + `visibleUncertain.absentUnverified` |
| absent / confirmed live | absent, source `posted` / `forecast` | **shown**, `'absent_confirmed_live'`, labelled by confirmed status | headline |
| absent / not_found (ambiguous) | absent, source `not_found` | **shown**, `'absent_not_found_ambiguous'` — never "closed" | headline + `visibleUncertain.absentNotFoundAmbiguous` |
| absent / confirmed closed or archived | absent, source `closed` / `archived` | **hidden** (record kept) | `hidden.confirmedClosedOrArchived` |
| superseded (renumbered duplicate) | `superseded_by` = the number the SAME Grants.gov id is listed under in the complete run | **hidden** (record kept); the grant is shown via its current row | `hidden.supersededDuplicates` |
| expired posted (close date past) | unchanged | hidden by the existing read-time filter | — |

- **Identity** is the Grants.gov opportunity id taken from the cached detail URL. The
  funding-opportunity number (`opp_number`, the cache key) changes when a forecast is posted or a
  notice is reissued.
- Superseded rows are not looked up; their current row is listed.
- A row seen again clears `absent_since` and `superseded_by`.
- The client does not yet *render* the `verification` label. The pin data carries it, and a UI
  change is a separate step. Until then an absent/unverified grant looks like any other visible
  grant, which is the safe direction.

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

## Evidence — the 103 stale rows, all classified (read-only, 2026-09-26)

`tasks/evidence/grants-cache-reconcile/classify-all-103-2026-09-26.json` ran every stale row through
the real `classifySourceRecord`. `…/dry-run-new-rule-2026-09-26.json` is the new-rule dry run.

| Result | Rows | New-rule outcome |
|---|---|---|
| live, re-listed under a new number (16 posted + 1 forecast) | 17 | superseded → stale row hidden; grant visible once via its current row |
| archived | 73 | visible as absent/unverified until looked up → then hidden |
| closed | 7 | same → then hidden |
| not_found | 3 | visible, labelled ambiguous |
| lookup returned HTTP 200 but an unrecognised shape (`NM-PMO1726`, `IVV-FT-OPP-…` ×2) | 3 | visible, unverified |

**How the three samples reconcile:**

- **My original 12** (chosen by `synced_at`), re-run through the real classifier: 8 archived, 3 live,
  1 not_found. The 8 archived are 5 synopses plus 3 archived forecasts (RFA-DK-27-102,
  HHS-2025-IHS-ALZ-0001, RFA-NS-26-009). The 3 live are PAR-26-120, FOR-RFA-AG-26-024 and PAR-25-454,
  all renumbered. The 1 not_found is NOAA-…-27967.
  - My earlier report ("8 archived synopses, 3 dropped forecasts, 1 missing") had the right total and
    the wrong members. My ad-hoc probe printed any archive date as "archived", including future
    ones, so it counted 3 live synopses as archived; and it read `synopsis.archiveDate` only, so it
    reported 3 archived forecasts as merely dropped. The fork's correction on RFA-DK-27-102 was
    right.
- **The fork's 20** were the first 20 **by `opp_number`** (the dry-run script's order). All 20 are
  archived, but that is a different, non-random sample: only 1 of them overlaps my 12, and the
  alphabetical order clustered archived rows. "All 20 archived" did not generalize: the full 103
  include 17 live and 6 uncertain.
- **The full 103** is the population. The dry run under the new rule: complete listing (925/925,
  611/611); 17 superseded hidden right after one run; 86 visible as absent/unverified; after
  looking up all 86, **80 would be hidden** (confirmed closed/archived), 3 stay visible as
  ambiguous, 3 stay visible as unverified, and **0** confirmed-live grants would be hidden.

## Verify after an authorized release (the migration is NOT approved; clipboard ≠ approval)

1. Only after explicit sign-off:
   `npm run migrate -- --only 20260926_grants_cache_reconcile.sql`. Never a bare `--go`, because
   other migrations are pending. Then `npm run db:check -- grants_cache superseded_by` and
   `npm run db:check -- grants_ingest_runs`.
2. **Before the first run:**
   `npx tsx scripts/grants-reconcile-dry-run.ts --confirm 200 --json` (read-only). Expect
   `complete: true`, `identity.supersededDuplicatesHidden` ≈ 17, `afterRun.hidden` equal to
   superseded only, and `afterLookupsOfSample.staysVisible_confirmedLive` = 0.
3. **After the first nightly run:**
   - `grants_ingest_runs` newest row has `complete=true`, `reconcile.ran=true` and
     `reconcile.superseded` ≈ the dry run;
   - `grants-map` `hidden.supersededDuplicates` ≈ 17;
   - `hidden.confirmedClosedOrArchived` climbs only as lookups land (40 per run);
   - `visibleUncertain.absentUnverified` falls correspondingly;
   - **PAR-28-056 is visible, PAR-26-120 is not, and no grant appears twice.**
4. **Regression pinned:**
   `src/lib/grants/grants-live-but-missing.regression.unit.test.ts` (PAR-26-120 both ways).

## Unknown / open

- **The 3 unrecognised lookup shapes** (HTTP 200, the classifier returns null) stay unconfirmed and
  visible. Worth a look before release, but not a blocker.
- **Why a live grant can be missing from a complete listing: RESOLVED for all 17 measured cases.**
  Each is the same Grants.gov id re-listed under a new funding-opportunity number (superseded). A
  genuinely missing live grant, with no id match, would stay visible as absent/unverified. That path
  is pinned by the regression test.
- **hitCount availability:** the legacy search endpoint's `total` falls back to the page length if
  `hitCount` is absent. That's caught by the consistency rule for multi-page statuses, but a
  single-page status without `hitCount` would look complete. Both statuses are 7–10 pages today.
- **Data inventory** still counts all `grants_cache` rows, including expired and absent ones. Not
  changed here; it's a follow-up.

# DESIGN BRIEF — Competition Health longitudinal snapshots

**Status:** design only. Not scheduled. Nothing here is built.
**Date:** 2026-09-26.
**Origin:** Data Core Observation Moat audit (PR `feat/data-inventory-visuals`).

## Why

Competition Health (`/admin/competition-health`, `src/lib/analytics/competition-health.ts`) is an
**on-demand scorecard**. It computes one agency's metrics per request and remembers nothing.

The only persisted piece is the competition-depth sample. That lives in `mcp_external_cache`
(`api_type='fpds_competition_depth'`), one row per scope key, overwritten on a 24h TTL. On
2026-09-26 that was 35 rows, 1 unexpired. It is a cache, not history.

As a result, the product questions below cannot be answered today:

- Is a buyer's small-business participation improving or weakening?
- Has single-bid competition narrowed since last quarter?
- Which markets moved from healthy to concentrated?

Starting to persist is the only way to make those answerable. The history begins on the day the
first snapshot is written, just as with `recompete_changes`. **It cannot be backfilled for the
cached components**:
- USASpending serves current award state.
- The bidder sample is re-drawn every time it is computed.

## What a snapshot would hold (only what the scorecard already computes)

One row per **(market scope, snapshot_date)**:

| column | source today | notes |
|---|---|---|
| `scope_kind` | — | `agency` first. `agency+naics` and `agency+state` only after the gov-buyer competition route's scoping is proven. |
| `agency` | request param | SAM long-form department name, exactly as the scorecard uses it |
| `naics`, `state` | optional scope | NULL for agency-wide |
| `snapshot_date` | — | UTC date |
| `active_opps`, `with_set_aside`, `sb_pct` | exact head-counts | already exact |
| `set_aside_mix` | JSONB | from a ≤1,000-row sample. **Store the sample size beside it** |
| `awarded_set_aside_mix` | JSONB | recompete award record |
| `awards_with_awardee`, `distinct_winners`, `top3_concentration_pct` | award notices in window | window = the scorecard's `windowDays` (store it) |
| `first_time_winners`, `first_time_checked` | bounded to top 15 | store both, so the rate is never over-read |
| `avg_bidders`, `median_bidders`, `single_bid_pct`, `sampled`, `sampled_with_data`, `evidence_strength` | competition-depth sample | store the sample counts and strength, never the average alone |
| `distinct_naics`, `top3_naics_pct` | sample | store the sample size |
| `computed_at`, `code_version` | — | so a formula change is visible in the series, not silent |

**Never store a composite "health score".** Integrity OS forbids scores that hide their inputs
(`contracts.unit.test.ts`). Any movement label must be derived from named components.

## Market set (what "monitored" would mean)

A snapshot is only a moat if the SAME markets are measured every cycle. Proposal:

- Phase 1: the agencies the scorecard's `TOPTIER` / `SUBTIER_BRANCHES` maps resolve (about 14 toptier + 3
  branches). An unmapped agency is refused by `computeCompetitionDepth` and must not be snapshotted.
- The watch list must be an explicit, versioned list in code, never "whatever someone viewed".
- "Markets monitored" may only be displayed as the count of that list with at least one successful
  snapshot.

## Cadence and cost

- Weekly. A monthly bid-count sample barely moves day to day, and each cycle is about 17 agencies × (a
  handful of Supabase head-counts + up to 100 USASpending award-detail fetches).
- Run as a `cron_jobs` row with a wall-clock budget, resumable by least-recently-snapshotted
  scope (the `recompete_naics_by_staleness` pattern). Stamp every outcome: ok / insufficient / refused / error.
- A run must be judged by rows written (`cron_job_runs.http_status` plus a count), never by
  `last_run_at`. The house rule: registered + firing ≠ working.

## Movement semantics (only after ≥ 2 snapshots of the same scope)

- Compare component by component, never a blended score:
  - participation Δ (percentage points)
  - single-bid Δ, **only when both snapshots have evidence_strength ≥ 'moderate'**
  - concentration Δ
- "Improving / stable / weakening" needs explicit per-component thresholds, written down and
  unit-tested. Below-threshold change reads as "no material change". Insufficient evidence reads as
  "not comparable", never "stable".

## Storage

- A new append-only table (e.g. `competition_health_snapshots`), unique on
  `(scope_kind, agency, coalesce(naics,''), coalesce(state,''), snapshot_date)`.
- Idempotent migration, applied with `npm run migrate -- --only <file>` and verified through PostgREST.
- RLS service-role only.

## Data Core integration (after it exists)

- Adds an **observation** row to `/admin/data-inventory` alongside `recompete_changes`,
  `leaderboard_snapshots` and `intelligence_changes`. It is never added to the source totals.
- Only then may the Competition Health card show a history line or movement classes.
- `inventory-truth.unit.test.ts` currently fails the build if the card claims a trend. That guard
  should be relaxed only in the same PR that ships real snapshots.

## Explicitly out of scope

- No backfill.
- No reconstruction of past bidder samples.
- No ranking or "score" across agencies.
- No customer-facing trend claims until at least two snapshots per scope exist and the movement
  thresholds are signed off.

## Open decisions for Eric

1. The Phase-1 market list: toptier agencies only, or also agency+NAICS for the campaign's
   talking-point markets?
2. Weekly vs monthly cadence.
3. The movement thresholds (pp change for participation / single-bid / concentration).

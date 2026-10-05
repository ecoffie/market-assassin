# Production awards completeness hard gate (2026-10-04)

**Status: BUILT + TESTED + run read-only against production. Not merged.** Awaiting review.
Incident: `tasks/bq-dod-awards-integrity-2026-10-04.md`. Sibling: `tasks/awards-merge-identity-2026-10-04.md` (#1831).

## The blind spot

On 2026-09-23 the warehouse held **71** DoD transactions for Feb 2026 against **355,113** at USASpending
(Mar 74 / 403,258 · Apr 50 / 398,896) while `MAX(action_date)` was current. The ingest stamped itself
healthy, because nothing on the production path looked at historical months.
- The cohort oracle (`cohort-completeness.ts`) existed, but only as a warn-only, local pre-push check.
- It was warehouse-only (year-over-year).
- It counted the malformed `'97'` DoD rows as "civilian".

## What changed (narrow, by instruction)

| Piece | File |
|---|---|
| Classifier: NOT_SETTLED · OK · SOURCE_LAG · WAREHOUSE_HOLE · UNMEASURED. It **reuses** `COHORT_SETTLE_DAYS` (DoD 120 / civilian 45), `MIN_YOY_RATIO` (0.40) and `MIN_PRIOR_BASELINE` (1,000) from the existing oracle | `src/lib/awards-ingest/completeness-gate.ts` |
| USASpending monthly source counts (moved out of the A1 acceptance script; one implementation) | `src/lib/awards-ingest/source-counts.ts` |
| I/O runner (SELECTs + USASpending counts only) | `src/lib/awards-ingest/completeness-gate-run.ts` |
| **On the production path**: after MERGE → recipients rebuild, **before** the `data_sources[bq_awards]` freshness stamp. FAIL → `failed_after_merge` thrown, clocks never stamped, workflow red (the normal Actions failure notification) | `scripts/ingest-usaspending-awards.ts` |
| Read-only check of live production | `scripts/awards-completeness-gate.ts` |

**Rule.** A settled month is a WAREHOUSE_HOLE when the source holds ≥ 1,000 transactions and the
warehouse holds < 40% of them. Small drift is informational (OK). The threshold is catastrophic-only:
- Jan 2026 at 74.7% of source in the incident is OK.
- Feb at 0.02% is a hole.

**SOURCE_LAG** is a settled month that is thin against its own prior year while the source is equally thin.
- It warns and never fails.
- The old oracle would have called it a hole: DoD Aug 2026 has 72 in the warehouse and 72 at USASpending.

**Agency codes.** A valid code has 3 or 4 digits.
- Malformed codes are their own bucket, never DoD and never civilian.
- Malformed codes in **this run's staged rows** fail the run (integrity).
- The **264** malformed rows already in the warehouse are reported as debt (WARN), not failed and not cleaned. Cleaning them is a separate decision.

**Source unavailable.** Settled months become UNMEASURED and the gate fails closed, the same contract as every other unmeasured check on this workflow.

**Not applied to partial runs** (`--to`, `--idv-only`). Those never stamp freshness, and the gate guards that stamp.

## Proof

`src/lib/awards-ingest/completeness-gate.unit.test.ts` uses **measured** fixtures: the pre-repair clone
`awards_clone_pre_idv_20261004_1406`, the live repaired table, and live USASpending counts.

| Fixture | Result |
|---|---|
| exact Jan–Apr 2026 DoD hole (clone 1406) | **FAIL**: dod 2026-02 71/355,113 · 03 74/403,258 · 04 50/398,896 |
| same state through **main's** production checks (`verifyPostApply` + `classifyFreshness`) | **passes (healthy)**: main would not stop it |
| fresh MAX(action_date) + newer DoD/civilian rows + the hole | still **FAIL** |
| repaired Jan–Apr population | no hole (WARN: malformed debt only) |
| DoD Aug 2026, 72 warehouse / 72 source, judged once settled | **SOURCE_LAG** (the old oracle: a HOLE for Jul + Aug) |
| DoD Jun–Sep today, inside the 120-day lag | NOT_SETTLED |
| healthy civilian cohort | OK on every settled month |
| malformed code in staged rows / staged check unmeasured | **FAIL** (integrity) |
| USASpending unavailable | every settled month UNMEASURED → **FAIL** (never healthy) |
| adapter: unreachable / no-count response | `null`, never 0 |
| gate placed after the rebuild and before the stamp; throws on fail | wiring test, **red on main's script** |

awards-ingest suite 226/226 · tsc clean.

## Production, read-only (2026-10-04)

`npx tsx scripts/awards-completeness-gate.ts` → **verdict WARN, exit 0. No settled warehouse holes.**
16 settled cohort-months, all OK at 99.74–100.06% of the source:
- **DoD** 2025-11 → 2026-05
- **civilian** 2025-11 → 2026-07

DoD 2026-06..10 and civilian 2026-08..10 are NOT_SETTLED. The single warning is the 264 malformed warehouse rows.

## Out of scope (explicit)

Automatic repair, repair queues, per-agency self-healing, the 140 duplicate pairs, the 264 malformed rows,
Players automation, derived-table cleanup, map coordinates, unrelated oracles.

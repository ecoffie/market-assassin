# Mindy Data Core Controls — Phase 3: Wiring

**Status: SHIPPED — wiring only. No sixth control. No new dashboard. No data
repaired, no refresh, no stamp, no registry merged, no product decision changed.**
**Date: 2026-09-13 · Builds on Phase 1 (#1450) and Phase 2 (#1454)**

> The controls are done. Make the truth visible without creating a second source
> of truth.

---

## Why no new control was added

Phase 2 closed with five controls answering five distinct questions. The gap was
never a missing check — it was that **C1, C4 and C5 were libraries nothing
called**. A sixth control would have added capability nobody reads. Phase 3 adds
exactly one thing: a reader.

---

## Where each control is wired

| Control | Wired at | How |
|---|---|---|
| **C1** Advancement | `src/lib/data-core/integrity-report.ts` → `runAdvancement()` | reads each oracle's own watermark from the live table, plus the existing `awards-ingest/clocks.ts` reference for `bq_awards` |
| **C4** Producer/lineage | `runProducer()` | `classifyProducer` over `LINEAGE_CLAIMS` |
| **C5** Coverage | `runCoverage()` | `measureCoverage` — figures measured at call time, never transcribed |
| **C2** Claim/literal | `runClaims()` | **consumes** `scripts/audit-data-claims.mjs --json` |
| **C3** Registry | `runRegistry()` | **consumes** `scripts/registry-reconciliation.mjs --json` |

Surfaced as `dataCoreIntegrity` on **`GET /api/admin/platform-health`** — an
existing surface with the right architecture (a thin reader whose own note already
says *"a status is only reported when it was actually checked"*).

### C2 and C3 are shelled out to, not reimplemented
Duplicating their classification in TypeScript would create exactly the second
source of truth the rule forbids, and the two copies would drift — that drift is
census class 5. A control that cannot run reports `state: 'unmeasured'`.

---

## Platform Health is a READER

**No hand-entered counts, statuses, dates or labels.** Enforced by tests that
assert the reader contains no display literals (`'Healthy'`, `'Manual'`,
`'Fresh'`, …) and none of the census figures (`2,768`, `296,445`, `34.3`, …).
Every value is computed by a control or read from a control's own JSON.

**No composite score.** `anyUnmeasured: boolean` exists so no all-clear can be
painted while any control could not measure.

---

## What it renders (live run, 2026-09-13)

### Advancement (C1)
Run **without** local Supabase credentials, every dataset correctly reported
`unmeasured` — **not stale**:

```
unmeasured  sam_opportunities        posted_date could not be read — unknown, NOT stale
unmeasured  recompete_opportunities  last_synced_at could not be read — unknown, NOT stale
unmeasured  agency_pain_points       created_at could not be read — unknown, NOT stale
unmeasured  bq_awards                awards-ingest clocks unreadable
```

Fed the **live watermarks** (read separately through the read-only client), the
same wired path classifies:

```
healthy      sam_opportunities        posted_date advanced 1d ago (budget 3d)
healthy      recompete_opportunities  last_synced_at advanced 0d ago (budget 3d)
stamp_ahead  agency_pain_points       stamp 103d AHEAD of the data it describes
                                      (last_built 2026-08-01, newest created_at 2026-04-19)
```

**`agency_pain_points` is now caught by a running control**, not a census
document — and `stampAhead` survives as an independent flag.

### Producer / Lineage (C4)
```
producer_manual    tier2_sblo        documented Jun-2026 manual curation (PR #1444)
producer_missing   contractors.json  candidates write naics-top100.ts and /tmp
producer_proven    naics_vocabulary  build-naics-vocabulary.ts; refreshed_at 2026-07-11
```
Manual is **not** called broken. Missing is **not** called stale.

### Coverage (C5)
```
population   unavailable  contractor_population   percent=null  (not 0%)
enrichment   measured     contact_enrichment      1.4%  — 40 of 2,768, email in the overlay
editorial    measured     sat_editorial_labels    6.2%  — 19 of 307, absence is uncovered
```

### Claims (C2) — consumed
`contradicted=1 · unfalsifiable=6 · total=7`, the contradiction listed explicitly:
`registry.ts:170 — claim 95% vs measured 2.6%`.

### Registry (C3) — consumed
`partially_aligned=8 · contradictory=1 · unmeasured=7 · supabaseReadable=false`,
with `agency_forecasts` named: *docs claim 9,973; live measured 33,687; `last_built` NULL*.

**`anyUnmeasured = true`** — correct, and the reason an all-clear must not show.

---

## Datasets intentionally included / excluded

**C1 included:** `sam_opportunities`, `recompete_opportunities`, `bq_awards`
(via the existing clock reference), `agency_pain_points` (carried from Phase 1 —
it is the dataset the `stamp_ahead` state exists for).

**C1 excluded, deliberately:** `alert_log`, `briefing_log`, `user_engagement`
(write-side logs — a dead stream surfaces as *missing alerts*, not a stale table;
monitoring them would be vanity) and `sam_entities` (largest table found, but P2 —
size is not consequence).

**C4 included:** only the three datasets whose canonical role the P0 decisions
established. **C5 included:** the three coverage kinds plus the population case.

---

## Evidence format

Every status carries `evidence` naming the watermark/basis, the control that
produced it, and `measuredAt` where available:

> `Healthy — sam_opportunities.posted_date advanced 1d ago (budget 3d)`

not

> `Fresh`

---

## Unresolved product decisions — still visible, still unfixed

| Item | How it surfaces |
|---|---|
| `registry.ts coveragePercent: 95` | C2 `contradicted=1`, listed every run |
| `agency_pain_points` stamp 4 months ahead | C1 `stamp_ahead`, 103d |
| `contractors.json` has no producer | C4 `producer_missing` |
| `tier2_sblo` not refreshable | C4 `producer_manual` |
| `agency_forecasts` registry disagreement | C3 `contradictory` |
| `tier2-contractors-database.json` untraced | corpus role `unresolved` |
| 132 unmatched SBLO firms · SAT live methodology | unchanged, out of scope |

**None were fixed in this PR.** Where they affect a control result, that result is
shown honestly.

---

## Verification

| # | Requirement | Result |
|---|---|---|
| 1–3 | C1 / C4 / C5 have real callers | ✅ `integrity-report.ts` |
| 4 | C2/C3 reused, not copied | ✅ `--json` consumed; tests assert no duplicated logic |
| 5 | No hand-entered values | ✅ tests assert no display literals or census figures |
| 6 | Unmeasured renders unmeasured, not stale | ✅ **proven live** (4/4 without credentials) |
| 7 | Manual renders manual, not broken | ✅ |
| 8 | Missing renders missing, not stale | ✅ |
| 9 | Editorial uncovered ≠ 0% | ✅ `percent: null` |
| 10 | Undefined denominator ⇒ no percentage | ✅ |
| 11 | Registry contradictions reproduce from C3 | ✅ `agency_forecasts` |
| 12 | Known false literal still unresolved via C2 | ✅ `contradicted=1` |
| 13–15 | No data changed · no refresh/stamp · no new control | ✅ |

**Suite 4,647 passed / 0 failed** (up 19). `tsc` clean. Gates green.

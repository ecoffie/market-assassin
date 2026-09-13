# Mindy Data Core Controls — Phase 1

**Status: SHIPPED — 3 controls. No data repaired, no registry mutated, no
freshness stamp written, no customer-facing behaviour changed.**
**Date: 2026-09-12 · Plan: PR #1449 · Census: PRs #1445–#1448**

Every control traces to a demonstrated census failure. No generic governance
framework; no speculative controls.

---

## What Shipped

| Control | Kind | Files | Census failure it prevents |
|---|---|---|---|
| **C1 Advancement check** | library + tests | `src/lib/data-core/advancement.ts`, `.unit.test.ts` (17 tests) | class 3 (stamp contradicts data), class 9 (freshness asserted without evidence), class 16 (unmonitored live datasets) |
| **C2 Claim/literal gate** | ratcheted audit | `scripts/audit-data-claims.mjs`, `tests/fixtures/data-claims-baseline.json` | class 15 (hardcoded coverage claim), class 13 (surface describes another corpus) |
| **C3 Registry reconciliation** | read-only report | `scripts/registry-reconciliation.mjs` | class 5 (duplicate stores), class 10 (served dataset absent from registry), class 12 (canonical artifact unclear) |

`npm run audit:claims` · `npm run registry:reconcile`

---

## C1 — Advancement Check

**The invariant: job success is not data advancement.** `jobReportedSuccess` is
accepted by the classifier and **deliberately never upgrades a status** — it only
appears in the detail line, so an operator can see that a job succeeded while the
data did not move. A test pins that the status is identical with the flag true or
false.

**Five states** (extending the `bq_awards`/`clocks.ts` four): `healthy`,
`upstream_stale`, `ingest_broken`, **`stamp_ahead`**, `unmeasured`.

`stamp_ahead` is new and exists **because of one real dataset**:
`agency_pain_points` carried `last_built = 2026-08-01` while the newest
`agency_intelligence` row was `2026-04-19` — a stamp **104 days ahead** of the
data it described.

**Unknown is never stale.** An unreadable or unparseable oracle returns
`unmeasured` with **null** ages — never `0`, never "stale". This is Bug
Prevention Rule #11 applied to freshness.

### Oracles are declared per dataset, never assumed

Each oracle carries a mandatory `rationale`, enforced by a test. The census
proved a generic `created_at` would be wrong:

| Dataset | Column | Why this column |
|---|---|---|
| `sam_opportunities` | `posted_date` | SAM's own business date. `synced_at` advances on every sync even when SAM returns nothing — that is job execution, not advancement. |
| `recompete_opportunities` | `last_synced_at` | `period_of_performance_current_end` maxes at **2032-07-30** (a future contract END date) and would read a frozen table as perpetually fresh. |
| `agency_pain_points` | `agency_intelligence.created_at` | Append-only quarterly merge, so row creation is the real clock. The class-3 instance. |

### A design correction made during implementation

The first implementation ordered `stamp_ahead` before the stale check, and a test
failed. Investigating showed **"recent run over frozen data" and "stamp ahead of
the data" are the same input shape**, not rivals — and the real
`agency_pain_points` row satisfies **both** (146d old against a 120d budget, and
104d stamp-ahead).

Collapsing both into one enum value would discard a real finding. The control now
reports the **claim defect as the status** (it is why a human believed the data
was fresh) and carries an **independent `stampAhead: boolean`** plus the stale
fact in the detail string. One test expectation was corrected to match measured
reality, with the reason recorded inline in the test.

### Datasets deliberately EXCLUDED (on the record)

- `alert_log`, `briefing_log`, `user_engagement` — write-side logs of work that already happened. A dead stream surfaces first as **missing alerts** (a delivery symptom with its own `/alert-delivery` tooling), not a stale table. Monitoring them would be vanity. A test asserts they are absent from the oracle set.
- `sam_entities` (910,126 rows) — the largest table in the census, held at **P2**: nothing yet shows a wrong number from it changing a decision. Size is not consequence.
- `bq_awards` — already covered by `verify:oracles --only freshness`.

### Tests (17, all passing)
healthy · within-budget · **cron-success-with-frozen-data is NOT healthy** ·
`jobReportedSuccess` cannot upgrade · recent-run-over-frozen reports both defects ·
stale-with-honest-stamp is `upstream_stale` · unreadable → `unmeasured` ·
unparseable → `unmeasured` · unmeasured reports null not zero · the real
104-day `agency_pain_points` shape · matching stamp is not flagged · skew
tolerance · oracle set is exactly the three justified datasets · excluded
datasets absent · every oracle has a rationale · recompete avoids the 2032 column.

---

## C2 — Claim / Literal Gate

Ratcheted audit in the family of `audit-supabase-errors.mjs` /
`audit-rank-then-filter.mjs`.

**It reproduced the census finding independently** — by measuring
`src/data/contractors.json` at runtime, not by reading the census document:

```
CONTRADICTED  src/lib/data-sources/registry.ts:170  contractors-coverage
              email 40/2768, sblo_name 72/2768 (n=2768); claim 95% vs measured 2.6%
```

**Four classifications:** `derived` (computed live — never flagged) · `pinned`
(static, evidence-backed, within tolerance) · `unfalsifiable` (no defined
denominator, so no measurement could confirm or refute — 6 found) ·
`contradicted` (measurably wrong — 1 found).

### A known contradiction is never silently baselined

Baselining exists so existing debt does not block all progress, but a
**contradicted finding is printed on every run**, baselined or not. "Green" can
never mean "nothing is wrong here."

Three additional blocking conditions were added after the first injection test
**failed** (changing `95` → `99` initially passed, because the key was already
baselined):
1. classification worsens to `contradicted`;
2. an already-contradicted claim drifts **further** from measurement;
3. the claimed value **changes at all** on a contradicted entry.

Without (2) and (3), baselining 95%-vs-2.6% would have been permission to raise
it to 99% for free — the baseline would become a licence to overclaim rather than
a record of debt.

### Acceptance (all verified by inject → observe → revert)
| Case | Result |
|---|---|
| Inject `coveragePercent: 99` on the decision-relevant entry | **exit 1, blocked** |
| Revert | exit 0 |
| Add `// docs example: coveragePercent: 95` + block comment | exit 0 — **not noisy** |
| Add a new registry entry with `coveragePercent: 77` | **caught as new** |
| Existing contradiction | **printed every run** |

---

## C3 — Registry Reconciliation Report

**A report, not a gate.** Mutates nothing, exits 0. The merge/architecture
decision is explicitly deferred.

**Absent evidence → `unmeasured`, never `aligned`.** Without Supabase
credentials the report prints `?` for that column and says so, rather than
reporting the dataset as absent — the Phase 0D "verification blocked ≠ stale"
rule applied to registry presence.

Statuses: `aligned` · `partially_aligned` · `contradictory` · `unregistered` ·
`unmeasured`.

### Reproduces the census contradictions
- **`agency_forecasts`** → `contradictory`: docs claim 9,973; live measured 33,687; `last_built` NULL.
- **`naics_vocabulary`** → GREEN dataset with a real producer and a real `refreshed_at` clock, **no `data_sources` row** — cannot be flagged stale even in principle.
- **`tier2_sblo`** → monitored for freshness but **no repeatable producer**; the report states explicitly that **PR #1444 corrected the description, not the refreshability**.

Verified against the 12 real `data_sources` rows measured in Phase 0C: 5/5
presence assertions correct.

---

## Deliberately NOT Built

Per the Phase 1 brief and the controls plan:

- **Producer/lineage controls** — classes 1, 2, 4, 7, 11, 14. They need product decisions first; a control cannot resolve "which of 5 contractor stores is canonical."
- **Coverage controls** — class 6. Same reason: no target until the corpus question is settled.
- **No dataset repaired**, no registry merged, no contractor-store decision encoded, no canonical corpus chosen.
- **No new dashboard.** No score. No "Data Health 92/100."

### The two P0 product decisions still blocked (unchanged by this PR)
1. **`agency-sat-friendliness.json`** — should unreproducible opinion-based percentages remain in customer alert emails? *Not removed or rewritten here.*
2. **`contractors.json` / contractor stores** — which corpus is canonical for `/contractors`? *Not chosen here.*

---

## Platform Health

**No new surface built.** C1 is a library with no caller wired into a dashboard
in this phase; C2 and C3 are CLI controls in the established script family. If
surfaced later, the plan's guidance stands: advancement coverage, reconciliation
summary, claim audit status — **no score**.

---

## Remaining Gaps

- C1 is a **classifier**; no cron or dashboard calls it yet (deliberate — wiring is Phase 2 and needs a decision on where results surface).
- C2 measures one claim mechanically (`contractors-coverage`); the other 5 contradicted literals found in Phase 0C (pain-points 2765, sba-prime 3500, dhs 1015, nsf 33) are **not yet wired** — each needs its own measurable artifact.
- C3 does not read the live `agency_forecasts` count at runtime; the contradiction is asserted from the census measurement.
- The 9 unfalsifiable `coveragePercent` literals remain unfalsifiable — that is a **product decision** (define a denominator or delete the field), not a control gap.

---

## Verification Summary

| # | Requirement | Result |
|---|---|---|
| 1 | C1 proven healthy / stale-broken / unmeasured | ✅ 17 tests |
| 2 | C1 does not equate cron success with advancement | ✅ two dedicated tests |
| 3 | C2 blocks an injected false claim | ✅ exit 1 (after a fix the first test exposed) |
| 4 | C2 not noisy on comments/tests/constants | ✅ comments and block comments ignored |
| 5 | C3 reproduces known contradictions | ✅ 3 reproduced, 5/5 presence checks |
| 6 | C3 mutates no registry | ✅ read-only, exit 0 |
| 7 | No production data changed | ✅ |
| 8 | No freshness stamps written | ✅ |
| 9 | No registry rows added/removed | ✅ |
| 10 | No dataset repaired | ✅ |
| 11 | No contractor-store decision encoded | ✅ |
| 12 | Every control traces to a census finding | ✅ table above |

Full suite: **4,604 passed / 0 failed** (up 17). `tsc --noEmit` clean.

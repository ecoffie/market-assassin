# Mindy Data Core Controls — Phase 2

**Status: SHIPPED — 2 controls. No data repaired, no refresh run, no stamp
written, no registry migrated, no producer created, no P0 decision reopened.**
**Date: 2026-09-12 · Builds on Phase 1 (PR #1450) · P0 decisions: PR #1451 / #1453**

> A dataset's **existence**, its **enrichment**, and our **editorial judgment**
> about it are three different claims. The controls must never allow one to
> masquerade as another.

Cross-reference: **`docs/data-core-p0-decisions-approved.md`** — Phase 2 was only
possible because those decisions defined the canonical roles.

---

## The control model after Phase 2

| Control | Question | Phase |
|---|---|---|
| **C1** Advancement | Did the data advance? | 1 |
| **C2** Claim/literal | Is this numeric claim defensible? | 1 |
| **C3** Registry reconciliation | Do our registries agree? | 1 |
| **C4** Producer/lineage | Can we prove how this dataset is produced? | **2** |
| **C5** Coverage | What *kind* of coverage are we talking about? | **2** |

**C1–C3 were reused unmodified** — `git diff` against the Phase 1 branch for
`advancement.ts`, `audit-data-claims.mjs` and `registry-reconciliation.mjs` is
**empty**. C5 supplies the measurement that C2 judges a hardcoded claim against;
neither re-implements the other.

---

## C4 — Producer / Lineage Control

`src/lib/data-core/producer-lineage.ts` · 12 tests

### The incidents it traces to (four distinct ones, not one)

| Class | Real incident |
|---|---|
| 1 | `tier2_sblo`'s registry named `~/Bootcamp/compile-sblo-list.py` — the **superseded regex scraper** the Jun-2026 roster was created to replace. Running it would have reintroduced the bad data (PR #1444). |
| 4 | `import-sblo-refresh.js` was mistaken for the producer; it **consumes** the CSV and writes `prime-contractors-database.json`. |
| 11 | `contractors.json` has **no producer at all** — both candidates write elsewhere. |
| 2 | `sblo-roster-2026-06.json` is real and correct but **manual** — "no producer" and "a human produces it" are different facts. |

### The invariant

A producer is proven **only** when evidence links
**SOURCE → PRODUCER → the canonical OUTPUT artifact.**

**Not proof:** a matching filename · a registry string · a comment · a downstream
importer reading the artifact · a stale `refreshWith`. The SBLO incident happened
because a plausible-looking name was trusted.

### Five states, deliberately not collapsed

`producer_proven` · `producer_manual` · `producer_missing` · `producer_mismatch` ·
`producer_unmeasured`

**manual ≠ missing** (one has a documented human process) · **missing ≠ mismatch**
(one names something wrong) · **unmeasured ≠ broken** (one is simply unknown).

`producer_manual` **requires a documented process** — otherwise "someone made it
once" would launder into a status.

### What C4 caught when run against the real datasets

```
producer_manual   tier2_sblo
                  no automated producer; documented manual process
                  (docs/DATA-SOURCES-REGISTRY.md §SBLO lineage, PR #1444)

producer_missing  contractors.json
                  no producer writes src/data/contractors.json; candidates write
                  elsewhere: generate-naics-top100.js -> src/data/naics-top100.ts,
                  generate-seo-contractor-candidates.js -> /tmp/...

producer_proven   naics_vocabulary
                  scripts/build-naics-vocabulary.ts writes naics_vocabulary
                  (refreshed_at 2026-07-11 on all rows)
```

Three datasets, three different states — which is what proves the control
distinguishes them rather than pattern-matching.

### The SBLO guard, tested three ways
1. The obsolete scraper does not prove `tier2_sblo` (`provenBy` is null).
2. Naming it as the producer yields **`producer_mismatch`** with "SUPERSEDED … must not be run" — the exact pre-PR-#1444 registry state.
3. **Even if a superseded producer wrote the exact canonical path**, it still cannot be proof. That case is tested explicitly, because the roster exists precisely because the scraper's *output* was rejected.

### Deliberately excluded
Only the three datasets whose canonical role the P0 decisions established. **No
other dataset was added** — the brief's instruction, and the right one: a lineage
claim needs traced evidence, and inventing entries would be the same "plausible
name" failure the control exists to catch.

---

## C5 — Three-Way Coverage Control

`src/lib/data-core/coverage.ts` · 12 tests

### The incidents it traces to

| Kind | Real incident |
|---|---|
| **population** | `/contractors` titled **"290,000+"** while its body rendered **~2,710** from a static overlay — 107×. Both numbers were individually true; only their *pairing* was wrong (class 13). |
| **enrichment** | `contractors.json` email coverage is **1.4%**. Read as population it says "only 1.4% of contractors exist"; read as enrichment it says "we have an email for 1.4% of this overlay" (class 6/15). |
| **editorial** | SAT friendliness covers **19 of ~307** agencies. An uncovered agency is not 0% and not unfriendly — and until PR #1453 a generic-word match actively rendered **another agency's** label. |

### Two hard rules, enforced by construction

1. **No denominator → `percent = null`.** A percentage is never invented.
2. **`uncovered` is its own state** — never `0`, never negative, never a failure.

Plus: **only a `population` measurement on the canonical store may back a
corpus-size claim.** `enrichment` and `editorial` can never, regardless of store —
enforced via `mayClaimCorpusSize()` from the approved corpus roles.

### The result shape

`{ kind, covered, denominator, percent, state, basis, measuredAt, maySupportCorpusSizeClaim }`

`state` ∈ `measured | uncovered | unavailable | unmeasured`. `basis` is
**required** — a number without a basis is a claim, not a measurement.

### What C5 caught
- `contractors.json` as a **population** claim → `maySupportCorpusSizeClaim: false` (the 107× incident, now structurally impossible).
- The 1.4% email figure renders as *"enrichment available for 40 of 2,768"* — the denominator is always stated.
- Zero editorial labels → `state: 'uncovered'`, `percent: null` — **not 0%**.
- An unreachable source → `unavailable` with null counts — **not 0%**.
- **`pop_state` at 34.3% stays `measured` and valid** — honestly represented partial coverage is not a failure (Phase 0C Yellow, preserved).
- **Cross-control:** C5's measured 2.6% vs `registry.ts`'s hardcoded `95` → a >15pt gap, which is what C2 already blocks on. C5 supplies the measurement; C2 owns the gate.

---

## Surface / reporting

**No new dashboard, no score, no composite "Data Core Health %".** Both controls
expose explicit states only. Nothing was wired into Platform Health in this phase —
where results surface is a Phase 3 decision.

---

## Did any dataset change classification?

**No.** C4 and C5 confirmed the census classifications from evidence rather than
revising them:
- `tier2_sblo` — still the SBLO problem; **`producer_manual` names it more precisely than "RED"** did, and confirms PR #1444 corrected the *description*, not the refreshability.
- `contractors.json` — still `producer_missing`.
- `naics_vocabulary` — still the Green exemplar.

**No new contradiction surfaced.** Two test-authoring errors were caught and
corrected during the build (a `.not.toContain` against a null `provenBy`, twice);
in both cases the control was right and the test was wrong.

---

## Remaining blocked on product decisions

| Item | Blocked on |
|---|---|
| `tier2-contractors-database.json` (207 rows) | untraced; role deliberately unassigned |
| SAT live derivation (Option A) | methodology undefined |
| `registry.ts coveragePercent: 95` | C2 prints it every run until a product decision; **untouched** |
| The 132 unmatched SBLO companies | insert-as-new vs separate-store, never decided |
| `agency_pain_points` stamp 4 months ahead | repair not in scope for Phase 2 |

---

## Explicit non-goals honoured

No SBLO producer built · no SBLO refresh or stamp · 132 companies unresolved · no
stores merged · no contact fields moved to BigQuery · `tier2-contractors-database.json`
unclassified · no SAT methodology defined · no new SAT percentages · no agencies
added · registries not reconciled · `agency_pain_points` not repaired · BigQuery
quota architecture untouched · Phase 3 not started.

---

## Verification

| # | Requirement | Result |
|---|---|---|
| 1 | C4 classifies proven / manual / missing | ✅ all three, against real datasets |
| 2 | C4 catches a mismatched producer | ✅ two shapes (wrong artifact, name-only) |
| 3 | The obsolete scraper cannot satisfy proof | ✅ three tests, incl. exact-path case |
| 4 | C5 distinguishes population/enrichment/editorial | ✅ structurally, via `kind` + `maySupportCorpusSizeClaim` |
| 5 | Percentages require an explicit denominator | ✅ null denominator → null percent |
| 6 | Uncovered editorial ≠ negative evidence | ✅ `uncovered`, percent null |
| 7 | Honest partial coverage stays valid | ✅ `pop_state` 34.3% `measured` |
| 8 | C1/C2/C3 reused, not duplicated | ✅ zero diff against Phase 1 |
| 9 | No production data changed | ✅ |
| 10 | No refresh/stamp/registry migration | ✅ |
| 11 | No P0 decision reopened | ✅ |
| 12 | Every test traces to a real incident or approved rule | ✅ cited inline |

**Suite: 4,628 passed / 0 failed** (up 24). `tsc --noEmit` clean. C2 gate still green.

# Mindy Data Core Controls Plan

**Status: DESIGN ONLY — no repairs, no monitors built, no production data changed.**
**Date: 2026-09-12 · Inputs: census Phases 0A–0D (PRs #1445, #1446, #1447, #1448)**

> The census is done. The job now is to prevent the specific failure modes we
> actually observed — not to invent a generic data-governance platform.

Every control below traces to a demonstrated census finding. Nothing is proposed
because it sounds useful.

---

## Executive Summary

| | |
|---|---|
| Census phases completed | 4 (0A built/curated · 0B unregistered artifacts · 0C live Supabase · 0D BigQuery + cache) |
| Datasets/paths examined | 6 + 23 + 16 + 22 |
| Failure classes **demonstrated** | **15** (class 8 never demonstrated — see taxonomy) |
| Existing controls found reusable | **4** (freshness oracle · cache degradation gate · snapshot refusal · partial-write refusal) |
| Material datasets with **no** control | 27 of 30 |
| Highest-risk datasets | `agency-sat-friendliness` · `contractors.json` · `agency_pain_points` · `tier2_sblo` |
| Proposed Phase 1 controls | **3** |
| **Repairs applied** | **0** |

### The proven pattern

Across four phases, in **every single case**, the underlying data was real and
the serving path worked. **The failure was always a claim about data** — a wrong
producer, a stamp ahead of the data, a hardcoded percentage, a registry that
disagreed with itself, a title describing a different corpus than the body.

The corollary shapes the whole plan: **controls must verify claims, not just
liveness.** A "is the data there?" monitor would have caught none of the 15
classes.

### The second pattern: discipline improves toward the live core

0A (curated, months frozen) → 0B (unregistered, hardcoded) → 0C (healthy data,
1/197 monitored) → 0D (healthy data **and working controls**). Investment should
therefore go to the **curated and claim layers**, not to rebuilding what the live
engineering core already does well.

---

## Census Method Amendments (frozen)

| ID | Rule | Origin |
|---|---|---|
| **A1** | **Comments do not establish consumption.** Strip comments before declaring a file a reader. | 0A — `contracts-data.json` appeared in two customer-facing files; both were comments documenting the migration away from it. |
| **A2** | **Inspect nested fields before declaring coverage zero.** | 0A — `directorVerified` probed at 0/169; fields nest under `smallBusinessOffice`; truth is 48/169. |
| **A3** | **Consumer counts must come from resolved imports/query references, never substring matches.** | 0B — `contractors.json` "253 consumers" was the word "contractors"; comment-stripping gave 190; import resolution gave **9**. |
| **A4** | **Dynamic identifiers must be enumerated from their constructor and from live system metadata, never from a literal grep of the name.** A template-built id cannot be found by searching for the string it evaluates to. | 0D — a literal scan found 6 BigQuery tables; `client.ts` builds ids from `` `${PROJECT_ID}.${DATASET}.x` ``; the real inventory is **12**. |

A4 is **formally recorded here** as instructed; it is the dual of A3 and was
discovered mid-Phase-0D.

---

## Failure Taxonomy (demonstrated classes only)

IDs preserved exactly as the census assigned them. **Class 8 ("serving path
differs from documented path") was never demonstrated** in 0A–0D and is listed as
`NOT OBSERVED` rather than given a fabricated example.

| # | Class | Real example | Consequence | Detectable today? | Control type | Exists? | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Registry points to wrong producer | `tier2_sblo` → `compile-sblo-list.py`, the superseded regex scraper | Refresh would **reintroduce** replaced-for-quality data | ❌ | Producer/Lineage | ❌ | **P0** |
| 2 | One-off/manual presented as automated | `tier2_sblo`; `dod_command_osbp`; `agency-sat-friendliness` | False confidence a refresh is a command away | ❌ | Producer/Lineage | ❌ | P1 |
| 3 | Build date contradicts underlying data | `agency_pain_points` stamp 2026-08-01 vs data max **2026-04-19** | 4-month-stale data reads as fresh | ❌ | **Advancement** | ❌ | **P0** |
| 4 | Importer mislabeled as producer | `import-sblo-refresh.js` (consumes CSV, writes prime DB) | Operator runs the wrong script | ❌ | Producer/Lineage | ❌ | P1 |
| 5 | Duplicate/parallel stores, unclear relationship | 5 contractor/SBLO stores; pain points JSON (3,045) vs `agency_pain_points_db` (**0 rows**) | Unknown which is canonical; divergent answers | ❌ | Registry Reconciliation | ❌ | P1 |
| 6 | Sparse coverage presented as complete | `contractors.json` email **1.4%** behind `coveragePercent: 95` | Product logic assumes contactability | ❌ | **Coverage** | ❌ | **P0** |
| 7 | Legacy producer can regenerate lower-quality data | `compile-sblo-list.py` still present and discoverable | Same as class 1, on a future operator | ⚠️ partial (PR #1444 warns in prose) | Producer/Lineage | ⚠️ | P1 |
| 8 | Serving path differs from documented path | **NOT OBSERVED in 0A–0D** | — | — | — | — | — |
| 9 | Freshness assertion without refresh evidence | `?stamp=` sets `last_built=today` with no evidence; `agency_forecasts.last_built` NULL while advancing | A stamp proves nothing | ❌ | **Advancement** | ❌ | **P0** |
| 10 | Served dataset absent from registry | `naics_vocabulary` (Green, unmonitorable); 16/16 live tables; 23 JSON artifacts | Cannot be flagged stale even in principle | ❌ | Registry Completeness | ❌ | P1 |
| 11 | Producer exists but is not repeatable | `contractors.json` — **no producer at all**, frozen 8.5 months | No path to refresh | ❌ | Producer/Lineage | ❌ | **P0** |
| 12 | Canonical artifact unclear | which of 5 contractor stores is authoritative | Two surfaces, two answers | ❌ | Registry Reconciliation | ❌ | P1 |
| 13 | Surface describes one corpus, serves another | `/contractors` title "290,000+" vs body ~2,710 (**107×**) | Public page contradicts itself | ❌ | **Claim/Literal** | ❌ | **P0** |
| 14 | Curated field lacks provenance | `sbloVerified="2026-06"` documented in `95f6826c`, **0/3,502** in the artifact | Provenance asserted, never shipped | ❌ | Producer/Lineage | ❌ | P2 |
| 15 | Hardcoded coverage/count claim in code | `registry.ts:203` `coveragePercent: 95` vs measured 1.2–2.6%; 5 of 32 literals contradicted | A literal no freshness check can ever catch | ❌ | **Claim/Literal** | ❌ | **P0** |
| 16 | Material live dataset unmonitored | `LIVE_SYNC_CHECKS` = **1 of 197**; BQ 1 of 12; caches 0 of 10 | Silent degradation is unobserved, not observed-good | ❌ | Registry Completeness + Advancement | ❌ | P1 |

**Root cause of class 15, newly established for this plan:** `registry.ts`'s own
header instructs *"Update coverage: Run `/api/admin/data-health` to recalculate."*
That route **only reads** `DATA_REGISTRY` (`route.ts:9`, `getRegistrySummary`) —
it never recalculates anything. The literal cannot self-correct, and the file
says it can.

---

## Dataset Control Matrix

Status from the census. **Cadence-appropriate**: a quarterly curated roster is not
controlled like a daily ingest.

| Dataset | Layer | Status | Producer proven? | Advancement measurable? | Coverage measurable? | Registry aligned? | Current monitor | Missing control | Priority |
|---|---|---|---|---|---|---|---|---|---|
| `agency-sat-friendliness.json` | built/curated | 🔴 RED | ❌ none | ❌ static literals | ✅ 19 agencies | ❌ flagged "opinion-based", still shipping | none | **Claim/Literal + product decision** | **P0** |
| `contractors.json` | built/curated | 🔴 RED | ❌ none | ❌ frozen 8.5 mo | ✅ 2.6/1.4/1.2% | ❌ `coveragePercent: 95` | none | **Corpus/serving reconciliation BEFORE any freshness control** | **P0** |
| `agency_pain_points` | Supabase live | 🔴 RED | ✅ `merge-agency-intelligence.js` | ✅ `max(created_at)` | ✅ 307/3,045 | ❌ stamp 4mo ahead | `check-data-freshness` (stamp only) | **Advancement** (replace stamp-trust) | **P0** |
| `tier2_sblo` | built/curated | 🔴 RED | ❌ manual, no producer | ❌ | ✅ 200/41/57/104 | ⚠️ corrected by PR #1444 | stamp only | **Provenance/runbook BEFORE freshness automation** | **P0** |
| `sam_opportunities` | Supabase live | 🟡 YELLOW | ✅ sync cron | ✅ `max(posted_date)` 2026-09-12 | ✅ naics 96%, desc 57.3%, pop_state 34.3% | ❌ not in `data_sources` | **none** | **Advancement** | **P1** |
| `recompete_opportunities` | Supabase live | 🟢 GREEN | ✅ sync cron | ✅ `max(last_synced_at)` 2026-09-13 | ✅ 140,079 real | ❌ not registered | **none** | **Advancement** | **P1** |
| `agency_forecasts` | Supabase live | 🔴 RED | ✅ import scripts | ✅ rows to 2026-09-12 | ✅ 33,687 | ❌ 3 registries disagree (33,687 / 9,973 / NULL) | none | Registry Reconciliation | P1 |
| `naics_vocabulary` | Supabase live | 🟢 GREEN | ✅ `build-naics-vocabulary.ts` | ✅ `refreshed_at` | ✅ 25,252/1,013 | ❌ **no `data_sources` row** | none | **Registration** (cheapest P1 win) | P1 |
| `bq_awards` | BigQuery | 🟢 GREEN | ✅ ingest script | ✅ `max(action_date)` 9d | ✅ FY-partitioned | ✅ **stamp matches measurement** | ✅ **freshness oracle** | — **reference implementation** | — |
| `recipients_rollup_merged` | BigQuery | 🟡 YELLOW | ✅ `build-derived.sql` | ❌ build recency unmeasured | ✅ 296,445 | ⚠️ docs say 292,848 (stale, conservative) | none | Advancement (derived-build) | P2 |
| 10 other derived BQ tables | BigQuery | ⚪ GREY | ✅ derived builds | ❌ unmeasured | ❌ unmeasured | ❌ absent | none | Advancement (derived-build) | P2 |
| KV/BQ cache (14 callers) | cache/fallback | 🟢 GREEN | ✅ `queryCached` | n/a | n/a | ❌ absent | ✅ **degradation gate** | — **already covered** | — |
| market-scanner snapshot | cache/fallback | 🟢 GREEN | ✅ | n/a | n/a | ❌ | ✅ **snapshot refusal** | — **already covered** | — |
| TMR `agency_target_data_cache` | cache/fallback | 🟡 YELLOW | ✅ | ⚠️ `generated_at` only | n/a | ❌ | ✅ **partial-write refusal** | age disclosure (P2) | P2 |
| `alert_log` / `briefing_log` / `user_engagement` | Supabase live | 🟢 GREEN | ✅ crons | ✅ all 2026-09-12+ | n/a | ❌ | none | **NONE — see below** | — |
| `sam_entities` (910,126) | Supabase live | ⚪ GREY | ❌ unmeasured | ❌ unmeasured | ❌ unmeasured | ❌ absent | none | measurement first | P2 |

**Deliberate non-control:** `alert_log` / `briefing_log` / `user_engagement` are
**write-side logs of work that already happened**. A dead stream shows up first as
*missing alerts* (a delivery symptom with its own `/alert-delivery` tooling), not
as a stale table. **Monitoring them would be vanity** — the brief's own test, and
the answer is no.

---

## Control Primitives

### 1. ADVANCEMENT CHECK
**Proves the dataset actually advanced.** Never "cron returned 200."

**Reference implementation exists:** `scripts/verify-oracles.mjs --only freshness`
+ `src/lib/awards-ingest/clocks.ts`. It reads `MAX(action_date)` from the source
table and classifies into **four** states:
`healthy | upstream_stale | ingest_broken | unmeasured`.

**That four-state model is the single most valuable artifact the census found.**
`unmeasured` is precisely the brief's requirement that *inability to query must
not become a stale-data claim* — already built, already tested.

**Generalize to:** `agency_pain_points` (P0), `sam_opportunities`,
`recompete_opportunities` (P1), derived BQ tables (P2).

### 2. PRODUCER / LINEAGE CHECK
**Proves the named producer creates the served artifact.**
Census method: resolve the writer (`OUTPUT_PATH` / `writeFileSync` target), not
the name. This is exactly how 0B proved `naics-codes.json` Green
(`build-naics-cache.js:34`) and `contractors.json` Red (both candidates write
elsewhere). **Needed for every `built/curated` dataset.** Classes 1, 2, 4, 7, 11, 14.

### 3. COVERAGE CHECK
**Measures important field coverage where product behaviour depends on it.**
Scope deliberately narrow — only fields that change customer-visible behaviour:
`contractors.json` contact fields (gate teaming), SBLO roster contacts,
`dod_command_info.directorVerified`, `sam_opportunities.pop_state` (drives a
documented filter). **Not** every column. Classes 6, 15.

### 4. REGISTRY RECONCILIATION CHECK
**Detects disagreement among the three registries.** Measure first; do not decide
they should all continue to exist. Known disagreement: `agency_forecasts` =
33,687 live / 9,973 docs / NULL stamp. Classes 5, 12.

### 5. FALLBACK INTEGRITY CHECK
**Already satisfied — mark covered, do not rebuild.**
`cache.ts` never reaches `kv.set` on the failure path (verified by line: failure ends `markDegraded` L282 → `return []` L283; the sole `kv.set` is L290, after it); `markDegraded` +
`bqDegraded`/`bqResultState` distinguish failure from empty; tests pin
"UNAVAILABLE, not NOT MET"; market-scanner and TMR both refuse to persist
degraded results. **Residual gap (P2): stale-KV age disclosure** — a caller
served a stale copy cannot tell how old it is.

### 6. CLAIM / LITERAL CHECK
**Detects hardcoded count/coverage claims that drift from live data.**
Scope: only literals affecting customer-visible or system-decision behaviour.
**Do not flag docs or examples for containing numbers.** Census baseline: 32
literals in `registry.ts` — **18 exact, 5 contradicted, 9 unfalsifiable**.
A gate on the pattern of `scripts/audit-*.mjs` with a baseline ratchet fits
naturally. Classes 13, 15.

### 7. REGISTRY COMPLETENESS CHECK
**Detects material served datasets outside registry/monitoring coverage.**
Census proved completeness cannot be assumed: 28 served JSON artifacts / 5
registered; 16/16 live tables unregistered; 12 BQ tables / 1 registered.
Classes 10, 16.

---

## Priority Queue (by consequence, not size)

**P0 — a wrong number can change a government/acquisition or paid-customer decision**
1. `agency-sat-friendliness` — unreproducible percentages in **customer alert emails**, already flagged for removal. *Claim/Literal + a product decision.*
2. `registry.ts coveragePercent: 95` — 40× off, in code, self-correcting instruction that does not work. *Claim/Literal.*
3. `agency_pain_points` — stamp 4 months ahead of data. *Advancement.*
4. `/contractors` title vs body (107×) — public page contradicts itself. *Claim/Literal.*
5. `contractors.json` — no producer, frozen, 1.4% contact coverage. *Corpus reconciliation first.*
6. `tier2_sblo` — no repeatable producer. *Provenance/runbook first.*

**P1 — high blast radius, healthy today, no control**
7. `sam_opportunities` + `recompete_opportunities` advancement.
8. `naics_vocabulary` registration (Green producer + real clock, simply unregistered — cheapest win).
9. Registry reconciliation for `agency_forecasts`.
10. Registry completeness sweep.

**P2 — real but bounded**
11. Derived BQ build-recency; `sam_entities` measurement; stale-KV age disclosure; TMR expired-row hygiene; `sbloVerified` provenance.

**Explicitly NOT prioritized by size:** `sam_entities` is the largest table found
(910,126) and sits at P2, because nothing yet shows a wrong number from it
changing a decision.

---

## Existing Controls We Should Reuse

| Control | Location | Satisfies | Action |
|---|---|---|---|
| Freshness oracle + 4-state clocks | `verify-oracles.mjs --only freshness`, `awards-ingest/clocks.ts` | Advancement (primitive 1) | **Generalize, do not rebuild** |
| BQ cache degradation gate | `src/lib/bigquery/cache.ts` | Fallback integrity (5) | **Mark covered** |
| Snapshot refusal | `market-scanner/route.ts:811` | Fallback integrity (5) | **Mark covered** |
| Partial-write refusal | `target-market-research/route.ts:1455` | Fallback integrity (5) | **Mark covered** |
| Gate + baseline-ratchet pattern | 16 `scripts/audit-*.mjs` | Claim/Literal (6), Completeness (7) | **Reuse the pattern** |
| `bq_awards` derived stamp | `data_sources.notes` `[awards-ingest-clocks:v1]` | Advancement + registry alignment | **Template for every stamp** |

---

## Controls Missing Today

Advancement for every dataset except `bq_awards` · Producer/lineage for all
curated datasets · Coverage for the four behaviour-affecting fields · Registry
reconciliation (all three) · Claim/literal for `registry.ts` + page metadata ·
Registry completeness · Stale-KV age disclosure.

---

## Registry Architecture Recommendation (recommendation only — do not implement)

**Mapped ownership, from the census:**

| Registry | Form | Fields it owns | Machine-readable? | Consumed by |
|---|---|---|---|---|
| Supabase `data_sources` | DB table, 12 rows | `key`, `last_built`, `refresh_cadence`, `category`, `notes` (incl. the `[awards-ingest-clocks:v1]` block) | ✅ yes | `check-data-freshness` — **application behaviour** |
| `docs/DATA-SOURCES-REGISTRY.md` | prose tables | lineage, caveats, refresh ownership, human runbooks | ❌ no | humans — **documentation** |
| `src/lib/data-sources/registry.ts` | TS array, 32 literals | `recordCount`, `coveragePercent`, `importScript`, `status` | ⚠️ compiled, but hand-maintained | `/api/admin/data-health` — **read-only display** |

**Overlap:** all three carry a record count or freshness notion; none is
authoritative. **Contradiction proven:** `agency_forecasts` = 33,687 / 9,973 / NULL.

**Recommendation (for review, not action):**
- **`data_sources` becomes the single machine-readable source of truth**, because it already drives behaviour and already demonstrates the derived-stamp pattern.
- **`registry.ts` numeric literals should be derived or deleted** — not hand-maintained. Its own "run data-health to recalculate" instruction is false today.
- **The docs registry stays** as the lineage/runbook home — it is the only place a manual-curation runbook can live, and 0A proved that is needed.
- **Do not merge the three.** Give each one job: behaviour · display · narrative.

---

## Proposed Phase 1 Build (smallest set closing the highest-risk gaps)

**Three controls. All modelled on existing infrastructure. No data repairs.**

### C1 — Advancement check, generalized (closes classes 3, 9; P0 #3)
Extend the `clocks.ts` four-state model to a per-dataset advancement check
comparing `data_sources.last_built` against the dataset's own newest-row clock.
Fails only when a stamp is **ahead** of the data (the `agency_pain_points` shape).
Reports `unmeasured` when it cannot read — never as stale.
*Start with `agency_pain_points`, `sam_opportunities`, `recompete_opportunities`.*

### C2 — Claim/literal gate (closes classes 13, 15; P0 #2, #4)
A `scripts/audit-data-claims.mjs` on the established gate pattern, baseline-ratcheted
at the census figures (18 exact / 5 contradicted / 9 unfalsifiable). Compares
`registry.ts` literals and page-metadata corpus claims against live measurement.
Blocks **new** drift; existing debt is baselined, not force-fixed.
*Unfalsifiable literals (no denominator) are reported as `unfalsifiable`, never as pass.*

### C3 — Registry completeness + reconciliation report (closes classes 10, 16, and measures 5, 12)
A read-only report enumerating material served datasets (JSON importers, `.from()`
refs, `BQ_TABLES` — per A3/A4) against all three registries. **Report, not a gate**,
until the reconciliation architecture above is decided.

**Deliberately NOT in Phase 1:** producer/lineage automation (classes 1/2/4/11
need the *product decisions* on `contractors.json` and `tier2_sblo` first — a
control cannot resolve "which of 5 stores is canonical"), coverage checks
(P0 #1 and #5 need a product decision before a control has a target), and any
repair.

---

## Explicit Non-Goals

No data repairs · no registry migration · no freshness stamps · no new producer ·
no store merges · no cache changes · no broad refactor · no monitors built until
this plan is reviewed.

---

## Compliance

**No production data changed. No freshness state changed. No monitors added. No
registry edited. No repair mixed into this plan.** All census PRs (#1445–#1448)
and the SBLO provenance PR (#1444) remain unmodified. The only write is this file.

Every control above traces to a numbered class with a real census example. The
three Phase 1 controls each reuse existing in-repo infrastructure rather than
introducing a new system.

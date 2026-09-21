# Mindy Data Core Census — Phase 0A (Built / Curated)

**Status: AUDIT ONLY — no fixes applied, no production data changed.**
**Date: 2026-09-12 · Sequence: AUDIT → taxonomy → controls → repair**

> The purpose of Phase 0A is not to make the Data Core look healthy.
> The purpose is to establish what we can actually prove.

Grey is the default. A status without mechanical evidence is not a finding.

---

## Status Taxonomy (refined — frozen 2026-09-12)

Phase 0A's `dod_command_osbp` finding forced a distinction the original taxonomy
lacked: **incomplete coverage is NOT the same as misleading coverage.**

### 🟢 GREEN — Proven
Proven provenance, serving path, freshness/cadence relationship, and material
coverage. No known contradiction affecting the dataset's meaning.

### 🟡 YELLOW — Honest limitation
The underlying data is real and serving correctly, but something is incomplete:
partial coverage · manual refresh · incomplete repeatability · an unresolved
lineage step · another known limitation.

**The key requirement is that the limitation is represented honestly to
consumers.** A dataset that is 28% verified and *says so* is Yellow. A dataset
that is 28% verified and presents as complete is Red.

### 🔴 RED — Integrity contradiction
The metadata, freshness, provenance, serving path, or presentation **contradicts
reality**.

### ⚪ GREY — Unproven
Insufficient evidence to classify. Grey is the default and is **not** failure.
Do not promote Grey merely because nothing obviously looks wrong.

---

## Method Amendments (mandatory for Phase 0B)

Both were produced by false leads inside the Phase 0A audit itself. Recorded here
so Phase 0B inherits them.

### A1 — Reader verification
**Comments do not establish consumption.** Strip or exclude comments before
declaring a file a real consumer. A filename or string appearing in a
customer-facing source file is not sufficient evidence that the dataset is
actually consumed.

*Instance:* `contracts-data.json` appeared in `RecompetesPanel.tsx:403` and
`fpds-recompete.ts:527`. Both are **comments documenting the migration away from
it**. A comment-blind grep would have classified a retired snapshot as a live
customer-facing Red.

### A2 — Coverage verification
**Inspect the actual schema/object structure, including nested fields, before
declaring field coverage zero.** Do not infer absence from a top-level check.

*Instance:* a first probe reported `directorVerified` at **0/169**. The fields
are nested under `smallBusinessOffice`. The true figures are 169/169 director
names and 48/169 (28.4%) verified — a false Red averted by re-probing.


---

## Executive Summary

| Metric | Count |
|---|---|
| Datasets enumerated (doc built/curated table) | 6 |
| `data_sources` rows (all categories) | 12 |
| `REFRESH_SCRIPTS` keys | 5 |
| `LIVE_SYNC_CHECKS` keys | 1 |
| `src/data/*.json` files on disk | 29 |
| — **served** (≥1 non-`src/data` consumer) | **28** |
| — zero-consumer (`agency-procurement-sources.json`) | 1 |
| **Datasets in material scope (Phase 0A)** | **6** |
| — GREEN | 1 |
| — YELLOW | 3 |
| — RED | 2 |
| — GREY | 0 |
| Unregistered served datasets identified | **23** candidates (0 promoted) |
| Contradictions discovered | 7 |
| **Fixes applied** | **0** |

Every number above is derived from the rows below.

### Answer to the Phase 0A question

**SBLO was NOT an isolated provenance defect.** Of 6 in-scope datasets, only 1
reached Green. Two are Red on contradictions structurally identical to SBLO's
(registry metadata that does not match the artifact it describes). Registry
completeness is itself unproven: 28 served JSON artifacts exist against 5
registered, and one dataset in the doc table (`NAICS buyer vocabulary`) has **no
`data_sources` row at all**, so it cannot be freshness-monitored even in
principle.

The pattern is not "bad data." In every case measured, the underlying data was
real and the serving path worked. The failure is consistently in the **metadata
layer that describes the data** — the same class the SBLO trace exposed.

---

## Census Table

| Dataset | Customer-visible use | Canonical served artifact | Source | Producer | Repeatable? | Last built (proven) | Cadence | Coverage | Registry accurate? | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Tier-2 / SBLO | MCP `get_sblo_contact` (paid) | `src/data/sblo-roster-2026-06.json` (200) | SBA Prime Directory | **NONE** (manual curation) | ❌ No | 2026-06 (commits) | Quarterly | name 41/200 (20.5%), email 57/200 (28.5%) | ❌ was wrong, corrected PR #1444 | 🔴 RED |
| DoD command / OSBP | MCP `lookup_federal_osbp` | `src/data/dod-command-info.json` (169) | Agency OSBP pages | Manual edit | ⚠️ Partial | `metadata.lastUpdated` 2026-06-25 | Quarterly (names) | director 169/169; **verified 48/169 (28.4%)** | ⚠️ count off by 1 (170 vs 169) | 🟡 YELLOW |
| Agency pain points | `/api/pain-points`, target-enrichment | `src/data/agency-pain-points.json` (307 ag / 3,045 pts) + `agency_intelligence` (557) | GAO / NDAA / USASpending | `scripts/merge-agency-intelligence.js` ✅ | ✅ Yes | JSON: doc-consistent; **DB: 2026-04-19** | Quarterly | 307 agencies, 3,045 pts, 2,658 priorities | ❌ `last_built` 2026-08-01 > DB max 2026-04-19 | 🔴 RED |
| DoDAAC directory | office-anchored contacts/opps | `dodaac_directory` (4,826) | BigQuery FPDS awards | `scripts/populate-dodaac-directory.mjs` ✅ | ✅ Yes | `last_built` 2026-06-01 | As-published | 4,826 offices | ⚠️ doc names `.ts`, file is `.mjs` | 🟡 YELLOW |
| Forecast intelligence | `/forecasts`, MCP `get_agency_forecasts` | `agency_forecasts` (**33,687**) | 13+ agency portals | `scripts/import-forecasts.js` (+variants) ✅ | ✅ Yes | rows to 2026-09-12 | As-published | 20+ agencies | ❌ doc says 9,973 (3.4× low); `last_built` NULL | 🟡 YELLOW |
| NAICS buyer vocabulary | onboarding, alerts, recompete/forecast chips | `naics_vocabulary` (25,252) | USASpending award text + TF-IDF | `scripts/build-naics-vocabulary.ts` ✅ | ✅ Yes | `refreshed_at` **2026-07-11** (all rows) | On rebuild (no cron) | 25,252 terms / 1,013 codes | ⚠️ **absent from `data_sources`** | 🟢 GREEN |

---

## Per-Dataset Evidence

### 1. Tier-2 / SBLO contractor DB — 🔴 RED

- **Inclusion:** MCP `get_sblo_contact`, a paid tool returning supplier names/emails. Qualifies.
- **Serving path:** `src/lib/gov-contacts/sblo-lookup.ts` → `sblo-roster-2026-06.json` (tier 1) → `prime-contractors-database.json` (tier 2) → BigQuery (tier 3).
- **Producer:** NONE. `grep` across `scripts/` + `~/Bootcamp/` finds only consumers.
- **Coverage:** 200 companies; `withSbloName` 41 (20.5%), `withEmail` 57 (28.5%), `withPortal` 104 (52%).
- **Duplicate store:** `prime-contractors-database.json` (3,502 primes, `sbloName` on 895 = 25.6%). 68 were merged from the Jun-2026 roster; **132 were not** (insert-as-new vs separate-store decision never made).
- **Contradiction A:** registry named `~/Bootcamp/compile-sblo-list.py`, the superseded regex scraper the roster replaced. Corrected in PR #1444.
- **Contradiction B (NEW):** commit `95f6826c` states the merge stamped `sbloVerified="2026-06"` on matched primes. **The field does not exist in the served artifact** — `sbloVerified` populated 0/3,502. Provenance survives only in free-text `source` (54 primes mention "Jun 2026"). A documented provenance stamp that did not ship.
- **Status:** RED — remains Red after PR #1444 because the producer gap and Contradiction B are unresolved (the PR corrected the *description*, not the underlying condition).

### 2. DoD command / OSBP directory — 🟡 YELLOW

- **Inclusion:** MCP `lookup_federal_osbp` returns director names + office contacts. Qualifies.
- **Producer:** no script; hand-maintained JSON (`metadata.version` 2.0, `lastUpdated` 2026-06-25).
- **Coverage:** 169 commands, 169 with `smallBusinessOffice`, **169 with a director name, only 48 (28.4%) carrying a `directorVerified` stamp** (all `"2026-06"`). 121 names are unverified.
- **Honest-failure design (credit):** `federal-osbp.ts:75` `directorStatus()` emits `verified | unverified | none` per office, so a caller cannot mistake an unverified name for a verified one. This is the correct handling of partial coverage.
- **Contradiction:** doc says "170 commands"; artifact has 169.
- **Measurement note:** a first probe reported `directorVerified 0/169` because the fields are nested under `smallBusinessOffice`, not at command top level. Corrected before classification — recorded because it is exactly the false-Red a shallow probe produces.
- **Status:** 🟡 YELLOW — **honest limitation**, not an integrity contradiction.
  Under the refined taxonomy this is the reference example: coverage is partial
  (48/169 = 28.4% verified) but the consumer represents it truthfully via
  `director_status`, so no consumer can mistake an unverified name for a verified
  one. It would become RED only if the product presented unverified names as
  verified — no evidence of that was found.

### 3. Agency pain points / intelligence — 🔴 RED

- **Inclusion:** `/api/pain-points`, `target-enrichment`, `agency-sources`. Qualifies.
- **Producer:** `scripts/merge-agency-intelligence.js` ✅ exists and is repeatable.
- **Coverage:** JSON 307 agencies / 3,045 pain points / 2,658 priorities (doc claims 3,045 ✓, 307 ✓).
- **Contradiction:** `data_sources.last_built = 2026-08-01`, but `agency_intelligence` rows max out at **2026-04-19** (446 `gao_high_risk` + 111 `contract_pattern` = 557). The stamp is ~3.5 months ahead of the newest data in the table it describes.
- **Secondary:** `verified` column is `false` on **0/557** rows — the verification field is unused.
- **Class:** freshness assertion without refresh evidence (class 9) + registry build date contradicting artifact history (class 3), on a dataset that *does* have a working producer — so the stamp, not the pipeline, is the defect.
- **Status:** RED.

### 4. DoDAAC directory — 🟡 YELLOW

- **Inclusion:** office-anchored contacts (`federal-contacts`), target list, TMR. Qualifies.
- **Producer:** `scripts/populate-dodaac-directory.mjs` ✅ exists.
- **Coverage:** 4,826 offices.
- **Contradiction:** registry doc script inventory names `populate-dodaac-directory` under `scripts/` implying `.ts` alongside other `.ts` entries; the actual file is `.mjs`. Minor, but it is class 1/4 in miniature — a producer reference that does not resolve as written.
- **Freshness:** `last_built` 2026-06-01, cadence "as-published" — no mechanical check that FPDS has not moved.
- **Status:** YELLOW — producer real and repeatable; freshness asserted rather than measured.

### 5. Forecast intelligence — 🟡 YELLOW

- **Inclusion:** `/forecasts`, MCP `get_agency_forecasts`. Qualifies.
- **Producer:** `scripts/import-forecasts.js` (+ gsa/nsf/ssa variants) ✅.
- **Coverage:** **33,687 rows**, 20+ source agencies; newest rows 2026-09-12 (DHS), most agencies refreshed 2026-08-01.
- **Contradiction A:** registry doc says **9,973**; live table has **33,687** (3.4× understated). CLAUDE.md separately says 7,764 and 9,973 in different places.
- **Contradiction B:** `data_sources.last_built` is **NULL** for a dataset that is demonstrably refreshing — freshness is unmeasured despite being measurable (`created_at` per row).
- **Stale shard:** SSA last loaded 2026-04-06, ONR/NRL 2026-04-12 — no per-source staleness surfaced.
- **Status:** YELLOW — healthy pipeline, wrong published numbers.

### 6. NAICS buyer vocabulary — 🟢 GREEN

- **Inclusion:** onboarding, `daily-alerts` keyword expansion, recompete/forecast chips, `keyword-coverage`. 12 consumers. Qualifies.
- **Producer:** `scripts/build-naics-vocabulary.ts` ✅ — repeatable, documented (USASpending award text cleaned by cross-NAICS TF-IDF).
- **Serving:** `src/lib/market/vocabulary.ts` → `naics_vocabulary` table.
- **Coverage:** 25,252 terms across 1,013 codes — doc claims 25,252 ✓ exact match.
- **Freshness:** `refreshed_at` = 2026-07-11 on all rows (single clean rebuild; the column is a real measured clock, not an assertion).
- **Registry gap:** has **no `data_sources` row**, so it is invisible to `check-data-freshness`. Documented cadence is "on rebuild, no cron," so this is consistent — but it means the dataset cannot ever be flagged stale.
- **Status:** GREEN on lineage/producer/coverage/freshness-evidence. The registry gap is recorded under Unregistered Served Datasets rather than downgrading the status, because the dataset itself is fully proven.

---

## Unregistered Served Datasets

29 `src/data/*.json` files exist; **28** have at least one consumer outside `src/data`
(`agency-procurement-sources.json` has zero). **5** appear in the built/curated registry,
leaving **23** unregistered served candidates. **No dataset was added to the registry in this phase.**

Highest-reach unregistered candidates (consumer counts = files referencing the artifact):

| Artifact | Entities | Consumers | Customer-visible? | Recommended classification |
|---|---|---|---|---|
| `contractors.json` | — | 253 | Likely (contractor surfaces) | UNREGISTERED / UNRECONCILED — highest priority for Phase 0B |
| `agency-pain-points.json` | 307 | 17 | Yes | registered (see row 3) |
| `agency-aliases.json` | 454 aliases / 25 CGAC | 10 | Yes (agency resolution) | UNREGISTERED / UNRECONCILED |
| `prime-contractors-database.json` | 3,502 | 8 | Yes | partially registered via `tier2_sblo` — relationship unresolved |
| `naics-codes.json` | — | 7 | Yes | UNREGISTERED / UNRECONCILED |
| `psc-codes.json` | — | 5 | Yes | UNREGISTERED / UNRECONCILED |
| `psc-naics-crosswalk.json` | 153 | 4 | Yes (alert expansion) | UNREGISTERED / UNRECONCILED |
| `tribal-businesses-database.json` | 800 tribes | 2 | Needs decision | `scope_status = needs_decision` |
| `tier2-contractors-database.json` | 207 | 2 | Needs decision | `scope_status = needs_decision` — name collides with the `tier2_sblo` registry key |
| `december-hit-list.json` | 25 opps | 1 | Needs decision | already flagged "stale snapshot" in registry |
| `december-spend-forecast.json` | 58 opps | 4 | Needs decision | already flagged "stale snapshot" |
| `agency-sat-friendliness.json` | — | 3 | Needs decision | already flagged "opinion-based" |

**Not counted as material — verified admin/cron-only:** `contracts-data.json`
(9,450 `grouped_synthetic` rows). Six files reference it, but the two
customer-facing references (`RecompetesPanel.tsx:403`,
`fpds-recompete.ts:527`) are **comments documenting the migration away from it**,
not live reads. Remaining readers are `admin/*` and `cron/refresh-contracts`.
Recorded because a comment-blind grep would have classified this Red — the same
"strip comments first" trap the pre-push gates document.

---

## Observed Failure Classes (evidence-backed only)

| # | Class | Instance |
|---|---|---|
| 1 | Registry producer does not write served artifact | `tier2_sblo` → `compile-sblo-list.py` (PR #1444) |
| 2 | Manual/one-off presented as automated | `tier2_sblo`; `dod_command_osbp` |
| 3 | Registry build date contradicts artifact history | `agency_pain_points` (stamp 2026-08-01 vs DB max 2026-04-19) |
| 4 | Downstream importer mislabeled as producer | `import-sblo-refresh.js` (PR #1444) |
| 5 | Duplicate stores, unresolved relationship | roster (200) vs prime DB (3,502); 132 unmerged |
| 6 | Sparse field used as if complete | SBLO email 28.5%; director verified 28.4% |
| 7 | Obsolete producer can regenerate lower-quality data | `compile-sblo-list.py` still present and discoverable |
| 9 | Freshness assertion without refresh evidence | `?stamp=` endpoint; `agency_pain_points` stamp |
| 10 | Served dataset absent from registry | `naics_vocabulary`; 23 unregistered candidates |
| 14 | Curated fields lack meaningful provenance | `prime-contractors-database.json` — `sbloVerified` documented in `95f6826c` but **0/3,502 populated** |

**Classes 8, 11, 12, 13 were tested and NOT observed** in this scope. No new class
was invented; class 14's instance is new evidence for an existing class.

**Class 3 and 9 in combination is the Phase 0A signature:** a working producer
plus a stamp that describes something other than what shipped.

---

## Phase 0B Carry-Forward (do NOT trace in Phase 0A)

Explicitly retained, deliberately unrepaired:

| Item | Status | Retained finding | Do NOT |
|---|---|---|---|
| `agency_pain_points` | 🔴 RED | `data_sources.last_built = 2026-08-01`; newest `agency_intelligence` row = **2026-04-19** (557 rows) | change the stamp |
| `tier2_sblo` | 🔴 RED | No repeatable producer. PR #1444 corrects the provenance *description* but does **not** solve refreshability. Documented `sbloVerified="2026-06"` is absent from the served artifact (**0/3,502**) | add the field or refresh the roster |
| `dod_command_osbp` | 🟡 YELLOW | 169/169 director names, 48/169 (28.4%) verified; consumer exposes `director_status` → honest limitation | "fix" the coverage |
| `contractors.json` | ⚪ GREY | **253 consumers**, unregistered, producer unknown — highest-priority Phase 0B candidate | deep-trace in this pass |
| Registry completeness | ⚪ GREY | 28 served / 5 registered / 23 unreconciled; `naics_vocabulary` Green but unmonitorable; `tier2_sblo` monitored but unrefreshable | add registry rows |

---

## Phase 0A Conclusion

**Was SBLO isolated, or is there a pattern?**

**A pattern — in the metadata layer, not the data layer.**

- 1 of 6 datasets is Green.
- 2 are Red on registry-vs-artifact contradictions.
- Every dataset's underlying data was real and its serving path worked.
- All 7 contradictions are descriptions that disagree with the thing described.

SBLO was the most dangerous instance (its wrong pointer could regenerate inferior
data), but it was not unique. `agency_pain_points` shows the same shape with a
*working* producer, which is the more troubling finding: a functioning pipeline
does not protect against a false freshness claim.

### What I proved
- 6/6 in-scope datasets have a customer-facing consumer (inclusion test passed with evidence).
- Producer existence resolved for all 6 (4 exist, 1 absent, 1 manual-by-design).
- Live counts measured for every dataset; 3 doc claims exact-matched (3,045 / 307 / 25,252), 2 diverged (9,973→33,687; 170→169).
- 2 stamps contradict their artifacts (`agency_pain_points`; `sbloVerified` 0/3,502).
- 28 served artifacts vs 5 registered (23 unreconciled) — registry completeness is disproven, not assumed.

### What remains unknown
- Whether `contractors.json` (253 consumers) is customer-facing and what produces it — **the single largest Phase 0B gap**.
- The roster ↔ prime-DB relationship (the 132 unmerged).
- Whether `forecast_intelligence`'s per-source staleness (SSA Apr-2026) is intended.
- Why `agency_intelligence.verified` is unused (0/557).
- Whether the 23 unregistered candidates are material.

### What surprised me
1. **The best-instrumented dataset is the unregistered one.** `naics_vocabulary` has a real producer and a real `refreshed_at` clock, yet no `data_sources` row — while `tier2_sblo`, which has no producer at all, is monitored. Monitoring coverage is inversely correlated with provenance quality here.
2. **A working producer did not prevent a false stamp** (`agency_pain_points`).
3. **`sbloVerified` was documented in a commit message and never shipped** — a provenance claim asserted in the record and absent from the data.
4. **Two of my own probes were wrong first** (nested director fields; comment-only `contracts-data` references), each of which would have produced a false Red. Shallow measurement fabricates findings in both directions.

### Is the method good enough for Phase 0B?

**Yes, with three amendments:**
1. **Strip comments before counting consumers.** Already a documented gate trap; it recurred here.
2. **Probe nested structures before reporting 0% coverage.** A zero from a wrong field path is indistinguishable from a real zero.
3. **Compare stamps to in-table max timestamps, not to cadence.** This is what caught `agency_pain_points`, and it generalizes to every dataset with a per-row clock.

Pass 1 was sufficient to classify all 6 without full Pass 2 archaeology (SBLO's
was already done). Phase 0B should start with `contractors.json` and the
`data_sources`/served-artifact reconciliation.

---

## Re-Verification Log (pre-commit, 2026-09-12)

Every Phase 0A number was re-measured before this checkpoint was frozen. Per the
audit contract, a number that changed is **reported, not preserved**.

| Claim | First pass | Re-verified | Result |
|---|---|---|---|
| Served `src/data/*.json` artifacts | 29 | **28** | ❌ **CORRECTED** — 29 files exist on disk; 28 have ≥1 consumer outside `src/data`. `agency-procurement-sources.json` has zero consumers. The original figure conflated *files on disk* with *files consumed*. Downstream: unregistered candidates 24 → **23**. |
| Director coverage (nested) | 169/169 name, 48/169 verified | 169/169, 48/169 (28.4%) | ✅ unchanged |
| `agency_pain_points` stamp vs data | 2026-08-01 vs 2026-04-19 | 2026-08-01 vs 2026-04-19 (557 rows) | ✅ unchanged |
| SBLO roster / metadata | 200 · 41 · 57 · 104 · 68 | identical | ✅ unchanged |
| `sbloVerified` in prime DB | 0/3,502 | 0/3,502 (`sbloName` 895) | ✅ unchanged |
| Pain points JSON | 307 ag / 3,045 pts | 307 / 3,045 / 2,658 priorities | ✅ unchanged |
| `naics_vocabulary` | 25,252 | 25,252 | ✅ unchanged |
| `agency_forecasts` | 33,687 | 33,687 | ✅ unchanged |
| `dodaac_directory` | 4,826 | 4,826 | ✅ unchanged |
| All `last_built` values | — | unchanged (5/5 re-queried) | ✅ no writes |

**Status counts derive from the six census rows:** Green 1 (`naics_vocabulary`) ·
Yellow 3 (`dod_command_osbp`, `dodaac_directory`, `forecast_intelligence`) ·
Red 2 (`tier2_sblo`, `agency_pain_points`) · Grey 0 = **6**.

---

## Compliance

**No fixes applied. No production data changed. No freshness state changed.**
`tier2_sblo.last_built` re-queried post-census: still `2026-06-01`. The only write
is this file.

# Independent verifier — Cyrus contractor audit closure

**Verdict: PASS_WITH_NOTES**  
**BLOCKERs: none**  
**Mode:** read-only product inspection; evidence write limited to this file.  
**Worktree:** `/Users/ericcoffie/Projects/market-assassin/.claude/worktrees/cyrus-freshness-provenance`  
**Branch:** `fix/cyrus-freshness-provenance` (`8901bc09`) vs `origin/main`  
**Subject baseline:** Cyrus Management Solutions LLC · UEI `N1N9JPDYHVC7`  
**Verifier UTC:** 2026-09-21 (session)

---

## Scope read

- Disposition: `00-DISPOSITION.md` (O1–O16, N1–N5, F1–F4 freeze)
- Local three-tool baseline: `04-baseline-summary.json` + `01-profile.json` / `02-sam.json` / `03-history.json`
- Round-3 before/after: `tasks/evidence/cyrus-freshness-provenance-2026-09-20/{before,after}-repro.json`
- Diff: `git diff --stat origin/main...HEAD` → 11 paths, **+1004 / −32**; product surface is additive (no deletions/renames under `src/`)

Product commits on branch: `5ff4af98` (freshness + provenance) · `8901bc09` (awards-ingest test skip when bq CLI missing).

---

## Challenge answers

### 1. Did any existing functionality disappear?

**No.** Diff is additive honesty/provenance fields plus a set-aside cache-key bump (`v3-m` → `v4-m`) that forces cold refill — not a removed capability.

Preserved on the Cyrus baseline:

| Surface | Still present |
|---------|----------------|
| Profile / history award identity | UEI `N1N9JPDYHVC7`, name match, `award_count` / `unique_awards` = **17** |
| Counting bases | `unique_awards` 17 · `fiscal_year_award_count_sum` 51 · `recent_grain=obligation_actions` |
| Activity | both `dormant`, `last_positive_obligation_fy=2020` |
| Agency honesty | `count: null` + `count_unavailable: true` on top agencies; profile `top_agencies_capped` |
| Mod / grain labels | profile `mod_classification` / `is_modification` / `grain`; history camelCase equivalents |
| `last_fy_by_label` | retained; machine `deprecated.last_fy_by_label` |

O12 / `#1580` untouched (no PSC blank-row changes in this diff).

### 2. Can a customer infer something stronger than the evidence supports?

**Mostly no — notes below are residual over-read risks, not silent fabrication.**

Guards that hold on live Cyrus payloads:

- Historical `8(A) SOLE SOURCE` / `8A COMPETED` carry notes denying certification / graduation / award origin; `null_first_positive_note` present; no `award_origin_fy*` fields.
- SAM `entity.has8a === false` (current) while warehouse set-asides show past 8(a) **actions** — explained dual-source, not a invented graduation claim.
- Zero agency-year cells: **19** `zero_net_obligations`, all `unused_vehicle === false`, notes forbid unused-vehicle from $0 alone.
- Soft warehouse clock load (`read-warehouse-coverage.ts`): missing env / read failure → `null` → clocks unknown; does not invent `healthy`.

**NOTES (not BLOCKERs):**

1. **`coverage_complete_established: true` naming.** Code + JSDoc mean “warehouse max + ingest clocks are attached and freshness is measured,” **not** “this contractor’s award history is exhaustive.” Freshness notes correctly warn that a quiet recipient last action ≠ stale corpus and that a recent recipient action alone ≠ complete coverage. A skimming consumer could still over-read the flag name. Mitigated by note text; rename deferred.
2. **`04-baseline-summary.json` `cross.sam_certs`** records `has8a: null` / `lookup_status: null` while `02-sam.json` has `has8a: false`, `lookup_status: found`. Extractor gap in the summary file only — raw SAM capture is correct. Review packet text matches raw SAM.
3. **`after-repro.json` is not the Cyrus subject.** PR packet documents canary UEI `FCJCDUZV7RM3` (`activity_status: active`). Cyrus closure evidence is `01–04`. Do not treat after-repro dollar/activity fields as Cyrus regression proof.

### 3. Do profile, SAM, and history disagree for an unexplained reason?

**No unexplained disagreement.**

| Axis | Profile | History | SAM | Verdict |
|------|---------|---------|-----|---------|
| Identity | `N1N9JPDYHVC7` / CYRUS… | same + `match_status=unique` | same UEI / legal name | Agree |
| Award count | 17 + counting_bases | 17 + counting_bases | n/a | Agree |
| Dollars | `$14,956,164.46` | same | n/a | Agree for this single-UEI rollup (`uei_count=1`); `totals_note` still warns parent-rollup ≠ single-UEI in general |
| Activity | dormant / FY2020 | same | n/a | Agree |
| Set-asides | labels + FYs + `scope.kind=profile_rollup` | same labels/FYs + `history_single_uei` | current `has8a=false`, WOSB self-id | **Explained:** warehouse historical actions ≠ current SAM cert |
| Freshness clocks | as_of `2026-06-16`, warehouse max `2026-09-18`, ingest healthy | same three clocks | n/a | Agree |
| Recent action limits | 5 returned | 20 returned (`award_limit=20`) | n/a | Expected limit difference, not conflict |
| Mod field casing | snake_case | camelCase | n/a | Pre-existing dual convention; values agree (e.g. A00005 → modification / true) |
| Invalid PoP canary | — | PIID `693JK418P500008` → `invalid` / `end_before_start` | — | O10 still observable |

### 4. Are complete / grounded / freshness claims justified?

**Yes, under the contracts shipped in this branch.**

| Claim | Evidence | Justified? |
|-------|----------|------------|
| Profile `enrichment_status=complete` | recent_awards length 5; set-asides labeled; agencies present | Yes |
| Set-aside `coverage=complete` | warehouse query returned labels + provenance; not warm-empty-as-none | Yes |
| SAM `_meta.grounded=true` | entity found, unique match | Yes |
| History `_meta.grounded` / award_count 17 | rows present | Yes |
| `coverage_complete_established=true` | warehouse max + ingest clocks + freshness ≠ unmeasured (see naming note above) | Yes per code contract |
| Before (F1) | `before-repro.json`: warehouse max / ingest unwired on payloads | Defect reproduced |
| After (F1–F4) | Cyrus `01–04` + documented canary `after-repro.json` | Repairs evidenced |

---

## Unit-test protection matrix

| Required invariant | Where protected | Status |
|--------------------|-----------------|--------|
| Warm agencies + cold awards → Pass-2 fills awards | `tier2-tools.unit.test.ts` — *Cyrus path: warm agencies + cold awards…* | **Covered** |
| Warm empty ≠ unavailable | `tier2-tools.unit.test.ts` — warm-empty set-aside; `bq-history-completeness` — unavailable → `coverage=unavailable` | **Covered** |
| Denied budget + warm empty → complete, labels `[]` | `tier2-tools.unit.test.ts` — *warm-empty set-aside with cold budget denied…* | **Covered** |
| Set-aside not from capped recent sample | note assertions (`not derived from the capped recent_awards` / warehouse scope notes) in tier2 + shape tests | **Covered** |
| Positive mod ≠ award origin | `award-history-shape.unit.test.ts` — first-positive / origin denial cases | **Covered** |
| Historical set-asides ≠ certification | shape + bq-history note assertions; no `award_origin_fy` | **Covered** |
| Unknown mods / dates | shape `classifyModNumber` unknown; bq-history blank mod + invalid PoP | **Covered** |
| Counting bases grains | `buildCountingBases` unit + bq-history unique vs FY-sum | **Covered** |
| `profile_rollup` vs `history_single_uei` | tier2 profile scope; bq-history history scope | **Covered** |

Additional F1–F4 coverage in the same suites: three-clock `describeCoverageTimestamp`, `null_first_positive_note`, deprecated `last_fy`, `unused_vehicle: false` (shape + history integration).

Verifier did **not** re-run vitest in this pass; protection is confirmed by reading the tests and the review packet’s reported `55 passed` on those three files. Re-run before merge if CI has not yet greenlit this SHA.

---

## Disposition spot-check (finish-line items)

| ID | Acceptance | Verifier |
|----|------------|----------|
| F1 / O4 | Three clocks + `coverage_complete_established` when clocks present | **Pass** (naming note) |
| F2 | Contributing UEIs + supporting actions; machine scope | **Pass** on Cyrus `01`/`03` (`N1N9JPDYHVC7`) |
| F3 | `null_first_positive_note` | **Pass** |
| F4 | deprecated `last_fy` + unused_vehicle false | **Pass** |
| O6 | counting_bases grains | **Pass** |
| O8 | agency `count` null | **Pass** |
| O1 / N2–N3 | no award_origin; historical ≠ cert | **Pass** |
| N1 | Pass-2 unit | **Pass** |
| N4 | warm-empty + denied budget unit | **Pass** |
| N5 | scope kinds | **Pass** |
| O12 | untouched | **Pass** |

---

## Verdict

**PASS_WITH_NOTES** — product changes and Cyrus local baseline satisfy the frozen disposition for F1–F4 and the regression invariants listed above. No merge BLOCKERs from this verifier pass.

**Notes to carry (non-blocking):**

1. `coverage_complete_established` is easy to over-read; keep note text (or rename later).
2. Fix or ignore `04-baseline-summary.json` `sam_certs` nulls — trust `02-sam.json`.
3. Treat `after-repro.json` as canary (`FCJCDUZV7RM3`), not Cyrus; Cyrus proof is `01–04`.
4. This is **local_code_against_live_data**, not authenticated public MCP production closure (disposition finish-line item 6 / separate release acceptance).

**Not done by this verifier:** merge, deploy, push, or product code edits.

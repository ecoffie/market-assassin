# Independent verifier — Cyrus · PR #1597 four honesty corrections

**Verdict: PASS**  
**BLOCKERs: none**  
**Mode:** read-only product inspection; write limited to this file.  
**Worktree:** `/Users/ericcoffie/Projects/market-assassin/.claude/worktrees/cyrus-freshness-provenance`  
**Branch:** `fix/cyrus-freshness-provenance`  
**Subject:** Cyrus Management Solutions LLC · UEI `N1N9JPDYHVC7`  
**Verifier UTC:** 2026-09-21T01:34Z

---

## Verdict

**PASS** — HEAD `e730b305` ships the four machine-readable honesty corrections. Required vitest suite is **64/64** green, including **4/4** in `four review corrections — fail-before / pass-after`. Live evidence (`01-profile.json`, `03-history.json`, `04-baseline-summary.json`) carries the required fields (not caveat prose alone). Shared checker asserts reject the four old behaviors. `#1580` / O12 untouched.

---

## HEAD

```
e730b30599ebe30e9800cc5838ce900f844bc9da
```

Tip: `fix(cyrus): four machine-readable honesty corrections`  
Branch tracks `origin/fix/cyrus-freshness-provenance` (ahead 1 at verify time).  
Parent evidence stamp in committed `04-baseline-summary.json` still records `codeSha=fe54f4e4`; on-disk working copy re-stamped to `e730b305` (timestamps only). Acceptance flags for the four corrections are **true** on both. Payload evidence (`01`/`03`) at HEAD already contains the corrected machine-readable fields.

---

## Suite results

**Command executed:**

```bash
cd /Users/ericcoffie/Projects/market-assassin/.claude/worktrees/cyrus-freshness-provenance
npx vitest run \
  src/lib/contractor/cyrus-acceptance.unit.test.ts \
  src/lib/contractor/award-history-shape.unit.test.ts \
  src/lib/bigquery/bq-history-completeness.unit.test.ts \
  src/lib/chat/tier2-tools.unit.test.ts
```

| Metric | Result |
|--------|--------|
| Test files | **4 passed / 4** |
| Tests | **64 passed / 64** |
| Failed | **0** |
| Duration | ~841ms |

Per-file: `cyrus-acceptance` 8 · `award-history-shape` 27 · `tier2-tools` 19 · `bq-history-completeness` 10.

### `four review corrections — fail-before / pass-after` (4/4)

| # | Test | Result |
|---|------|--------|
| 1 | freshness: `coverage_complete_established=true` (old) fails; clocks≠completeness passes | **PASS** |
| 2 | vehicle: `unused_vehicle=false` (old caveat) fails; null/`not_established` passes | **PASS** |
| 3 | distinct-award grain: unlabeled counts fail; `unique_awards_grain=distinct_awards` passes | **PASS** |
| 4 | contributors: substituting queried UEI when unknown fails; null + truncation disclosure passes | **PASS** |

---

## Shared checker — rejects old behavior

File: `src/lib/contractor/cyrus-acceptance.ts` (also imported by both closure runners).

| Assertion id | What it rejects / requires |
|--------------|----------------------------|
| `coverage_completeness_not_established` | Requires `coverage_complete_established === false` **and** `coverage_completeness === 'not_established'` on profile + history — old “clocks attached ⇒ complete” fails |
| `freshness_evidence_available` | Separate flag; clocks can be true while completeness stays unproven |
| `zero_dollar_vehicle_usage_not_established` | Every zero-$ agency cell: `unused_vehicle === null` **and** `vehicle_usage === 'not_established'` — boolean `false` fails (message: “reject boolean false caveat”) |
| `counting_distinct_award_grain` | `unique_awards_grain === 'distinct_awards'` on profile + history counting bases |
| `agency_cell_distinct_award_grain` | Zero-$ cells carry `count_grain: 'distinct_awards'` + numeric `distinct_award_count` |
| `set_aside_contributor_truncation_disclosed` | Requires `contributing_ueis_sample_limit`, `contributing_ueis_truncated_labels`, `contributing_ueis_unknown_labels` |
| `set_aside_unknown_contributors_preserved_profile` | Every `contributing_ueis_unknown_labels` entry on **profile** must have `contributing_ueis_by_label[label] === null` (strict; no any-null loophole) |
| `set_aside_unknown_contributors_preserved_history` | Same strict check on **history** |

Shape helpers in `award-history-shape.ts` match: `describeCoverageTimestamp` always emits `coverage_complete_established: false`; `classifyAgencyYearObligations` always emits `unused_vehicle: null` / `vehicle_usage: 'not_established'`; `summarizeHistoricalSetAsides` preserves `contributingUeis == null` as null + unknown label.

---

## Requirement assessment

### 1. Freshness vs completeness — **PASS**

| Field | Profile (`01`) | History (`03` → `coverage_timestamp`) |
|-------|----------------|----------------------------------------|
| `freshness_evidence_available` | `true` | `true` |
| `coverage_completeness` | `"not_established"` | `"not_established"` |
| `coverage_complete_established` | `false` | `false` |

Meaning field states clocks do **not** establish completeness. Summary flags: `freshness_evidence_available=true`, `coverage_completeness_not_established=true`. Fail-before test #1 proves old `coverage_complete_established=true` fails the checker.

### 2. Vehicle usage — **PASS**

Live history: **35** agency cells; **19** zero-dollar; **0** boolean `unused_vehicle`. All cells: `unused_vehicle: null`, `vehicle_usage: "not_established"`. Zero-$ sample (GSA FY2016): `classification=zero_net_obligations`, note denies unused-vehicle inference from $0 alone. Summary: `zero_dollar_vehicle_usage_not_established=true`. Fail-before test #2 proves `unused_vehicle: false` fails.

### 3. Distinct-award labels — **PASS**

| Surface | Evidence |
|---------|----------|
| Profile / history `counting_bases.unique_awards_grain` | `"distinct_awards"` |
| Agency cells | All 35: `count_grain: "distinct_awards"` + numeric `distinct_award_count` |
| Summary flags | `counting_distinct_award_grain=true`, `agency_cell_distinct_award_grain=true` |

Fail-before test #3 proves unlabeled grains fail.

### 4. Contributors — **PASS**

| Field | Profile | History |
|-------|---------|---------|
| `contributing_ueis_sample_limit` | `20` | `20` |
| `contributing_ueis_truncated_labels` | `[]` (disclosed) | `[]` |
| `contributing_ueis_unknown_labels` | `[]` | `[]` |

Cyrus live labels (`8(A) SOLE SOURCE`, `8A COMPETED`) carry real UEI lists — not a substitution case. Null-preservation + truncation disclosure proven by fail-before/pass-after test #4 and shape helper (`contributingUeis == null` → `null` + unknown label; sample at limit → truncated label). **Assertion follow-up:** unknown labels are checked strictly per side — `contributing[label] === null` for each unknown label on profile and on history separately (no “any null elsewhere” loophole). Mixed-label regression `4b`: one legitimately null unknown label + one incorrectly populated unknown label → both profile/history flags fail. Summary: `set_aside_contributor_truncation_disclosed=true`, `set_aside_unknown_contributors_preserved_profile=true`, `set_aside_unknown_contributors_preserved_history=true`.

---

## `#1580` / O12

**Untouched.** Disposition marks O12 / `#1580` out of scope. `git diff --name-only origin/main...HEAD` has **no** blank-PSC / `#1580` product paths (contractor freshness/provenance + evidence only).

---

## BLOCKERs

**None.**

### Non-blocking observation (not a requirement failure)

`06-REVIEW-PACKET.md` still contains a few pre-correction prose rows (e.g. older `coverage_complete_established=true` / `unused_vehicle=false` wording). Live `01`/`03`/`04` and the shared checker are the authority; packet prose drift does not overturn the four machine-readable requirements.

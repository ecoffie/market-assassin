# Cyrus audit closure — review packet

**Status: PR ready for review — not fixed in production.**  
Stop: before merge / deploy. No production writes. `#1580` / audit `#12` untouched.

| | |
|--|--|
| **Branch** | `fix/cyrus-freshness-provenance` |
| **PR** | `#1597` |
| **Head** | `e730b30599ebe30e9800cc5838ce900f844bc9da` |
| **Subject** | Cyrus Management Solutions LLC · `N1N9JPDYHVC7` |
| **Verifier** | **PASS** — no BLOCKERs (`05-VERIFIER.md`, agent `e04be775`) · suite **64/64** · fail-before/pass-after **4/4** |

## Four machine-readable corrections (this update)

Do not substitute caveats for correct values. Shared checker rejects the old behaviors.

| # | Requirement | Machine-readable after | Checker flag |
|---|-------------|------------------------|--------------|
| 1 | Freshness ≠ completeness | `freshness_evidence_available=true` when clocks attached; `coverage_complete_established=false`; `coverage_completeness=not_established` | `freshness_evidence_available` · `coverage_completeness_not_established` |
| 2 | Unsupported vehicle usage | `unused_vehicle: null` · `vehicle_usage: not_established` (never boolean `false`) | `zero_dollar_vehicle_usage_not_established` |
| 3 | Distinct-award labels | `unique_awards_grain=distinct_awards` · agency `count_grain=distinct_awards` + `distinct_award_count` | `counting_distinct_award_grain` · `agency_cell_distinct_award_grain` |
| 4 | Unknown contributors + truncation | `contributing_ueis_by_label[label]=null` when unknown (no queried-UEI substitute); `contributing_ueis_sample_limit` · `contributing_ueis_truncated_labels` · `contributing_ueis_unknown_labels` | `set_aside_contributor_truncation_disclosed` · `set_aside_unknown_contributors_preserved` |

Fail-before / pass-after: `src/lib/contractor/cyrus-acceptance.unit.test.ts` describe `four review corrections — fail-before / pass-after` (4 tests).

## Disposition (unchanged)

See `00-DISPOSITION.md`. F1–F4 repaired earlier; O12 → `#1580` untouched.

## Full-workflow baseline (local ≠ public MCP)

- **Env:** `local_code_against_live_data`
- **SHA:** matches HEAD (`04-baseline-summary.json`)
- **Checker:** `src/lib/contractor/cyrus-acceptance.ts` · **32** assertions · all flags `true` · `failures: []`
- **Not claimed:** authenticated public MCP production closure

## Tests (executed by verifier on HEAD)

```text
npx vitest run \
  src/lib/contractor/cyrus-acceptance.unit.test.ts \
  src/lib/contractor/award-history-shape.unit.test.ts \
  src/lib/bigquery/bq-history-completeness.unit.test.ts \
  src/lib/chat/tier2-tools.unit.test.ts
# 4 files · 64 passed · 0 failed
# including fail-before/pass-after ×4
```

## Verifier

See `05-VERIFIER.md`. **PASS**. Requirements 1–4 each assessed against live evidence + checker + fail-before/pass-after tests.

## Compatibility risks

- Additive / tightened honesty fields (`freshness_evidence_available`, `coverage_completeness`, `vehicle_usage`, grain labels, contributor truncation metadata).
- `coverage_complete_established` now **always false** (was true when clocks attached) — consumers that treated true as “clocks OK” must read `freshness_evidence_available`.
- `unused_vehicle` type widens to `null` (was `false`).
- `contributing_ueis_by_label` values may be `null` (unknown) — never invent the queried UEI set.

## Blocked / deferred

- Public MCP re-acceptance until approved release
- `#1580` / `#12`
- Dedicated coverage-completeness oracle (until then completeness stays `not_established`)

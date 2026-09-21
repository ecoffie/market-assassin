# Cyrus audit closure — review packet

**Status: PR ready for review — not fixed in production.**  
Stop: before merge / deploy. No production writes. `#1580` / audit `#12` untouched.

| | |
|--|--|
| **Branch** | `fix/cyrus-freshness-provenance` |
| **Base** | `origin/main` @ `1119cac4` (at rebase) |
| **Head** | see `git rev-parse HEAD` after evidence commit (includes disposition + baseline + verifier) |
| **Overlap PRs** | `#1580` left open/untouched · `#1589`/`#1592` already merged (preserved) · no other open Cyrus contractor repair PR |
| **Subject** | Cyrus Management Solutions LLC · `N1N9JPDYHVC7` |
| **Verifier** | **PASS_WITH_NOTES** — no BLOCKERs (`05-VERIFIER.md`, agent `0e5c4aab`) |

## Disposition

See `00-DISPOSITION.md`. Summary:

- **Confirmed defects repaired this batch:** F1 freshness clocks, F2 set-aside provenance, F3 null-first-positive honesty, F4 last_fy deprecation + zero-$ unused-vehicle refusal (O4/O9).
- **Already fixed + regression-protected:** O1–O3, O5–O8, O10, O14, O16, N1–N5.
- **Evidence unavailable / do not encode:** O11 NAICS pivot narrative.
- **Untouched:** O12 → `#1580`.
- **Deferred enhancements:** O13 award_limit, O15 metadata dedupe, casing, NAICS comparison UI, unused-vehicle without award-type column.

## Before / after (Round-3 follow-up defects)

| ID | Before | After (local live baseline) |
|----|--------|------------------------------|
| F1 | Recipient last action only | Profile+history: warehouse max `2026-09-18`, ingest `healthy`, `coverage_complete_established=true`; three-clock note |
| F2 | No UEIs/actions; prose scope only | `profile_rollup` vs `history_single_uei`; contributing UEIs + supporting actions |
| F3 | Null first-positive easy to over-read | `null_first_positive_note` present |
| F4 last_fy | Alias unmarked | `deprecated.last_fy_by_label.status=deprecated` |
| F4 zero-$ | Risk of unused label | Cells `classification=zero_net_obligations`, `unused_vehicle=false` |

Evidence files: `cyrus-freshness-provenance-2026-09-20/before-repro.json`, `after-repro.json`; this folder `01–04`.

## Full-workflow baseline (local ≠ public MCP)

- **Env:** local code against live BQ/SAM (`environment: local_code_against_live_data`)
- **UTC start:** see `04-baseline-summary.json` `startedAt`
- **SHA:** see `codeSha` in that file
- **Inputs:** profile `company_name=Cyrus Management Solutions`; SAM+history `uei=N1N9JPDYHVC7`, `award_limit=20`
- **Acceptance booleans:** all `true` in `04-baseline-summary.json`
- **Cross-check:** profile/history UEI+name agree; both `activity_status=dormant`, `last_positive=2020`; counting bases 17 / FY-sum 51; SAM `has8a=false` (current) while historical set-asides show past `8(A)` — **explained**, not a contradiction
- **Not claimed:** authenticated public MCP production closure

## Tests

```text
npx vitest run \
  src/lib/contractor/award-history-shape.unit.test.ts \
  src/lib/bigquery/bq-history-completeness.unit.test.ts \
  src/lib/chat/tier2-tools.unit.test.ts
# 55 passed
```

Protected paths covered: Pass-2 warm agencies/cold awards; warm-empty ≠ unavailable; denied budget + warm empty; set-aside warehouse scope notes; no award_origin; null first-positive note; deprecated last_fy; zero-$ unused_vehicle false; unknown mods/dates; counting bases; coverage clocks.

## Verifier

See `05-VERIFIER.md` (separate agent). Any BLOCKER must be resolved before merge recommendation.

## Compatibility risks

- Additive payload fields only (coverage clocks, set-aside provenance, agency-year classification, deprecated marker).
- Cache key `set-aside-history:v3-m` → `v4-m` (cold refill).
- `last_fy_by_label` retained as deprecated alias.
- Soft-fail warehouse clock read → unknown (not fabricated healthy).

## Blocked / deferred

- Public MCP re-acceptance until separately approved release
- Award-type column for unused-vehicle claims
- O11 / O13 / O15 enhancements
- `#1580` / `#12`

## Saved public acceptance (after approved release only)

```bash
# From a deploy-ready worktree, AFTER merge+prod deploy of THIS SHA lineage:
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config \
  scripts/cyrus-audit-closure-mcp-acceptance.ts

# Then compare 04-baseline-summary.json acceptance booleans + serving commit
# against the MCP capture. Do not declare production closure without that compare.
```

Runner script: `scripts/cyrus-audit-closure-mcp-acceptance.ts` (mints/revokes a one-shot key; no production DB writes beyond key+credits ledger used by existing acceptance).

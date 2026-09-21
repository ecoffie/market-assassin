# Cyrus audit closure — review packet

**Status: PR ready for review — not fixed in production.**  
Stop: before merge / deploy. No production writes. `#1580` / audit `#12` untouched.

| | |
|--|--|
| **Branch** | `fix/cyrus-freshness-provenance` |
| **PR** | `#1597` |
| **Base** | `origin/main` |
| **Head** | `8e1771672b65f7b7b0f5c8cff4aae436beb52f7f` |
| **Overlap PRs** | `#1580` left open/untouched · `#1589`/`#1592` already merged (preserved) · no other open Cyrus contractor repair PR |
| **Subject** | Cyrus Management Solutions LLC · `N1N9JPDYHVC7` |
| **Verifier** | **PASS_WITH_NOTES** — no BLOCKERs (`05-VERIFIER.md`, agent `66fb0f70`) · suite **64/64** executed on HEAD |

## Disposition

See `00-DISPOSITION.md`. Summary:

- **Confirmed defects repaired this batch:** F1 freshness clocks, F2 set-aside provenance, F3 null-first-positive honesty, F4 last_fy deprecation + zero-$ unused-vehicle refusal (O4/O9).
- **Already fixed + regression-protected:** O1–O3, O5–O8, O10, O14, O16, N1–N5.
- **Evidence unavailable / do not encode:** O11 NAICS pivot narrative.
- **Untouched:** O12 → `#1580`.
- **Deferred enhancements:** O13 award_limit, O15 metadata dedupe, casing, NAICS comparison UI, unused-vehicle without award-type column.

## Shared acceptance checker (this update)

One module drives both runners; fail-hard on assertion or tool error:

| Surface | Path |
|---------|------|
| Checker | `src/lib/contractor/cyrus-acceptance.ts` → `checkCyrusThreeToolAcceptance` |
| Unit regressions | `src/lib/contractor/cyrus-acceptance.unit.test.ts` (9) |
| Local runner | `scripts/cyrus-audit-closure-baseline.ts` |
| Public MCP runner | `scripts/cyrus-audit-closure-mcp-acceptance.ts` (post-release only) |

Asserts across profile / SAM / history: identity (UEI + name), restored awards, counting grains (`unique_awards` / FY-sum / recent grain), scope (`profile_rollup` vs `history_single_uei`), uncertainty (freshness clocks, `coverage_complete_established` **not** exhaustive, set-aside provenance, agency count unavailable, zero-$ ≠ unused vehicle).

`coverage_complete_established_meaning` + freshness note deny over-read as exhaustive recipient history.

## Before / after (Round-3 follow-up defects)

| ID | Before | After (local live baseline @ HEAD) |
|----|--------|-------------------------------------|
| F1 | Recipient last action only | Profile+history: warehouse max `2026-09-18`, ingest `healthy`, `coverage_complete_established=true` + meaning field; three-clock note |
| F2 | No UEIs/actions; prose scope only | `profile_rollup` vs `history_single_uei`; contributing UEIs + supporting actions |
| F3 | Null first-positive easy to over-read | `null_first_positive_note` present |
| F4 last_fy | Alias unmarked | `deprecated.last_fy_by_label.status=deprecated` |
| F4 zero-$ | Risk of unused label | Cells `classification=zero_net_obligations`, `unused_vehicle=false` |

Evidence: this folder `01–04`; Round-3 canary before/after under `cyrus-freshness-provenance-2026-09-20/` (canary ≠ Cyrus).

## Full-workflow baseline (local ≠ public MCP)

- **Env:** local code against live BQ/SAM (`environment: local_code_against_live_data`)
- **UTC:** `04-baseline-summary.json` `startedAt` / `finishedAt`
- **SHA:** `8e1771672b65f7b7b0f5c8cff4aae436beb52f7f` (matches HEAD)
- **Checker:** `src/lib/contractor/cyrus-acceptance.ts` · **27** assertions · all flags `true` · `failures: []`
- **Inputs:** profile `company_name=Cyrus Management Solutions`; SAM+history `uei=N1N9JPDYHVC7`, `award_limit=20`
- **Cross-check:** profile/history UEI+name agree; counting bases 17 / FY-sum 51; SAM current `has8a=false` while historical set-asides show past `8(A)` actions — **explained**
- **Not claimed:** authenticated public MCP production closure

## Tests (executed by verifier on HEAD)

```text
npx vitest run \
  src/lib/contractor/cyrus-acceptance.unit.test.ts \
  src/lib/contractor/award-history-shape.unit.test.ts \
  src/lib/bigquery/bq-history-completeness.unit.test.ts \
  src/lib/chat/tier2-tools.unit.test.ts
# 4 files · 64 passed · 0 failed
```

Protected: shared checker fail-hard paths; Pass-2 warm agencies/cold awards; warm-empty ≠ unavailable; denied budget + warm empty; set-aside warehouse scope; no award_origin; null first-positive note; deprecated last_fy; zero-$ unused_vehicle false; unknown mods/dates; counting bases; coverage clocks + non-exhaustive meaning.

## Verifier

See `05-VERIFIER.md` (agent `66fb0f70`). **PASS_WITH_NOTES**, BLOCKERs none. Suite executed on final code head (not read-only).

Residual notes (intentional): after-repro canary UEI ≠ Cyrus; local ≠ public MCP until approved release.

## Compatibility risks

- Additive payload fields only (coverage clocks + meaning, set-aside provenance, agency-year classification, deprecated marker, shared checker).
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

# Shares checkCyrusThreeToolAcceptance with the local runner.
# Compare flags + serving commit to 04-baseline-summary.json.
# Do not declare production closure without that compare.
```

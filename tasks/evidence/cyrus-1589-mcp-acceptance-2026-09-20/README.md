# Cyrus #1589 public MCP acceptance (2026-09-20)

Authenticated calls against `https://mcp.getmindy.ai/mcp` after production deploy `dpl_GwfUXhMnc9HGfn1wNX1Go77mUJD3` (aliases include `mcp.getmindy.ai`).

| Check | Result |
|-------|--------|
| Profile recent awards | **5** (was 0 pre-fix) |
| Profile / history set-aside fields | `last_observed_action_fy_*` + `first_observed_positive_action_fy_*`; **no** `award_origin_fy_*` |
| Notes deny award origin / certification | Pass |
| Counts | unique 17 · FY sum 51 · profile recent actions 5 / unique 2 · history 20 / unique 8 |

Feature SHA `56b254df` is ancestor of merge `9eab156c` on `main`. Script: `scripts/cyrus-1589-mcp-acceptance.ts`.

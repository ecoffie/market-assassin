# CAI compose wiring audit — next-agent brief

**Status:** recovery agent STOPPED here (2026-09-20).  
**Start ref:** `origin/main@5cc700d7` (PR #1576 — Phase 0 market-window split + Phase 1 compose contract).  
**Existing worktree (optional reuse):** `.claude/worktrees/recovery-1576-verify` is already detached at `5cc700d7`.

## One job only

**Audit the frozen production CAI runtime against the new compose contract and design the minimum wiring change.**

Read-only first. **No code** until the diff is written down and Eric sees exactly what differs.

## What landed at `5cc700d7` (do not re-derive)

| Piece | Path | Role |
|-------|------|------|
| Compose contract | `src/lib/cai/compose-contract.ts` | Allowed/forbidden sources, `routeCaiEvidenceNeed()`, killer-rule helpers |
| Contract tests | `src/lib/cai/compose-contract.unit.test.ts` | Unit coverage for routing + killer rule |
| Product note | `docs/PRD-current-acquisition-intelligence-v0.md` §0 | Explicit: contract is additive; **no CAI behavior change yet**; frozen compose stays production |

PRD stop line: contract does **not** reopen CAI polish and does **not** authorize strategic persistence.

## Frozen production path to audit

Locate and read the live CAI compose implementation (name expected from PRD: something like `current-acquisition-intelligence.ts` / MCP `get_current_acquisition_intelligence`). Compare it to the contract as a **gap matrix**, not a redesign:

1. **Sources used** vs `CaiSourceKind` / `CAI_FORBIDDEN_SOURCES`
2. **Evidence routing** vs `routeCaiEvidenceNeed()` (internal-first vs live gap-fill)
3. **Killer rule** vs `passesCaiKillerRule` / `filterByCaiKillerRule` (`do_differently` / implications without `caused_by`)
4. **Epistemic classes / citation shape** vs `CaiItem` / `CaiCitation`
5. **Market window** — any 1-FY keyword-coverage used as market size (forbidden) vs `MARKET_SPEND_WINDOW` for CURRENT_STATE concentration

## Deliverable (stop when this exists)

A short audit note (task file or reply) with:

1. **Diff table** — contract requirement → production today → match / gap / unknown  
2. **Minimum wiring design** — smallest import/call sites to close real gaps only (no polish, no new collectors, no FR/pain as OBSERVED_CHANGE)  
3. **Explicit non-goals** — anything the contract forbids that production already avoids (confirm, don't "improve")

Then wait. Implementation is a separate agent/job after Eric approves the wiring plan.

## Hard constraints

- Do **not** commit/deploy from a checkout on `main` that is behind `5cc700d7` without fetching first.
- Prefer worktree:  
  `git fetch origin && git worktree add -b chore/cai-compose-wiring-audit .claude/worktrees/cai-compose-wiring-audit 5cc700d7`  
  (or continue from `recovery-1576-verify` if still clean/detached at that SHA).
- Link env with `npm run env:link-worktree -- .claude/worktrees/<slug>` — never raw `ln -sfn`.
- No scrapers. No strategic ingest. No CAI polish beyond the wiring design.

---
name: encode-post-fix-lesson
description: After a verified fix, records the failure class, points at the gold master, adds or links a red/green regression, updates the smallest durable skill or instruction, removes stale prose, and stops at the authorization boundary. Use when a fix would otherwise become another chat-only lesson, or for a read-only lesson-encoding checkpoint from current main.
disable-model-invocation: true
---

# Encode post-fix lesson

Encode the lesson in structure. Do not start a history diary. Do not duplicate `docs/REPAIR-LEDGER.md`. Path authority lives in `scripts/ma-skill-registry.json` under `postFixLesson`.

## Workflow (after the fix is verified)

1. Record the failure class (decision-chain taxonomy or the Map contract dimension that lied).
2. Identify the authoritative source or gold master module.
3. Add or point to the red/green regression (prefer an existing unit/oracle/browser script over a new narrative).
4. Update the smallest durable instruction or skill. Prefer editing one of the Phase 2 skills or the registry paths over a new always-on rule.
5. Remove stale prose that contradicts the fix. Prefer deletion over a changelog entry.
6. Report what remains unverified.
7. Stop at the current authorization boundary.

## Read-only checkpoint mode (no ship)

Use when batch-encoding lessons from a known main SHA without committing:

1. Pin the base ref (`git rev-parse HEAD` must match the requested checkpoint or explain drift).
2. Map each failure class to **one** existing skill (`data-provenance`, `map-contract-verify`, `cross-surface-parity`, or this skill). Do not create parallel skills.
3. Update `scripts/ma-skill-registry.json` paths when new fixtures exist; run `npm run verify:ma-skills`.
4. Run offline fixture subsets cited by the touched skills (`npx vitest run …` — no prod curl, no apply, no dispatch).
5. Return changed paths + lesson-to-skill table + unverified live checks. **Stop for review** — no commit, push, PR, deploy, workflow dispatch, or production writes.

## Failure-class routing (where lessons land)

| Class | Encode in | Gold master / regression anchor |
|-------|-----------|----------------------------------|
| Four-clock freshness, fail-closed ingest, CSV staging | `data-provenance` | `awards-ingest/*`, `post-apply-verify.ts`, `split-member-lead.ts` |
| Manual vs apply vs scheduled workflow gates | `data-provenance` + registry scripts | `workflow-control.ts`, `validate-bq-awards-ingest-dispatch.ts` |
| Auth before UI state change (Players gate) | `map-contract-verify` | `__playersGate`, `map-trust-gaps.unit.test.ts` |
| Provenance / uncertainty honesty | `data-provenance` + Map drawer tests | decision-chain docs, `companyFreshnessSec` |
| Unique identity before grounded market claims | `data-provenance` | `capability-anchor.ts`, grounding unit tests |
| Map ↔ MCP ↔ cron shared behavior | `cross-surface-parity` | saved-search service, alert drain |
| Cron terminal self-report + backlog | `cross-surface-parity` | `alert-drain.ts`, `delivery-readiness.ts` |
| Worktree isolation + branch cleanup | this skill + ship rules | `tidy-branches.mjs`, `.claude/worktrees/*` |

Keep PR numbers, temporary SHAs, dates, and incident row counts as **evidence in chat or REPAIR-LEDGER only** — not permanent skill rules.

## Worktree isolation and current-main integration

- **Never commit from a shared checkout on `main`.** Agent work belongs in `.claude/worktrees/<slug>` on a feature branch (`git fetch` + pin `origin/<base>` when creating).
- **`git branch --show-current` immediately before commit** — concurrent sessions can switch a shared `.git` underneath you.
- **`scripts/tidy-branches.mjs` guards:** refuse branches checked out in any worktree; refuse branches with ≥1 unmerged commit (`git branch -d`, never `-D`). Remote gone ≠ merged — squash merges leave the original ref unmerged; only the commit graph decides.
- **Lesson-encoding checkpoints start from current main** at an explicit SHA; if local main diverges, report drift and stop rather than encoding against the wrong tree.

## Deterministic multi-file CSV staging (encode pointer)

When USASpending bulk exports arrive as split ZIP members:

- File 1 owns the **authoritative header**; later members are classified (`matching_header` vs `headerless_data`) via `classifySplitExportMemberLead` — never assume identical headers on every member.
- Conflicting header rows **fail closed** (`staging_conflicting_header`), not silent column misalignment.
- Regression fixtures live under `scripts/fixtures/awards-ingest/`; unit tests in `awards-ingest.unit.test.ts`.

## What "smallest durable" means

| Prefer | Avoid |
|---|---|
| Fixture / oracle / audit ratchet | Long postmortem markdown |
| On-demand skill edit | Always-on rule expansion |
| Registry path add | Copying counts, SHAs, customer names |
| Pointing at `verify-prod` / `ui-fix` commands | Re-deriving ship steps |

## Commands to reuse

- `.claude/commands/verify-prod.md` for deploy-wide proof when shipping is authorized
- `.claude/commands/ui-fix.md` for render-only loops after data is proven right
- `.claude/commands/verify-map-contract.md` for Map contract runs
- `.claude/commands/encode-lesson.md` entry point for this skill
- `npm run verify:ma-skills` after registry or skill edits
- `npm run ledger:audit` when a REPAIR-LEDGER row already exists for the fix class

## Pass / fail

- Pass when the next agent can find the class, gold master, and regression without reading the chat.
- Fail when the only record is conversational memory or a duplicated ledger diary.
- This skill does not authorize commit, push, PR, merge, deploy, env changes, credit changes, workflow dispatch, or production writes. Ask or stop when those are required.

## Anti-patterns

- Appending incident chronology to CLAUDE.md
- Freezing temporary demo totals into skills
- Expanding always-apply Cursor rules without an explicit justification
- Encoding lessons without running `verify:ma-skills` after registry changes

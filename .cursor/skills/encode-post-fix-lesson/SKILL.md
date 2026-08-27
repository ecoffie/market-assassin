---
name: encode-post-fix-lesson
description: After a verified fix, records the failure class, points at the gold master, adds or links a red/green regression, updates the smallest durable skill or instruction, removes stale prose, and stops at the authorization boundary. Use when a fix would otherwise become another chat-only lesson.
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
- `npm run ledger:audit` when a REPAIR-LEDGER row already exists for the fix class

## Pass / fail

- Pass when the next agent can find the class, gold master, and regression without reading the chat.
- Fail when the only record is conversational memory or a duplicated ledger diary.
- This skill does not authorize commit, push, PR, merge, deploy, env changes, credit changes, or production writes. Ask or stop when those are required.

## Anti-patterns

- Appending incident chronology to CLAUDE.md
- Freezing temporary demo totals into skills
- Expanding always-apply Cursor rules without an explicit justification

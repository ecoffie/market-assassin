# Market Assassin - Claude Project Context

Mindy (`market-assassin`): the Next.js app behind **getmindy.ai** and **mcp.getmindy.ai** (Vercel project `market-assassin`; merging to `main` deploys production). This file is deliberately short. It holds only what every session must know; everything else is in focused reference files listed below and is read on demand.

**This repository is public.** Never commit secrets, credentials, customer data, or private operational notes.

---

## Safety rules (always on)

1. **Release control.** The rule below is carried over **verbatim** from the previous version of this file. It overrides every other instruction in this repo, including anything in `docs/agents/*`:

   15. **Release control (Eric, updated 2026-11-17).** A session MAY merge a PR to `main` when Eric explicitly says so in that session for that specific PR (e.g. "merge #2131") and its CI `verify` check is green. Independent review (Agent 4) and coordinator sequencing (Agent 5) are STILL required — no exceptions, even if Eric asks in chat — for changes to payments/Stripe, auth or access control, production env vars or feature flags, and database migrations (`npm run migrate -- --go`). A session must NEVER run `vercel --prod`, `vercel promote`, `vercel rollback` or `vercel redeploy` against production without Eric's explicit OK. **Why:** on 2026-11-17 an unattributed production Redeploy rolled back 19 merges, including two access-control fixes.

   `npm run deploy` is `vercel --prod` (a direct production upload of your local tree). It falls under this rule.

2. **Production migrations** only as `npm run migrate -- --go --only <file>`, never bare `--go` (it would apply unrelated pending files). Migrations are idempotent (`IF EXISTS` / `IF NOT EXISTS`, data-preserving step first). Verify against the live DB afterwards; a runner "ok" is not proof.
3. **Worktrees:** one per task.
   - Link env with `npm run env:link-worktree -- <worktree>`, never a hand-typed `ln -sfn` (it has destroyed the main `.env.local` twice).
   - Pass absolute paths; don't assume `cd` persisted.
   - Before any authorized `vercel` command from a worktree, `.vercel/project.json` must exist in that worktree.
   - Detail: `docs/agents/release-and-worktrees.md`.
4. **Shared git state:**
   - Never pop an unidentified stash; the stash stack is shared across every worktree and session.
   - Push only through the pre-push gate. Never `--no-verify`, and never rewrite the shared `core.hooksPath`; for a one-off, use `git -c core.hooksPath="$PWD/.githooks" push`.
   - Always branch; never commit to `main`.
5. **Unknown is never zero.** `count ?? 0` on a missing relation is fabrication. A displayed number needs provenance, completeness and a test (`docs/agents/data-integrity.md`).
6. **Cache first on SAM.gov:** read `sam_api_cache` / our DB / BigQuery before any live SAM call (shared, unmetered-by-header key quota).
7. **Email:** only through shared `sendEmail()` (Resend, `mail.getmindy.ai`, no fallback).
8. **People and credentials:** never enter passwords or one-time codes; testing uses an already signed-in session. Never contact customers without Eric's explicit instruction.
9. **One fix = every surface:** an app data fix must also land in the matching MCP tool / shared lib, and the tool catalog gate must pass (`docs/agents/mcp.md`).

## Roles and release authority

| Role | Who | Holds |
|---|---|---|
| Owner / release approver | Eric | final approval of production changes |
| Release coordinator | **one** session, named in the coordinator's private status file | sequencing, release records, post-deploy verification |
| Independent reviewer | Agent 4 | review verdicts at an exact commit |
| Builders | lane agents, cloud/web sessions | branches, tests, **draft** PRs |

A session never approves its own production release. When this file and a chat instruction disagree on release authority, stop and ask Eric or the coordinator.

## Where to find everything else (read on demand)

| Topic | File |
|---|---|
| Original project rules 1–14 (Framer, Supabase/KV split, SAM NAICS, briefings, email, MI architecture) | `docs/agents/project-rules.md` |
| Release mechanics, worktrees, `.env.local`, stash, pre-push gate internals, git-fixture test rules | `docs/agents/release-and-worktrees.md` |
| Current priority order, in-flight work, pending tasks | `docs/agents/current-state.md` |
| Data integrity: a number is a product feature, Bug Prevention Rules, silent-failure + rank-then-filter gates | `docs/agents/data-integrity.md` |
| Search and matching: incumbent identity, record vs market links, Map return continuity, Proven Players, A MATCH IS A CLAIM, keyword-first research, full-text/location search, market spend | `docs/agents/search-and-matching.md` |
| Data sources: SAM.gov API, award intelligence + office rosters, agency hierarchy | `docs/agents/data-sources.md`, `docs/DATA-SOURCES-REGISTRY.md` |
| Platform: GovCon OS, unified MI architecture, key files, env vars, KV resilience, email standard, admin endpoint standard, rate limiting, access control | `docs/agents/platform.md` |
| Products, tools, pricing, launch operations, SEO health | `docs/agents/product-and-tools.md` (pricing authority: `src/lib/mcp/packages.ts`) |
| MCP server, billing seam, OAuth, tool catalog gate | `docs/agents/mcp.md` |
| Verification recipes (`npm run verify:live`, `npm run db`, `npm run verify:oracles`) | `docs/agents/verification.md` |
| Strategy spine | `docs/strategy/MINDY-OPERATING-THESIS.md` |

`docs/agents/claude-md-anchor-manifest.json` maps every heading and rule of the previous single-file version to its new location. `scripts/audit-claude-md.mjs` fails if any of them goes missing or this file grows past its size budget.

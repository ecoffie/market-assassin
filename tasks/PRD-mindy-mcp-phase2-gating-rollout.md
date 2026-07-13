# PRD — Mindy MCP Phase 2: tier gating + catalog rollout

**Status:** Draft · 2026-07-13
**Owner:** Eric (product) · engineering: incremental PRs
**Depends on:** Phase 1 (billing seam `runMeteredTool`, OAuth, credits) — shipped.

## 1. Why

The MCP shipped Phase 1 with **9 metered tools, no feature gating** — every credit
buyer can call everything. Two gaps:

1. **The catalog is a launch subset.** The platform has **~60+ queryable capabilities**;
   only 9 are wrapped as MCP tools. ~39 more already exist as `/api` routes or lib
   functions and "just need wrapping." Shipping them expands what credits buy (and, for
   the moat tools, what Pro is worth).
2. **The pricing model needs enforcement.** The finalized model (see the catalog
   artifact) is **meter everything by default; gate only for four reasons** —
   differentiation, build-cost recovery, capability depth, security. Today there is no
   entitlement check, so the pricing page's "Pro unlocks …" is aspirational copy. Nothing
   ships to prod truthfully until a gate exists.

## 2. The packaging rule (what this enforces)

- **Meter (default):** commodity public data + curated intelligence. Priced by cost
  (`TOOL_CREDITS`), available to any credit balance. The credit meter already handles
  margin.
- **Gate → Pro (the exception, four reasons):**
  - **Differentiation** — teaching corpus/playbook, curated contacts, agency angles.
  - **Build-cost** — Proposal Assist 2.0, deep dossiers.
  - **Capability depth** — Proposal Assist 1.0 vs 2.0; basic vs AI variants.
  - **Security** — workspace/private data (per-key OAuth scopes).

Enforcement is one gate at the billing seam: `runMeteredTool` checks credits for
everything, plus a Pro-entitlement check on the gated set. **The page never advertises a
lock the server doesn't enforce.**

## 3. Phase A — gating enforcement (THIS build, the keystone)

Small, contained. Ships **flag-gated OFF** (`MCP_ENFORCE_TIERS`) so the layer lands with
zero behavior change; flip on when ready (same pattern as `MCP_OAUTH_ENABLED`).

**Components**
1. **Tool-tier metadata** — `src/lib/mcp/entitlements.ts`: `TOOL_TIER: Record<name,
   'metered'|'pro'>` (default `metered`; `get_winning_playbook` = `pro` — the one live
   moat tool). `tierFor(name)` reads it.
2. **Entitlement resolver** — `isProForMcp(email)` reuses the SAME Pro definition as the
   monthly-credit grant cron: `user_notification_settings` where `is_active=true AND
   briefings_enabled=true`. One source of truth — do not invent a second "Pro." Fails
   **open** (treat as entitled) on a DB error + logs — a soft monetization gate must not
   block a paying user on a transient blip.
3. **Enforce in `runMeteredTool`** — before the balance pre-check: if
   `mcpFlags.enforceTiers && tierFor(name)==='pro'` and `!isProForMcp(email)` → return a
   structured `requires_pro` outcome (clear upsell message + upgrade link), **no debit, no
   throw**. Honest agent UX: the agent relays "this needs Pro," it does not crash mid-run.
4. **New call-log status** `'gated'` — extend `CallStatus`. `mcp_call_log.status` is plain
   TEXT (no CHECK), so no migration. The gated rows are the **upsell queue**: who hit the
   wall = who to convert.
5. **Expose tier** — `listMcpTools()` annotates `_tier`; `/api/mcp/catalog` returns `tier`
   per tool. This is what flips the pricing page's `rolling out` → `live` per tool.
6. **Tests** — `entitlements.unit.test.ts` (tierFor + TOOL_TIER). Live smoke follow-up:
   a `pro` tool denies a non-Pro caller (no debit) and allows a Pro one.

**Acceptance (Phase A)**
- Flag OFF (default) → behavior identical to today (all metered). Verified: playbook still
  callable by a credit user.
- Flag ON → non-Pro caller of `get_winning_playbook` gets `requires_pro`, **0 debited**, a
  `gated` row logged; a Pro caller succeeds and is debited 2.
- `/api/mcp/catalog` shows `tier:'pro'` on the playbook, `tier:'metered'` elsewhere.
- No migration required.

## 4. Release phases (the rest of the ~39 tools)

Each wrap = the documented "adding a tool" recipe (pure fn + registry entry + Zod schema +
smoke + `data_sources` seed). Batches of 2–4 per PR.

| Phase | Ships | Gating dep | Effort |
|---|---|---|---|
| **A · Gating foundation** | entitlement layer (this doc §3) | — | S |
| **B · Metered discovery** | forecasts, recompetes, award-detail, incumbent-for-opp, entity/UEI lookup, IDV search, grants, SBIR, award history, agency profile, keyword coverage, 6-Q market scan | none | M |
| **C · Moat tools (gated `pro`)** | teaching-corpus & podcast search, curated contacts (federal/DoDAAC/SBLO/OSBP), agency angles (pain points, unified intel, SAT) | needs A | M |
| **D · Proposal Assist 2.0** | extraction+compliance matrix → multi-section drafting → manual mode → .docx export (gated `pro`) | needs A | L |
| **E · Workspace (Tier-0)** | pipeline / targets / teaming CRM / Vault over MCP, behind per-key OAuth scopes | needs A + scopes | M |

**Sequencing:** A and B run in **parallel** (B needs no gating — pour out metered tools
immediately for more credit revenue). C ships the moment A lands (makes Pro unlocks real).
D is its own track behind A's gate. E last (private data → security scopes).

Proposal 2.0 packaging (open decision): (a) included in Pro w/ a monthly package cap
[default], (b) a "Proposal Pro" add-on ~+$99/mo, (c) per-package credits.

## 5. Non-goals / guardrails

- **No new "Pro" definition.** Reuse the briefings/MI-Pro cohort check.
- **No hard gate on commodity or curated-intelligence tools** — they stay metered so the
  credit packs keep their value.
- **Fail-open on entitlement errors** — never block a paying user on a DB blip.
- Enforcement stays flag-gated until verified live, then `MCP_ENFORCE_TIERS=1`.

## 6. Rollout switch

1. Merge Phase A (flag OFF) — no behavior change.
2. Verify catalog `tier` fields live.
3. Flip `MCP_ENFORCE_TIERS=1` in Vercel → fresh deploy.
4. Live-smoke: non-Pro playbook → `requires_pro` (0 debit); Pro playbook → success.
5. Only then flip the pricing page's playbook unlock from `rolling out` → `live`.

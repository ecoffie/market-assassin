# PRD — Mindy v2: Team Execution + Outcome Loop + Base-Wide Hidden Work

**Status:** Draft for decision (defer-or-execute)
**Date:** July 6, 2026
**Author:** Claude (grounded against verified prod state, not the aged Mar/May roadmaps)

---

## Reuse-Check FIRST (what already exists — do NOT rebuild)

Verified in code + prod this session before scoping anything:

| Roadmap claimed "missing" | Reality (verified Jul 6) | Verdict |
|---|---|---|
| **Labor Rate Analytics / GSA CALC / Price-to-Win** | **DONE.** `src/lib/utils/calc-rates.ts` (470 lines), `/api/app/pricing-intel`, `PricingIntelPanel.tsx` (432 lines), sidebar "Estimating" section, Pro-gated. Server-aggregation price-to-win, SB-vs-LG splits, pagination. The $40.55-vs-$102.43 median bug fixed Jun 30. | **NOT a v2 gap. Roadmap was stale.** |
| Solo pipeline / kanban | EXISTS — `/api/pipeline` (stages `tracking→pursuing→bidding→submitted→won/lost/archived`), `PipelineBoard.tsx`, `/api/pipeline/stats`, `bid-no-bid` analyst route, `add-to-pipeline`. | Precursor — v2 builds the **team** layer on top. |
| Semantic hidden-work engine | Engine BUILT + flag-enabled. SOW corpus 100% embedded (`embed-sow-corpus` cron), `getCapabilityVector`, UEI fallback all shipped. | Engine done; **coverage is the gap** (see below). |

**Net:** two of the three items the old roadmap called "the wedges" are already built. v2 is NOT net-new tools — it's **closing three loops on top of what exists.**

---

## The one customer question (from `PRD-deal-flow-board.md`)

> **Does this help a small business find and win federal contracts?**

Today Mindy proves the *find* half (alerts, research, pricing, forecasts). It does **not** prove the *win* half — we can't answer "did MI usage move anyone toward a bid or a win?" That is the v2 thesis: **turn Mindy from intelligence into execution + evidence of outcomes.**

---

## Scope: three loops, in priority order

### Loop 1 — Deal Flow Board (team collaboration) 🎯 PRIMARY
**Gap:** the pipeline is single-user. Top buyer feedback (per PRD) wanted a *shared* board where founder + BD + capture + proposal + teaming partners work the same opportunities. This is also the natural pull into **Teams ($499)** and the Coach add-on's client workspaces.

**Build ON the existing `user_pipeline`** — do not create a parallel system.

MVP:
- **Shared account-level board** (workspace-scoped via existing `org_id`/`workspace_id` + RLS — reuse `[[coach_mode_tenancy]]` architecture, no new tenancy model).
- Columns reuse existing stages, add `no_bid` and `inbox`: `Inbox → Qualify → Capture → Proposal → Submitted → Won → Lost → No-Bid`.
- **Owner + collaborators per card** (assignment). **Next action + due date** (already partly on cards).
- Filters: owner, agency, NAICS, due date, stage, value, set-aside, source.
- Saved views: "Due this week", "Needs owner", "High value", "Teaming needed".
- Activity history per card (who moved it, when).

Explicitly OUT of MVP: real-time multiplayer cursors, in-app chat, file collaboration (link to Vault instead).

**Enterprise-SaaS precedent:** this is the Linear/Notion "shared board, assigned owner, saved views" pattern — the paid pull is *collaboration + scale of seats*, the view stays frictionless (data-behind-glass free preview via existing `PipelinePreviewFree.tsx`).

---

### Loop 2 — Outcome Loop (bid → won + lessons) 🎯 THE MOAT
**Gap:** `won`/`lost` stages exist but capture no *reason*, no *lesson*, and nothing ties MI usage → bid submitted → contract won. Without this we cannot answer the core customer question with data, and we have no testimonial/renewal engine.

MVP:
- **Win/Loss capture** on the `Won`/`Lost`/`No-Bid` transition: award $ (real, from USASpending award-detail spine — reuse `award-detail.ts`), incumbent beaten, primary reason (dropdown + free text), **one lesson learned**.
- **Outcome metric** on the admin command center: `MI-active users → bids submitted → wins recorded → $ won`. Ground each number in a real pipeline row, never an estimate (`[[ground_in_real_data]]`).
- **"You won" moment** — when a user marks Won, trigger the testimonial ask + a shareable stat. Feeds the advocate/10-10 pipeline already on the command center.
- Lessons feed back into future `bid-no-bid` grounding for that user (private).

Explicitly OUT: CPARS scraping, full past-performance library (that's a later PRD; `PRD-knowledge-base-repository.md`).

**Why this is the moat, not the board:** anyone can ship a kanban. The defensible asset is *"Mindy users reported $X in wins"* — the proof that converts free→paid and renews Pro. It's also the only honest answer to "does this help win contracts?"

---

### Loop 3 — Base-Wide Hidden Work (NAICS/keyword capability vector) 🎯 CHEAPEST HIGH-LEVERAGE
**Gap (verified, `[[hidden_match_coverage_reality]]`):** the semantic engine is fully built and enabled, SOW corpus 100% embedded, but it fires for **~nobody** — capability vectors need Vault/UEI signals and **only 5 users have a UEI.** Hidden-match CTR readout: ~0 impressions. A built, dark feature.

MVP (Eric scoped this OUT once as UEI-only-first — **this is the revisit**):
- **Fallback capability vector** built from the data ~every user already has: NAICS titles + keywords + `business_description` (reuse `embeddings.ts` `embedText`, JSONB cosine — no pgvector dependency, same pattern as `semantic-keywords.ts`).
- Populate `user_identity_profile.capability_embedding` base-wide via a batched, resumable backfill (local `tsx` runner per bulk rule, stamp `capability_embedded_at`).
- Verify BOTH sides have data before claiming live (measure pool AND per-user vector coverage — the explicit lesson from the last time this looked "enabled but worked for no one").

Explicitly OUT: new embedding infra (exists), pgvector migration (not needed for this).

**Why include a "small" item with two big ones:** it's days not weeks, it lights up an already-paid-for engine, and it directly serves the *find* side that makes the Deal Flow board have something worth working. Highest ROI per hour of the three.

---

## Phases

| Phase | Deliverable | Proof it works (rule #2) |
|---|---|---|
| **0. Verify + measure** | Confirm reuse-check above holds; measure current hidden-match vector coverage + pipeline usage counts | Real counts from DB, not estimates |
| **1. Hidden-Work fallback vector** | Fallback capability vector + base-wide backfill | `hiddenMatchCtr` impressions > 0 base-wide; N users with `capability_embedding` up from 5 → ~all active |
| **2. Deal Flow Board** | Shared board on `user_pipeline` + owner/collaborator + saved views | Two seats in one workspace both see + move the same card; RLS blocks cross-workspace |
| **3. Outcome Loop** | Win/loss + lesson capture + command-center outcome metric + testimonial trigger | A real Won transition writes $ + reason + lesson; command center shows usage→bid→won funnel from real rows |

Ship in this order: Phase 1 first (cheap, lights up existing spend), then 2, then 3 (3 depends on 2's board existing).

---

## Acceptance criteria

- [ ] Hidden-match produces non-zero impressions for users who have **no** UEI/Vault (NAICS/keyword only).
- [ ] Two teammates in one workspace collaborate on one board; a third in another workspace cannot see it (RLS verified, not assumed).
- [ ] Marking an opp `Won` captures real award $ (from award-detail spine), reason, and one lesson; nothing fabricated.
- [ ] Command center shows a real, row-grounded funnel: MI-active → bids submitted → wins → $ won.
- [ ] No new tenancy model, no pgvector dependency, no parallel pipeline table — all three loops ride existing infra.
- [ ] Marketing literature appended (What/Why/SEO/Proof) in the same push (`[[update_marketing_on_push]]`).

---

## What v2 is explicitly NOT

Per `[[simplify_not_complicate]]` and `[[mindy_product_principles]]` — v2 REMOVES the "built but dark / solo-only / find-but-no-proof" gaps. It does **not** add: Labor Rates (done), CPARS, a PP library, DCAA-lite accounting, invoice generation, or the Phase-3/4 infra tiers (all revenue/contract-gated, `[[resilience_open_items]]`). Those stay roadmap-labeled.

---

## Defer-or-Execute recommendation

**Execute Phase 1 immediately** (Hidden-Work fallback vector) — it's days, un-darkens a paid-for engine, and is verifiable. **Decide Phases 2+3 together** as the "team execution + proof" bet — that's the real strategic call (does Mindy become a team-execution product, or stay a single-operator intelligence product?). That's a founder decision, not a build detail.

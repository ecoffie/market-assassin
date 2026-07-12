# PRD: Mindy Chat → Data Core (Chat v2, tool-calling)

> Give the flagship Mindy chat the ability to reach the platform's **structured
> data** — the user's own pipeline + Vault, then live SAM opportunities, then
> contractor/award intelligence — via **tool-calling**, instead of being RAG-only
> over the teaching corpus. Staged, isolation-first, cost-guarded.

**This is the feature `PRD-mindy-chat-v1.md` already named "Mindy Chat v2."** v1 line 117
explicitly deferred *"Tool use / agent loop… search SAM live"* to v2. This PRD picks up
that logged decision — it is not a new direction.

---

## 1. Problem Statement

**Who has this problem?**
Every Pro/Team user who opens Mindy Chat expecting it to know *their* account and *the
live market* — not just how federal contracting works in the abstract.

**What's the pain?**
The flagship chat (`/api/app/chat`) is **"Eric-in-a-box"** — a teaching assistant. It
retrieves only from the GovCon Giants knowledge base: `mindy_rag_chunks` (~1,337 docs /
12,369 chunks of course + podcast transcripts, FTS-ranked) + `podcast_episode_metadata`
+ a thin profile blurb. It knows **how to win**. It has **zero** line of sight to the
data that says **what to win** or **where you stand**. A user cannot ask:

- *"What SAM opps in my NAICS closed this week?"* → the answer sits in `sam_opportunities` (104,085 records)
- *"Who's the incumbent on this recompete and what did they win last year?"* → `recompete_opportunities` (6,660 active) + BigQuery `recipients` (317,135) / `usaspending.awards`
- *"Which of my 6 pursuits is closest to deadline?"* → their own `user_pipeline`
- *"Draft my past-performance bullet for this agency"* → their own Vault (`user_past_performance`, `user_capabilities_library`)

**How they solve it today?**
They leave the chat and go hunt in the panels themselves. The system prompt literally
instructs Mindy to punt: *"I don't have that in my knowledge base — try the [X] panel."*
**That punt line is the value leak** — every one is a question the platform can already
answer, just not through the conversational surface.

**Evidence this is real:**
- [x] Our own experience / architecture audit (2026-07-11): confirmed the chat has no tool-calling and no path to any of the 7 Data Core domains.
- [x] Prior decision on record — `PRD-mindy-chat-v1.md` scoped v1 RAG-only *and named v2 as "tool use / search SAM live."* This was always the plan.
- [x] Eric (in `chat/route.ts` comment, Jul 2): *"the mindy chat needs help"* — already elevated chat to gpt-4o for quality; the missing half is **reach**, not just model tier.
- [ ] *To strengthen: pull top failed/punted chat turns from `mindy_chat_messages` to quantify how often users ask a Data-Core question the chat can't answer.*

---

## 2. Competitive Context

**Who else solves this?**
| Competitor | How They Solve It | Gap We Exploit |
|---|---|---|
| GovDash | AI over your captures + live opps | Costs 10–20×; we're $149 flat and already hold the unified data |
| Deltek GovWin IQ | Search + analyst content, no conversational data agent | No natural-language "ask my pipeline"; per-seat |
| HubSpot Breeze / Salesforce Agentforce / Notion AI | The exact arc: content-assistant → **agent that queries your own records via tools** | GovCon-specific data + the moat below |

**Why users choose us:** the moat is the unification (`MINDY-DATA-CORE-SOURCES.md`: ~596K
records, ~25–30 external sources, 6 formats, 300+ agencies). A conversational front-end
over *that* is something no competitor can cheaply copy. Enterprise-SaaS precedent (Rule
#13): every AI assistant that mattered graduated from "chatbot over a KB" to "agent over
your structured data." This is that graduation.

---

## 3. Solution

**One-sentence description:**
Users can *ask Mindy about their own pipeline, their Vault, and the live federal market
in plain English and get a grounded, real-data answer* — because the model can call
scoped tools that query the Data Core, not just retrieve teaching chunks.

**Which tool does this live in?** Mindy Chat (flagship, `/api/app/chat`).

**Architecture shift:** RAG-context-stuffing → **tool-calling** (function-calling). Today
retrieval is hardcoded (`Promise.all([rag, podcast, profile])` → concat → stream). v2
adds a `tools` array + an agent loop: the model decides *when* to call a Data-Core tool,
the tool returns **real rows**, and the model grounds its answer on them. The teaching-RAG
path stays as one tool among several (so "how do I…" questions are unchanged).

**User flow:**
1. User asks a question (e.g. *"which of my pursuits is due first?"*).
2. Model picks a tool (`get_my_pipeline`), which runs a `user_email`-scoped query.
3. Tool returns real rows; model composes a grounded, cited answer and streams it.
4. If no tool fits, it falls back to teaching-RAG (today's behavior) — never worse than v1.

**Output:** same streamed chat bubble + source chips, but chips can now be a live opp,
a pursuit card, or a Vault entry — not only a podcast/episode.

---

## 4. What ALREADY exists (don't rebuild)

The reuse spine is large — this is mostly **wiring existing loaders into a tool layer**,
not new data plumbing.

| Need | Already exists — reuse | File |
|---|---|---|
| User's Vault (identity, past perf, capabilities, team) — **email-scoped** | `loadVaultContext(email, sectionType)` | `src/lib/proposal/loaders.ts:107` |
| User's bidder profile (NAICS, set-asides) | `loadBidderProfile(email)` | `src/lib/proposal/loaders.ts:69` |
| Teaching corpus retrieval | `retrieveRagContext()` → `get_rag_chunks` RPC | `src/lib/rag/retrieve.ts` |
| SAM opps full-text search | `sam_opportunities.search_tsv` (generated tsvector + GIN) | `supabase/migrations/20260703_sam_opportunities_fts.sql` |
| Semantic opp match (embeddings) | `sow_embedding` / `hidden-match` | Data Core §7 |
| Vault pgvector (evidence match) | `match_vault_evidence` RPC | `supabase/migrations/20260702_vault_pgvector.sql` |
| Contractor / award rollups | `recipients_rollup_merged`, `top_contractors_by_dimension` | `src/lib/bigquery/recipients.ts` |
| BigQuery cost control | KV cache + `cacheOnly` guard pattern | (existing SEO/query-cache path) |
| LLM cost attribution + over-budget downgrade | `isUserOverBudget()`, per-tool usage logging | `src/lib/llm/call-llm.ts`, `usage-cost.ts` |
| Chat persistence | `mindy_chat_sessions` / `mindy_chat_messages` | `src/app/api/app/chat/route.ts` |
| The seam to wire into | the `{userProfile}` slot + the "try the [X] panel" punt line | `chat/route.ts` SYSTEM_PROMPT_TEMPLATE |

**The proposal chat (`/api/app/proposal/chat`) already reaches the Vault + pursuit docs.**
It is the working proof that email-scoped Data-Core access from a chat surface is safe and
already shipped — v2 generalizes its pattern to the flagship chat.

---

## 5. What's net-new

**Backend / architecture**
- A **tool registry + agent loop** in `chat/route.ts` (or a new `src/lib/chat/tools/`):
  define OpenAI/Groq `tools`, run the call, execute the chosen tool, feed results back,
  stream the final turn. Both providers speak the OpenAI tool-call format, so the SSE
  parser change is contained.
- **Tool implementations** (each a thin wrapper over an existing loader/query), staged:
  - `get_my_pipeline` — the caller's `user_pipeline` (stage, deadline, agency).
  - `search_my_vault` — the caller's `loadVaultContext` / `match_vault_evidence`.
  - `search_sam_opportunities` — `search_tsv` FTS, optional NAICS/set-aside/date filters.
  - `find_contractors` / `award_history` — BigQuery `recipients` / `usaspending.awards` (cache-gated).
- **Three-tier isolation model** (see below) — the organizing principle of the tool layer.
  Every user-owned tool takes `auth.email` from the **session**, NOT from model-supplied
  args, so the model *cannot* pass another user's email.
- **No-fabrication contract** — when a tool returns empty, the model must say "none found,"
  never invent an opp number / dollar / agency (Rule #1). Enforced in the tool-result
  framing + system prompt.

### 5a. Data-sensitivity tiers (the isolation spine)

The Vault is the **crown jewels** — `loadVaultContext` returns CPARS ratings, reference
names + phone numbers, security clearances, contract values, key-personnel bios, and
teaming partners. Leaking one user's Vault into another's chat is a breach, not a bug.
So sensitivity — not data domain — drives the tool design:

| Tier | Data | Tables | Isolation rule |
|---|---|---|---|
| **Tier 0 — PRIVATE (crown jewels)** | user pipeline + Vault | `user_pipeline`, `user_identity_profile`, `user_past_performance`, `user_capabilities_library`, `user_team_members`, `user_teaming_partners` | Email from the **authenticated session only** (`auth.email`). **A tool must NOT accept an email argument.** Empty result → "you have none," never fabricated. Isolation is a merge-blocking test (two seeded accounts). |
| **Tier 1 — SHARED PLATFORM** | SAM opps, forecasts, contractor/award, recompetes, NAICS buyer vocabulary | `sam_opportunities`, `agency_forecasts`, BQ `recipients`/`usaspending.awards`, `recompete_opportunities`, `naics_vocabulary` | Public federal data — no per-user scoping. Normal query, cache-gated for BigQuery. |
| **Tier 2 — CROSS-TENANT (deferred)** | a coach asking about a client's pipeline/Vault | `org_clients` + Tier-0 tables of a *different* workspace | **Out of scope for v2.** Requires the org-isolation review from the coach layer. A coach's chat gets ONLY their own Tier-0 in v2, never a client's. |

**Keep Tier 0 logically separate at the tool boundary — but in the SAME agent, not a
forked chat.** Enterprise-SaaS precedent (Rule #13): HubSpot Breeze, Salesforce
Agentforce, and Notion AI all keep sensitive tenant data in one assistant and enforce
isolation at the **tool/permission layer**, not by physically splitting the surface.
Forking the chat doubles the maintenance + UX cost and *widens* the isolation surface
rather than shrinking it. Separation = the session-email boundary on Tier-0 tools, not a
second endpoint.

**Pattern to copy = the flagship chat's, not the proposal chat's.** The flagship chat
derives `email` from `auth.email!` (session-only, `chat/route.ts:360`). The proposal chat
takes `body.email` then verifies it against the signed session
(`requireMIAuthSession(request, email)` → rejects a mismatch, `two-factor-session.ts:17`)
— **safe, but weaker** (trust-but-verify vs. never-trust). Tier-0 tools use the
session-only pattern so the "wrong email" class of bug is structurally impossible.

**Prompt**
- Extend SYSTEM_PROMPT_TEMPLATE: describe the tools, when to use each, and the
  empty-result rule. Keep the existing voice/scope blocks.

**DB**
- **None expected for Phase 1–2** — pipeline, Vault, SAM FTS all already have their tables
  + indexes. (BigQuery phase needs no migration either.) Any new index is additive and
  hand-run per Rule #6.

**UI**
- Source chips extended to render pipeline/opp/Vault result types (the chip component
  already exists; add result-type variants). No new panel.

---

## 6. Scope

**In scope (MVP = Phase 1 only):**
- [ ] Tool-calling agent loop in the flagship chat (single tool round-trip, streamed).
- [ ] Two user-owned tools: `get_my_pipeline`, `search_my_vault` — email-scoped, isolation-tested.
- [ ] No-fabrication-on-empty enforced + unit-tested.
- [ ] Teaching-RAG preserved as the fallback tool (v1 behavior never regresses).
- [ ] Per-tool cost logging via existing `usage-cost` path.

**Out of scope (defer):**
- Multi-step / multi-tool chains (call SAM → then contractors → then draft). Phase 3+.
- BigQuery contractor/award tools (cost + latency) — Phase 3, behind cache.
- Write actions (add to pipeline, mute an opp, send an email from chat) — separate PRD; read-only first.
- Cross-user / org-wide queries in chat (a coach asking about a client) — needs the org-isolation review from the coach layer; defer.
- Streaming citations mid-retrieval (already deferred in v1).

**Dependencies:** `OPENAI_API_KEY` (present); SAM FTS migration (already live); BigQuery
SA + KV cache (present, Phase 3 only); no new env for Phase 1–2.

**50K-user / cost question (flag):** tool-calling adds a second model round-trip per
tool-using turn (higher token spend on the $149 flat plan). Mitigation: the existing
`isUserOverBudget` downgrade already guards margin; Phase 1 tools hit Postgres (cheap);
BigQuery tools are gated behind Phase 3 + cache + `cacheOnly`. **Architect the tool
registry for many tools, ship two.**

---

## 7. Acceptance Criteria

- [ ] *"Which of my pursuits is due first?"* returns the caller's real earliest-deadline
      pipeline row (verified against `user_pipeline` for that email) — not a hallucination.
- [ ] *"What's in my capability library for cybersecurity?"* returns the caller's real Vault
      entries; a user with an empty Vault gets "you don't have any yet," never invented ones.
- [ ] **Tier-0 isolation proof:** user A's chat can never surface user B's pipeline/Vault,
      even if the prompt tries to coerce another email — because Tier-0 tools read
      `auth.email` and expose no email argument. (Test with two seeded accounts; this test
      blocks merge.)
- [ ] **No-regression:** a pure teaching question (*"how do I write a past-perf volume?"*)
      answers identically to v1 (teaching-RAG fallback fires).
- [ ] **No-fabrication:** an empty tool result never produces an invented opp/dollar/agency
      (unit test + a live adversarial prompt).
- [ ] Per-tool cost is logged; an over-budget user is downgraded, not blocked.
- [ ] Full production build green; the two coach/chat routes 200 in prod.

---

## 8. Estimated Effort

- **Phase 0 — spike (½–1 day):** tool-call round-trip against Groq + OpenAI in `chat/route.ts`; confirm the SSE parser tolerates a tool-call frame. De-risks the whole thing.
- **Phase 1 — user-owned tools (2–3 days):** `get_my_pipeline` + `search_my_vault`, isolation wrapper, no-fabrication contract, unit tests, chip variants. **← MVP ships here.**
- **Phase 2 — live market read (2 days):** `search_sam_opportunities` over `search_tsv` (+ optional semantic `hidden-match`); `get_market_vocabulary` — the real buyer work-words for a NAICS (`naics_vocabulary`, 25,252 rows, via `src/lib/market/vocabulary.ts`) so chat can answer *"what words actually win in my market?"* / expand a vague ask into the terms buyers use. Cheap Postgres read, no per-user scoping, already a proven lib (powers keyword lead + alerts + onboarding) — Tier-1, ships alongside SAM here.
- **Phase 3 — contractor/award intel (2–3 days):** BigQuery `recipients` / `usaspending.awards` tools behind KV cache + `cacheOnly`; latency + cost validated before enabling.
- **Phase 4 (separate PRD) — write actions & multi-tool chains.**

---

## 9. Risks + Open Questions

**Risks**
- **Tenant data leak** (highest) — a Tier-0 tool that trusts model-supplied email = cross-customer breach (Vault = CPARS, references, clearances). *Mitigation: Tier-0 tools read `auth.email` from the session and expose NO email argument (§5a); isolation is a merge-blocking test.*
- **Fabrication on empty** — a tool-calling model is *more* tempting to hallucinate confident specifics. *Mitigation: empty-result framing + adversarial test as an acceptance gate.*
- **Cost creep** — extra round-trip + BigQuery scans. *Mitigation: Postgres-only Phase 1–2; BQ gated Phase 3.*
- **Latency** — an agent loop is slower than one-shot RAG. *Mitigation: single tool round-trip in MVP (no chains); stream the final turn.*
- **Provider drift** — Groq's tool-call support/format lags OpenAI's. *Mitigation: verify in Phase 0; if Groq can't tool-call reliably, tool-using turns route to OpenAI, teaching turns stay on Groq.*

**Open questions (need Eric's call)**
1. **Free/Pro/Team gating** — is Data-Core chat a **Pro** perk (like chat is today) or a **Team+** differentiator? (Enterprise-SaaS lens: "cap the view, not the action" → likely Pro can ask, Team gets the heavier BigQuery tools.)
2. **Ship order after Phase 1** — SAM opps (market intel) or contractor/award (competitive intel) first? Pipeline/Vault first is settled (owned data, tight isolation).
3. **Does Phase 1's value clear the bar** to justify Phase 2–3, or is "chat knows my pipeline + Vault" enough on its own for now?

---

## 10. Decision Log

- **2026-07-11** — Confirmed via code audit: flagship chat is RAG-only, **no tool-calling**, no path to any of the 7 Data Core domains. `mindy_rag_chunks` is even FTS-only (pgvector not wired on that path).
- **2026-07-11** — Confirmed this is not a new idea: `PRD-mindy-chat-v1.md` line 117 already scoped v1 RAG-only and named v2 = *"tool use / agent loop / search SAM live."* This PRD executes that logged plan.
- **2026-07-11** — Reuse decided: extend `chat/route.ts` + wrap existing loaders (`loadVaultContext`, `loadBidderProfile`, SAM `search_tsv`, BQ `recipients`) as tools. The **proposal chat already proves email-scoped Data-Core chat is safe** — generalize its pattern, don't invent one.
- **2026-07-11** — Staging decided: **user-owned data first** (pipeline + Vault — owned, cheap, tight isolation) → SAM opps → BigQuery contractor/award (cost/latency last). Ship Phase 1 as MVP.
- **2026-07-11** — Real Data Core counts sourced from `MINDY-DATA-CORE-SOURCES.md` (104,085 SAM opps · 317,135 contractors · 6,660 active recompetes · 142,135 decision-makers · 9,572 semantic-indexed opps), not estimated.
- **2026-07-11** — **Three-tier isolation model adopted** (§5a): sensitivity, not data domain, drives the tool design. Tier 0 (pipeline/Vault) = session-email-only, no email arg, merge-blocking isolation test. Tier 1 (public federal data) = normal query. Tier 2 (coach→client) = deferred. **Decided: keep Tier 0 in the SAME agent, isolated at the tool boundary — do NOT fork a separate chat** (enterprise-SaaS precedent; forking widens the isolation surface).
- **2026-07-11** — **Added `naics_vocabulary` (25,252 buyer-words per NAICS) as a Tier-1 Data Core tool** (`get_market_vocabulary`, Phase 2 alongside SAM). It's already a shipped internal lib (`src/lib/market/vocabulary.ts`, powers keyword lead + alerts + onboarding + recompete/forecast chips) — exposing it to chat lets Mindy answer *"what words win in my market?"* Cheap Postgres, public data, no per-user scoping. Registered in the data-sources registry same day.
- **2026-07-11** — **Proposal chat is verified SAFE, not a bug** — it takes `body.email` but `requireMIAuthSession(request, email)` rejects any mismatch against the signed session token (`two-factor-session.ts:17`). No remediation ticket needed. v2 Tier-0 tools adopt the *stronger* flagship pattern (`auth.email`, session-only) so the "wrong email" class is structurally impossible — a design rule, not a fix.
- **2026-07-11 — ✅ PHASE 2 SHIPPED.** Tier-1 (public data) tools added to the flagship chat: `search_sam_opportunities` (live SAM opps via the `search_tsv` GIN-FTS, active + not-yet-closed only) + `get_market_vocabulary` (25,252-row `naics_vocabulary`, reusing `src/lib/market/vocabulary.ts`). `src/lib/chat/tier1-tools.ts` — no per-user scoping (public data), same no-fabrication-on-empty contract. Route now offers the COMBINED Tier-0 + Tier-1 tool set in the pre-flight round and dispatches each called tool to its owning toolset by name (`TIER0_TOOL_NAMES` gate). 12 unit tests + **6/6 live-route E2E PASSED** (extended `verify-chat-v2-e2e.mjs`): the 4 Phase-1 gates still green (no regression) PLUS (5) vocabulary returns real buyer-words for 541512, (6) SAM search returns a real open opp (USMC EDCOM ITSS) instead of punting. 84/84 total tests, full build green. Remaining: Phase 3 (BigQuery contractor/award).
- **2026-07-11 — ✅ PHASE 1 SHIPPED (MVP).** Tier-0 tools live in the flagship chat: `get_my_pipeline` + `search_my_vault`, isolated by construction (`src/lib/chat/tier0-tools.ts` — email bound from session, NO email arg in the schema, `additionalProperties:false`). Agent loop = one non-streamed pre-flight tool call → execute → append result → existing stream produces the grounded answer (v1 path byte-for-byte preserved when no tool fires). 11 isolation/behavior unit tests + **4/4 live-route E2E acceptance criteria PASSED** (`scripts/verify-chat-v2-e2e.mjs`, two real Pro users): (1) pipeline returns real rows, (2) empty-user never sees another's pursuits, (3) teaching no-regression, (4) no-fabrication on empty. Full build green. Remaining: Phase 2 (SAM opps), Phase 3 (BigQuery).
- **2026-07-11 — ✅ PHASE 0 SPIKE PASSED (3/3 runs, both providers).** `scripts/spike-chat-v2-toolcall.mjs` proved a streamed tool-call round-trip works on **OpenAI gpt-4o AND Groq llama-3.1-8b-instant** without breaking the route's SSE parse shape. Verified: (1) model emits a `tool_call` for a pipeline question, (2) fragmented `.arguments` deltas reassemble to valid JSON, (3) feeding the tool result back yields a final answer grounded in the tool's data, (4) a teaching question calls NO tool and streams plain content (no v1 regression). **Key de-risk:** the 8B Groq fallback — the model most likely to fail tool-calling — was reliable, so v2 does NOT need to force tool-using turns onto OpenAI only. The SSE parser needs exactly one addition: accumulate `delta.tool_calls[i].function.arguments` alongside the existing `delta.content` path. Architecture is GO for Phase 1.

---

**Status:** ☐ PRD only · ☑ **Approved to build (Eric, 2026-07-11)** — starting Phase 0 spike.

*Phase 0 = prove a tool-call round-trip works on both Groq + OpenAI without breaking the SSE stream. De-risks the architecture before any Tier-0 tool is written.*

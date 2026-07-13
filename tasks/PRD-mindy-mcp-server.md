# PRD: Mindy MCP Server — the GovCon *intelligence* layer other AI agents call

**Status:** ☐ PRD only · ☑ **Approved to build** (Eric, 2026-07-11) — Phase 0 spike in progress
**Owner:** Eric / Claude
**Date:** 2026-07-11
**Supersedes:** `tasks/PRD-mindy-as-ai-data-layer.md` (May 22 2026 strategic direction — same
thesis, but that predates the now-built Chat v2 Data Core and the Tango launch; this is the
current, buildable version).

> Package Mindy's **already-built** Data Core tools as a hosted **MCP server** that any AI
> agent (Claude Desktop, Cursor, Continue, the Anthropic/OpenAI SDKs, a customer's own bot)
> can tie into with their existing tools. Metered by a **prepaid credit ledger** (Higgsfield
> model). Public federal data + our **intelligence layer** in v1; the user's own private
> pipeline/Vault deferred to phase 2 behind explicit scopes. The wedge vs Tango: they sell
> *data*, we sell *conclusions*.

---

## 1. Problem statement

**Who has this problem?** Two audiences:
1. **Power users / consultants / dev-savvy GovCon shops** who already live in Claude/Cursor
   and want federal-contracting intelligence *inside the tools they already use* — not by
   logging into another web app.
2. **Us** — Mindy's growth is capped by "you must come to getmindy.ai and use our UI." Every
   competitor in the 2026 AI-SaaS wave that scaled fast (Higgsfield → $500M ARR) did it by
   **letting people plug the capability into their existing workflow via MCP**, then metering
   usage. The distribution is the agent ecosystem, not our marketing funnel.

**How they solve it today:**
- Raw gov APIs (SAM, USASpending, FPDS) — free but a token-firehose; an LLM burns ~$9,400 to
  read one FY of awards raw (Tango's own benchmark). Unstructured, no intelligence.
- **Tango by MakeGov** (the direct competitor, launched ~2026) — a unified GovCon *data* API
  + MCP server (`https://govcon.dev/mcp`, 5 tools: `resolve`, `search`, `search_opportunities`,
  `get_details`, `fetch_api_docs`). Their whole pitch is "same records, 2.6× fewer tokens."
  **That's a plumbing pitch.** They give you cleaner data; you still have to do the thinking.

**Evidence it's real:** Tango exists and is selling this exact shape — the market is validated,
not hypothetical. Higgsfield proved the MCP-metered-by-credits model scales ($500M ARR, per
Eric's market scan). And our own **Chat v2 Data Core already answers these questions internally**
— we've built the hard part; we just haven't opened the edge.

---

## 1a. USP — "SAM's API is free, so what's the moat?" (the load-bearing question)

**The challenge (Eric, 2026-07-11):** *Everyone can now get a SAM.gov API key. So is
`search_sam_opportunities` even valuable — what's our USP?*

**The honest answer: raw SAM search is NOT a USP, so we don't sell it as one.** "We call SAM
for you, more conveniently" is exactly Tango's commoditizable "fewer tokens" plumbing pitch.
`search_sam_opportunities` is the **doorway, not the product.** The moat is what only Mindy can
**weld onto each result** and **join to it** — nothing a competitor can reproduce by wrapping
the free API. Ranked weakest → strongest (all verified against the codebase, 2026-07-11):

**❌ NOT a moat — don't position on it:** "We proxy the SAM API." Free, public, anyone can do
it. (Though even here we quietly de-risk the caller: raw SAM is famously hostile — no
comma-separated NAICS, 0-indexed pagination, `MM/dd/yyyy` dates, `samRegistered=Yes` required
or it returns empty, 1,000/day + 10/min limits. We've eaten those quirks so the agent doesn't.
Convenience, not defensibility.)

**🟡 DERIVED (we computed it from public data — moderately defensible):**
- **Recompete intelligence** — SAM has **zero** of this. We derive it by joining USASpending
  award end-dates and **computing** `estimated_recompete_date`, `lead_time_months`, and a
  `recompete_likelihood` score (a Postgres `compute_recompete_likelihood()` weighing end-date +
  options-remaining + value). `recompete_opportunities` = **9,481 rows** (`src/lib/recompete/*`,
  migration `20260405_recompete_intelligence.sql`). "Who's the incumbent, what did they win last
  time, when does it re-compete" — SAM literally cannot answer.
- **317K-recipient BigQuery rollup** — we **computed** the parent-UEI merge + legal-suffix
  name-dedup (`recipients_rollup_merged`, `src/lib/bigquery/recipients.ts`) collapsing a company's
  scattered subsidiary UEIs into one canonical org (Lockheed's ~31 name variants → one entity),
  plus a composite capability `match_score` (`findCapableSmallBusinesses`). Raw USASpending gives
  neither.
- **SBA-goaling intelligence** — which agencies *miss* their small-biz goals → where a small
  business is structurally advantaged. A conclusion, not a record.

**🟢 ENRICHMENT welded to each SAM opp (verified in migrations — SAM returns none of this):**
- **SOW/PWS extraction + semantic embeddings** — on the raw opp we ADD `has_sow_doc`
  (**13,372 of 124K opps** flagged), doc-type classification, extracted `sow_text`, and OpenAI
  `sow_embedding` (~6,000 embedded) for "hidden work" semantic search
  (`20260521_..._full_extraction.sql`, `20260609_sow_catalog.sql`, `20260611_sow_embeddings.sql`).
  SAM gives a notice + attachment *links*; we give the *whole parsed, queryable, embeddable scope*.
- **Extracted points-of-contact** — **162,922** deduped gov contacts mined from
  `sam_opportunities.points_of_contact` into a searchable people index (`federal_contacts`,
  `20260604_federal_contacts.sql`). The human to call, not just the notice.
- Normalized set-asides, AI `seo_summary` analysis, respondability / deadline-runway flags, FTS
  `search_tsv` (`20260703_sam_opportunities_fts.sql`).

**🔵 PROPRIETARY (un-copyable — no public API contains this, not even Tango):**
- **The GovCon Giants teaching corpus** — **1,386 docs / 12,564 chunks / ~30M chars** of course
  transcripts + **414 Whisper-transcribed podcast episodes** (with structured per-episode intel:
  guest, company, NAICS/agencies/set-asides mentioned, key lessons) + coaching calls
  (`mindy_rag_documents`, `mindy_rag_chunks`, `podcast_episode_metadata`; `src/lib/rag/*`). This
  is Eric's original IP and answers **"how do I actually WIN this"** — the one thing a data API
  can never provide. **The single strongest moat: no competitor can buy or scrape it at any price.**
- **Hand-curated agency pain-points / SAT-friendliness DB** — editorial IP mapping each agency's
  buying pain → NAICS, with SAT/micro-purchase-friendliness scores + NDAA-mandate tracking
  (`src/data/agency-pain-points.json` ~7,447 lines, `agency-sat-friendliness.json`,
  `agency_intelligence` 557 rows; `20260419_agency_intelligence.sql`). A HigherGov-style asset a
  competitor would have to rebuild by hand. Turns "here's an opp" into "here's WHY this agency
  buys and whether a new entrant can win it."
- **The `_ai_hint` narration layer** — the pre-computed *conclusion* itself.

**The wedge, in one line:**
> **Tango (and raw SAM) tell you a contract exists. Mindy tells you whether to bid it, who
> you're up against, how they won it last time, how to beat them, and cites the exact playbook —
> in the same call.** The SAM search is the hook; the enrichment + derived intelligence + our
> own 8-year corpus is why nobody clones it by wrapping the free API.

**Design rule that falls out of this (non-negotiable):**
> **The MCP must NEVER return a bare SAM record.** Every `search_sam_opportunities` result is
> enriched-only — pre-joined with incumbent/recompete signal, extracted SOW, POC, fit flags, and
> an `_ai_hint`. If the MCP ever returns raw SAM, we've handed a competitor our positioning for
> free. (See §4 — the enrichment wrapper is the tool, not the SAM call.)

*Illustrative enriched-intelligence response* (the shape competitors can't match):
"DOD spent $4.2B in NAICS 541512 across 12,847 contracts; 18% were sub-SAT → SAT-friendly for
new entrants; the incumbent on this recompete is [X], who won it in 2023 at $Y and re-competes
in 8 months; here are 3 next actions and the capture play from the GovCon Giants corpus." An LLM
doesn't *want* to do math on 12,847 rows — it wants the conclusion. **Pre-doing the conclusion is
the product.**

---

## 2. Solution

**One sentence:** A hosted, credit-metered MCP server (`mcp.getmindy.ai`) that exposes Mindy's
Data Core tools — each returning not just data but an `_ai_hint` pre-narrated conclusion the
calling agent can quote verbatim — authenticated by a per-user API key drawn from a prepaid
credit balance shared with the Mindy account.

**User flow:**
1. A Mindy user goes to `getmindy.ai/mcp`, generates an **API key**, buys **credits** (Stripe
   top-up, `$1 = N credits`), and drops the server URL + key into their agent's `mcp.json`.
2. Their agent (Claude Desktop / Cursor / custom) now has Mindy tools. They ask natural-language
   questions; the agent calls Mindy tools; **credits are debited per call, by tier, on success
   only** (a BigQuery contractor scan costs more than a SAM keyword search).
3. The MCP exposes a `get_balance` tool + per-tool price metadata so the agent can **warn before
   spending** (Higgsfield's key UX — no bill shock).

**What the output looks like** (the differentiator — carried forward from the superseded PRD):
```jsonc
// get_agency_intel("DOD", naics="541512")
{
  "agency": "Department of Defense",
  "naics_spend_fy": 4_200_000_000, "naics_contract_count": 12_847,
  "sat_friendly_pct": 0.18, "open_opportunities": 234,
  "_ai_hint": {                              // ← pre-narrated, LLM-passable, no re-math
    "summary": "DOD spent $4.2B in NAICS 541512 across 12,847 contracts this FY. 18% were under the $250K SAT — SAT-friendly for new entrants. 234 opps are open now.",
    "recommended_next_actions": ["Filter open opps under $250K for first-contract candidates", "…"],
    "key_caveats": ["Budget figure is congressional authorization; obligations TBD"]
  },
  "_credits_charged": 3
}
```

---

## 3. What ALREADY exists (don't rebuild) — the reuse audit

**~80% of this is already built.** The MCP server is a *packaging + edge-auth + metering* job,
not a data-integration job. (Inventory confirmed by codebase audit, 2026-07-11.) The audit found
**~60+ distinct queryable capabilities** already in the codebase (§4a) — only 6 are wired into the
chat tool layer; the rest exist as routes/lib functions ready to promote. The tool *catalog* is
therefore also mostly built, not just the data plumbing.

| Layer | Already exists | Where |
|---|---|---|
| **Tool contracts** | Chat v2 Data Core — 6 tools across 3 tiers, each an `execute(name, args)` with per-field arg validation | `src/lib/chat/tier0-tools.ts`, `tier1-tools.ts`, `tier2-tools.ts`; orchestrated `src/app/api/app/chat/route.ts` |
| **Tier 1 tools (public)** | `search_sam_opportunities` (Supabase `sam_opportunities` FTS), `get_market_vocabulary` (`naics_vocabulary`, ~25K terms) | `tier1-tools.ts` |
| **Tier 2 tools (intel)** | `get_contractor_profile` (BigQuery `recipients_rollup_merged`, ~317K), `find_capable_contractors` | `tier2-tools.ts`, `src/lib/bigquery/recipients.ts` |
| **Cost guard (reuse!)** | Two-pass cache-only→live BQ pattern + `checkRateLimit('chat-bq:'+email, 12/hr)` + per-turn cap; built to stop the June-2026 $2,075 BQ spike | `tier2-tools.ts`, `src/lib/rate-limit.ts` |
| **Rate limiting** | `checkRateLimit(key, limit, windowSeconds)` — KV fixed-window, standard `X-RateLimit-*` headers | `src/lib/rate-limit.ts` |
| **Usage telemetry shape** | `recordLlmUsage()` → `llm_usage_log` (per-user, cost) — the pattern for a credit-debit ledger | `src/lib/llm/usage-cost.ts` |
| **Stripe** | Product/subscription billing, purchases index | `src/lib/stripe.ts`, `src/lib/supabase/purchases*` |
| **Data-source registry** | Central per-source status + recordCount + coverage% | `src/lib/data-sources/registry.ts` |

**What's genuinely NET-NEW** (the external edge — none of this exists today):
1. **MCP transport layer** — no MCP server code, no `@modelcontextprotocol/sdk` dep anywhere.
2. **API-key issuance + verification** — auth today is *web-session only* (`x-mi-auth-token` /
   2FA). There is NO programmatic API-key concept.
3. **Prepaid credit ledger** — `llm_usage_log` tracks *our* LLM cost; there's no per-user
   *credit balance* to debit external calls against.
4. **Metered Stripe (top-ups)** — current Stripe is one-time/subscription; no usage/credit
   top-up wiring.
5. **`_ai_hint` narration layer** — tools currently return raw data to *our* chat model; the
   pre-narrated conclusion wrapper is new (and is the moat).

---

## 4. What's net-new (by layer)

**DB (hand-run migrations — this DB has no in-app DDL):**
- `mcp_api_keys` — `id, user_email, key_hash, key_prefix, scopes[], created_at, last_used_at, revoked_at`. Store a **hash**, show the key once.
- `mcp_credit_ledger` — append-only: `id, user_email, delta, reason, tool_name, api_key_id, balance_after, created_at`. Balance = latest row (or a materialized `mcp_credit_balance` for O(1) reads).
- `mcp_call_log` — `id, user_email, api_key_id, tool_name, credits_charged, latency_ms, status, created_at` (audit + analytics + abuse detection).

**Backend:**
- **MCP server** at `mcp.getmindy.ai` (HTTP transport, same as Tango/Higgsfield). Wraps the
  existing `execute(name,args)` toolsets. Exposes: the Tier-1/2 tools + `get_balance` +
  per-tool `_credits` price metadata + `fetch_api_docs`-style self-doc.
- **API-key middleware** — verify `Authorization: Bearer <key>` (or `X-Mindy-API-Key`), resolve
  to `user_email` + scopes, reject if revoked / no credits.
- **Credit debit** — a wrapper around each tool call: compute cost by tier (SAM search = 1,
  vocab = 1, contractor profile w/ live BQ = 5, capable-contractors scan = 8 — tune later),
  **debit on success only**, write `mcp_credit_ledger` + `mcp_call_log`. Reuse the Tier-2
  cache-first pattern so warm/cached hits cost fewer credits (protects our margin AND rewards
  the user).
- **`_ai_hint` narration** — a per-tool post-processor that computes the summary/next-actions
  from the returned data (deterministic where possible; a cheap LLM pass only where needed,
  costed into the credit price). **Every fact in `_ai_hint` must come from the real returned
  data — never an LLM guess** (process rule #1).
- **Enrichment wrapper (the USP made real — see §1a).** `search_sam_opportunities` over the MCP
  is NOT the raw SAM/`sam_opportunities` row. It's an **enriched-only** result: each opp is
  pre-joined with its extracted SOW/PWS text, points-of-contact (`federal_contacts`), normalized
  set-aside + respondability flags, the incumbent + recompete signal (from
  `src/lib/briefings/recompete/*` + USASpending award end-dates), and an `_ai_hint`. **The
  wrapper IS the tool; the SAM call is an implementation detail the caller never sees raw.** This
  is what makes the free SAM API irrelevant to our moat.

**UI:**
- `getmindy.ai/mcp` — dashboard: generate/revoke API keys, buy credits (Stripe), see balance +
  usage history, copy-paste `mcp.json` snippet, per-tool price table, live docs link.
- Marketing/landing section positioning vs Tango ("data → intelligence") + the content hooks.

**Integration / GTM (the flywheel Eric named):**
- **Content engine:** we publish videos/threads showing people building "really cool innovative
  things" with the Mindy MCP they couldn't get elsewhere (e.g. "point Claude at Mindy MCP and
  have it build your whole capture pipeline for a $2M DOD recompete in 4 prompts"). Content →
  MCP adoption → credit purchases. This is a first-class deliverable, not an afterthought.

---

## 4a. The Data Core tool menu — we already have ~60+ tools, only 6 are wired

**Critical finding (codebase audit, 2026-07-11):** the platform already has **~60+ distinct
queryable capabilities** across API routes + lib functions. **Only 6** are wired into the Chat
v2 tool layer (`get_my_pipeline`, `search_my_vault`, `search_sam_opportunities`,
`get_market_vocabulary`, `get_contractor_profile`, `find_capable_contractors`). **The other
~54 already exist** as routes/lib functions — they just aren't tools yet. The MCP's tool catalog
is a *promotion* job, not a build job.

The chat tiers (`src/lib/chat/tier{0,1,2}-tools.ts`) are the **reference adapter**: they already
implement the isolation contract (Tier-0 email bound server-side, never a model param), the
no-fabrication `count:0/items:[]` pattern, and the BigQuery cost gate. **Reuse those patterns for
every promoted tool.** Menu of the highest-value un-exposed capabilities (full table in the audit;
`[CHAT]` = already wired, else exists as route/lib):

**Opportunity/solicitation:** `search_opportunities_full` (CTA-scored, hasSow, notice-type) ·
`semantic_sow_search` (embedding cosine: expiring-contract desc → likely SOW) · `get_recompetes`
(likelihood + incumbent) · `get_expiring_contracts` · `get_forecasts` (multi-agency + DoD
early-signal scrapers) · `get_grants` · `search_dibbs` (~3.3M DLA small-buys) · `search_sbir` ·
`search_idv_vehicles` · `get_incumbent_for_opp` (predecessor engine).

**Contractor/competitive intel:** `get_contractor_profile` **[CHAT]** · `find_capable_contractors`
**[CHAT]** · `get_contractor_award_history` / `yearly_totals` / `top_naics` / `top_agencies` /
`executives` · `find_similar_contractors` (peers/competitors) · `get_subaward_tree` (teaming trees,
both directions) · `get_teaming_intel` · `find_predecessor_award` · `get_award_detail` (w/ mods) ·
`lookup_sam_entity` (UEI/CAGE/certs) · `top_contractors_listicles`.

**Agency/market intel:** `market_scan_6q` (the 6-question framework) · `get_agency_profile` ·
`get_agency_offices` · `get_agency_sat_friendliness` · `get_agency_pain_points` (curated) ·
`get_unified_agency_intelligence` · `get_budget_intel` (program spend + trend) · `get_sba_goaling`
· `get_naics_profile` · `get_market_vocabulary` **[CHAT]** · `profile_from_text` (company desc →
NAICS/keywords).

**People/contacts:** `search_federal_contacts` (~112K POCs) · `lookup_dodaac_directory` ·
`find_osbp_smb` (Navy OSBP capable-SB search) · `get_notice_poc`.

**Pricing/decision support:** `get_pricing_intel` (labor rates / price-to-win) ·
`evaluate_bid_no_bid` (scorecard + gates + recommendation) · `compute_why_fit` (win-prob + why) ·
`gov_buyer_market_research` (reverse: find firms for a requirement) · `compliance_scan` ·
`opportunity_runway`.

**Teaching corpus (proprietary — §1a):** `search_teaching_corpus` (FTS over course/coaching/
templates, doc-type rank boosts) · **`search_podcast_episodes`** — the *richest* query surface:
filter by topic, **NAICS mentioned**, **agency mentioned**, **set-aside**, guest, product-vs-service
· `get_podcast_insight_for_profile` (best "someone like you won" quote). **These assemble the
`get_winning_playbook` spike tool** (Phase 0): `retrieveRagContext({docTypes:['proposal_template',
'cap_statement','past_performance']})` + `getPodcastInsightForProfile`.

**Derived/narrative (return CONCLUSIONS, not rows — ideal `_ai_hint`-native tools):**
`generate_market_narrative` (3-sentence read + 3 next actions) · `generate_market_dossier`
(biddable-now opps + recompetes matched to profile) · `get_best_fit_opportunity` (single best opp +
why) · `generate_pursuit_brief` · `bid_no_bid_narrative` · `unified_agency_intel_summary`.

**Implication for the roadmap:** Phase 1 exposes the ~6 already-wired chat tools; **Phases 2–3
promote the best of these ~54** (recompete/forecast search, subaward/teaming trees, agency
pain-points, the decision layer, structured podcast search, and the narrative endpoints — those
are the un-exposed crown jewels). Two identity postures to preserve on promotion: Tier-0 (pipeline/
vault) binds `email` server-side; BigQuery tools carry the `liveBq` + `checkRateLimit` cost gate.

---

## 5. Data — you already have most of it; the SHORT net-new list

**Reframe (Eric's question "what other data should I add?"):** After the Data Core audit, the
honest answer is **you don't have a data-gap problem — you have a data-*exposure* problem.** ~60+
capabilities already exist (§4a) across SAM opps, USASpending/BigQuery (317K recipients, subawards,
executives), forecasts (multi-agency scrapers), grants, SBIR, DIBBS, federal contacts, agency
pain-points, SBA goaling, pricing/labor rates, and the teaching corpus. **First move = expose what
you have, not ingest more.**

That said, there IS a small, high-value net-new list — and it clusters around **one theme the
current stack can't do: see DEMAND before it hits SAM.** Everything you have today answers "what's
open/awarded now." These additions answer "what's *coming*" — a pitch no data-mirror competitor
(Tango included) can make.

### 5a. ADD THESE (net-new, ranked) — the "demand before SAM" wedge
| # | Source | Why (the intelligence, not the data) | Effort |
|---|---|---|---|
| 1 | **SEC EDGAR** (`data.sec.gov`, free, no key) | Public-contractor financials → "incumbent is a $2B public co, 60% gov-dependent, margins under pressure." Turns an incumbent name into a competitive read. *Eric's DLA-Ciber cite.* | **Low** |
| 2 | **Federal Register + Regulations.gov** (free API) | A new/proposed rule (e.g. CMMC) creates a services surge **months before** solicitations exist. **The core demand-before-SAM signal.** | **Low-Med** |
| 3 | **Congress.gov appropriations** (free API) | What Congress *funded* = 6–18 mo leading indicator of agency buying, further upstream than the Federal Register. | **Med** |
| 4 | **GAO bid-protest decisions** (gao.gov) | Which awards are contested, who protests & wins → a *risk* signal on a pursuit. (Tango exposes protest records; we add the pattern.) | **Med** |
| 5 | **GSA CALC labor rates** (free) | Price-to-win benchmarks by labor category. We already have *some* pricing intel — CALC deepens it, and Tango tier-gates it (we undercut). | **Low** |

*(1, 2, 5 are low-effort + high-signal → do first. 3–4 next.)*

### 5b. LATER / lower-priority net-new
FPDS Atom feed (historical granularity) · USAJobs + org charts (BD targeting) · **Lobbying
disclosure (Senate LDA) / FARA** (who's influencing a program — highest "didn't know I needed it"
factor, but longer tail).

### 5c. ALREADY HAVE — just expose (do NOT re-ingest)
USASpending awards/subawards (BigQuery) · SAM opps + forecasts · Grants.gov · SBIR · DIBBS · SBA
goaling · federal contacts · DODAAC directory · NAICS vocabulary · agency pain-points/SAT · pricing/
labor rates (partial) · the teaching corpus. *(Full list = §4a. Exposing these is Phase 1–3, not a
data project.)*

---

## 5-OLD. (superseded) Data-source expansion — 15 candidates

*(Kept for reference; the ranked, deduped version is §5 above.)* ✅ = we already ingest it;
🟡 = partial; ⬜ = net-new.

**Tier 0 — the PROPRIETARY sources that ARE the moat (§1a) — expose FIRST, no one can copy:**
- ✅ **GovCon Giants teaching corpus** (`mindy_rag_chunks` 12,564 chunks / 414 podcast episodes)
  — an MCP tool like `get_winning_playbook(topic)` grounded in Eric's actual coaching transcripts.
  Tango has NOTHING like this. This is the headline of the MCP, not a footnote.
- ✅ **Hand-curated agency pain-points / SAT-friendliness** (`agency_intelligence`,
  `agency-pain-points.json`) — `get_agency_intel(agency)` returns WHY they buy + whether a new
  entrant can win, mapped to NAICS. Editorial IP.
- ✅ **Recompete intelligence** (`recompete_opportunities`, 9,481 rows, computed likelihood) —
  incumbent + re-compete timing SAM doesn't publish.
- ✅ **SOW extraction + embeddings** (13,372 opps w/ scope text, semantic "hidden work" search).

**Tier A — strong public/derived, mostly already-held:**
1. ✅ **USASpending awards + subawards** (BigQuery, ~317K recipients / 1M subawards) — who won
   what, teaming trees. *Have it; expose the COMPUTED rollup, not raw rows.*
2. ✅ **SAM.gov opportunities + forecasts** (124K opps enriched, ~10K forecasts) — *have it;
   enriched-only per §1a.*
3. ✅ **SBA goaling** (`sba_goaling`) — which agencies MISS their small-biz goals → where a SB is
   structurally advantaged. Tango doesn't frame this as intelligence. *Have it.*
4. ⬜ **SEC EDGAR** (`data.sec.gov`, free, no key, 10 req/s) — public-contractor financials
   (revenue, segment gov-vs-commercial, 10-K risk factors). *Eric's DLA-Ciber cite.* Turns
   "who's the incumbent" into "the incumbent is a $2B public co deriving 60% from this agency —
   here's their margin pressure." **High-value, low-effort.**
5. ⬜ **GAO bid-protest decisions** (gao.gov) — who protests, what wins, which awards are
   contested → risk signal on a pursuit. Tango exposes protest *records*; we'd add the *pattern*.

**Tier B — strong intelligence, moderate effort:**
6. ⬜ **USASpending "budget/account" (TAS) data** — agency money by program → forecasting spend
   before it hits SAM.
7. ⬜ **Federal Register + Regulations.gov APIs** (free) — proposed/final rules that create
   demand (e.g. a new CMMC rule → cyber-services surge). Demand *ahead* of solicitations.
8. ⬜ **Congress.gov / appropriations** (free API) — what Congress funded → 6–18mo leading
   indicator of agency buying.
9. ⬜ **GSA CALC labor rates** (free) — price-to-win benchmarks by labor category (Tango
   tier-gates this; we can undercut).
10. ⬜ **GSA eLibrary / Schedules** — which vehicles a contractor holds → teaming/vehicle fit.
11. 🟡 **DIBBS / DLA RFQs** (`dibbs_rfqs`, pilot) — micro-purchase entry point. *Partial; finish
    + expose.*

**Tier C — enrichment / longer tail:**
12. ⬜ **FPDS Atom feed** (legacy but live) — historical award granularity USASpending lags on.
13. ⬜ **Grants.gov** (free) — $700B+ assistance side for firms that also chase grants.
14. ⬜ **USAJobs + agency org charts** — who the decision-makers are (BD targeting).
15. ⬜ **Lobbying disclosure (Senate LDA) / FARA** (free) — who's influencing a program → the
    real competitive map. *Highest "they didn't know they needed it" factor.*

*(Content angle for each: "You didn't know you needed X — here's what Mindy MCP does with it.")*

---

## 6. Scope

**In scope (v1 MVP):**
- [ ] MCP server (HTTP) exposing **public + intelligence tools only** (Tier 1 + Tier 2). NO
      private pipeline/Vault in v1 (Eric's call 2026-07-11 — ship fast, zero new PII edge).
- [ ] API-key issuance/verification + `mcp_api_keys`.
- [ ] Prepaid credit ledger + debit-on-success + `get_balance` tool + per-tool price metadata.
- [ ] Stripe credit top-up.
- [ ] `_ai_hint` narration on every tool.
- [ ] `getmindy.ai/mcp` self-serve dashboard.
- [ ] SEC EDGAR (#4) + GAO protests (#5) as the two flagship "beyond Tango" net-new sources.
- [ ] Reuse the Tier-2 cache-first cost guard so warm hits are cheap.

**Out of scope (defer):**
- Private Tier-0 tools (pipeline/Vault) over MCP → **phase 2**, behind explicit per-key scopes
  + audit logging + `requireStrongAuth`-equivalent. (The differentiator, but the PII stakes
  demand its own hardening pass.)
- Data sources #6–#15 → phased after v1 proves adoption.
- Embeddings/vector-search endpoint (was Layer 3 in the old PRD) → later.
- Usage-based *postpaid* Stripe metering → we chose prepaid credits; revisit only for enterprise.

**Dependencies:**
- `@modelcontextprotocol/sdk` (new dep).
- Hand-run migrations (3 tables) — clipboard → paste → verify.
- Stripe credit-product + webhook for top-ups.
- `mcp.getmindy.ai` subdomain + Vercel routing.

---

## 7. Acceptance criteria (the QA gate — prove it before shipping)

- [ ] A fresh user can: generate a key → buy credits → drop into Claude Desktop `mcp.json` →
      ask "biggest DOD 541512 opps under $250K closing in 30 days" → get a correct, `_ai_hint`-
      narrated answer → see credits debited by the right amount, **on success only**.
- [ ] **USP guard: no MCP result is a bare SAM record.** Every `search_sam_opportunities` result
      carries at least the enrichment SAM itself doesn't return (SOW text OR POC OR
      incumbent/recompete signal) + an `_ai_hint`. Diff an MCP result against the raw SAM API
      response for the same notice — they must NOT be identical. (If they are, we've shipped a
      commodity proxy, not the moat — §1a.)
- [ ] A revoked key is rejected; a zero-balance key is rejected with a clear "top up" message.
- [ ] `get_balance` returns the live balance; a failed tool call debits **0** credits.
- [ ] Every number in an `_ai_hint` is traceable to the real returned data (spot-check 10 calls
      vs the DB/BQ source — process rule #1 & #2).
- [ ] A cold BigQuery scan is rate-limited (can't be looped to run up our BQ bill) — verify the
      Tier-2 guard carries over to the MCP edge.
- [ ] SEC EDGAR + GAO tools return live, correct data (spot-check against sec.gov / gao.gov).
- [ ] Load: 100 concurrent tool calls don't corrupt the ledger (balance is consistent — the
      debit is atomic).

---

## 8. Estimated effort (phased)

- **Phase 0 — spike (½–1 day):** stand up a bare MCP server wrapping ONE existing tool with a
  hardcoded key, no billing, to prove the transport + that Claude Desktop can call it. **Wrap the
  PLAYBOOK tool (the RAG corpus retrieval — `get_winning_playbook(topic)` over `mindy_rag_chunks`),
  NOT `search_sam_opportunities`** (Eric, 2026-07-11). Rationale: the very first thing we prove
  should be the **un-copyable** part of the moat (§1a) — an agent answering "how do I win an 8(a)
  construction recompete" grounded in Eric's actual coaching transcripts. If the spike wrapped SAM
  search, we'd be demoing the commodity layer competitors already have; wrapping the playbook demos
  what only Mindy can do, and validates the RAG retrieval path over MCP end-to-end. *De-risks the
  whole thing cheaply AND proves the differentiator first.*
- **Phase 1 — auth + ledger (core, ~1 wk):** `mcp_api_keys` + credit ledger + debit-on-success +
  Stripe top-up + the `/mcp` dashboard. Expose the existing Tier-1/2 tools. `get_balance`.
- **Phase 2 — intelligence + net-new data (~1 wk):** `_ai_hint` narration on all tools + SEC
  EDGAR + GAO protests. This is where it beats Tango.
- **Phase 3 — content flywheel + launch:** the video/thread series showing wild builds; public
  docs; landing page positioning.
- **Phase 4 (later):** private Tier-0 tools behind scopes; data sources #6–#15; embeddings.

---

## 9. Risks + open questions

- **R1 — Credit pricing math.** Set per-tool credit costs so we're margin-safe on BigQuery
  (the one real variable cost) but still cheap vs Tango. Needs a real cost model before launch
  (measure BQ $/scan, price credits above it). *Owner decision.*
- **R2 — Abuse / bill-run-up.** An API key looping cold BQ scans = our cost spike. Mitigated by
  reusing the Tier-2 rate-limit + per-turn cap at the MCP edge, + debit-before-expensive-op.
- **R3 — `_ai_hint` accuracy = the whole moat.** If a narrated conclusion is ever wrong, we've
  shipped a hallucination as "intelligence." Every hint fact must be computed from real data,
  never LLM-guessed; caveats must be explicit. This is the #1 quality gate.
- **R4 — Cannibalization?** Does an MCP that answers everything reduce reasons to use the Mindy
  web app? Likely NO — different buyer (dev/agent-native vs UI user), and MCP is a *new* revenue
  line + top-of-funnel (they discover Mindy via MCP, upgrade for the workspace). Frame as
  land-and-expand, not substitution.
- **Q1 — Free tier? ✅ RESOLVED 2026-07-13: 100 credits, ONE-TIME trial (not monthly).**
  Higgsfield gives 150/mo, but that's a *consumer* retention/virality engine. Mindy MCP is a
  B2B intelligence tool — a perpetual monthly free grant just leaks margin-heavy BQ scans to
  non-payers. B2B API norm (Twilio/Algolia/OpenAI) = one-time trial credits, then metered pay.
  Free = 100cr on first connection key (≈ 4 capable-scans / 20 profiles / 100 SAM searches) —
  enough to run one real evaluation, then buy a pack.

  **⚠️ CORRECTION (2026-07-13):** the R1 "$1=100 credits / $10=1,000cr" table above was a
  THEORETICAL peg written without checking that real Stripe packs already shipped 2026-07-12.
  The LIVE packs (`src/lib/mcp/packages.ts`) are the source of truth and are priced RICHER:
  **Starter $5=250cr · Plus $15=800cr (7% bonus) · Scale $40=2,400cr (20% bonus)** — ~$0.017–0.020/cr,
  a 10–12× markup on the measured capable-scan. Keep the R1 table's *per-tool credit weights*
  (1/1/5/25/2), but the $/credit and pack tiers are the LIVE packs, not the peg. Additionally,
  **Pro ($149/mo) bundles 1,000 MCP credits/mo** (`PRO_MONTHLY_CREDITS`) — so the real model is
  hybrid: free 100 one-time trial → prepaid packs (pay-as-you-go) → Pro sub includes a monthly
  allowance. No monthly stipend for the FREE tier; Pro's monthly credits are a paid-sub perk.
- **Q2 — Key scope model for phase 2.** When private data comes, scopes must be explicit
  (`read:opportunities`, `read:my_pipeline`, …). Design the `scopes[]` column now even if v1
  only issues public scopes.
- **Q3 — Pricing vs Tango.** Tango doesn't publish prices (contact-sales). We can win on
  *transparent, self-serve, prepaid* — a GTM advantage. Confirm the $1=N credits rate.

---

## 10. Decision log

- **2026-07-11** — Supersedes the May-22 `PRD-mindy-as-ai-data-layer.md`: same thesis, but the
  Chat v2 Data Core is now BUILT, so this is packaging not construction; and Tango has since
  launched, defining the competitor to beat.
- **2026-07-11** — **Data Core audit: ~60+ queryable capabilities already exist, only 6 wired into
  chat (§4a).** MCP tool catalog is a *promotion* job. Crown jewels un-exposed: recompete/forecast
  search, subaward/teaming trees, agency pain-points, the pricing/bid-no-bid/why-fit decision
  layer, structured podcast search (NAICS/agency/set-aside filters), narrative endpoints.
- **2026-07-11 (Eric)** — **"What data to add?" resolved (§5):** it's an *exposure* problem, not a
  data gap. Expose the ~60 you have first. Net-new list is SHORT and themed **"demand before SAM"**:
  SEC EDGAR + Federal Register/Regulations.gov + Congress appropriations + GAO protests + GSA CALC
  (do EDGAR/FedReg/CALC first — low effort, high signal). This is the pitch no data-mirror can make.
- **2026-07-11 (Eric)** — v1 exposes **public data + intelligence only**; private pipeline/Vault
  deferred to phase 2 behind scopes. (Ship fast, zero new PII edge.)
- **2026-07-11 (Eric)** — Metering = **prepaid credit ledger** (Higgsfield model), not flat tiers
  or postpaid metered Stripe. "They buy tokens."
- **2026-07-11** — Positioning locked: **intelligence, not data** — carry the `_ai_hint`
  pre-narration forward from the old PRD as the core wedge vs Tango.
- **2026-07-11** — Flagship net-new sources = **SEC EDGAR** (Eric's DLA-Ciber cite) + **GAO
  protests**; full 15-source list ranked by value÷effort in §5.
- **2026-07-11 (Eric)** — **USP resolved (§1a):** raw SAM search is NOT the moat (SAM API is
  free/public). USP = enrichment welded to each opp (extracted SOW, POC, set-aside norm) +
  DERIVED intelligence SAM can't publish (recompete/incumbent, 317K BQ rollup, SBA-goaling) +
  the PROPRIETARY GovCon Giants corpus + hand-curated agency pain-points + `_ai_hint`. **Design
  rule locked: the MCP NEVER returns a bare SAM record — enriched-only, or we hand competitors
  our positioning.**
- **2026-07-11 (Eric)** — **Phase 0 spike wraps the PLAYBOOK tool** (`get_winning_playbook` over
  the RAG corpus), NOT SAM search. The first thing we prove should be the un-copyable moat, not
  the commodity layer. See §8.
- **2026-07-11** — **Moat inventory verified by codebase audit** (ranked, with live counts):
  Tier-1 PROPRIETARY = RAG teaching corpus (**1,386 docs / 12,564 chunks / 414 podcast episodes**)
  + hand-curated agency pain-points/SAT DB (`agency_intelligence` 557 rows) — un-copyable at any
  price. Tier-2 DERIVED = recompete (**9,481 rows**, computed likelihood), 317K BQ rollup
  (computed parent-merge + `match_score`), SOW extraction/embeddings (**13,372 opps**),
  naics_vocabulary (25,252 TF-IDF terms), federal_contacts (**162,922** extracted), forecasts
  (**9,973** unified). Tier-4 RAW-MIRROR (NOT a moat) = base `sam_opportunities`/USASpending rows,
  NAICS/PSC reference tables — table-stakes plumbing only. **Correction to first §1a draft:** the
  hand-curated agency pain-points DB is a proprietary Tier-1 asset (was under-weighted); corpus
  counts updated to the audited figures.
- **2026-07-12** — **Three "demand-before-SAM" MCP tools shipped (§5a):** `get_pricing_intel`
  (promoted existing GSA CALC client — *CALC was already built*, a promotion not a build), `get_incumbent_financials`
  (net-new SEC EDGAR client: name→CIK→XBRL companyfacts, public filers only, private→`grounded=false` honest miss),
  and `get_regulatory_demand` (net-new Federal Register client: the "demand before SAM" leading indicator).
  All three follow the Phase-0 `winning-playbook.ts` pattern (transport-agnostic pure fn + `_meta.grounded/degraded`
  always-ships). Registered in BOTH `tool-registry.ts` (hosted HTTP edge + credit metering, priced 1/2/1) AND
  `server.ts` (stdio dev/smoke). Verified live end-to-end via `scripts/mcp-smoke.mjs` (EDGAR Leidos CIK 1336920/
  $15.44B revenue/10-K 2026-02-17; Federal Register 15 items/218 total/FCC NG911 Rule; EDGAR private-miss grounded=false;
  playbook grounded). Smoke pricing-intel assertion is NON-FATAL on a transient upstream CALC 429 (the keyless
  CALC API rate-limits per IP; verified passing in a prior run).
- **2026-07-12 (Eric, data-first principle — supersedes the always-emit-`_ai_hint` plan):** the raw grounded DATA
  is the moat; nothing narrated ships until explicitly enabled. So `_ai_hint` is gated behind `mcpFlags.aiHint`
  (env `MCP_ENABLE_AI_HINT`, **OFF by default**) in all three tools + winning-playbook. `_meta` (grounded/degraded/
  counts) ALWAYS ships — machine-readable, the edge/agent branches on it. When enabled, every `_ai_hint` fact
  still traces to real returned data (no-fabrication contract intact). Deferred §5a sources: Congress.gov
  appropriations + GAO protests (built later). Branch `feat/mcp-data-core-sources` (isolated worktree off HEAD 6460210f);
  merge deferred until the parallel Phase-1 session stabilizes. Two migrations handed to Eric to run by hand:
  `20260712_mcp_external_cache.sql` (shared response-cache table, backs all three tools' TTL cache) +
  `20260712_mcp_data_sources_seed.sql` (idempotent `data_sources` seed for the 3 new live-API sources).

# GovCon SaaS Competitive Landscape — Mindy vs. the field (2026-07-29)

**Grounded in:** each competitor's public docs/pricing pages + third-party comparison data (every
third-party or unverified claim is flagged), and Mindy's verified codebase capabilities. Honest about
where each rival WINS — no Mindy cheerleading (rule #10). For roadmap + sales positioning + the exit
lens. Companion to the deeper single-competitor teardown:
`projects/edc-mbda-partnerships/COMPETITOR-HIGHERGOV-TEARDOWN.md`.

> ⚠️ **Pricing caveat, read first.** Half this market hides pricing behind a demo. Where a number is
> **vendor-published** it's marked ✅; where it's a **third-party buyer estimate** (comparison blogs) it's
> marked *(3P est.)* and is directional, NOT quotable as official. Several vendor pages 403'd on fetch —
> those are flagged inline. Don't put an unverified competitor price in a customer-facing deck.

---

## TL;DR — the two things that actually matter in 2026

1. **The field splits on AI, not data.** The legacy data platforms (GovWin, Bloomberg Gov, GovSpend,
   EZGovOpps) have minimal-to-scoring AI. The AI-native cohort (SweetSpot, Rogue, Procurement Sciences,
   HigherGov-post-acquisition, and GovTribe's recent moves) do drafting/capture/agents. **Mindy lives in
   the AI cohort** — and its wedge inside that cohort is *grounded generation with provenance* + a *true
   free tier* + *built for the solo/small contractor*, not the enterprise.

2. **Consolidation is happening fast, and it defines the exit map.** **Procurement Sciences** now owns
   both an AI execution layer (**Rogue AI**, acq. Feb 2026) and a data platform (**HigherGov**, acq. May
   2026) — the clearest "own the whole stack" play in the category, funded by a **$30M Series B (2026)**.
   These aren't just rivals; they're the **likely acquirers** (memory `exit_strategy_brand_separation`).

**The one-liner:** *They out-cover and out-fund. Mindy out-reasons for the small contractor — grounded
answers + drafting, a real free tier, no enterprise price wall.*

---

## The whole field at a glance

| Provider | Category | AI depth | SLED | Entry price | vs. Mindy |
|---|---|---|---|---|---|
| **GovWin IQ** (Deltek) | Data + analyst research | Low (Smart-Fit scoring) | ✅ deepest | ~$29K/yr avg *(3P est.)* | Out-covers; no drafting; enterprise price |
| **Bloomberg Gov** | Policy/legislative intel | Unverified | Federal focus | ~$7.5K–$14K/yr *(3P est.)* | Different job (policy, not capture) |
| **HigherGov** | Data + CRM (now PSci) | New (bolted-on post-acq.) | ✅ 10K+ agencies | $500/yr solo ✅ | Out-covers; cheaper entry; Mindy out-reasons |
| **GovTribe** (GovExec) | Opp search + intel | ✅ growing (first GovCon MCP) | Partial (~22 states) | $1,350/yr ✅ | Closest on transparent price + MCP move |
| **GovSpend** (+Fedmine) | SLED spend/PO data | Analytics (not drafting) | ✅ SLED leader | ~$11.6K/yr *(3P est.)* | Different job (what govt paid) |
| **EZGovOpps** | Opp search (budget) | Minimal/unverified | ✅ add-on | $2,695/yr *(1-source)* | Search/alert tool, no AI |
| **SweetSpot** (YC) | AI capture + proposal | ✅ strong (end-to-end) | Unverified | Quote-only | **Direct AI rival** — no free tier, no public price |
| **Govly** (~$9.5M) | Teaming network + AI | ✅ intel/predictive | ✅ 6K+ sources | Free tier; ~$3K/yr *(3P est.)* | **Direct rival** on teaming + free tier |
| **Rogue AI** (→ PSci) | AI proposal writer | ✅ core (drafting) | Federal | $400/mo solo ✅ | **Direct AI-drafting rival**; now inside PSci |
| **Procurement Sciences** | End-to-end AI + data | ✅ deepest (agents) | ✅ | Quote-only ("$40K" illustrative) | **The consolidator / likely acquirer** |
| **Unanet** | Back-office ERP/CRM | Analytics only | N/A | ~$150K–$300K/yr *(3P est.)* | Different category (financials, not BD) |

*(GovConWire is a news outlet, not a SaaS platform — excluded.)*

---

## The three groups (how to think about them)

### Group A — Legacy data incumbents (out-cover, thin AI, enterprise price)
**GovWin IQ · Bloomberg Gov · GovSpend · EZGovOpps · HigherGov (pre-PSci)**

- **GovWin IQ (Deltek)** — the category gold standard. Analyst-sourced **pre-RFP forecasts** (claims 65%
  of opps identified before SAM.gov), the **deepest SLED** (claims ~95% of SLED spend, 100K+ agencies),
  46M+ federal transactions, 530K+ SLED contacts, labor pricing. AI is **scoring only** ("My Smart Fit
  Score") — not drafting. Pricing hidden; **~$13K–$119K/yr, ~$29K avg** *(3P est., Civic IQ / Fed-Spend)*.
  **Wins:** pre-RFP + SLED depth + trust. **Loses:** price, no AI drafting, overkill for a solo.
- **Bloomberg Government** — really a **policy/legislative/gov-affairs** platform; contract data is one
  module. Best-in-class federal news, appropriations, "Federal Funding Flow." **Its product detail pages
  403'd on fetch** — SAM/FPDS/subaward/SLED granularity + any AI are **UNVERIFIED**. Price ~$7.5K–$14K/yr
  *(3P est.)*. **Wins:** policy intel. **Loses:** not a capture/BD tool.
- **GovSpend (+ Fedmine)** — the **SLED spend-data leader**: actual purchase orders, bids, "what govt
  paid," pricing validation; federal via Fedmine (SAM/FPDS/subawards). AI = analytics, **not drafting**.
  Price hidden, ~$11.6K/yr *(3P est.)*. **Wins:** real PO/pricing history. **Loses:** spend-data, not a
  capture workflow.
- **EZGovOpps** — budget-tier federal + SLED (add-on) opportunity search from 1,000+ sites; 48K+
  IDIQ/program DB; recompete tracking. **AI minimal/unverified.** Federal from **$2,695/yr**, SLED add-on
  **$1,095/yr** *(one source — its pricing page 403'd; treat as single-source)*. **Wins:** cheap
  fed+SLED coverage. **Loses:** search tool, no AI/intelligence layer.

### Group B — AI-native challengers (Mindy's actual peer group)
**SweetSpot · Govly · Rogue · GovTribe**

- **SweetSpot (YC-backed)** — the closest thing to a direct competitor on *shape*: AI-native, "OS for
  GovCon," searches SAM/USASpending/FPDS/**DIBBS**, AI capability-matching, and an **AI Proposal Engine**
  that extracts Section C/L/M → auto compliance matrix → drafted sections (this is Mindy's Proposal
  Assist territory). **CMMC L2 + SOC 2 Type II.** **Pricing is quote-only — no public numbers; no free
  tier.** SLED **unverified**. **Wins:** end-to-end AI in one tool, security certs. **Loses vs Mindy:**
  no free tier (Mindy's daily alerts are free forever), no public price, provenance story unproven.
- **Govly (~$9.5M funding)** — differentiated on the **teaming network** ("AngelList for procurement") +
  broad **contract-vehicle coverage** (40+ GWACs/IDIQs, reseller visibility) + **6,000+ SLED sources**.
  Has a **free tier** (30-day-lookback). Paid ~$3K/yr Basic → ~$20K/yr Plus *(3P est. — Govly's own page
  shows only Free + demo-gated Enterprise)*. **Wins:** teaming + vehicle breadth + a free tier. **Loses
  vs Mindy:** younger dataset; drafting/grounded-answer depth is not its core.
- **Rogue AI (→ acquired by Procurement Sciences, Feb 2026)** — a focused **AI proposal writer**: RFP/RFI/
  RFQ/sources-sought/SBIR drafting, "Deep Dive" trains on YOUR winning proposals to write in your voice,
  Proposal Autopilot. **NIST 800-171 / CUI compliant.** Publicly tiered: **Solo $400/mo · Starter
  $500/mo (2 seats) · Professional $1,250/mo (5 seats) · Enterprise quote** (FedRAMP Mod). **Wins:** fast
  compliant drafting on your own content. **Loses vs Mindy:** drafting-only (no discovery/data/incumbent
  intel) — and it's now folded into PSci.
- **GovTribe (owned by GovExec)** — mid-market opp search over SAM/FPDS/USASpending + **the first GovCon
  MCP server (Feb 2026, 50+ tools)** and an AI research assistant. Transparent tiers: **$1,350 (fed) /
  $1,800 (+state) / $4,000 / $5,500 /yr** ✅. SLED partial (~22 states). **Wins:** clean tracking +
  transparent price + early MCP/AI. **Loses vs Mindy:** shallow SLED; drafting isn't its core; **Mindy's
  MCP is now a direct head-to-head — this is the closest competitor on the "GovCon-as-MCP" bet.**

### Group C — The consolidator + adjacent
**Procurement Sciences · Unanet**

- **Procurement Sciences ("Awarded AI")** — the **best-funded, deepest AI stack**: human-in-the-loop
  agents for qualification, capture strategy, drafting, compliance, pricing, gate reviews, evaluation.
  Post-acquisitions it owns **Rogue's drafting** + **HigherGov's data** = the only true
  discovery→capture→proposal→pricing platform. **$30M Series B; 3,000–3,500+ contractors, ~half the Top
  100, $100B+ AI-assisted awards; FedRAMP Mod + SOC 2 Type 2.** Quote-only ("$40K/yr" is an illustrative
  ROI-calc example, **not a list price**). **Wins:** owns the whole stack + funding + distribution.
  **Loses:** enterprise-oriented, hidden pricing, and **Rogue+HigherGov integration is still in-flight
  (execution/integration risk)** — a real, time-boxed opening for a focused challenger.
- **Unanet** — **different category**: back-office ERP/CRM (DCAA/FAR accounting, PPM, timekeeping), not
  discovery/capture. ~$150K–$300K/yr *(3P est.)*, 3,100+ orgs. Only relevant if comparing "whole GovCon
  software stack." Not a BD/capture rival.

---

## Where MINDY wins (the honest wedge — filter every roadmap idea through this)

The same wedge that beats HigherGov generalizes across the field. Mindy does **not** win on breadth,
funding, SLED, or feed count. It wins on:

1. **"Answers, not a database" — grounded generation with provenance.** The data incumbents give you
   dashboards to interpret; Mindy *answers the question and drafts the response*, and **every figure
   reconciles to USASpending/SAM with an as-of date** (the anti-"generic AI" story). Even the AI cohort
   mostly can't cite its numbers to source — that provenance discipline (the M-Estimate/M-Win/M-Scale
   verification work; the `verify:m-scale` harness; the "grounded not fabricated" contract) is the
   defensible differentiator. (Memory `ground_in_real_data`, `mindy_product_principles`.)
2. **A true free tier.** Free daily alerts forever. GovWin/GovSpend/BGOV/SweetSpot have **no** free entry;
   the cheapest paid floors are HigherGov $500/yr, Rogue $400/mo, GovTribe $1,350/yr. Mindy's floor is $0.
3. **Built FOR the solo/small contractor.** Enterprise tools bury the solo user in features they never
   use; Mindy *starts* with the answer for one person (low-floor/high-ceiling). The whole field is
   enterprise- or mid-market-first.
4. **Agent-native from day one (MCP).** Mindy is a full MCP server (52 tools, grounded). Only **GovTribe**
   (50+ tools) is a real peer here; Procurement Sciences is agentic but closed. This is a live,
   defensible front — most incumbents can't expose their data to an agent, and the ones that can are
   racing to catch up.
5. **DoD office-roster depth + the incumbent spine** — DoDAAC-decoded rosters, award-detail
   (ceiling/expiry/vehicle/confidence). Specific, grounded, not a generic "contacts" table.

**Positioning line (sales/marketing):**
> "The incumbents sell you a database; the enterprise AI tools sell you a $40K seat. Mindy is the analyst
> who reads the government's own records for you — finds the opportunity, sizes up the incumbent on real
> award data, and drafts your response — starting free, built for one contractor, and grounded in the
> actual source every time."

---

## Where Mindy is genuinely behind (be honest — these are real gaps)

1. **SLED** — federal-only. GovWin/GovSpend/Govly/EZGovOpps all cover state & local. (Eric's call: **HOLD
   until Phase 3**; don't chase their breadth — see the HigherGov teardown.)
2. **Feed breadth** — DIBBS (SweetSpot + HigherGov have it; we shelved it, memory `dla_dibbs_not_feasible`),
   GSA Advantage / labor-rate pricing, subawards (SAM API blocked), 70+ forecast sources.
3. **Market presence & funding** — the incumbents have half the Top 100 and PSci has a $30M Series B.
   Mindy is early/growth (~$112K ARR, memory `mindy_100k_goal_math`).
4. **Security certs** — SweetSpot (CMMC L2 + SOC 2 II), Rogue (NIST 800-171/CUI), PSci (FedRAMP Mod +
   SOC 2 II) publish compliance certs. Mindy's CUI-custody story is strategy, not yet a cert (memory
   `cmmc_cui_custody_strategy`). For enterprise/CUI buyers this is a real blocker.

---

## The exit / acquisition lens (Eric's frame — Mindy is built to sell)

Competitors here are the **likely future acquirers**, and 2026 is an active-consolidation year — good for
the exit thesis (memory `exit_strategy_brand_separation`).

- **The consolidator is clear: Procurement Sciences** (Rogue Feb 2026 + HigherGov May 2026 + $30M Series
  B). Also watch **Deltek/GovWin**, **GovExec** (owns GovTribe), **Unanet** — all potential acquirers as
  the market rolls up. Acquisition prices were **UNDISCLOSED** in both PSci deals — don't cite a figure.
- **Valuation FRAMEWORK** (general, grounded — not competitor-specific): 2026 GovCon/vertical SaaS is a
  hot M&A category. ~3–4× ARR (undifferentiated) → **6–8× ARR (high-growth + AI + strong retention)**.
- **What it means for Mindy:** at ~$112K ARR, pre-scale for acquisition *today* — but the deals prove
  buyers exist and are paying for **AI + owned data + grounded execution**. The differentiation that wins
  customers (grounded generation, provenance, agent-native) is the **same thing that earns the 6–8×
  multiple**. Path to acquirable: grow ARR + prove retention + lean into the grounded-AI wedge.

---

## Roadmap implications (consider — NOT commitments; filter through `mindy_product_principles`)

- **Lead with the MCP + provenance wedge** — it's the one place Mindy is *ahead* of most of the field and
  hardest to copy. GovTribe is the only real MCP peer; press the "grounded, verifiable" advantage
  (the M-number verification harness is a marketing asset, not just an internal test).
- **Programmatic SEO** (from the HigherGov teardown) — the mass-acquisition engine none of the AI-native
  startups have built yet. Still the #1 steal.
- **Security certs (SOC 2 / CMMC path)** — the enterprise-blocker gap; sequence it against the CUI-custody
  strategy when moving upmarket.
- **Don't chase breadth-for-breadth** (SLED, DIBBS, 70+ feeds). Depth + grounded answers is the edge; feed
  count is a losing race against a $30M-funded consolidator.

---

## HONEST GAPS in this research (don't overclaim)

- **Bloomberg Gov** product pages **403'd** — its SAM/FPDS/subaward/SLED depth and AI are **UNVERIFIED**;
  pricing is 3P-estimated only.
- **EZGovOpps** pricing page **403'd** — the $2,695 / $1,095 figures are from a single search excerpt; AI
  capability **unverified**.
- **Govly** mid-tier prices ($3K/$20K) are **3P** (Serchen/Extruct); Govly publishes only Free + demo-gated
  Enterprise.
- **SweetSpot** and **Procurement Sciences** publish **no** real price numbers (PSci's "$40K/yr" is an
  illustrative ROI-calc example).
- **All 3P pricing** (GovWin/BGOV/GovSpend/Unanet) is buyer-reported ranges from comparison blogs —
  directional, not quotable as official.
- **Rogue founder** name conflicts across sources; primary-source PR says **John Shahawy**.
- **Customer-review cons** (G2/Capterra) were **not** pulled per-competitor here — strengths/weaknesses
  are structural inferences from platform facts + primary sources, not cited user reviews. → TODO if a
  deeper teardown is needed.

*Sources are linked inline in the research notes backing this doc (each provider's own pricing/feature
pages + Fed-Spend / Civic IQ / RFP Recon / SamSearch comparisons + PR Newswire for the acquisitions).
Compiled 2026-07-29.*

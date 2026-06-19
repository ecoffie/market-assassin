# Competitor Teardown — HigherGov vs. Mindy (June 19, 2026)

**Grounded in:** HigherGov public docs/reviews + Mindy's verified codebase capabilities. Honest about
where each WINS — no Mindy cheerleading (rule #10). For roadmap + sales positioning.

## TL;DR
HigherGov is the **broad, established data+CRM platform** (deepest coverage, SLED, transparent low
entry price, just acquired by Procurement Sciences for AI-capture muscle). Mindy is the **AI analyst
that answers + drafts** (grounded generation: incumbent intel, MRR/proposal drafting, provenance).
**They out-cover; Mindy out-reasons.** Don't fight them on breadth — win on "answers, not a database."

## Big strategic shift (May 20, 2026)
**Procurement Sciences acquired HigherGov** → "largest AI-powered growth platform in GovCon."
HigherGov's data + PSC's Awarded AI (capture/proposal/pricing agents). **This makes them a direct
Mindy competitor on the AI-drafting front, not just data.** They were data; now they're data + AI
workflows. Watch the integration rollout.

## Side-by-side

| Dimension | HigherGov | Mindy | Edge |
|---|---|---|---|
| **Opportunity sources** | SAM, Grants, **DIBBS**, PIIE, NECO, SBIR.gov, JCCS, NIH boards | SAM (88K cached), Grants, SBIR/multisite (NIH/DARPA/NSF/DOE) | **HG** (more feeds, incl. DIBBS) |
| **SLED (state/local)** | ✅ **10,000+ agencies, 60K total** | ❌ federal only | **HG — big gap for Mindy** |
| **Award/awardee data** | FPDS, FSRS, USASpending, DSBS, GSA Advantage | USASpending (317K contractors, by UEI) | ~Even (HG has GSA Advantage pricing) |
| **Forecasts** | 70+ sources | 7,648 forecasts, 11 agencies | **HG** (more breadth) |
| **People / contacts** | people endpoint (name/title/role/org) | **125K POCs + DoDAAC office rosters** | ~Even / **Mindy** depth on DoD office rosters |
| **GSA Advantage / labor-rate pricing** | ✅ labor rates, GSA pricing | ❌ | **HG — gap for Mindy** |
| **Subawards** | FSRS | ❌ (SAM subaward API blocked) | **HG** |
| **Incumbent intel** | AI agent identifies incumbent/bidders | ✅ **award-detail spine: ceiling, expiry, vehicle, confidence** | ~Even / **Mindy** (deeper, grounded) |
| **AI drafting (proposals/MRR)** | now via PSC "Awarded AI" (post-acquisition) | ✅ **Proposal Assist + MRR generator, grounded in docs** | ~Even (was Mindy's; HG just bought parity) |
| **Provenance / "grounded not generic"** | data platform; AI new | ✅ **every figure cites source + as-of date** | **Mindy** (core differentiator) |
| **CRM** | ✅ built-in | Pipeline + Teaming CRM | ~Even |
| **Pricing** | $500 / $2,500 / $5,000 **per YEAR** | $149/**mo** ($1,788/yr) | **HG cheaper at entry** ($500/yr solo) |
| **Reach** | >half Top-100, 3,000+ contractors | early/growth | **HG** (incumbent) |

## Where HigherGov clearly WINS (be honest)
1. **SLED coverage** (10K+ state/local agencies) — Mindy is federal-only. Real gap.
2. **Breadth of feeds** — DIBBS, GSA Advantage pricing, labor rates, subawards, 70+ forecast sources.
3. **Entry price** — $500/yr solo vs Mindy $1,788/yr. They're cheaper to start.
4. **Market presence** — half the Top 100; trust + distribution Mindy doesn't have yet.
5. **Just bought AI-capture muscle** (PSC) — closed the "they're only data" gap.

## Where MINDY can WIN (the honest wedge)
1. **"Answers, not a database."** HG gives you data + dashboards to interpret. Mindy *answers the
   question* and *drafts the response* — incumbent analysis, MRR, proposal sections — grounded in the
   actual notice/docs. Low-floor/high-ceiling (memory `mindy_product_principles`).
2. **Grounded generation w/ provenance** — every number reconciles to USASpending/SAM, dated. The
   anti-"generic AI" story. HG's AI is new + bolted on post-acquisition.
3. **Built FOR the solo/small contractor** — HG's full value is the $2,500–$5,000 tier + setup; the
   $500 tier "stops at data, no drafting." Mindy *starts* with the answer for one person. (The same
   wedge the research found vs GovWin: small biz never uses 70% of enterprise features.)
4. **DoD office-roster depth** (DoDAAC-decoded rosters) + the incumbent spine — specific, not generic.
5. **Free daily alerts** — a true free tier (HG's floor is $500/yr).

## Positioning line (for sales/marketing)
> "HigherGov is a bigger database. Mindy is the analyst who reads it for you — finds the opportunity,
> sizes up the incumbent on real award data, and drafts your response. They give you data to
> interpret; Mindy gives you the answer, grounded in the actual government records."

## Roadmap implications (what to consider building — NOT commitments)
- **SLED** is the biggest coverage gap → decide: ignore (stay federal-focused) or add a state/local
  feed. (Filter through `mindy_product_principles` first — does it serve the core user?)
- **GSA Advantage / labor-rate pricing** — useful for pricing intel; a real gap.
- **Subawards** — blocked on SAM subaward API (memory `pursuit_attachments_pipeline` notes DDL/access
  constraints); revisit.
- **Don't chase breadth-for-breadth** — Mindy's edge is depth + grounded answers, not feed count.

## Open items
- [ ] Watch the PSC × HigherGov AI integration rollout (closes their drafting gap — our former moat)
- [ ] Decide SLED: in or out of Mindy's scope
- [ ] Price check: is $149/mo right vs their $500/yr entry? (separate pricing-benchmark task)
- [ ] Pull real HigherGov user-reported weaknesses (reviews) — the search didn't surface specifics

*Created June 19 2026. Honest teardown: HG out-covers (SLED, feeds, price, reach, now AI too); Mindy
out-reasons (grounded answers + drafting, solo-first, provenance). Compete on "answers not a database,"
not on breadth.*

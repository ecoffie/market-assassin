---
name: project_gcap_proposal
description: GCAP = Government Contractor Assistance Program (SBDC-affiliated); the real first org customer + proposal facts
metadata:
  type: project
---

**GCAP = Government Contractor Assistance Program**, an **SBDC-affiliated** org — the REAL first org/enterprise customer that anchors the [[project_org_enterprise_pricing]] $36K Single band.

**Confirmed profile (from the GCAP discovery questionnaire + conversation):**
- **8 counselors today, adding 4 → 12**; serves **~1,000 businesses**.
- **Funder = SBTDC / SBA** (SBDC network) — funding-fit angle is SBA/SBTDC reporting, NOT a chamber grant.
- **GCAP's core value = "building capability"** — move a business from an opportunity → an honest assessment of its ability to win → close the gap. A **progression** model, not a lead firehose.
- **Reporting is THE wedge:** "if Mindy produces the numbers you already have to report, it becomes the system that renews your funding, not just another tool." Progression milestones to track per business: SAM registration, certification (WOSB/HUBZone/8a), capability statement, first bid, first award.

> ## ⚡ 2026-07-14 UPDATE — FINAL send-ready model (SUPERSEDES the pricing/term/add-on lines below)
> The GCAP proposal was substantially restructured 2026-07-14. Where this section conflicts with the list below, **the list wins.** The narrative facts above (8→12 counselors, ~1,000 businesses, SBTDC/SBA funder, capability-progression wedge) are unchanged.
>
> 1. **Per-seat pricing, NOT a flat number pulled from thin air.** List = **$400/seat/mo** (the honest admin-tier price — the org/admin layer costs more to build+maintain than the self-serve Coach add-on; matching Coach's price gave the expensive product away). Discounted rate = **$250/seat/mo at 8+ seats** (volume + **state-funded/PUBLIC-SECTOR** rate — SBDCs are state-run, NOT nonprofit). GCAP: 8 = **$24,000/yr**, 12 = **$36,000/yr** (shown as a discount off the $57,600 list). $36K survives as GCAP's number but is now a *derived* discounted price, not a floating anchor. **5-seat minimum**; under 8 = $400/seat.
> 2. **TERM = 6-month initial, NO annual lock.** 3-stage: $0 30-day pilot → **6-month term** ($18K @ 12 / $12K @ 8, billed at $250/seat) → **month-6 joint economics review**, continue by mutual written agreement. Multi-year (2yr 8% / 3yr 12%) is now an OPTIONAL post-review lock-in, never required.
> 3. **Mutual termination for cause:** either party, in writing, for material non-performance/non-delivery; **30-day cure**; **pro-rata refund of unused prepaid**.
> 4. **Proposal Assist = FIXED $99/mo per-user add-on, NOT metered.** No credit-packs, no BYO-LLM (all that language removed). **Counselors get it INCLUDED with their seat**; **client workspaces don't have it by default — a client buys it directly at $99/mo/user** (client purchase, not billed to GCAP → add-on revenue outside the org license). NOTE: no fixed price was ever previously locked (this section + §4b said "metered/PENDING"); $99/mo/user is the 2026-07-14 decision of record.
> 5. **MCP / API credits** explicitly excluded from the license (separate Pro-member prepaid-pack product). MCP is **LIVE in prod**, not a spike.
> 6. **Recipient FILLED:** Jacquie Spearman (`jmspearm@ncsu.edu`), dated July 14, 2026. Send PDF = `docs/proposals/GCAP-Mindy-Proposal.pdf`.
>
> Full running log: [[project_gcap_proposal_sendready]] (memory).

**Pricing (ORIGINAL 2026-07-08 model — see the 2026-07-14 UPDATE above for the final version):** GCAP = **Single band, $36,000/yr** (anchor: 12 counselors × mgmt power ≈ 1,000 workspaces × $2.50–3/mo, all converge ~$36K). $0 **30-day** pilot is the land motion (shortened from 60d 2026-07-13 per Eric — 60d was too long a free runway; 30d still fits ~25-workspace onboarding + one funder-report cycle).

**Proposal doc:** `docs/proposals/GCAP-Mindy-Proposal.html` (built 2026-07-10, adapted from `USHCC-Atlanta-Mindy-Proposal.html`).

**Why:** GCAP validates or corrects the whole org pricing band when it closes — it's the first real deal. **How to apply:** never guess GCAP facts into a client-facing doc; the numbers above are confirmed, anything else is `[fill]`.

---

## ⚠️ INTERNAL — cost-to-serve (DO NOT put in client-facing docs) — computed 2026-07-13

**Variable/AI cost = trivial.** Even the worst case Eric worried about — counselors run a live Mindy demo for EACH of ~1,000 clients — costs ≤3% of revenue. One real demo/client/yr = $251 (99.3% margin); quarterly demos = ~$1,006 (97.2%); you'd need heavy MONTHLY demos across all 1,000 to reach 83%. Cache-first Tier-2 makes it even cheaper in practice. Proposal Assist (the one token-heavy feature) is separately metered/BYO-LLM so it can't eat the flat license. **Conclusion: tokens are never the GCAP risk.** ("Unlimited demos" reassurance line added to the client proposal.)

**HUMAN cost-to-serve = the ACTUAL risk.** At Eric's $500/hr opportunity cost, with the moderate estimate (25h one-time onboarding + 10h/mo = 120h/yr support):

| Delivery model | Year 1 net | Year 2+ net |
|---|---|---|
| **A. All-Eric** (Eric does onboarding + all support @ $500) | **−$37,506 (LOSES money)** | −$25,006 |
| **B. Eric onboards ($500), team supports ($50/hr)** | +$16,494 (46%) | +$28,994 (81%) |
| **C. Team does both ($50/hr)** | +$27,744 (77%) | +$28,994 (81%) |

**Break-even at $500/hr = just 72 Eric-hours/yr (6 hrs/month). The moderate all-Eric estimate is 145 hrs = $72,500 = 2× the revenue.**

**RULE for GCAP (and every future org): Eric LANDS + ONBOARDS it (worth it — flagship reference into the SBDC network), then RECURRING support MUST be delegated to a ~$50/hr team member/contractor.** The proposal now promises **quarterly** office hours (fixed 2026-07-14 — was "monthly," which would have silently eaten $6K+/yr of founder time if Eric ran it) + email/ticket support + guided kickoff + done-for-you cohort load + named onboarding contact. **The recurring pieces (ticket support, quarterly office hours) MUST be team-run/templated, NOT Eric** — Eric's time is the kickoff/onboarding only. The **6-month term (2026-07-14)** further caps this risk: if the support economics don't work, the month-6 review is the exit — no locked year of delivery obligation. Do NOT price org #2/#3 assuming Eric delivers personally — the model proves it doesn't scale past one. Full margin numbers in [[project_gcap_proposal_sendready]].

# Mindy CMMC / CUI Custody Strategy — Business Case

**Status:** Exploration / decision-ready draft
**Date:** 2026-07-12
**Owner:** Eric
**Origin:** A friend in BD at Microsoft raised the idea — NOT scraping controlled bids, but
building a *compliant environment where we hold contractors' CUI* and prove to the government
we're a trustworthy custodian (esp. since an incumbent custody vendor was breached). Then sell
Mindy into that trust gap.

> **One-line thesis:** The opportunity is to become the *certified, trustworthy custodian* of
> contractors' Controlled Unclassified Information (CUI) — a GCC High enclave with Mindy's
> GovCon intelligence layer on top — riding the CMMC mandate and a breached-incumbent opening.
> This is a **separate, higher-commitment business** than today's commercial Mindy, but the AI
> long-pole is solvable (Azure OpenAI is authorized in GCC High), and a **partner-first bridge**
> captures most of the upside at a fraction of the audit risk.

---

## 1. The market — real, large, time-boxed

| Fact | Figure | Source |
|---|---|---|
| DIB orgs needing **CMMC Level 2** | **80,000+** by Nov 2028 phased deadline | Cyber AB marketplace / secureframe |
| **C3PAO assessors that exist** | **only ~97** (Jan 2026) | Cyber AB |
| CMMC L2 cert cost, year 1 (small biz avg) | **~$138K** (range $75K–$300K) | secureframe / cabrilloclub |
| C3PAO assessment portion (3-yr cycle) | **$105K–$118K** | preveil / elevateconsult |
| Assessment = share of total cost | only **25–40%** (infra is the bigger line, 30–40%) | secureframe |
| GCC High licensing | **~$60/user/mo (G3), ~$93 (G5)**; Azure Gov ~15% premium | secureframe / ecfdata |
| Maintenance | **20–30% of yr-1 cost annually** | secureframe |

**Why the timing is a window:** 80,000 companies need L2, only 97 assessors exist, most SMBs
are nowhere near ready, and the deadline is phasing in through Nov 2028. Massive supply/demand
gap. GovCon Giants already ranks for "CMMC certification" (our own guide is a top search result)
— we have **content authority + audience** in this exact space already.

**The breached-vendor wedge:** when a CUI-custody vendor is breached, their customers must move
FAST to a trustworthy replacement. "We're the custodian that didn't get breached, and we're
GovCon-native" is a sharp, urgent pitch — not a cold sell.

---

## 2. The key reframe — this is TWO products

| | **Product A — Mindy (today)** | **Product B — CUI Custody Enclave** |
|---|---|---|
| What | AI GovCon intelligence on PUBLIC data | Certified place to STORE/collaborate on contractors' CUI |
| Data | Public (SAM, USASpending, forecasts) | CUI (proposals, ITAR, controlled drawings) |
| Environment | Commercial (Vercel/Supabase/OpenAI) | **GCC High / Azure Government** |
| Business model | SaaS subscription ($) | Managed service / infra ($$$, per-user) |
| Competes with | HigherGov, GovWin | PreVeil, GCC High MSPs, Virtru |
| Certification | none needed | **CMMC L2 (C3PAO-audited)** |
| Risk | low | high (custody liability + audit) |

Eric's friend is describing **Product B**. It is a different company than Mindy — different
buyers, model, competitors, risk. That's not a "no"; it's a scope-honesty flag.

---

## 3. The AI long-pole — SOLVED (the plan-changing finding)

The obvious blocker was: *Mindy is AI, and commercial OpenAI/Groq/Claude can NEVER touch CUI.*
So does the enclave have to be AI-free?

**No.** Research (2026): **Azure OpenAI is authorized inside Azure Government / GCC High** —
FedRAMP High + DoD IL4/IL5 (Sept 2024), and GPT-4o cleared to IL6/Top-Secret (Jan 2025). AI
models are containerized within GCC High so contractors can "summarize research, analyze supply
chain risks, draft technical specs without risking CUI integrity."

**Implication:** Mindy's AI intelligence layer CAN run compliantly on CUI inside GCC High via
Azure OpenAI. Product A and Product B are NOT forced apart by the AI constraint. The moat becomes
**"the only GovCon AI that can also legally sit on your CUI."** (Must still confirm current
Azure OpenAI GCC High GA + model list with an AOS-G partner — cited as authorized, verify the
specific region/model before committing.)

---

## 4. Build vs. Partner — the decision that sets the risk

- **DON'T build the compliant cloud.** Microsoft already built GCC High (FedRAMP High). Building
  a FedRAMP-authorized environment from scratch = years + millions. Never.
- **Option A — Resell/wrap a GCC High tenant** (via an AOS-G / CSP partner): stand Mindy up inside
  GCC High, inherit most of Microsoft's authorization boundary, own only the app-layer controls.
  Realistic: months + six figures.
- **Option B — Partner-first bridge (RECOMMENDED FIRST):** Mindy stays the commercial GovCon
  **intelligence + CMMC-readiness front door**; partner with an ALREADY-certified GCC High
  provider for actual custody; revenue-share. Win breached-vendor customers now WITHOUT the
  $150K/12–18mo/C3PAO audit bet. Convert to owned enclave only once demand is proven.

---

## 5. The C3PAO gate (if we own the enclave)

To *sell CUI custody* you need CMMC L2 **certified** (third-party assessed), not self-attested:
1. Implement all **110 NIST SP 800-171 controls** in GCC High.
2. System Security Plan (SSP) + POA&M documentation.
3. **C3PAO assessment** (~97 exist, booked 9–12 mo out — start selection early).
4. Pass → 3-year certification, annual affirmations.

---

## 6. Recommended phased path

1. **Validate (weeks):** friend's specific breached-vendor lead + 3–5 DIB contractors — is the
   pain urgent enough to pay to switch custodians? How many? At what price?
2. **Ship the readiness layer (weeks, current stack, NO CUI):** a CMMC-readiness module in Mindy
   — 110-control self-assessment, computed SPRS score, gap → POA&M → roadmap. Sellable to the
   same 80K SMBs immediately; **qualifies enclave leads** (low scorers = future custody buyers);
   de-risks the enclave decision. Low cost, low risk, high fit, leverages GovCon Giants authority.
3. **Partner for custody (months):** integrate a certified GCC High provider as the CUI vault
   behind Mindy's front door. Revenue-share. Serve breached-vendor customers.
4. **Own the enclave (12–18mo, $150K+) ONLY IF** steps 1–3 prove sustained demand — and even
   then evaluate wrap-vs-build. Bring the AI in via Azure OpenAI GCC High.

**Do NOT** invert this (build enclave first). That's a $150K+, audited, liability-heavy bet on
an unvalidated market. Readiness-tool-first is the measure-before-build discipline applied to a
strategy decision.

---

## 7. What to explicitly NOT do
- Do NOT ingest/scrape controlled or CUI bid content into commercial Mindy (violation + poisons
  the compliance story).
- Do NOT let CUI touch commercial OpenAI/Groq/Claude endpoints — Azure OpenAI GCC High only.
- Do NOT accept redistributed leads from the friend's portal without reading ITS terms (many
  such portals forbid redistribution; that could breach his employer's agreements).
- Do NOT build a FedRAMP environment from scratch — wrap Microsoft's.

---

## 8. Open questions to resolve before committing
- [ ] Confirm current Azure OpenAI **GCC High** GA + available models (AOS-G partner call).
- [ ] Identify a candidate certified GCC High **partner** for the bridge model.
- [ ] Friend's breached-vendor lead: who's the incumbent, how many customers in play, timeline?
- [ ] Validate willingness-to-pay with 3–5 real DIB contractors.
- [ ] Legal read on the friend's portal terms (redistribution).

---

*Sources: secureframe.com/hub/cmmc, preveil.com/blog/cmmc-certification-costs,
cabrilloclub.com/insights/cmmc-certification-cost-guide, ecfdata.com/gcc-high-pricing-in-2026,
secureframe.com/blog/gcc-high-pricing, devblogs.microsoft.com/azuregov (Azure OpenAI
authorization), nextgov.com (Azure OpenAI IL6), govcongiants.com/guides/cmmc-certification.*

# AFWERX Open Topic Phase I — Qualification Checklist

**Goal:** Know exactly what gates we must clear to submit a *valid* AFWERX Open Topic Phase I — and which gates have lead times that decide whether we can even make a given window.
**Owner:** Eric → FT Head of Partnerships & Funding
**Status:** Verified June 15, 2026 — grounded in live AFWERX/SBIR/SBA sources (see Sources)
**Companions:** `GOVT-GTM-STRATEGY.md` (why one SBIR — the Phase III key), `AFWERX-SBIR-READINESS.md` (product hardening), `AFWERX-ENDUSER-OUTREACH.md` (end-user emails)

> ## ⚠️ FINDING (June 16, 2026 — checked live on DSIP): NO Open Topic this cycle
> Logged into DSIP and reviewed the **DoW SBIR 2026 BAA (65 topics, Releases 2 & 3, pre-release/open,
> close 06/24 & 07/22/2026)**. **Every topic is a SPECIFIC topic** (defined problem: hydraulic heating,
> hyperspectral imagers, Rydberg sensors, lithium batteries, etc.). **The tech-agnostic AFWERX Open
> Topic is NOT in the FY2026 DoW SBIR** — searching "open" returns only "Open *Architecture*" sensor
> topics, not the Open Topic program. Consistent with the 2026 SBIR/STTR reauthorization disruption.
> **→ There is no current AFWERX topic that fits Mindy (a market-intelligence SaaS).** Do NOT force a
> submission into a specific topic we don't match (readiness-doc rule). **Pivot near-term to the
> DIRECT COMMERCIAL BUY track (`GOVT-GTM-STRATEGY.md`) with the 3 warm contacts; monitor DSIP for the
> next Open Topic release.** Registration prep (SBC ID + DSIP — already done logging in) still stands
> so we can move the day an Open Topic opens.
>
> ## ⭐ STRONG LEAD — `DLA26BZ03-NV012` (read the full topic; it's a REAL fit, June 16)
> "AI-Powered Tool for Automated Evaluation of **Vendor Economic Dependency**" — DLA, **closes
> 07/22/2026**, **Phase I $100K/12mo → Phase II $1M/24mo**. TPOCs named: Shea McCullough, Corey Cook,
> Matthew Borsinger. **This may be a BETTER path than the Open Topic ever was** — customer (DLA) already
> attached (no end-user hunt), more money, longer runway.
> - **Core ask = Mindy's engine:** identify a vendor universe from contract data, pull public financials
>   (SEC EDGAR 10-Ks, **SAM.gov** — our source), compute **economic dependency % = vendor's federal $ /
>   total revenue**, flag related-party/concentration risk by contract type. Verified: the numerator
>   (federal $/vendor by UEI) is NATIVE to Mindy (e.g. McKesson $84B, Pfizer $28B fed obligated); the
>   denominator = 10-K revenue. The dependency join is what we're built for.
> - **Gaps to close (real):** (1) **US-person team** — topic is **ITAR**-restricted (must disclose any
>   foreign nationals + their SOW tasks); (2) **CMMC Level 2 (Self)** self-attestation; (3) **SFFAS-47 /
>   federal-accounting SME** — the topic is anchored in federal financial-accounting standards + audit
>   readiness, which is NOT Mindy's domain → need an accounting/audit teammate or advisor for
>   credibility; (4) reframe the pitch as "vendor economic-dependency analysis," not "Mindy as-is."
> - **Bonus:** gives the AFDW SBP outreach a CONCRETE topic to reference, and our warm DISA contact +
>   DoD partnerships motion are DLA-adjacent.
> - **Action:** decide go/no-go before 07/22; if go → secure the SFFAS-47 SME + confirm US-person team +
>   CMMC L2 self-attest, then write Phase I on the mandatory template (proof-of-concept: DLA vendor
>   universe → EDGAR pull → dependency criterion → golden dataset).
>
> **One-line answer (registration mechanics, still valid for when an Open Topic opens):** We almost certainly *already* qualify as a business (US-owned, <500 employees, for-profit). The real work is **(1) the registration stack** — SAM + CAGE/UEI + the SBC ID on SBIR.gov + a DSIP account — which has **multi-week lead times**, and **(2) submitting on the mandatory proposal template** during an open window. There is **no customer/end-user requirement at Phase I.**

---

## DECIDED — the applicant entity (June 15, 2026)

**The SBIR applicant is GovCon Edu (Eric's for-profit), "developer of Mindy." Use GovCon Edu's SAM.**

- ❌ **NOT the GovCon Giants nonprofit** — SBIR is for-profit only; the nonprofit fails eligibility. (The nonprofit is the vehicle for the *other* grants — SBA GAFC/PRIME/EDA/MBDA per `FUNDING-STRATEGY.md` — not SBIR.)
- ❌ **Do NOT create a new "Mindy" entity for the SBIR.** Reasons: (1) a new entity = a cold 4–6 wk SAM/UEI/CAGE start → blows the AFWERX window; (2) SBIR cares about the *legal applicant*, not the product name — "Mindy" is a product GovCon Edu owns; (3) a new entity has **zero past performance** (GovCon Edu carries the TX/FL state contracts + operating history) → weaker applicant; (4) the **Phase III sole-source key** attaches to the winning entity — we want that to be the real operating company.
- ✅ **GovCon Edu** is the applicant; its SAM/UEI/CAGE go on the SBC registry, DSIP, and the proposal. **Mindy does not get its own SAM.**
- **If Mindy is ever spun into its own entity** (the `exit_strategy_brand_separation` play), that's a deliberate M&A/IP-assignment move done **with counsel at sale/raise time** — SBIR + Phase III rights transfer with the IP via novation/assignment. **Decoupled from this SBIR; do not trigger it to file.**

**✅ SAM CONFIRMED ACTIVE (June 15, 2026):** Eric confirmed **GovCon Edu's SAM is renewed/active**. This clears the slowest gate (the 4–6 wk cold start is OFF the table). GovCon Edu already has its UEI + CAGE. **R3 (closes Jul 22) is now reachable.** Remaining registration steps are fast: SBC ID (minutes, needs active SAM — ✅ have it) + DSIP account.

**Note:** the **MCP** SAM tool (`mcp__samgov__search_entities`) returned 401 June 15 2026 — but that's the standalone MCP server's own key, NOT the app. The **app reroutes across a rotated SAM key pool** (`SAM_API_KEY`, `SAM_API_KEY_1..N`, rotated daily in `src/lib/sam/utils.ts`; entity uses `SAM_ENTITY_API_KEY` → rotated-key fallback). So Mindy's live entity search is NOT necessarily broken — only the MCP path is. Not a blocker for SBIR (Eric confirmed SAM directly) and not used by either gov demo.

---

## PART A — Company eligibility (the "are we even allowed" gate)

A Small Business Concern (SBC) must meet ALL of these at time of award (13 CFR 121 Subpart A):

| # | Requirement | Mindy / GovCon Giants status |
|---|---|---|
| 1 | **Organized for-profit**, place of business in the US, operating primarily in the US | ✅ Apply as the **for-profit** entity (NOT the GovCon Giants nonprofit — SBIR requires for-profit). |
| 2 | **≤ 500 employees** (incl. affiliates; full-time, part-time, leased all count) | ✅ Comfortably under. |
| 3 | **≥ 51% owned & controlled by US citizens or permanent residents** | ✅ Confirm cap table is clean (no single VC/PE/hedge fund >50%; green-card holders DO count as US). |
| 4 | **Work performed in the US** (Phase I R/R&D during the period of performance) | ✅ We're US-based. Foreign nationals on the team are limited; **green-card holders are NOT "foreign."** |

**Verdict:** No structural disqualifier. This is the easy part. *(Note: the nonprofit-path that re-opened SBA PRIME/GAFC/EDA in `FUNDING-STRATEGY.md` does NOT apply to SBIR — SBIR is for-profit only.)*

---

## PART B — Registration stack (THE real gate — has lead time)

You **cannot submit** until all of these are active. **Start now** — some take weeks and block the others in sequence.

| Order | Registration | Where | Lead time | Blocks |
|---|---|---|---|---|
| 1 | **UEI + SAM.gov registration** (active) | sam.gov | **4–6+ weeks** initial; annual renewal | Everything downstream |
| 2 | **CAGE code** (issued via SAM) | (auto in SAM) | **~2 weeks** within the SAM process | SBC registry |
| 3 | **SBC ID — SBA Company Registry** | sbir.gov | minutes–days, **but requires active SAM first** | DSIP proposal submission |
| 4 | **DSIP account** (Defense SBIR/STTR Innovation Portal) | dodsbirsttr.mil/submissions/login | account setup; needs the above | The actual submission |
| 5 | **Login.gov** (for SAM/DSIP auth) | login.gov | minutes | SAM/DSIP access |

> **Action this week:** check whether the for-profit entity's **SAM registration is active** (we've held TX/FL state contracts, so a SAM reg may already exist — if so this whole gate could be a *renewal*, not a cold 6-week start). If active → confirm UEI + CAGE, then create the **SBC ID** and a **DSIP account**. If lapsed → renew immediately; that's the critical-path item.

---

## PART C — The submission itself (mechanics that auto-reject if wrong)

Verified from the AFWERX Open Topic Phase I FAQ (AFRL-2025-3235):

- **Mandatory proposal template** — proposals that don't use the current template are **NOT evaluated.** Template lives under Open Topic Resources at afwerx.com/divisions/ventures/open-topic/. Content must stay on its designated pages; no "page limit" outside the table of contents (every firm gets the same page budget).
- **One proposal per solicitation** — and you can't submit under both Air Force *and* Space Force topics in the same cycle.
- **Phase I period of performance: 3 months**, clock starts at award; structured AFWERX curriculum + kickoff within 30 days of contract start.
- **Volumes:** technical detail → Volume 2; supporting docs/diagrams → Volume 5; **Cost Volume** defines the budget (no fixed example — varies by project).
- **Deliverables:** scope, task outline, kickoff (≤30 days), preliminary report, final report with SF 298 + DD Form 882.

---

## PART D — Customer / end-user (the misconception — read this)

- **NO customer is required at Phase I.** Per the FAQ: *"There is not an expectation to have a particular customer in Phase I. Phase I can be used to find your DAF fit."* AFWERX assigns **SAGE fellows** to help you make the end-user connection.
- **If you ALREADY have a customer**, AFWERX *suggests researching Direct-to-Phase-II (D2P2)* instead — which is relevant to us, since we have 3 warm govt contacts. **Decision point:** standard Phase I (find the DAF fit via the curriculum) vs. **D2P2** (skip Phase I if we can document an existing DAF customer + prior feasibility). D2P2 is bigger money but needs a real DAF use case documented up front.
- **Letters of support** from government personnel are *not required* but are positive indicators — low-cost trust signals if we can get them.
- The **signed Customer Memorandum is a Phase II requirement**, not Phase I (consistent with `AFWERX-ENDUSER-OUTREACH.md`).

---

## PART E — Timing (which window can we actually hit?)

DAF FY26 SBIR/STTR monthly BAA schedule (pre-release first Wednesday of each month — **confirm live on DSIP, this is the authoritative source**):

| Release | Pre-release | Opens | Closes |
|---|---|---|---|
| R3 | 3 Jun 26 | 24 Jun 26 | **22 Jul 26** |
| R4 | 1 Jul 26 | 22 Jul 26 | **19 Aug 26** |
| R5 | 5 Aug 26 | 26 Aug 26 | **23 Sep 26** |
| R6 | 2 Sep 26 | 23 Sep 26 | **21 Oct 26** |

**Realistic read (today = Jun 15, 2026 — SAM CONFIRMED ACTIVE):**
- **R3 (closes Jul 22) is LIVE for us.** SAM is active, so the only blockers left are fast registration steps (SBC ID + DSIP) plus writing a template proposal in ~5 weeks. **This is the target if we can produce a credible Phase I narrative + Cost Volume by mid-July.** R3 opened Jun 24 — the window is open *now*.
- **R4 (closes Aug 19)** is the **fallback / quality target** — same prep, more runway, and it **straddles NAPEX (Aug 16–20)** where we'd firm up the DAF end-user relationship. If R3 feels rushed on proposal quality, slide to R4 deliberately (not by default).
- **R5 (closes Sep 23)** = lands right after NAPEX with the relationship locked. Use only if we want a documented DAF customer in hand first (or are weighing D2P2).

**The gating question is no longer registration — it's proposal readiness.** With SAM active, the constraint shifts entirely to: (a) can we write a credible Phase I technical narrative + work plan + Cost Volume on the mandatory template, and (b) which window gives us the best shot without rushing it.

---

## What to DO — qualification critical path (updated: SAM active)

1. ✅ **SAM confirmed active** (GovCon Edu) — slowest gate cleared.
2. **[Eric, this week — fast] Finish the registration stack:** create the **SBC ID** on sbir.gov (minutes; needs active SAM — ✅ have it) → set up a **DSIP account** at dodsbirsttr.mil/submissions/login. These are the only registration steps left, and they're quick.
3. **[Eric — NOW] Download the mandatory proposal template** from AFWERX Open Topic Resources (afwerx.com/divisions/ventures/open-topic/) and read the table of contents — it dictates the entire structure. Off-template = auto-reject.
4. **[Decision] Phase I vs. D2P2** — standard Phase I (use the curriculum to find DAF fit) vs. D2P2 (needs a documented existing DAF customer). Default: **standard Phase I** unless a DAF end-user firms up before the window.
5. **[Product] Harden the ONE capability** the lead end-user needs (per `AFWERX-SBIR-READINESS.md` Tier 1.2) — spot-check 10 real cases.
6. **[Write] Phase I narrative + work plan + Cost Volume** on the template — the DIB-visibility mission framing (`AFWERX-SBIR-READINESS.md` Tier 1.3).
7. **Target window: R3 (closes Jul 22) if proposal is ready; R4 (Aug 19) as the deliberate quality fallback.** The decision is now proposal-readiness, not registration.

---

## Sources (verified June 15, 2026)

- [AFWERX Open Topic Phase I FAQ — AFRL-2025-3235](https://afwerx.com/wp-content/uploads/20250702_Ventures_Open_Topic_Phase_I_FAQs_update_CLEARED_AFRL-2025-3235.pdf) — template mandatory, 3-mo PoP, one proposal/solicitation, no customer at Phase I, D2P2 suggestion, volumes/deliverables
- [SBIR.gov — eligibility / size & ownership](https://www.sbir.gov/faq/eligibility-requirements) + [13 CFR 121 Subpart A](https://www.ecfr.gov/current/title-13/chapter-I/part-121/subpart-A/subject-group-ECFRb7921b3fcf04228/) — 500 employees, 51% US-owned, for-profit, VC/PE cap
- [SBIR required registrations tutorial](https://www.sbir.gov/tutorials/registration-requirements/tutorial-1) + [SBIR SAM.gov renewal guide 2026](https://grantedai.com/blog/sbir-sam-gov-registration-renewal-guide-2026) — SAM 4–6 wk, CAGE ~2 wk, SBC ID needs active SAM
- [Defense SBIR/STTR Innovation Portal (DSIP)](https://dodsbirsttr.mil/submissions/login) — submission portal + authoritative schedule
- DAF FY26 monthly BAA schedule via [AFWERX 26.1 Open Topic](https://grantedai.com/grants/afwerx-26-1-sbir-phase-i-open-topic-department-of-the-air-force-ae121eb6) — **confirm live on DSIP**

---

*Created June 15, 2026. Bottom line: company eligibility is not in doubt; the gate is the registration stack (multi-week, SAM-first) + submitting on the mandatory template in an open window. No customer required at Phase I. Confirm SAM-active status first — it decides whether R3 (Jul 22) is reachable or we target R4/R5.*

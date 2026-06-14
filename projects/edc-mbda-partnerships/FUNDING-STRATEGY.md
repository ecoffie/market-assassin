# Funding Strategy — Non-Dilutive Capital for Mindy

**Owner:** Eric → FT Head of Public Sector Partnerships & Funding
**Status:** Research complete — June 14, 2026
**Companion to:** `grant-nofo-tracker.md` (live deadlines), PRD §6, `apex-sbdc-funding-strategy/funding-levers-research.md` (how our CUSTOMERS' funding works)
**Rule:** Every program below is assessed from real sources. Fit verdicts are honest — "Poor / Not eligible" is a useful answer that saves wasted applications.

> **This doc answers: which funding can MINDY actually win, and is it worth the effort?**
> The tracker has deadlines; this has the strategy, fit, and apply/skip calls behind them.

---

## 0. TL;DR — the honest read

After researching DoD SBIR, civilian grants, and 5 states, the funding landscape sorts into **three buckets**:

**🟢 WORTH REAL EFFORT (apply):**
1. **AFWERX SBIR Open Topic (DoD/Air Force)** — the best federal fit. Dual-use software-friendly, low-dollar feasibility gate. **Win hinges on lining up a government end-user (Customer Memorandum), not the tech.**
2. **NSF SBIR/STTR Phase I** (`NSF 26-510`, up to **$305K**, deadlines **Jul 27 & Nov 4, 2026**) — only civilian direct-apply fit for a for-profit SaaS. **Conditional on a genuine deep-tech research question** (novel matching/win-prediction methods), not "a better tool."

**🟢 PROVEN / HIGH-CONFIDENCE (we've done it):**
3. **TX + FL state vendor — reactivate.** We've held state contracts in both → past performance + likely-active registration. FL OSD + TX DIR are the best-fit states *and* the ones we already know. Lowest-effort, highest-realism money on the board.

**🟡 NOW IN PLAY via the GovCon Giants NONPROFIT (was 🔴):**
4. **SBA GAFC + PRIME, EDA, MBDA center NOFOs** — these fund nonprofits, so we **apply through GovCon Giants → license Mindy as the platform.** Either way (we apply, or a partner does), get Mindy **written into the grant budget as the software line item.**

**🔴 SKIP (not eligible / off-mission / dilutive):**
5. NIST MEP (awardee-restricted), Treasury SSBCI (dilutive debt/equity), NTIA (off-mission).

**Single structural truth:** SBIR funds tech the **government uses**; Mindy's natural buyer is the **vendor side**. The credible bridge for every federal R&D pitch = the **OSBP / DIB-visibility angle** — give a government office visibility into small-business participation across the 14 Critical Technology Areas. That's a government end-user story.

### ⚡ Two assets that change the math (Eric, Jun 14)

These weren't in the initial research and they materially upgrade the plan:

1. **GovCon Giants is a NONPROFIT entity we can apply through.** The #1 disqualifier in the research below was *"for-profit SaaS not eligible"* — it killed SBA PRIME, GAFC, EDA, and MBDA-center NOFOs. **Applying through the GovCon Giants nonprofit flips a whole 🔴 SKIP tier to ELIGIBLE.** The structure: nonprofit applies/operates the program (eligible) → licenses Mindy as the platform (revenue to the SaaS). This is the single most valuable funding asset we have. *(Confirm with counsel: nonprofit-applicant + for-profit-affiliate-vendor arrangements need a clean related-party/procurement story — but it's a well-trodden model.)*
2. **We've already held TX and FL STATE CONTRACTS.** We are not a cold vendor — we have **past performance + likely-active registration** in the exact two states with the best vendor fit (TX DIR / FL OSD). State-vendor isn't a "discovery" path; it's a **reactivation** path. Becoming a state vendor where required is a no-brainer — we've done it.

---

## 1. DoD SBIR/STTR — the primary R&D path

### 1.1 Program structure (verified, 2026)

- **Reauthorized Apr 13, 2026** (after a ~6-month lapse) through **Sep 30, 2031**. New "Strategic Breakthrough Phase II" added.
- **Monthly BAA cadence.** Each release: pre-release → open → close (~1 month each). Topics + submission via **DSIP — dodsbirsttr.mil/topics-app/**.
- **Note:** 2026 docs now carry "Department of War (DoW)" branding. "26.3" = **FY26 Release 3**: opens **Jun 24**, closes **Jul 22, 2026**.

| Release | Opens | Closes |
|---|---|---|
| FY26 R3 | Jun 24, 2026 | Jul 22, 2026 |
| R4 | Jul 22 | Aug 19 |
| R5 | Aug 26 | Sep 23 |
| R6 | Sep 23 | Oct 21 |

### 1.2 Real topics that fit Mindy (verified topic numbers — prove demand; target the next recurrence)

| Topic | # / Solicitation | Component | Fit | Status |
|---|---|---|---|---|
| **Resilient Supply Chain Autonomous Intelligence Assistant** | `11887` / 25.B (STTR) | Air Force | ★ Near-exact: DIB supply-chain platform, open-source data extraction + **entity disambiguation in a knowledge graph** = Mindy's contractor-data + UEI engine | CLOSED (recurs) |
| **Scalability for Knowledge Graphs for Enterprise** | 25.D (STTR) | Air Force | Same family — heterogeneous data ingestion + analytics for DIB | CLOSED (recurs) |
| **AI-enabled Portfolio Management** (acquisition decision-support) | `A254-023` / 25.4.5 (D2P2 up to $2M) | Army | Adjacent — opportunity→requirement matching | CLOSED; was **xTechIgnite-gated** |
| **AFWERX SBIR Phase I Open Topic** | recurring (26.1 closed Mar 6 2026) | Air Force | ★ **Best structural fit** — propose any dual-use tech w/ an AF use case | Recurs monthly |

**Phase III precedent (the money is real):** Small Business Consulting Corp. won a **$60M AF Phase III IDIQ** for "Commercial Engagement and Integration — **Rapid Acquisition Decision Support**" — the closest existing program-of-record to what Mindy does.

### 1.3 Best-fit component — AFWERX Open Topic (DAF)

Why it's the entry point:
- **Topic-agnostic + explicitly dual-use** — you don't need a matching topic to exist, you need an Air Force end-user.
- **Friendliest to commercial software with no defense pedigree** — the Phase I deliverable is essentially a signed **Customer Memorandum** (proof an AF office would use it), not building hardware.
- Runs across multiple monthly releases → flexible timing.

### 1.4 Award sizes + honest win odds

| Path | Phase I $ | Timeline | Honest win read |
|---|---|---|---|
| **AFWERX Open Topic Phase I** | up to **$75K** (SBIR) / $110K (STTR) | ~3 mo | **Winnable on first try IF an end-user signs a Customer Memorandum.** Without one, coin-flip. The bar is relationship work, not tech. |
| Standard DoD specific topic (cold) | $50K–$250K | 3–6 mo | **Low (~10–20%)** for a no-prior-SBIR software firm vs. prior performers |
| Phase II / D2P2 | up to ~$1.25M–$2M | ~18–21 mo | Requires Phase I + Customer Memorandum + prototype |

**The differentiator is end-user pull.** Mindy's edge: we already talk to APEX centers, OSBP, and base small-business offices through the partnerships motion — **any of them can be the SBIR end-user.** The funding track and the partnerships track reinforce each other here.

### 1.5 DoD OSBP angle (verified interest, no dedicated topic)

- OSBP's mission = increase small-biz participation + **strengthen the DIB** (business.defense.gov). Runs the **Commercialization Readiness Program (CRP)** — a Phase III transition lever, not a topic.
- Adjacent OSD demand exists: **DAVE** (Defense Acquisition Visibility Environment) maintenance; **DIU Digital OnRamp** uses AI to match commercial tech to DoD needs (conceptually parallel to Mindy).
- **No published OSBP SBIR topic** for "small-business industrial-base participation tooling" — the *interest* is documented, the topic isn't. Pitch into it via **AFWERX Open Topic with an OSBP end-user**.

---

## 2. Civilian federal — one real shot + a reframe

**Eligibility column now reads two ways: as the for-profit SaaS vs. via the GovCon Giants NONPROFIT.** The nonprofit path re-opens several programs.

| Program | For-profit SaaS? | Via GovCon Giants nonprofit? | Award | Next deadline | Verdict |
|---|---|---|---|---|---|
| **NSF SBIR/STTR** `NSF 26-510` | **YES** — intended applicant | (for-profit is the right vehicle here) | Phase I up to **$305K** | **Jul 27 & Nov 4, 2026** | 🟡 **POSSIBLE** — only if reframed as deep-tech R&D (novel methods), NOT product engineering. Apply as the for-profit. |
| **SBA GAFC** | No (ESOs/accelerators) | **✅ YES — nonprofit runs accelerator programming** | $75K→$150K | FY26 TBD | 🟢 **NOW IN PLAY** via nonprofit → license Mindy as the platform |
| **SBA PRIME** | No (nonprofits/gov/tribes) | **✅ YES — exactly the intended applicant** | capacity grants | ~Apr–May | 🟢 **NOW IN PLAY** via nonprofit (microenterprise TA) |
| **EDA** (B2S, Univ Ctrs, EAA) | No (EDOs/gov/univ/nonprofit) | **✅ Possible** — nonprofit in cooperation w/ a political subdivision | $300K–$2M | ⚠️ lane partly frozen 2026 | 🟡 Nonprofit-eligible but **lane frozen** — watch, don't lead |
| **MBDA center NOFOs** (e.g. Rural Business Center) | No (center operators) | **✅ YES — nonprofit can operate a center** | center grant | Rural BC closes Jun 29 | 🟡 Nonprofit could bid + bundle Mindy *(but MBDA in legal limbo — see §2 of research doc)* |
| NIST MEP | No (awardee-restricted) | No | — | — | 🔴 Off-mission — skip |
| Treasury SSBCI | No (funds states; dilutive) | No | debt/equity | — | 🔴 Fails non-dilutive test |

**The NSF catch (be honest):** NSF funds *"deep technologies requiring substantial high-risk R&D,"* not *"incremental product development."* Mindy's current stack reads as applied engineering on existing techniques → which NSF declines. To compete, we'd need a defensible **research-grade hypothesis** (e.g., a novel ML approach to semantic capability-matching or win-prediction with measurable technical risk). If we can't articulate that honestly, don't force it.

---

## 3. State funding & vendor paths (5-state scan)

**The universal finding:** state *grants* fund the nonprofit/public/university centers, not the for-profit vendors that serve them. Mindy's realistic state path is mostly **be a vendor / get bought by the grantees** — with two exceptions. **And becoming a state vendor is a no-brainer we've already done — we've held TX and FL state contracts**, so those two (the best-fit states) are reactivations, not cold starts.

| State | Best path | Verdict |
|---|---|---|
| **MD** ⭐ | **TEDCO** — Social Impact funds (Pre-Seed Builder $100K; Inclusion; Seed). Mission-matched to minority-business focus. | **Best CAPITAL fit** — but it's **equity/convertible note, not grant**, and requires a **Maryland HQ** + founder-disadvantage thresholds. Real money if we're open to MD registration. |
| **FL** ⭐⭐ | **DMS Office of Supplier Diversity (OSD)** — cleanest product fit in the scan. Vendor portals free + fast; <$35K = pilot, no RFP. | **Best near-term VENDOR path — and we've HELD a FL state contract before** (past performance + likely-active registration). Reactivation, not cold start. Pair w/ FL SBDC (39 centers). |
| **TX** ⭐ | DIR Cooperative Contract (Tech4TX) to sell SaaS to TX agencies/universities. | **We've HELD a TX state contract before** → reactivate. ⚠️ HUB → VetHUB restructure (Dec 2025) weakened the minority hook — pivot to veteran + general small business. |
| **CA** | Sell INTO TAEP/iHub-funded centers (100+ orgs = our buyers); DGS Small Business cert → sub-$250K no-bid IT lane. | Vendor/channel — can't win the grants. |
| **GA** | Team Georgia Marketplace + DOAS workshops (natural Coach-Mode customer). | Vendor only. GA FAST = $2,450 (federal-SBIR doorway only). No state MBE program. |

**Honest caveat (all 5 states):** verified the *mechanisms* and mission-aligned offices, but found **no live RFP and no existing purchase** of a Mindy-like platform. These are warm BD pathways, not shovel-ready deals — validate with 1–2 discovery calls per priority state.

---

## 4. Prioritized funding plan

| # | Move | Type | Effort | Realism | When |
|---|---|---|---|---|---|
| 1 | **Reactivate TX + FL state vendor status** (we've held contracts → past performance) → sell into FL OSD / TX agencies | Vendor rev | **Low** | **★ Highest — proven path** | Now (pull prior contract records) |
| 2 | **Line up a govt end-user (Customer Memorandum)** for AFWERX — via OSBP / an APEX center / base SBO shop | Pre-work | Med | **The federal unlock** | Now → Aug (use NAPEX) |
| 3 | **AFWERX SBIR Open Topic Phase I** | DoD R&D | Med | **High IF #2 done** | Next open window (confirm on DSIP) |
| 4 | **Apply via GovCon Giants NONPROFIT** — SBA GAFC + PRIME (now eligible) → license Mindy as the platform | Grant + rev | Med | **Now in play** (was 🔴) | Next FY26 cycles |
| 5 | **Get Mindy written into partners' grant budgets** (MBDA Rural BC, GAFC-winner ESOs, EDA subawards) | Revenue | Low-Med | **Most realistic federal $** | Ongoing via partnerships |
| 6 | **NSF SBIR Phase I go/no-go** — only if we can write a real research question | Civilian R&D | High | Possible | Decide before Jul 27 or aim Nov 4 |
| 7 | **MD TEDCO** — if open to MD HQ + cap-table fit | Equity | Med | Real money, structural strings | Eval Q3 |
| 8 | Watch DoD SBIR 26.3+ for a reissue of topics 11887 / 25.D | DoD R&D | Low | Topic-dependent | Monitor DSIP monthly |

**What to SKIP outright:** NIST MEP, Treasury SSBCI direct, NTIA. *(SBA PRIME/GAFC + EDA + MBDA NOFOs are NO LONGER auto-skip — they're eligible via the GovCon Giants nonprofit; moved to plan rows 4–5.)*

**Confirm with counsel:** the nonprofit-applies / for-profit-licenses structure (related-party + procurement story). Standard model, but get it clean before submitting.

---

## 5. Open items (for the FT hire)

- [ ] Identify + secure a government end-user willing to sign an AFWERX Customer Memorandum (the single highest-leverage funding task)
- [ ] Confirm next AFWERX Open Topic window on DSIP
- [ ] NSF 26-510 go/no-go: can we articulate a deep-tech research question? (If no, skip.)
- [ ] Pull live FY26 R3+ topic list on DSIP when pre-release drops — check for an 11887/25.D successor
- [ ] TEDCO: confirm MD-HQ requirement + which Social Impact fund fits the cap table
- [ ] FL OSD: discovery call to scope a <$35K pilot
- [ ] For each partner grant (MBDA Rural Business Center, etc.): get Mindy named as a budget line item pre-award
- [ ] **Pull our prior TX + FL state contract records** — confirm current vendor registration status (DIR/CMBL for TX; MyFloridaMarketPlace/VBS for FL); reactivate where lapsed
- [ ] **Counsel review:** GovCon Giants nonprofit-applies / Mindy-licenses structure (related-party + procurement clean story) before any nonprofit grant submission
- [ ] Confirm which nonprofit grants GovCon Giants is best positioned for (GAFC accelerator programming vs. PRIME microenterprise TA)

---

## 6. Sources (verified)

- DoD SBIR/STTR: [dodsbirsttr.mil/topics-app](https://www.dodsbirsttr.mil/topics-app/) · [AFWERX Open Topic](https://afwerx.com/divisions/sbir-sttr/open-topic/) · topics [11887](https://www.sbir.gov/topics/11887), [11779](https://www.sbir.gov/topics/11779) · [SBIR reauth (Crowell)](https://www.crowell.com/en/insights/client-alerts/sbirsttr-programs-reauthorized-after-six-month-lapse)
- NSF: [NSF 26-510](https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation)
- SBA GAFC/PRIME: [sbir.gov/community/gafc](https://www.sbir.gov/community/gafc) · [SBA community grants](https://www.sba.gov/funding-programs/grants/grants-community-organizations)
- EDA: [Build to Scale](https://www.eda.gov/funding/programs/build-to-scale) · [FY26 uncertainty](https://technical.ly/civics/innovation-funding-uncertain-fy-2026-budget-guest-post/)
- State: [MD TEDCO](https://www.tedcomd.com/funding/social-impact-funds) · [FL DMS OSD](https://www.dms.myflorida.com/business_operations/state_purchasing/office_of_supplier_development_osd) · [TX DIR](https://dir.texas.gov/how-become-vendor) · [CA grants portal](https://www.grants.ca.gov/) · [GA DOAS](https://doas.ga.gov/)
- DoD OSBP: [business.defense.gov](https://business.defense.gov/About.aspx) · [CRP](https://www.acq.osd.mil/osbp/sbir/sb/crp.shtml)

---

*Last updated: June 14, 2026 — research complete + two Eric assets folded in. Bottom line: (1) TX+FL state vendor = proven/reactivate (we've held contracts) — lowest-effort money; (2) AFWERX Open Topic (with a govt end-user) = the real DoD R&D path; (3) the GovCon Giants NONPROFIT re-opens SBA GAFC/PRIME/EDA/MBDA NOFOs that for-profit Mindy can't win alone → apply via nonprofit, license Mindy; (4) NSF = conditional deep-tech go/no-go; (5) MD TEDCO = equity if MD-HQ. Next: reactivate TX/FL vendor status + secure an AFWERX end-user via the partnerships motion + counsel-check the nonprofit structure.*

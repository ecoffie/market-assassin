# PRD: EDC, MBDA-Adjacent & State/Local Partnerships

**Status:** DRAFT — research + GTM expansion (post-NAPEX execution)
**Date:** June 13, 2026
**Owner:** Eric (Strategy) / Head of Public Sector Partnerships & Funding (hire)
**Related docs:**
- `PRD-apex-sbdc-funding-justification.md` (parent APEX/SBDC/chamber motion)
- `projects/apex-sbdc-funding-strategy/funding-levers-research.md` (DoD/SBA reporting levers)
- `projects/apex-sbdc-funding-strategy/NAPEX-2026-readiness-plan.md` (Aug 16–21 forcing function)
- `market-assassin/tasks/COACH-ENTERPRISE-BD-PLAN.md` (legacy coach BD plan — advisor assignments retired June 2026; recruit replacements)
- `projects/edc-mbda-partnerships/JD-head-public-sector-partnerships-funding.md` (FT role)

---

## 0. TL;DR

Mindy already sells **Coach Mode + org licenses** to APEX, SBDC, and chambers. This PRD extends the same platform to **state/local economic development organizations (EDCs)**, **workforce boards**, and the **MBDA-adjacent ecosystem** (MBDA Business Centers, state minority business divisions, NMSDC regional councils).

**The wedge is not "free alerts."** It is:

1. **317,106 USASpending recipient profiles** — find primes, incumbents, and teammates by NAICS, agency, set-aside, state
2. **DoD Critical Technology Area (CTA) filters** — align client pursuits to the 35% mandate APEX centers must report on
3. **Teaming / Find Partners** — match small firms to larger contractors in the same CTA lane
4. **UEI roster → win attribution** (NAPEX build) — prove *their* clients won contracts, not industry aggregates

**Relationship to APEX:** Partner, don't replace. EDCs and MBDA-adjacent orgs often **refer** to APEX for 1:1 counseling; Mindy is the **reporting + matching layer** that makes quarterly funder narratives write themselves. DoD/OSBP direct funding is **complementary** (national CTA pipeline visibility), not channel conflict.

**Dual revenue model:**
- **B2B org licenses** (primary) — EDC/state contracts $50K–$200K training + platform bundles
- **Non-dilutive capital** (SBIR, EDA, SBA programs, state innovation grants) — funds R&D on EDMIS export, UEI attribution, funder report API

---

## 1. Problem Statement

### Who has this problem?

| Segment | Funder | Scale (verified) | What they must prove |
|---------|--------|------------------|----------------------|
| **State/local EDCs** | State commerce, county/city EDC budgets, EDA grants | Thousands nationwide; GovCon programs vary (e.g. Prince George's County EDC runs Procurement 360 + GovCon Academy) | Jobs, capital accessed, minority business growth, contract wins in-region |
| **Workforce boards** | DOL WIOA | ~550 local boards | Job placement, career pathways into high-wage sectors (federal contracting qualifies) |
| **MBDA Business Centers** | MBDA cooperative agreements (status disrupted 2025–26) | **39 active centers in 2024** (GAO-26-107718) | Contract access, capital, export/market expansion for minority-owned enterprises |
| **State minority business divisions** | State appropriations | Operates when federal programs wobble | Same as MBDA mission — often the **local operator** when federal grants pause |
| **NMSDC regional councils** | Corporate + member dues | 23 regional councils | MBE certification pipeline, corporate supplier diversity, contract matching |

### What's the pain?

These organizations run **cohort programs, academies, and procurement events** (training grants, EDA projects, chamber partnerships). They lack:

- A **searchable prime/teaming database** beyond manual LinkedIn and SAM entity search
- **CTA-aligned opportunity intelligence** for DoD industrial base narratives
- **Client-level win attribution** tied to roster UEIs (counselors export spreadsheets today)
- **One coach dashboard** that rolls up pursuit activity + outcomes for funder reports

OpenGovIQ sold APEX Illinois a **workbench** ($50K–$68K/yr). Mindy already ships that (Knowledge Base RAG + Proposal Assist). EDC/MBDA-adjacent buyers need **matching + outcomes**, not another internal AI sandbox.

### Pitch line (use verbatim in outreach)

> "We don't just help your clients find opportunities — we help you prove placement into the defense supply chain and match them to the right prime partners in Critical Technology Areas."

---

## 2. Landscape Research (Phase 1 — June 2026)

### 2.1 Economic Development Corporations (EDCs)

**What they are:** Public or public-private entities (county, city, regional) funded by state/local appropriations, EDA grants, and fee-for-service. Mission: jobs, capital, business retention/expansion.

**GovCon relevance:** Many EDCs run procurement academies, prime-sub networking, and certification workshops — often **alongside** (not instead of) APEX Accelerators.

**Verified example:** Prince George's County EDC (Maryland)
- **Procurement 360: Targeting Opportunities** — bi-monthly sessions aligning local businesses with one agency/prime per session (launched July 2025)
- **Government Contracting Academy** — 7-week cohort with Maryland Black Chamber of Commerce (March–May 2025)
- Focus: MBE certification, set-asides, prime subcontractor integration, federal + state + local agencies

**Implication for Mindy:** EDC deals look like **USHCC cohort packages** (training + platform + outcome reporting), not single-seat SaaS. Budget line items: $25K–$100K training grants, $50K–$200K multi-year EDA/state contracts.

**Open research (Phase 2 — assign to FT hire):**
- [ ] Inventory top 20 EDCs with active federal contracting programs (by state priority: GA, TX, FL, MD, VA, CA)
- [ ] Map EDA Revolving Loan Fund / Public Works / University Center NOFOs with GovCon-adjacent scopes
- [ ] Identify which EDCs already partner with APEX (referral vs. duplicate counseling)

### 2.2 MBDA & MBDA-Adjacent Ecosystem

**Statutory role:** MBDA is the only federal agency dedicated to minority business enterprise growth (Minority Business Development Act of 2021, Division K of IIJA).

**2025–2026 disruption (public record — not LLM inference):**
- March 14, 2025: Executive Order effectively eliminating MBDA
- May 13, 2025: Preliminary injunction requiring restoration (federal district court)
- November 2025: Permanent injunction vacating agency dismantling actions
- **January 2026:** Defendants appealed; **appeal pending as of February 27, 2026** (GAO-26-107718)
- GAO documented: cooperative agreements with business centers terminated; at least **9 centers** lost funding as of August 2025; staff reductions and grant pauses despite court orders (Senate Commerce / Small Business Committee letters, 2025)

**Outreach targets (prioritized):**

| Target | Why | Warm path |
|--------|-----|-----------|
| **MBDA Business Centers still operating** | Direct MBDA mission; contract + capital focus | Research center-by-center post-injunction status |
| **State minority business divisions** | Often absorb programming when federal grants pause | State commerce dept outreach |
| **NMSDC regional councils** | 23 councils; corporate supplier diversity | Recruit **minority-business partnership advisor** (see §4) |
| **State Black/Hispanic/Asian chambers** | Cohort training + member GovCon pipelines | USHCC playbook; MBCC/PGCEDC model |
| **APEX centers with minority business focus** | Already federally funded; CTA + win attribution story | NAPEX + Illinois re-warm |

**Do not assume:** A single "replacement org" for MBDA. The landscape is **legally contested** and **center-by-center**. Every outreach must confirm current funding status before pitching multi-year licenses.

### 2.3 Workforce Boards (WIOA)

**Fit:** Federal contracting careers = high-wage placement outcomes WIOA boards report to DOL.

**Mindy angle:** Coach Mode for **career counselors** placing veterans and displaced workers into GovCon firms; contractor DB for "who's hiring in your NAICS/state."

**Status in repo:** No strategy doc. Phase 2 research item.

### 2.4 Coexistence vs. Competition with APEX

| Motion | Relationship to APEX |
|--------|---------------------|
| Org license to each APEX center | **Partner** — strengthens their quarterly DoD report |
| EDC cohort + APEX referral | **Partner** — EDC runs academy; APEX does 1:1; Mindy tracks both |
| Pitch DoD OSBP on national CTA dashboard | **Complement** — aggregate view no single center builds |
| Match SMB ↔ prime via 317K DB | **Value-add** — counselors do this manually today |
| SBIR/BAA on CTA pipeline tech | **Parallel funding** — builds product centers then buy |

**Do not take counseling dollars.** Take **reporting infrastructure + matching intelligence** dollars.

---

## 3. Product Fit (What Ships Today vs. Gaps)

### 3.1 Ready now (demo-able)

| Capability | EDC/MBDA use case | Source |
|------------|-------------------|--------|
| **Coach Mode** | Director dashboard, client switcher, org provisioning | `/api/app/coach`, `PRD-coach-mode-apex.md` |
| **317K contractor search** | Prime/incumbent/teaming by NAICS, agency, set-aside, state | USASpending BigQuery |
| **125K+ SAM contracting POCs** | Agency buyer contacts (count/teaser in product) | SAM cache |
| **88K+ cached SAM opportunities** | Daily briefings, pursuit alerts | Supabase cache |
| **Knowledge Base RAG** | Center playbooks, SOPs, proposal templates | Shipped |
| **Proposal Assist V2** | RFP upload, compliance matrix, .docx export | Shipped |
| **SBIR / Grants tabs** | Non-DOD funding pipeline for clients | Product UI |
| **Teaming / Find Partners** | MBE ↔ prime matching | Product (partial — validate NAPEX demo) |
| **CTA filters** | DoD 14 Critical Tech Areas on opportunity feed | Shipped June 2026 (`cta_codes`, Source Feed UI) |

### 3.2 NAPEX-critical (Week 3–4, per parent PRD)

| Capability | Why EDC/MBDA cares |
|------------|-------------------|
| **UEI roster import** | Tie cohort members to USASpending wins |
| **Win attribution rollup** | "Your program placed 12 clients into $4.2M DoD contracts" |
| **Funder report export** | One-click PDF/CSV for quarterly narratives (Phase 2 — show mockup at NAPEX) |

### 3.3 Phase 2 product (post-NAPEX)

| Capability | Funder |
|------------|--------|
| **EDMIS field mapping export** | SBDC cooperative agreements |
| **DoD APEX quarterly report template** | APEX centers |
| **State EDC outcome template** | Jobs + capital + contracts in-region |
| **MBE supplier diversity rollup** | NMSDC / state minority divisions |

---

## 4. Go-to-Market: Channel Map

### Tier 1 — Execute now (documented elsewhere)

- **APEX** — NAPEX Aug 16–21; Illinois re-warm; CTA hook
- **Chambers** — USHCC Atlanta cohort recalibration
- **SBDC** — Same Coach Mode MOU; EDMIS Phase 2

### Tier 2 — This PRD (EDC / MBDA-adjacent)

| Priority | Channel | First target | Entry offer |
|----------|---------|--------------|-------------|
| **P1** | State EDC with active GovCon academy | Prince George's County EDC (MD) — proven Procurement 360 + MBCC partnership | 60-day director eval → $50K–$75K cohort + platform |
| **P1** | NMSDC regional council | Minority-business partnership advisor (recruit) | Enterprise license + member alert funnel |
| **P2** | State minority business division | GA, TX, FL, CA commerce depts | Pilot 1 state; mirror USHCC pricing ladder |
| **P2** | MBDA Business Center (operating) | Confirm post-injunction status per center | Eval → $35K–$50K/yr (APEX Foundation ladder) |
| **P3** | Workforce board | Local board near existing chamber/APEX pilot | WIOA outcome reporting angle |
| **P3** | University innovation / PTAC-adjacent | State SBIR pipeline partners | SBIR tab + teaming |

### Regional partnership advisors (recruit — replaces retired assignments)

Prior advisor assignments (Ryan / Zach / Randie) are **retired June 2026**. Recruit three part-time or commission-based advisors to open doors; FT Head of Partnerships **closes**.

| Role to recruit | Territory | Opens |
|-----------------|-----------|-------|
| **APEX partnership advisor** | APEX-heavy states (TX, FL, VA, MD, IL, CA) | Director intros pre-NAPEX |
| **SBDC & chamber advisor** | SBDC lead centers + regional chambers | Cohort pilots + 60-day eval intros |
| **Minority-business partnership advisor** | NMSDC councils + MBDA-adjacent + state MBE offices | MBDA-adjacent + corporate diversity intros |

**Profile:** Former APEX director, SBDC lead, or NMSDC/MBDA center operator — credible with center directors, not a generic referral partner. Comp: intro bounty + % of first-year license (structure TBD with FT hire).

---

## 5. Pricing Ladder — EDC / MBDA-Adjacent

Reuse Coach Mode infrastructure. **Do not use chamber pricing for EDC/state deals** — budget envelopes are larger (training grants + EDA).

| Tier | Audience | Price | What's included |
|------|----------|-------|-----------------|
| **60-Day Director Eval** | EDC program director, MBDA center director, NMSDC regional lead | **$0** | 1 org_admin + up to 20 client workspaces; CTA filters; UEI attribution (when shipped); branded Org Tab |
| **EDC Cohort Standard** | Single EDC academy (20–40 firms) | **$50,000/yr** | Director + 30 member seats; daily briefings; contractor DB; teaming; quarterly outcome report (mockup → production) |
| **EDC Cohort Plus** | Same + training bundle | **$75,000–$100,000/yr** | Standard + GovCon Giants bootcamp delivery (Eric/Sikander) + custom Knowledge Base |
| **State EDC Network** | State commerce dept (multi-EDC rollout) | **$150,000–$200,000/yr** | 3–5 EDCs × Cohort Standard + statewide rollup |
| **MBDA-Adjacent / NMSDC** | Regional council or operating MBDA center | **$35,000–$50,000/yr** | Maps to APEX Foundation / Accelerated ladder (see parent PRD §8) |

**Chamber ladder ($18K)** remains for **trade associations without state commerce budgets**. EDC ladder is separate SKU.

---

## 6. Non-Dilutive Funding for Mindy (Platform R&D)

Dedicated owner required. SBIR funds **build**; org licenses fund **revenue**.

| Source | Fit | Realistic use of funds |
|--------|-----|------------------------|
| **DoD SBIR/STTR** | DoD OSBP / small business readiness tech | CTA matching engine, UEI attribution API, counselor reporting |
| **SBA Growth Accelerator / PRIME** | Underserved firm cohort tooling | Minority + rural coach platform |
| **EDA (Economic Development Administration)** | State EDC partnerships | Defense industrial base placement, export-adjacent contracting |
| **State innovation / minority business grants** | Single-state pilot | GA, TX, FL, CA commerce dept RFPs |
| **DoD OSBP / OUSD(R&E)** | **35% CTA mandate tooling** | National pipeline dashboard — industrial base strengthening narrative |

**Calendar ownership:** FT hire maintains NOFO tracker, topic releases, submission deadlines.

**Open research:**
- [ ] Confirm SBIR topic alignment (OSBP, USAF AFWERX, Navy NAVSEA small business)
- [ ] EDA FY26 NOFO scan for "defense industrial base" / "minority business" keywords
- [ ] State RFP inventory (Q3 2026)

---

## 7. 90-Day Execution Sequence

| When | Focus | Owner |
|------|-------|-------|
| **Now → Jun 27** | Ship/polish CTA filters + NAPEX demo laptop story | Product |
| **Jun 28 – Jul 4** | APEX director outreach (35% mandate hook) | Eric + FT hire (if onboarded) |
| **Jul 1–15** | **Phase 2 research sprint:** EDC top-20 inventory, MBDA center status check, 1 state commerce target | FT hire |
| **Jul** | UEI roster + win attribution live | Product |
| **Jul 12–18** | Reactivate APEX Illinois eval | Eric + FT hire |
| **Aug 16–21** | **NAPEX** — 10+ director meetings, 2 post-show pilot targets | Eric + FT hire (+ APEX advisor if recruited) |
| **Post-NAPEX (Sep)** | EDC pilot (PGC EDC or equivalent); NMSDC intro via minority-business advisor; SBIR Phase I draft | FT hire |
| **Q4 2026** | Productize funder report export; second EDC or MBDA-adjacent paid license | Product + FT hire |

---

## 8. Success Metrics

### 6-month KPIs (partnerships)

| Metric | Target |
|--------|--------|
| Signed 60-day director evals (APEX **or** EDC **or** MBDA-adjacent) | **3** |
| Paid org license ($18K+ chamber **or** $35K+ APEX/EDC) | **1** |
| NAPEX qualified director meetings | **10+** |
| Post-NAPEX pilots launched | **2** |
| EDC/MBDA landscape research doc complete | **1** (this PRD Phase 2 appendix) |

### 6-month KPIs (funding capture)

| Metric | Target |
|--------|--------|
| Grant applications submitted | **2** (SBIR + one state/EDA) |
| NOFO tracker live with 90-day horizon | Yes |
| LOI / pre-application conversations | **3+** |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| MBDA center funding still frozen despite court orders | High (2026) | Med | Target state minority divisions + NMSDC; confirm center status before pitch |
| EDC sees Mindy as competing with APEX | Med | Med | Position as **reporting + matching layer**; encourage APEX referral |
| EDC budgets are grant-cycle dependent | Med | High | Align to academy cohort dates; offer eval straddling fiscal year |
| Funder report export not production-ready | Med | High | NAPEX mockup OK; paid deals require Phase 2 delivery date in contract |
| No FT owner — Eric is bottleneck | High | High | **Hire before NAPEX** (see JD) |
| SBIR win rate low | High | Low | Treat as optionality; org licenses remain primary |

---

## 10. Phase 2 Research Backlog (Assign to FT Hire)

- [ ] **EDC inventory:** Top 20 orgs with federal contracting programs; contact, budget cycle, APEX relationship
- [ ] **MBDA center status matrix:** 39 centers (2024 GAO baseline) — operating / funded / alternative operator
- [ ] **NMSDC council map:** 23 regions — existing GovCon tooling, member alert partners
- [ ] **WIOA board scan:** 5 boards in APEX/EDC pilot states with veteran placement programs
- [ ] **EDA + state RFP calendar:** Next 4 quarters
- [ ] **DoD OSBP contact map:** CTA mandate owners for complementary (not competitive) pitch
- [ ] **Pricing validation:** 3 discovery calls at $50K EDC price point before standardizing

**Deliverable:** `projects/edc-mbda-partnerships/landscape-research-phase2.md` — due **Jul 15, 2026**.

---

## 11. References (Verified External)

| Source | URL / ID | Used for |
|--------|----------|----------|
| GAO MBDA report | [GAO-26-107718](https://www.gao.gov/products/gao-26-107718) | 39 centers (2024); 2025–26 disruption timeline |
| Senate Commerce MBDA letter | June 3, 2025 PDF | Executive Order / injunction context |
| Prince George's County EDC | [pgcedc.com/procurement360](https://www.pgcedc.com/procurement360) | EDC GovCon program example |
| SBA APEX Accelerators | [sba.gov/local-assistance/federal-contracting-assistance](https://www.sba.gov/local-assistance/federal-contracting-assistance) | APEX referral relationship |
| Mindy data counts | `market-assassin/docs/MARKETING-FEATURE-LITERATURE.md` | 317K contractors, 125K contacts, 88K opps |

---

*Last updated: June 13, 2026*

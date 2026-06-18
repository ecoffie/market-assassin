# DLA26BZ03-NV012 — Phase I Technical Outline (working draft)

**Topic:** AI-Powered Tool for Automated Evaluation of Vendor Economic Dependency (DLA)
**Solicitation:** DoW SBIR 2026 BAA, Release 3 · **Closes 07/22/2026**
**Phase I:** $100,000 / 12 months · **Phase II:** $1,000,000 / 24 months
**Applicant:** GovCon Edu (for-profit SBC) · **Product base:** Mindy
**TPOCs:** Shea McCullough · Corey Cook · Matthew Borsinger (DLA)
**Status:** DRAFT outline — June 16, 2026. NOT the submission; maps to the mandatory AFWERX/DSIP template.

> **Honesty rule for this whole doc:** the dependency MATH and the federal-award data are Mindy's native
> strength (verified: federal $/vendor by UEI is live — McKesson $84B, Pfizer $28B fed obligated). The
> SFFAS-47 / federal-accounting-compliance framing is NOT Mindy's domain — it's covered by a named
> accounting/audit SME teammate (see Team). Don't claim audit expertise we don't have; claim the
> data-engineering + dependency-analysis we do, wrapped in the SME's compliance guidance.

---

## 0. How this maps to the required Phase I work-plan format
(Per AFWERX Open Topic Phase I FAQ — same work-plan structure applies: Scope · Task Outline ·
Deliverables · Kickoff ≤30 days · Preliminary + Final report w/ SF298 & DD882. Content must sit on the
template's designated pages.)

| Template element | Filled by |
|---|---|
| Scope | §1 below |
| Task Outline | §3 (Tasks 1–6) |
| Deliverables | §4 |
| Kickoff (≤30 days) | Task 1 |
| Cost Volume | separate volume — $100K breakdown (§6) |
| Volume 2 (technical) | §1–5 | Volume 5 (supporting: data dictionary, golden-dataset spec, architecture diagram) |

---

## 1. SCOPE (the feasibility question)
**Can an AI-driven tool automatically and auditably quantify a DLA vendor's *economic dependency* on the
government — and flag potential related parties per SFFAS 47 — by joining DLA contract/award data to
public vendor financials, at scale across thousands of vendors?**

Phase I proves the concept end-to-end on a bounded sample and produces a **golden dataset** + a
proof-of-concept tool; it does NOT build the production system (that's Phase II). The deliverable the
topic explicitly names: "identify a universe of vendors from sample contract data, retrieve public
financial information (SEC EDGAR, 10-Ks, SAM.gov), apply the economic-dependency criteria, address
SFFAS 47, establish a golden dataset, and plan Phase II."

**Core metric (the heart of the tool):**
`economic_dependency_% = (vendor's federal/DLA obligated $) ÷ (vendor's total revenue)`
- Numerator = **native to Mindy** (USASpending award data, by recipient UEI, filterable to DLA).
- Denominator = **SEC EDGAR 10-K** annual revenue (public, machine-readable XBRL).
- Related-party flag = dependency above a defined threshold + corroborating signals (single-source
  reliance, contract-type concentration, ownership/affiliate links).

---

## 2. TECHNICAL APPROACH (what we build in Phase I)
A proof-of-concept pipeline, four stages — each grounded in an existing Mindy capability + the named
public sources:

1. **Vendor universe extraction** — from sample DLA contract/award data, resolve the distinct vendor
   set by **UEI** (Mindy's award-detail spine already keys on UEI; resolves PIID→recipient).
2. **Federal-dependency numerator** — aggregate each vendor's **obligated $ from DLA** (and total
   federal) over a fiscal window. *Live today in Mindy.*
3. **Public-financial denominator** — retrieve each public vendor's **total revenue** from **SEC EDGAR**
   (XBRL `Revenues`/`RevenueFromContractWithCustomer` facts); for private vendors, flag as
   "denominator unavailable — manual review" (honest gap, not a fabricated number).
4. **Dependency + related-party scoring** — compute the dependency %, apply the **SFFAS-47-informed
   criterion** (SME-defined threshold), layer risk by **contract type** (cost-reimbursement vs
   fixed-price, per the topic) and concentration; output an **auditable, traceable** record (every
   number cites its source + as-of date — the same provenance discipline Mindy already enforces).

**AI/NLP role (scoped honestly):** NLP extracts/normalizes entity names and parses 10-K narrative for
related-party disclosures + revenue-concentration language; the dependency calc itself is
deterministic math (auditable on purpose — the topic demands traceable results, so we do NOT hide it
behind a black-box model). This matters for SFFAS 47 / audit readiness: the evidence must be explainable.

---

## 3. TASK OUTLINE (the 12-month plan)

| # | Task | Months | Output |
|---|------|--------|--------|
| **1** | **Kickoff + requirements** (≤30 days). Meet DLA TPOCs; confirm the SFFAS-47 dependency criterion, the sample contract dataset, the secure-environment constraints, and the "golden dataset" definition. | 0–1 | Kickoff memo; agreed criterion + sample scope |
| **2** | **Vendor-universe + numerator** — ingest sample DLA contract data; resolve vendors by UEI; compute federal/DLA obligated $ per vendor. | 1–3 | Vendor table w/ federal $ (numerator proven) |
| **3** | **Public-financial retrieval** — automated SEC EDGAR pull (XBRL revenue); 10-K related-party section parse; private-vendor gap handling. | 3–6 | Financials table; coverage/gap report |
| **4** | **Dependency + related-party engine** — apply SFFAS-47-informed criterion (SME-led); contract-type risk layer; auditable output records. | 5–8 | Scored dependency results + provenance trail |
| **5** | **Golden dataset + validation** — assemble the labeled reference set; SME reviews accuracy; measure precision on flagged related parties. | 7–10 | **Golden dataset** (a named Phase I deliverable) + accuracy metrics |
| **6** | **Phase II plan + final report** — architecture for a scalable, government-environment prototype on DLA's tech stack; SF298 + DD882. | 10–12 | Final report; Phase II transition plan |

*(Tasks overlap; the bar/Gantt goes in Volume 2.)*

---

## 4. DELIVERABLES (what DLA gets)
1. **Proof-of-concept tool** — runs the 4-stage pipeline on the sample, end to end.
2. **Golden dataset** — the labeled vendor/dependency reference set (explicitly required by the topic).
3. **Preliminary report** (~month 5–6) + **Final report** with SF298 & DD882.
4. **SFFAS-47 compliance memo** — how the criterion + evidence trail map to the standard (SME-authored).
5. **Phase II plan** — scalable prototype design for DLA's environment/stack, with a transition path.

---

## 5. WHY US (feasibility credibility — grounded, no overclaim)
- **The data engine exists.** Mindy already computes federal obligated $ per vendor by UEI across the
  full USASpending universe (317K contractors) — the dependency numerator is not a research risk, it's
  a production capability. *(Demoable today: top DLA vendors + their federal $.)*
- **Provenance discipline is built in.** Mindy already sources every figure with an as-of date — exactly
  the "auditable, traceable" requirement the topic and SFFAS 47 demand.
- **SAM.gov + award data are our core sources** — the same ones the topic names.
- **The accounting gap is covered by a named SME**, not hand-waved (see Team).

---

## 6. OPEN ITEMS before submission (the real gating work — owner: Eric)
- [ ] **Secure the SFFAS-47 / federal-accounting SME** (teammate or consultant) — THE make-or-break.
      Without credible audit-standard expertise, the proposal reads as a data tool that doesn't
      understand the compliance core. Decide: subcontractor, advisor, or STTR research-institution route.
- [ ] **Confirm US-person team for ITAR** — disclose any foreign nationals + their SOW tasks. If Mindy
      has FN devs, scope them off this effort or document per §3.5.
- [ ] **CMMC Level 2 (Self) attestation** — confirm our stack/practices credibly self-assess to L2.
- [ ] **Registration:** SBC ID (sbir.gov) + DSIP account (already logged in) under **GovCon Edu**.
- [ ] **Pull the mandatory proposal template** from the DSIP topic page (Download Topic Details) and
      map §1–5 onto its designated pages — off-template = auto-reject.
- [ ] **Cost Volume** — $100K across 12 months (labor: data eng + SME hours; SEC/EDGAR integration;
      report production). No example budget given — build from the task hours.
- [ ] Optional: a **Letter of Support** is not required but is a positive signal — our warm DISA / DoD
      partnership contacts are DLA-adjacent.

---

## 7. The honest risk register (so we go in clear-eyed)
| Risk | Reality | Mitigation |
|---|---|---|
| SFFAS-47 expertise gap | Real — Mindy is market-intel, not audit | Named accounting SME (open item #1) |
| Private vendors have no public 10-K | Real — denominator missing for non-public firms | Phase I scopes to public vendors + flags the gap honestly; Phase II adds D&B/private estimates |
| Secure-environment / CMMC | Real for production | Phase I is feasibility (POC on sample data); production hardening is Phase II |
| ITAR / foreign nationals | Real constraint | US-person team; disclose per §3.5 |
| "Just a data tool" perception | Risk if pitched as Mindy-as-is | Reframe: vendor economic-dependency *analysis* for audit readiness, SME-anchored |

---

## 8. Partners: who we DO and DON'T need (decided June 18)
**ONLY partner needed for Phase I = the SFFAS-47 SME (§6 open item #1).** That's the whole gap.

**No IT / dev / cyber partner for Phase I — and adding one would HURT:**
- The AI/data pipeline (vendor universe → EDGAR pull → dependency calc → golden dataset) **IS Mindy** —
  our own engineering. An IT partner here signals "we can't build our own product." Don't.
- **CMMC Level 2 is SELF-attestation** for Phase I — no third-party auditor/partner required; we
  attest our own practices.
- "Secure government environment + DLA tech-stack integration" is explicitly a **Phase II** deliverable
  (12+ mo out) — cross that with the Phase I award in hand, and even then it's likely a **GovCloud/IL
  hosting vendor relationship**, not a proposal teammate.
- Keep the story clean: **we build the tech (Mindy), the SME brings the SFFAS-47 standard.** Two
  partners muddies it; a third party makes us look like an integrator, not a product company.
- **Only IT-adjacent gut-check:** are our core devs **US persons**? (ITAR.) If a foreign national
  touches Mindy's core, scope them off this effort or document per §3.5 — a STAFFING question, not a
  partner question.

---

*Draft June 16, 2026 (partners note added June 18). Grounded in the live DSIP topic text + verified Mindy capability (federal $/vendor
by UEI is native). The proposal's strength = our data engine + provenance; its gating dependency = a
real SFFAS-47/accounting SME. Decide go/no-go before 07/22/2026.*

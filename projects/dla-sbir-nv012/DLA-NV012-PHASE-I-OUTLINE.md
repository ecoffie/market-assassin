# DLA26BZ03-NV012 — Phase I Technical Outline (working draft)

**Topic:** AI-Powered Tool for Automated Evaluation of Vendor Economic Dependency (DLA)
**Solicitation:** DoW SBIR 2026 BAA, Release 3 · **Closes 07/22/2026**
**Phase I:** $100,000 / 12 months · **Phase II:** $1,000,000 / 24 months
**Applicant:** GovCon Edu (for-profit SBC) · **Product base:** Mindy
**TPOCs:** Shea McCullough · Corey Cook · Matthew Borsinger (DLA)
**Status:** DRAFT outline — updated 2026-07-15 to reconcile with the official DSIP Q&A (`DLA-NV012-OFFICIAL-QA.md`). NOT the submission; maps to the mandatory DSIP template.

> **Honesty rule for this whole doc (revised per Q&A):** Mindy's native strength is the **entity
> resolution + multi-source data joins + provenance** and computing **federal spend per vendor at scale**
> (verified: federal $/vendor by UEI is live — McKesson $84B, Pfizer $28B). PER THE OFFICIAL Q&A, the
> federal-$ figure is the **SECONDARY** reliance layer — the **compliance numerator is DLA WCF
> revenue/disbursements from EBS**, which we compute on DLA's post-NDA sample using that same proven
> machinery. Claim what's built (the plumbing, the scale, the provenance) as feasibility; describe the
> WCF numerator + private-vendor + SFFAS-47 pieces as demonstrated feasibility, SME-anchored. Never claim
> the WCF numerator or audit-standard expertise are live today.

---

## 0. How this maps to the required Phase I work-plan format
(Per AFWERX Open Topic Phase I FAQ — same work-plan structure applies: Scope · Task Outline ·
Deliverables · Kickoff ≤30 days · Preliminary + Final report w/ SF298 & DD882. Content must sit on the
template's designated pages.)

| Template element | Filled by |
|---|---|
| Scope | §1 below |
| Task Outline | §3 (Tasks 1–7) |
| Deliverables | §4 |
| Kickoff (≤30 days) | Task 1 |
| Cost Volume | separate volume — $100K breakdown (§6 open items) |
| Volume 2 (technical, **20-page limit**) | §1–5 + Cybersecurity & Compliance statement (CMMC L2 self-attest + SPRS) |
| Volume 5 (supporting) | data dictionary, golden-dataset spec, architecture diagram |

---

## 1. SCOPE (the feasibility question)
**Can an AI-driven, controls-backed decision-support tool automatically and auditably quantify a DLA
vendor's *economic dependency* on DLA — and surface potential related-party indicators per SFFAS 47 —
by resolving a vendor universe from DLA's own EBS transaction data, joining it to public and alternative
vendor financials, and producing an independently re-computable evidence package, at a scale that
replaces DLA J8's current manual, ad-hoc process?**

Phase I proves the concept end-to-end on DLA's de-identified sample EBS extract and demonstrates the
**feasibility** of each step (it does NOT build the production system — that's Phase II, and it does NOT
make the final disclosure determinations — those stay with DLA J8/DoW per SFFAS 47). It delivers a
proof-of-concept tool + demonstrates a **golden-dataset** methodology + a Phase II plan. The topic and
Q&A explicitly require: resolve a vendor universe from sample **EBS** contract data, retrieve financials
from **SEC EDGAR + SAM.gov** (and *alternative* sources for private/foreign vendors), apply a
**configurable** economic-dependency criterion, produce **auditable, independently re-computable**
results, and plan Phase II.

**Core metric (per the official Q&A — this is the compliance definition):**
`economic_dependency_% = (vendor's DLA Working Capital Fund revenue/disbursements) ÷ (vendor's total consolidated gross revenue)`
- **Numerator = DLA WCF revenue/disbursements** (accruals + actual disbursements), computed from the
  **de-identified EBS transaction sample DLA provides** — NOT obligations (Q&A: obligations don't
  generate realized vendor revenue) and NOT federal-wide. This is the SFFAS-47 compliance numerator that
  directly supports audit finding **NFR FIN-2025-WCF-071**.
- **Denominator = total consolidated PARENT gross revenue**, from **SEC EDGAR 10-K** (XBRL) for public
  filers; for **private/foreign vendors** (in scope for Phase I, not deferred) from alternative public
  sources — web-harvested audited statements, PDF/OCR of financial sheets, or commercial DBs (D&B/
  Experian) — with a **confidence score** and **SAM.gov fallback** for coverage gaps. Segment-level
  revenue captured as an optional secondary layer where disclosed.
- **Configurable trigger (not hardcoded):** baseline **10%** revenue-concentration (FASB ASC
  280-10-50-42) **+ going-concern footnote detection** (FASB ASC 205-40), analyst-adjustable (5/10/20%)
  via a Configurable Policy Engine; point-in-time snapshot.
- **Secondary layer (favorably viewed):** aggregate federal reliance (USASpending/FPDS) for J7
  supply-chain concentration — this is where Mindy's native federal-$-by-UEI engine plugs in.
- **Related-party indicators:** dependency above the configured trigger + corroborating signals
  (contract-type + **contract-financing flags** — advance/progress payments, per Q&A — concentration,
  ownership/affiliate links), mapped to the **GAO FAM §230/§1001 materiality cascade** from DLA WCF
  Total Gross Cost. Findings are flagged **recommendations** for a Human-in-the-Loop analyst, not
  determinations.

---

## 2. TECHNICAL APPROACH (what we build in Phase I)
A proof-of-concept, decision-support pipeline — six stages, each grounded in an existing Mindy
capability (entity resolution, provenance, federal-award data) + the named sources, wrapped in the
Human-in-the-Loop + audit-evidence framing the Q&A requires:

1. **Entity resolution across schemas** — from the de-identified **EBS** sample, resolve the distinct
   vendor universe and normalize/clean/join across index keys (**CAGE / DUNS / EIN / UEI**) to real
   public filings. The Q&A names this as a *core* Phase I demo (the sample is de-identified and won't
   align line-by-line, so robust fuzzy/index-key resolution is the point). Mindy's award-detail spine
   already keys on these identifiers.
2. **WCF-dependency numerator** — aggregate each vendor's **DLA Working Capital Fund revenue/
   disbursements** (accruals + actual disbursements) from the EBS transaction sample, by parent vendor.
   *(Demonstrates the exact SFFAS-47 compliance numerator — not obligations.)* Mindy's federal-$-by-UEI
   engine computes the **secondary** federal-wide reliance layer in parallel (J7 supply-chain view).
3. **Public-financial denominator (public filers)** — automated **SEC EDGAR** retrieval of total
   consolidated parent revenue (XBRL `Revenues`/`RevenueFromContractWithCustomer`); RAG/NLP mine of the
   10-K for related-party disclosures, revenue-concentration language, and **going-concern** footnotes.
4. **Private / foreign vendor denominator (in scope for Phase I)** — demonstrate a feasible workflow to
   estimate gross revenue where no SEC filing exists: automated web-harvest of published audited
   statements, PDF parsing/OCR of financial sheets, and/or commercial DBs (D&B/Experian). Attach a
   **reproducible confidence / data-reliability index** (a re-derivable calculation, not a qualitative
   flag) and **fall back to SAM.gov** business-size/revenue representations, flagging coverage gaps.
5. **Configurable Policy Engine + risk scoring** — compute dependency %; apply a **configurable**
   trigger (10% baseline per FASB ASC 280-10-50-42 + going-concern per ASC 205-40; analyst-adjustable
   5/10/20% + NLP footnote toggles via UI). Weight risk by **contract type × contract-financing flags**
   (advance/progress payments) and concentration; map findings to the **GAO FAM §230/§1001 materiality
   cascade** from DLA WCF Total Gross Cost. Output flagged **recommendations**, not determinations.
6. **Audit-ready evidence package + HITL workspace** — for each finding, emit a self-contained,
   **exportable, independently re-computable** record: exact source data + as-of snapshot, calculation
   basis + logic, and a signed record of *which configurable threshold + data snapshot* produced it
   (so a prior-FY SFFAS-47 disclosure re-derives exactly in a later audit, outside the live tool).
   Present in a side-by-side inspection **dashboard** with Human-in-the-Loop analyst controls; DLA
   J8/J7 adjudicate.

**AI/NLP role (scoped honestly):** NLP/RAG handles entity-name normalization, 10-K/audited-statement
text-mining (related-party, revenue-concentration, going-concern), and OCR of private financials; the
dependency calc and confidence index are **deterministic, re-derivable math** — auditable on purpose,
never a black box, because the topic demands "absolute explainability and transparency" for financial
auditors. The system's role is to automate the labor-intensive screening/scoring/evidence-generation
and present recommendations; **final SFFAS-47 disclosure and consolidation calls remain DLA's** (a
policy/legal decision, per the Q&A).

---

## 3. TASK OUTLINE (the 12-month plan)

| # | Task | Months | Output |
|---|------|--------|--------|
| **1** | **Kickoff + NDA'd data intake** (≤30 days). Meet DLA J8/J7 TPOCs; execute NDA/Data Use; ingest the de-identified EBS sample; confirm the WCF-numerator definition, configurable-trigger policy, GAO-FAM materiality basis, and golden-dataset scope. | 0–1 | Kickoff memo; CUI-compliant intake; agreed criterion + scope |
| **2** | **Entity resolution + WCF numerator** — resolve the vendor universe from EBS; normalize/join across CAGE/DUNS/EIN/UEI to public filings; compute DLA WCF revenue/disbursements per parent vendor. (Mindy federal-wide layer computed in parallel = secondary J7 view.) | 1–3 | Resolved vendor table w/ WCF numerator (+ secondary federal layer) |
| **3** | **Public-filer financials** — automated SEC EDGAR retrieval (XBRL consolidated-parent revenue); RAG/NLP mine of 10-K for related-party, concentration, and going-concern language. | 3–5 | Public-financials table + footnote-signal extraction |
| **4** | **Private/foreign vendor feasibility** — demonstrate web-harvest / PDF-OCR / commercial-DB (D&B) workflow to estimate gross revenue; reproducible confidence index; SAM.gov fallback + gap flags. | 3–6 | Private-vendor pipeline demo + coverage/confidence report |
| **5** | **Configurable Policy Engine + evidence package** — dependency %; adjustable trigger (10% + going-concern) w/ analyst UI; contract-type × financing-flag risk; GAO-FAM materiality mapping; exportable, re-computable audit evidence + HITL dashboard. | 5–9 | Scored recommendations + independently re-derivable evidence packages |
| **6** | **Golden-dataset methodology + validation** — assemble the labeled multi-source reference set (EBS + SAM.gov + EDGAR); measure flag accuracy + edge-case handling; validate explainability. | 8–10 | **Golden-dataset** methodology + accuracy metrics |
| **7** | **Phase II plan + final report** — IL-5/GCP architecture w/ J6 proxy ingestion, EBS integration, ATO 12–18mo schedule; SF298 + DD882. | 10–12 | Final report; Phase II transition plan |

*(Tasks overlap; the bar/Gantt goes in Volume 2.)*

---

## 4. DELIVERABLES (what DLA gets)
1. **Proof-of-concept tool** — runs the pipeline on the EBS sample end to end, incl. a **Configurable
   Policy Engine** (adjustable trigger + NLP footnote toggles) and a **Human-in-the-Loop dashboard**
   with side-by-side evidence inspection.
2. **Private/foreign-vendor feasibility demo** — the web-harvest/OCR/commercial-DB workflow + confidence
   index + SAM.gov fallback (a core Phase I requirement, not deferred).
3. **Exportable audit-evidence packages** — self-contained, independently re-computable records per
   finding (source data + as-of snapshot + logic + signed threshold/data record).
4. **Golden-dataset methodology** — the labeled multi-source reference set + accuracy/edge-case metrics.
5. **Preliminary report** (~month 5–6) + **Final report** with SF298 & DD882.
6. **SFFAS-47 compliance memo** — how the criterion, GAO-FAM materiality mapping + evidence trail map to
   the standard (SME-authored).
7. **Phase II plan** — IL-5/GCP prototype design (J6 proxy ingestion, EBS integration, 12–18mo ATO
   schedule).

---

## 5. WHY US (feasibility credibility — grounded, no overclaim)
- **The hard plumbing already exists.** Mindy runs production **entity resolution + multi-source joins**
  across 317K contractors keyed on CAGE/UEI, with a **denominator pipeline** (public-financial retrieval)
  and **provenance on every figure** — exactly the entity-resolution, data-join, and "auditable,
  traceable" spine this topic's numerator/denominator both ride on. The vendor-resolution and
  public-financial-join risk is retired, not researched.
- **We already compute federal spend per vendor at scale** — which is precisely the **secondary,
  favorably-viewed** federal-wide reliance layer (J7 supply-chain view). We map DLA's WCF-specific
  numerator onto the same proven aggregation-by-parent-vendor machinery, using the EBS sample.
- **Provenance + explainability are built in**, not bolted on — every number carries source + as-of
  date, and our calcs are deterministic/re-derivable, matching the "absolute explainability" and
  **independently re-computable evidence** the Q&A demands for auditors.
- **Mature, dual-use, TRL-7/8 COTS** — Mindy is a commercially viable platform (DLA's stated preference:
  customize+integrate a mature dual-use tool over greenfield), reducing transition timeline and cost.
- **SEC EDGAR + SAM.gov are our core sources** — the exact ones the topic and Q&A name.
- **The accounting/SFFAS-47 compliance framing is covered by a named SME**, not hand-waved (see Team) —
  Mindy brings the data engine + evidence discipline; the SME anchors the standard, materiality cascade,
  and related-party criterion.
- **Honest scope line:** we do NOT claim the WCF-disbursement numerator is live today — it runs on DLA's
  post-NDA EBS sample. What we claim is that every *capability that makes computing it feasible* (entity
  resolution, aggregation by parent, denominator retrieval, provenance, private-vendor fallback) is
  already built and demoable, so Phase I is integration + validation, not invention.

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
| SFFAS-47 expertise gap | Real — Mindy is market-intel, not audit | Named accounting SME (open item #1) — STILL the make-or-break gate |
| WCF numerator needs EBS data we don't hold pre-award | Real — the compliance numerator runs on DLA's post-NDA sample | Feasibility proposal describes the method on their EBS schema; every enabling capability (resolution, aggregation, provenance) is already built → integration, not invention |
| Private/foreign vendors have no public 10-K | Real — and Q&A says this is IN SCOPE for Phase I, not deferrable | Phase I DEMONSTRATES the private-vendor workflow (web-harvest/OCR/D&B) + confidence index + SAM.gov fallback (Task 4) — do NOT scope it out |
| Secure-environment / CMMC | Real for production | Phase I = offeror-hosted CUI-compliant, **FedRAMP Moderate acceptable**; IL-5 is Phase II. CMMC L2 self-attest + SPRS score stated in Vol-2 cyber paragraph |
| ITAR / foreign nationals | Real constraint | US-person team; disclose per §3.5 |
| "The AI decides" objection | Auditors distrust black-box determinations | Framed as HITL decision-support: tool recommends, DLA J8/J7 adjudicate; calcs deterministic + re-computable |
| "Just a data tool" perception | Risk if pitched as Mindy-as-is | Reframe: SFFAS-47 economic-dependency *screening + audit-evidence* system, SME-anchored, tied to finding NFR FIN-2025-WCF-071 |

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

---

## Q&A-DELTAS — where the official DSIP Q&A (pulled 2026-07-15) CHANGES this outline
> Full Q&A: `DLA-NV012-OFFICIAL-QA.md`. These are the answers straight from J8, so they override the
> draft above. MUST be reconciled into the submission before 07/22.

**🔴 1. NUMERATOR IS WRONG in §1/§2/§5.** The core compliance numerator is **DLA Working Capital Fund
revenue/disbursements (accruals + actual disbursements), NOT obligations.** Q&A: "obligations do not
directly generate realized vendor revenue." Mindy's native federal-obligated-$-by-UEI is explicitly the
**SECONDARY** supply-chain layer ("viewed highly favorably"), not the compliance metric. **Reframe:** the
WCF-disbursement numerator is computed from the **de-identified EBS sample data DLA provides post-NDA**;
Mindy brings the entity-resolution spine, the denominator pipeline, provenance, and the secondary
federal-wide layer. Ties to audit finding **NFR FIN-2025-WCF-071**. Do NOT lead "Why Us" with the
obligation engine as if it's the answer — it's the adjacent proof + the plumbing.

**🔴 2. PRIVATE/FOREIGN VENDORS CAN'T BE DEFERRED.** §1 stage 3, §7 risk row, and the one-pager all
scope private vendors to "gap/manual review, Phase II adds D&B." Q&A: proving private/foreign feasibility
is a **CORE Phase I requirement** — must demo a real workflow (web-harvest audited statements, PDF/OCR,
or D&B/Experian) + confidence score + SAM.gov fallback. **Rewrite** stage 3 + Task 3 to include the
private-vendor pipeline, not defer it.

**🟠 3. CONFIGURABLE POLICY ENGINE (mandatory, not "SME-defined criterion").** Baseline **10%**
revenue-concentration (FASB ASC 280-10-50-42) **+ going-concern footnote detection** (FASB ASC 205-40),
analyst-adjustable 5/10/20% + NLP footnote toggles via UI. Point-in-time snapshot. Add to §2/Task 4.

**🟠 4. HUMAN-IN-THE-LOOP DECISION-SUPPORT framing (required).** Tool screens/scores/generates evidence
+ side-by-side inspection workspace + HITL controls → presents "recommendations." DLA/DoW makes final
SFFAS-47 disclosure/consolidation calls. Say this explicitly (de-risks "the AI decides" objection).

**🟠 5. NAMED REQUIREMENTS to address:** (a) **GAO FAM §230 + §1001 materiality cascade** from WCF Total
Gross Cost → WCF threshold — propose how scoring maps to it. (b) **Contract-financing flags** (advance/
progress payments) weight risk alongside contract type. (c) **Consolidated-parent** denominator (segment
= optional secondary). Add these to §2/§4.

**🟠 6. AUDIT EVIDENCE = exportable + independently re-computable OUTSIDE the tool.** Signed record of
which threshold + data snapshot produced each finding, so a prior-FY disclosure re-derives exactly.
Confidence index must be a reproducible calculation, not a qualitative flag. Strengthen §2 stage 4.

**🟡 7. CMMC/ENV detail (§6, §7, §8 mostly right — refine):** Phase I env = offeror-hosted CUI-compliant,
**FedRAMP Moderate acceptable** (IL-5 is Phase II only). Keep CMMC L2 self-attest as the story — Q&A
CONFIRMS §8's "no cyber partner needed." ADD to Vol-2: a brief "Cybersecurity & Compliance" statement
(active CMMC L2 self-attest + active SPRS score per DFARS 7019/7020 + active SSP, no critical POA&Ms).
**Vol-2 = 20-page limit.** Sample EBS data is **CUI//SP-PROPIN + CUI//SP-PRVCY** under NDA.

**🟢 8. STRENGTHENERS now nameable:** audit finding **NFR FIN-2025-WCF-071**; owner **J8** (+ J7
dual-view); **GAO FAM** basis; **TRL 7/8 dual-use** preference (Mindy = mature COTS, fits perfectly);
**batch-upload + dashboard** UX; sources = **EBS + EDGAR + SAM.gov** (USASpending secondary, DIBBS out).
SFFAS-47 SME (§6 #1) is STILL the make-or-break gate.

**⚙️ ACTION before submit:** (1) **Sign the NDA/Data Use** to get the EBS sample — form
https://forms.osi.apps.mil/r/vLpqrz561L — the WCF-numerator reframe depends on it. (2) Rewrite §1/§2/§5
numerator. (3) Un-defer private vendors. (4) Add configurable engine + HITL + FAM materiality +
financing flags + exportable evidence. (5) Add Vol-2 cyber statement. (6) STILL secure the SME.

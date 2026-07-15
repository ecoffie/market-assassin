# DLA26BZ03-NV012 — Official DSIP Q&A (pulled 2026-07-15)

> Source: DSIP topic Q&A, questions submitted 06/04/2026 → 07/08/2026. This is the AUTHORITATIVE
> government clarification record. Where it conflicts with our one-pager / Phase I outline, THIS WINS.
> Several answers materially change scope — see `DLA-NV012-PHASE-I-OUTLINE.md` §Q&A-DELTAS.

## The highest-impact clarifications (proposal-shaping)

1. **NUMERATOR = DLA WCF revenue/disbursements, NOT obligations, NOT federal-wide.** For SFFAS 47
   compliance, "DLA business" = DLA Working Capital Fund **accruals + actual disbursements**,
   specifically. Obligations "do not directly generate realized vendor revenue." Broader DoD/federal
   (USASpending/FPDS) = **secondary** supply-chain layer, "viewed highly favorably" but NOT the core
   compliance metric. → Directly ties to audit finding **NFR FIN-2025-WCF-071**.

2. **DENOMINATOR = consolidated PARENT total gross revenue** (from 10-K). Segment-level = optional
   secondary layer if disclosed. Assess at consolidated-parent level per SFFAS 47.

3. **THRESHOLD = configurable engine, baseline 10% revenue-concentration** (aligned FASB ASC
   280-10-50-42) **+ "going concern" footnote detection** (FASB ASC 205-40). Must NOT be hardcoded —
   analysts adjust 5/10/20% + toggle NLP footnote filters via UI. Point-in-time snapshot.

4. **PRIVATE / FOREIGN vendors are IN SCOPE for Phase I — cannot defer to Phase II.** Must demonstrate
   a feasible workflow: web-harvest/scrape corporate sites for audited statements, PDF/OCR parsing,
   or commercial DBs (D&B, Experian, private-market). Then confidence score + SAM.gov fallback for gaps.

5. **DATA = de-identified synthetic flat-files (CSV/JSON/Excel) mirroring EBS master tables**, provided
   to Phase I awardees AFTER an **NDA/Data Use Agreement** (request form:
   https://forms.osi.apps.mil/r/vLpqrz561L ). Marked **CUI//SP-PROPIN + CUI//SP-PRVCY**. Includes
   resolved CAGE/DUNS/EIN (some masked). **No live EBS API / sandbox in Phase I** — offeror-hosted only.
   Entity-resolution across de-identified internal ↔ real public filings is a CORE Phase I demo.

6. **PHASE I ENVIRONMENT = offeror-hosted, CUI-compliant. FedRAMP Moderate (or equiv) is acceptable**
   for Phase I (IL-4/High also fine, not required). **IL-5 is a PHASE II production constraint only.**
   Must comply with **NIST SP 800-171 R2 + DFARS 252.204-7012**; **CMMC Level 2 self-attestation is a
   condition of AWARD** (not required in the proposal volume, but include a brief "Cybersecurity &
   Compliance" statement confirming active CMMC L2 self-attestation + active SPRS score + active SSP,
   no critical POA&Ms). Formal SPRS/SSP verification happens pre-award.

7. **MATERIALITY = GAO FAM §230 + §1001 five-step materiality cascade** from DLA WCF Total Gross Cost
   down to a WCF materiality threshold. Proposers must propose how risk-scoring maps findings to this.

8. **RISK DIMENSIONS beyond cost-reimb vs fixed-price:** weight by contract type **× active
   contract-financing flags (advance / progress payment indicators)** — they raise DLA's financial
   exposure. (FAR contract-type sections recommended as the basis.)

9. **SYSTEM ROLE = decision-support w/ Human-in-the-Loop, NOT a determiner.** Automate screening,
   risk-scoring, entity resolution, RAG footnote text-mining → present flagged "recommendations" +
   side-by-side evidence workspace + HITL analyst controls. Final SFFAS-47 disclosure / consolidation
   determinations stay with DLA/DoW financial-management personnel (policy/legal decision).

10. **AUDIT EVIDENCE = self-contained, EXPORTABLE, independently re-computable OUTSIDE the tool.**
    Every finding: visible audit trail, exact source data + as-of snapshot, calculation basis + logic,
    signed record of which configurable threshold + data snapshot produced each determination (so a
    prior-FY SFFAS-47 disclosure can be re-derived exactly in a later audit). Confidence/reliability
    index must be a mathematically reproducible calculation, not just a qualitative flag.

11. **OWNER = DLA Finance (J8)** primary system owner; **dual-view adjudication J8 (audit disclosure)
    + J7 (supply-chain risk)**. Trigger = drive to a clean, unqualified audit opinion. DLA has NO
    current automated related-party / SFFAS-47 tool (manual, ad-hoc).

12. **TRL preference 7/8** — commercially mature / dual-use, customization+integration over greenfield
    (greenfield not prohibited, fully evaluated, but strong COTS/dual-use preference).

13. **PHASE II target env** = government-hosted **GCP tenant at IL-5**, integrating **EBS** (master
    tables + GL views; exact system CUI). **No outbound public internet in IL-5** — SEC EDGAR/SAM.gov
    ingestion must route via **DLA J6 secure web/API proxies**. **ATO takes 12–18 months** — factor
    into Phase II transition schedule.

14. **SOURCES for Phase I** = **EBS (provided) + SEC EDGAR + SAM.gov** (the core). USASpending/FPDS =
    less critical (aggregated/historical), secondary only. **DIBBS out of scope** (already duplicated in
    EBS). No DCAA/DCMA needed in Phase I. Additional sources allowed but prioritize the core three.

15. **OUTPUT = interactive dashboard** (primary) for analyst/leadership actionable insight; PDFs /
    flat-file exports evaluated during Phase I. Workflow = large-scale **batch upload** at reporting
    intervals + point-in-time maintenance queries.

16. **GOLDEN DATASET** = seeded by DLA sample data + SAM.gov + SEC EDGAR into an end-to-end multi-source
    reference baseline; large enough vendor cohort to prove flagging + edge cases (formatting gaps);
    outputs must show absolute explainability. **NOT required to be pre-built by offeror in Phase I** —
    prove feasibility + how; EBS access to build it comes after Phase I award.

17. **Procedures/SOPs = OUT of scope** (government-led workstream). Phase I proves the tool + models the
    underlying logic/methodology, but does NOT build DLA's formal SOPs.

18. **Oral presentation** may be requested for highly acceptable proposals; team composition = offeror's
    discretion. **Volume 2 Technical = 20-page limit.** Eval = individual technical merit (not
    weighted/ranked against others); technical approach is the assessment basis.

## Logistics
- **NDA/Data Use request form:** https://forms.osi.apps.mil/r/vLpqrz561L (POC noted: Matthew Borsinger)
- **SFFAS 47 handbook (cited by DLA):** https://files.fasab.gov/pdffiles/handbook_sffas_47.pdf
- **Audit finding driving it:** NFR FIN-2025-WCF-071
- **Deadline:** 07/22/2026

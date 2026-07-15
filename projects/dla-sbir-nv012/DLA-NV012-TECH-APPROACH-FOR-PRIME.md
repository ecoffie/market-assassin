# Technical Approach — Mindy Data Engine (GovCon Edu, technical subcontractor)

> **For:** `[PRIME]`'s Volume 2, DLA26BZ03-NV012. This is the technical-approach contribution from
> **GovCon Edu** (product: **Mindy**) as the technical data-engineering subcontractor. `[PRIME]` owns the
> SFFAS-47 / audit-readiness methodology, the CMMC L2 / CUI-handling posture, and the overall Volume 2.
> Drop-in prose below; replace `[PRIME]` and trim to fit the 20-page limit. Written to the official Q&A.

---

## Team construct (one paragraph — for the prime to place near the top)

`[PRIME]` brings the federal-agency audit-readiness and SFFAS 47 domain expertise — the materiality
methodology, related-party criterion, and the CMMC Level 2 / CUI-compliant environment in which Phase I
is performed. **GovCon Edu** contributes **Mindy**, a production federal market-intelligence platform, as
the technical data engine: entity resolution across disparate identifiers, multi-source financial data
retrieval, dependency computation, and provenance-by-default evidence generation. The division is clean:
`[PRIME]` owns the *standard*; GovCon Edu owns the *data engineering and tooling*. This lets the team
demonstrate Phase I feasibility as **integration and validation of proven components**, not new research.

---

## 1. Solution overview

The proposed solution is an AI-driven, controls-backed **decision-support** system that automates DLA
J8's currently manual, ad-hoc screening of vendor economic dependency and related-party indicators under
SFFAS 47. It resolves a vendor universe from DLA's Enterprise Business System (EBS) transaction data,
computes each vendor's economic dependency on the DLA Working Capital Fund (WCF), retrieves the vendor's
total consolidated revenue from public and alternative sources, applies a **configurable** dependency
criterion, and produces an **independently re-computable audit-evidence package** for each finding. The
system **flags recommendations** for a human analyst; DLA J8/J7 retain all final SFFAS 47 disclosure and
consolidation determinations. Phase I proves feasibility end-to-end on DLA's de-identified EBS sample and
the named public sources; it does not build the production system (Phase II) or make binding
determinations (a government policy/legal function).

## 2. The economic-dependency computation (per DLA's stated definition)

The core metric is:

**economic_dependency_% = (vendor's DLA WCF revenue / disbursements) ÷ (vendor's total consolidated parent gross revenue)**

- **Numerator — DLA WCF revenue/disbursements.** Computed from the de-identified EBS transaction sample
  (purchase orders and invoice postings), aggregated by parent vendor. Consistent with DLA's guidance,
  the numerator uses **accruals and actual disbursements**, not obligations — because obligations do not
  represent realized vendor revenue. This is the numerator that supports DLA's SFFAS 47 related-party
  disclosures and the WCF audit finding this topic addresses. Mindy's aggregation-by-parent-vendor
  machinery, proven at scale on federal award data, is applied to the EBS transaction set.
- **Denominator — total consolidated parent gross revenue.** Assessed at the consolidated-parent level
  per SFFAS 47; segment-level revenue is captured as an optional secondary analytic layer where
  disclosed.
- **Secondary reliance layer.** In parallel, Mindy computes each vendor's aggregate reliance on the
  broader Federal Government from public award data (USASpending/FPDS) — a supply-chain concentration
  view for DLA J7. This is a proven, live Mindy capability (federal obligated dollars per vendor by UEI
  across 317K contractors) and is presented as the favorably-viewed secondary layer, distinct from the
  WCF compliance numerator.

## 3. Technical approach — the Phase I pipeline

**Stage 1 — Entity resolution across schemas.** The de-identified EBS sample will not align line-by-line
with live public filings, so robust entity resolution is a core Phase I demonstration. Mindy normalizes,
cleans, and joins vendor records across index keys (**CAGE, DUNS, EIN, UEI**), reconciling the standard
ERP field names with DLA-specific labels and handling realistic formatting discrepancies (inconsistent
document numbering, duplicate names). Mindy's contractor spine already keys on these identifiers in
production.

**Stage 2 — WCF numerator.** Aggregate DLA WCF revenue/disbursements per resolved parent vendor from the
EBS transaction sample. The secondary federal-wide reliance layer is computed in parallel.

**Stage 3 — Public-filer financials.** Automated **SEC EDGAR** retrieval of consolidated-parent total
revenue (XBRL `Revenues` / `RevenueFromContractWithCustomer` facts), with RAG/NLP text-mining of the
10-K for related-party disclosures, revenue-concentration language, and **going-concern** footnotes
(FASB ASC 205-40).

**Stage 4 — Private and foreign vendor feasibility (in scope for Phase I).** For vendors with no public
SEC filing, the pipeline demonstrates a feasible workflow to estimate gross revenue: automated
web-harvesting of published audited statements from corporate sites, PDF parsing / OCR of financial
sheets, and programmatic integration with commercial credit / corporate databases (e.g., Dun &
Bradstreet, Experian). Each estimate carries a **reproducible confidence / data-reliability index** — a
re-derivable calculation, not a qualitative flag — and, where alternative sources are exhausted, the
tool **falls back to SAM.gov** business-size/revenue representations and flags a documented coverage gap.

**Stage 5 — Configurable Policy Engine and risk scoring.** Dependency % is compared against a
**configurable** trigger — a **10%** revenue-concentration baseline (aligned with FASB ASC 280-10-50-42
major-customer disclosure) combined with going-concern detection — which J8 analysts adjust (e.g., 5%,
10%, 20%) and toggle NLP footnote filters through a simple UI; no hardcoded threshold. Risk is weighted
by **contract type in combination with active contract-financing flags** (advance/progress-payment
indicators, which increase DLA's financial exposure), and findings are mapped to the **GAO Financial
Audit Manual (§230 and §1001) five-step materiality cascade** from DLA WCF Total Gross Cost. `[PRIME]`
defines the SFFAS-47 criterion and materiality mapping that the engine implements.

**Stage 6 — Audit-evidence package and Human-in-the-Loop workspace.** For every finding, the system
emits a self-contained, **exportable, independently re-computable** record: exact source data with an
as-of snapshot, calculation basis and logic, and a signed record of the specific configurable threshold
and data snapshot that produced the determination — so a prior fiscal-year SFFAS 47 disclosure can be
re-derived exactly during a later audit, **outside the live tool**. Findings are presented in an
interactive **dashboard** with side-by-side evidence inspection and Human-in-the-Loop analyst controls.
The standard workflow is a large-scale **batch upload** of vendor datasets at reporting intervals plus
point-in-time maintenance queries.

**AI/NLP role, scoped for auditability.** NLP/RAG handles entity-name normalization, financial-statement
text-mining (related-party, concentration, going-concern), and OCR of private financials. The dependency
calculation and the confidence index are **deterministic, re-derivable math** — never a black box —
satisfying the topic's requirement for absolute explainability and transparency to financial auditors.

## 4. Data sources (Phase I)

Core sources are the **DLA EBS sample** (provided under NDA/Data Use), **SEC EDGAR**, and **SAM.gov**,
consistent with DLA's guidance. USASpending/FPDS is used only for the secondary federal-wide reliance
layer; DIBBS is out of scope (its critical contract data is already duplicated in EBS). No live EBS API,
DLA sandbox, or DCAA/DCMA data is required in Phase I; external public sources are acquired via their own
public REST/XBRL APIs.

## 5. Phase I deliverables (GovCon Edu technical scope)

1. Proof-of-concept tool running the pipeline on the EBS sample, including the Configurable Policy Engine
   and the Human-in-the-Loop evidence dashboard.
2. Private/foreign-vendor feasibility demonstration (web-harvest / OCR / commercial-DB) with confidence
   index and SAM.gov fallback.
3. Exportable, independently re-computable audit-evidence packages.
4. Golden-dataset methodology (EBS + SAM.gov + SEC EDGAR reference baseline) with flag-accuracy and
   edge-case metrics.
5. Inputs to the Phase II plan: an IL-5 / GCP target architecture, with SEC EDGAR / SAM.gov ingestion
   routed through DLA J6 secure proxies, EBS integration, and the 12–18-month ATO timeline factored in.

## 6. Why this team can do it (feasibility, no overclaim)

- **The data-engineering risk is retired.** Mindy runs production entity resolution and multi-source
  financial joins across 317K contractors, with a public-financial retrieval pipeline and provenance on
  every figure — the exact spine both the numerator and denominator ride on. Phase I integrates and
  validates proven components rather than researching new ones.
- **Federal-spend-per-vendor at scale is live**, providing the secondary reliance layer directly and the
  aggregation machinery reused for the WCF numerator.
- **Provenance and explainability are built in**, matching the independently re-computable evidence the
  topic demands.
- **Mature, dual-use, high-TRL** — Mindy is a commercially viable platform, aligning with DLA's stated
  preference to customize and integrate a mature dual-use tool over greenfield development.
- **`[PRIME]` anchors the standard** — SFFAS 47 criterion, GAO-FAM materiality, related-party
  determination logic — and provides the CMMC Level 2, CUI-compliant environment in which Phase I is
  performed.

---

### Honest-scope note (for the team, delete before submission)
Mindy does **not** compute the DLA WCF numerator today — that runs on DLA's post-NDA EBS sample. What is
live and demoable is every enabling capability (entity resolution, aggregation by parent, denominator
retrieval, provenance, private-vendor fallback). Claim the enabling capabilities as live; describe the
WCF numerator, private-vendor estimation, and SFFAS-47 mapping as demonstrated Phase I feasibility.
Do not claim CMMC/audit expertise on GovCon Edu's side — that is `[PRIME]`'s.

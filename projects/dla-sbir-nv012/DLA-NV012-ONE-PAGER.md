# AI for Federal Vendor Economic Dependency — DLA SBIR Teaming Brief (Technical Provider)

**The opportunity:** DLA SBIR topic **DLA26BZ03-NV012** — *AI-Powered Tool for Automated Evaluation
of Vendor Economic Dependency.* Phase I **$100K / 12 mo** → Phase II **$1M / 24 mo** → Phase III
transitions DoD-wide. **Closes 22 July 2026.** Customer (DLA) is already attached.
**Us:** GovCon Edu, product **Mindy** — the **technical provider** (the AI/data engine). **We're
looking for a prime** with **CMMC Level 2** + **agency-side SFFAS 47 / audit-readiness** expertise —
the two pieces this topic hinges on. You prime; we bring the tech.

---

## What DLA wants
An AI tool that automatically assesses how economically dependent each DLA vendor is on the
government — identifying **related parties and concentration risk per SFFAS 47** to support audit
readiness and supply-chain resilience. Today this is manual and can't scale across thousands of
vendors and millions of transactions.

The tool must: resolve a vendor universe from DLA's EBS transaction data → retrieve public financials
(SEC EDGAR, 10-Ks, SAM.gov) plus alternatives for private vendors → compute economic dependency
(vendor's **DLA Working Capital Fund revenue** ÷ its total consolidated revenue) against a
**configurable** threshold → flag related-party/risk indicators by contract type → produce
**auditable, independently re-computable** results a human analyst reviews (DLA makes the final call).

---

## ✅ What WE bring (built and proven)
- **The data engine + entity-resolution spine.** Our platform (Mindy) already resolves vendors across
  **CAGE / UEI / DUNS** and computes **federal spend per vendor at scale** across the entire USASpending
  universe (317K contractors) — the hard data-engineering (entity resolution, aggregation by parent
  vendor, multi-source joins) is a production capability, not a research risk. *(e.g., it returns
  McKesson's $84B / Pfizer's $28B in federal spend instantly.)* This same machinery computes the tool's
  DLA-specific numerator from DLA's transaction data.
- **The public-financial join (the denominator).** Built to ingest SEC EDGAR 10-K revenue + SAM.gov —
  the exact sources the topic names — with a fallback path for private/foreign vendors (audited-statement
  harvesting, OCR, commercial DBs).
- **Provenance + explainability by default.** Every figure carries its source + as-of date, and our
  calcs are deterministic and re-derivable — the "auditable, traceable, independently re-computable"
  evidence the topic and SFFAS 47 require.

> **The dependency metric (per DLA's own Q&A):** economic dependency = a vendor's **DLA Working Capital
> Fund revenue/disbursements** ÷ its **total consolidated revenue**. The DLA-specific numerator is
> computed from DLA's transaction data (provided post-award); vendor-wide federal spend is the *secondary*
> supply-chain layer. We bring the engine that does both.

## 🔲 What we need in a PRIME (this is the ask)
This topic hinges on two things Mindy deliberately doesn't cover — so we want a prime who brings both:
- **CMMC Level 2** (self-attestation + active SPRS score) — a **condition of award** for this topic, and
  the CUI-compliant environment Phase I is performed in.
- **Agency-side SFFAS 47 / audit-readiness expertise** (FIAR, FASAB — helping DLA audit its *own* books,
  not contractor-side DCAA/FAR) — to define the dependency/related-party criterion, anchor the proposal
  in DLA's audit language, and own the compliance methodology.

We were originally set to prime this ourselves, but a prime with **both** of those puts the team in a
far stronger position — so we'd rather come in as the technical provider (the "✅ What WE bring" engine
above is our lane).

---

## The deal (for the prime)
- **You prime; we're the essential tech sub.** You hold the award, the customer relationship, and
  Phase III; we deliver the engine that makes the tool work. Clean two-party structure.
- **Real upside.** $100K Phase I → $1M Phase II → Phase III sole-source pathway, DoD-wide.
- **Light integration lift.** The AI/data pipeline is ours and largely built — you bring the CMMC posture
  and the SFFAS-47 standard, not a from-scratch engineering effort.
- **Fast.** Closes 22 July 2026 — we're moving now.

---

## Phase I in one breath
A feasibility study: take DLA's de-identified sample EBS data → resolve the vendor universe → compute
the DLA WCF-dependency numerator → pull public + private financials for the denominator → apply the
configurable SFFAS-47 criterion → deliver a **proof-of-concept tool + a "golden dataset" methodology +
exportable audit evidence + a Phase II plan.** Not production, and not final determinations — proving
the concept is feasible on real data.

---

**Interested, or know someone who is?**
Eric Coffie · GovCon Giants / GovCon Edu · [phone] · [email]

*Grounded in the DLA26BZ03-NV012 topic text + verified platform capability. June 2026.*

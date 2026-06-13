# Federal RFP / Proposal Structure — Authoritative Baseline

The theory layer for the "normal RFP" response template. Grounded in the FAR +
standard forms (not memory). The empirical pass (`scripts/analyze-rfp-formats.ts`)
validates/corrects this against hundreds of real RFPs in our DB.

> **Key distinction:** the **Uniform Contract Format (UCF)** is how the
> *solicitation* is laid out. What we template is the **offeror's response**,
> which Section L tells you how to structure (typically into volumes). They are
> not the same document.

---

## 1. The Uniform Contract Format — solicitation sections A–M (FAR 15.204-1)

How a FAR Part 15 (negotiated) solicitation is organized.

**Part I — The Schedule**
- **A** — Solicitation/contract form
- **B** — Supplies or services and prices/costs
- **C** — Description / specifications / statement of work (the **SOW/PWS**)
- **D** — Packaging and marking
- **E** — Inspection and acceptance
- **F** — Deliveries or performance
- **G** — Contract administration data
- **H** — Special contract requirements

**Part II — Contract Clauses**
- **I** — Contract clauses

**Part III — List of Documents, Exhibits, and Other Attachments**
- **J** — List of attachments

**Part IV — Representations and Instructions**
- **K** — Representations, certifications, and other statements of offerors
- **L** — Instructions, conditions, and notices to offerors  ← *drives the response structure*
- **M** — Evaluation factors for award  ← *drives what the response must prove*

**The L↔M↔C triangle (the core rule):** the offeror's response follows **Section
L's instructions**, addresses every requirement in **Section C (SOW)**, and is
written to win on **Section M's evaluation factors**. L, M, and the SOW must trace
to each other. A response section that answers no L instruction / no M factor is
wasted; an L instruction / M factor with no response section is a compliance gap.

## 2. The standard offeror response — volumes

When Section L doesn't dictate otherwise, the conventional split (SBA / industry
standard) is:

- **Volume I — Offer / Administrative**: SF1442 or SF33 signed, Section K reps &
  certs, amendment acknowledgments, cover letter.
- **Volume II — Technical & Management**: the technical approach (how you'll do the
  SOW), management plan, key personnel, corporate experience — evaluated against
  Section M. Keep this volume free of price (a common DQ).
- **Volume III — Past Performance**: relevant recent projects (CPARS / references).
  Sometimes folded into Volume II.
- **Volume IV / separate — Price / Cost**: the fully-priced schedule (Section B /
  Schedule B). **Always physically separate from technical** — intermixing price
  into the technical volume is a frequent disqualifier.

Construction IDIQ/MACC is a *specialization* of this (the 4-volume Tech / Past
Perf / Price / Sol-&-Award with Volume I split by subfactor) — already templated.

## 3. The simplified / commercial reality (FAR Parts 12 & 13)

Most opportunities are NOT full FAR-15 UCF proposals. The "normal RFP" the user
actually faces is often:

- **FAR Part 12 — Commercial products/services**: uses **SF1449**; far lighter.
  Often a **Combined Synopsis/Solicitation** (FAR 12.603 streamlined) where there
  is no separate Sections L/M at all — instructions and eval criteria are short
  paragraphs in the notice body. Quote-style response, not a multi-volume proposal.
- **FAR Part 13 — Simplified Acquisition (≤ SAT)**: even lighter; often just a
  quote on the SF1449 schedule + a brief capability/price.
- **RFQ vs RFP**: an RFQ (commercial) asks for a *quote* (no binding offer); an RFP
  asks for a binding *proposal*. The response weight differs accordingly.

**Implication for the template:** "normal RFP" is a SPECTRUM, not one format. The
template must detect where a given notice sits — full UCF FAR-15 (heavy, L/M-driven
volumes) vs. commercial FAR-12 combined-synopsis (light, quote-style) — and shape
the response accordingly. Assuming every RFP is a full L/M UCF proposal (my first
instinct) would over-structure the majority of real, smaller commercial buys.

## 4. What the data pass (#9) must answer

1. Of real Solicitations / Combined-Synopsis notices in our DB, what fraction are
   full UCF (FAR 15) vs. commercial combined-synopsis (FAR 12/13)?
2. How often do real notices actually contain explicit "Section L" / "Section M"
   labels vs. bury instructions/criteria in prose?
3. What are the most common *response* structures requested (volume schemes,
   page limits, required plans)?
4. → Which baseline shape (heavy UCF vs. light commercial) should be the DEFAULT,
   and what signals pick between them.

---

*Sources: FAR 15.204-1 (UCF, acquisition.gov); FAR Subpart 12.6 / 12.603
(streamlined commercial solicitations); SBA "Developing Technical and Past
Performance Volumes" (sba.gov). Baseline written 2026-06-13; validated by the
empirical pass before any template is built.*

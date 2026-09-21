# Mindy — AI Capability for the DLA Enterprise / Agentic AI Requirement

**Prepared for:** Servexo Protective Services — GSA MRAS RFI, "OSW – AI Vendor Market Research"
(DLA Enterprise Artificial Intelligence & Agentic AI Rapid Support Services)
**Teaming partner:** GovCon Giants / Mindy (AI technical capability) · getmindy.ai · eric@govcongiants.com · 786-208-2071

---

## Who we are
**Mindy** is a production AI platform delivering **grounded large-language-model (LLM) and
retrieval-augmented generation (RAG)** over authoritative federal data — 317,000+ contractor records
and 88,000+ live federal solicitations sourced from USASpending and SAM.gov — with **citation-backed
answers, hallucination controls, and bounded agentic workflows** for market research, incumbent
analysis, and response drafting.

**Operating history:** federal market-intelligence software for the government-contracting community
**since 2024** — a suite of commercial GovCon products (Federal Market Assassin, Federal Contractor
Database, Recompete Tracker, Content Reaper, Opportunity Hunter) now unified into **Mindy**.
**Current scale:** **~1,900 users/customers.** Commercial product per FAR Part 12.
**Capability website:** getmindy.ai

On this requirement, **Servexo provides the GSA Schedule vehicle, cleared staffing, and program
delivery; Mindy provides the AI/LLM/RAG and agentic-automation technical capability and federal
domain expertise** the requirement centers on.

---

## 1. Production LLM/RAG integrated with authoritative data + legacy systems
Our architecture delivers a secure, production-grade LLM/RAG capability — not a prototype:

- **Ingestion & integration:** connectors to authoritative and legacy data sources; normalized,
  NUL-safe ingestion; semantic chunking with structured metadata (agency, NAICS/PSC, date, document type).
- **Vector store & retrieval:** embeddings to a managed vector store; **metadata-filtered retrieval** so
  answers draw only from the authorized, relevant corpus.
- **Grounding & citations:** every answer carries **inline citations to the source record and as-of
  date**. Responses that cannot be grounded **abstain** rather than fabricate.
- **Hallucination reduction:** retrieval-only context, citation enforcement, confidence gating,
  abstain-on-insufficient-evidence, and an LLM-as-judge fact-check on high-stakes output.
- **Model evaluation:** labeled gold dataset; precision/recall on retrieval and factuality scoring,
  with regression testing on every change.
- **Security & sustainment:** least-privilege service accounts, encryption in transit and at rest, full
  audit logging, a provider-agnostic model fallback chain (no single-vendor lock-in), and cost
  controls — engineered to run continuously in production.

## 2. AI-enabled workflow automation with agentic controls
We match the automation method to the task and enforce strict governance on autonomous action:

- **Method selection:** rules-based automation for deterministic steps; AI-assisted (human-in-the-loop)
  for drafting; retrieval-enabled for grounded answers; **agentic execution only where multi-step
  autonomy genuinely earns its risk.**
- **Human oversight & control:** approval routing, **bounded/scoped permissions**, reversible
  operations with rollback, full **audit logging and traceability** on every agentic action.
- **Safeguards:** defenses against unauthorized actions, invalid tool calls, prompt injection, and data
  leakage — via tool allow-listing, input/output filtering, and least-privilege so an agent cannot act
  outside its lane.

## 3. Delivery & staffing
Servexo leads cleared staffing and program delivery (Secret / IT-II personnel across AI/ML, LLM
engineering, automation, integration, testing, responsible AI, cybersecurity, and project management),
with a phased prototype → production → sustainment model over the first 12 months. Mindy defines the
AI/ML and LLM-engineering role requirements and provides technical onboarding so cleared staff execute
to standard.

---

## Relevant experience (commercial — FAR Part 12)
**Mindy (getmindy.ai)** — a deployed, commercial AI platform delivering grounded LLM/RAG and bounded
agentic workflows over authoritative federal data. In production since 2024 (the GovCon Giants product
suite — Market Assassin, Federal Contractor Database, Recompete Tracker, Opportunity Hunter — unified
into Mindy); ~1,900 users/customers today. Demonstrates exactly the capabilities this requirement calls
for: secure enterprise LLM/RAG integrated with authoritative data, citation-backed grounding,
hallucination controls, and governed agentic automation. *Commercial item — no CPARS.* getmindy.ai.

---

*GovCon Giants / Mindy — AI technical teaming partner. Contact: Eric Coffie · eric@govcongiants.com ·
786-208-2071 · getmindy.ai*

# Mindy — Capability Answers for Servexo Joint Capability Statement
### USDA FSIS "Homegrown AI" (RFI1820064 / FSAI) · AI teaming partner to Servexo

**From:** GovCon Giants / Mindy (getmindy.ai) — AI / LLM / RAG technical capability
**To:** Faith Bustillo, Servexo Protective Services (prime)
**Contact:** Eric Coffie · eric@govcongiants.com · 786-208-2071

> **Teaming posture (read first):** Servexo is the prime and carries the **GSA vehicle, cleared staffing, FedRAMP-authorized / FISMA-ATO hosting environment, and program delivery**. **Mindy provides the AI/LLM/RAG and content-intelligence capability** that deploys **into that authorized environment**. Where a requirement depends on the hosting boundary (FedRAMP, FISMA ATO, Azure Gov Cloud), it is delivered **on the prime's / hosting partner's authorized infrastructure** — Mindy supplies the portable, provider-agnostic application layer that runs inside it. Every capability below is in **production today** on our commercial platform (~1,900 users since 2024) and is architected to redeploy into a government-authorized environment.

---

## 1. Robust AI over structured AND unstructured data

Mindy runs grounded **LLM + retrieval-augmented generation (RAG)** in production over a mixed corpus of structured records and unstructured documents:

- **Structured data:** 317,000+ contractor records and 88,000+ live federal solicitations, plus award/spending data — queried with typed filters (agency, NAICS/PSC, date, dollar value) and exposed to the model as tool-callable, cited facts (never guessed).
- **Unstructured documents:** solicitations, SOW/PWS, PDFs, and long-form notices are parsed, **NUL-safe normalized**, and **semantically chunked** with structured metadata, then embedded to a vector store for **meaning-based retrieval** (a query matches a document by concept, not just keyword).
- **Grounding:** every answer carries **inline citations to the source record and as-of date**; responses that cannot be grounded in the retrieved corpus **abstain rather than fabricate** — enforced by a fabrication guard and an LLM-as-judge fact-check on high-stakes output.
- **Fine-tune + RAG:** the architecture supports both domain fine-tuning and RAG against the agency's own documents (the FSIS pattern: regulatory Q&A, inspection decision support), with a labeled evaluation set and regression testing on every change.

*Implementation:* connector-based ingestion → normalization → semantic chunking with metadata → embeddings → metadata-filtered retrieval → cited generation with abstain-on-insufficient-evidence.

---

## 2. Observability layer for security, usage, and cost

Observability is built in, not bolted on — Mindy runs an operational dashboard over three planes today:

- **Cost:** per-call and **per-user cost accounting** with an enforced budget cap; a provider-agnostic model chain with automatic downgrade so spend stays bounded under load. Admin cost dashboard reports spend by tool, model, and user.
- **Usage:** every AI tool call records success/failure, latency, model, and provider; daily aggregates and a health dashboard surface tool-level success rates and error classes (timeout, rate-limit, token-limit, validation, provider error).
- **Security / audit:** full **audit logging and traceability** on every request and every agentic action; least-privilege service accounts; external-provider health tracking so a degraded upstream is detected, not silently absorbed.

*Implementation:* structured event logging → per-tool + per-provider health metrics → cost-usage ledger with caps → admin observability dashboard. This maps directly to the SOO's SLA-availability, incident-resolution, and benchmark-performance requirements.

---

## 3. True API-first platform

Mindy is API-first by construction: the platform is **463 discrete API endpoints** with the UI as one consumer of those same APIs — not a monolith with an API bolted on.

- Every capability (search, retrieval, RAG answer, document parse, compliance scan, drafting, evaluation) is an addressable service endpoint with typed request/response contracts.
- Authentication, authorization, and rate-limiting are enforced at the API layer, so the same services can be consumed by a UI, another system, or the prime's platform.
- This makes Mindy **integrable into PHIS / LIMS and other USDA systems** as services, and makes the AI capability composable rather than locked to one front end.

*Implementation:* service-per-endpoint architecture; typed contracts; auth + rate-limit + audit at the API boundary; clean separation of capability services from presentation.

---

## 4. Content application design, development, and deployment framework

Mindy provides an end-to-end framework for building content-driven applications on top of the AI + data layer:

- **Design:** reusable content and component patterns; templated document/report generation (e.g. drafted regulatory responses, compliance matrices, cited briefings).
- **Development:** the API-first service layer (see #3) plus a component library lets new content applications be assembled from existing grounded-AI services rather than rebuilt.
- **Deployment:** continuous-integration deployment with automated pre-ship gates (type checking, an authorization audit, and an automated test suite that blocks a release on failure), plus **graceful-degradation** patterns so a content application stays usable during an upstream outage.

*Implementation:* content/component patterns → API-composed application services → CI/CD with hard pre-deploy gates → resilient runtime. Delivered into the prime's authorized environment for the government instance.

---

## 5. Robust security & permission structure — services, content, AI, and RAG

Security and permissions are enforced at every layer, and the **RAG retrieval boundary is itself access-controlled** — a distinguishing point for a document-AI platform:

- **Services & content:** authenticated, token-based sessions; **role- and workspace-scoped access** with row-level security at the database so a caller only ever sees data they are entitled to; two-factor session controls.
- **AI & RAG:** **metadata-filtered retrieval** so the model can only draw from the corpus the requester is authorized to see — permissioning applies to *what the AI can retrieve*, not just what the UI shows. Agentic actions run under **bounded, allow-listed, least-privilege scopes** with full audit trails and reversible/rollback-able operations.
- **Safeguards:** defenses against prompt injection, data leakage, and unauthorized tool calls via input/output filtering, tool allow-listing, and least privilege.
- **Data handling:** encryption in transit and at rest; least-privilege service accounts; audit logging. Aligns with the SOO §3.1 model of session-scoped processing and no unauthorized external data flow — enforced within the prime's authorized boundary.

*Implementation:* API-layer authn/z → DB row-level security + workspace/role scoping → retrieval-time permission filtering (RAG) → bounded agentic scopes → full audit.

---

## 6. Self-managed deployment in Azure Gov Cloud

**Honest, precise answer:** Mindy's application layer is **provider-agnostic and containerizable**, and is **architected to deploy self-managed into Azure Government Cloud** as part of the prime's authorized environment. Today the commercial product runs on commercial cloud; the government instance would be **stood up inside Servexo's (or the hosting partner's) FedRAMP-authorized Azure Gov Cloud boundary** — Mindy is the portable software that runs there, not the hosting authority.

What makes that a low-risk lift:
- **Portable building blocks:** standard Postgres + vector store, an object store, and a **provider-agnostic model fallback chain** (no single-vendor lock-in) — all of which have direct Azure Gov equivalents (Azure Database for PostgreSQL, Azure OpenAI in Gov, Blob Storage).
- **Containerized components** already exist in our data-ingestion pipeline, and the service-per-endpoint design deploys cleanly to a managed container/Kubernetes runtime.
- **In-boundary models by design — a firm commitment, not just a capability:** because the model layer is provider-agnostic and configuration-driven, the government instance is **configured to call only in-boundary models (e.g. Azure OpenAI in Azure Gov)**, with **no FSIS data transmitted to any external or third-party LLM service**. This meets SOO §3.1 directly: *all work with FSIS data stays in the USDA-approved secure environment.*
- **OCIO-governed connections:** any external authorized-system connection (e.g. to a source system) is **identified and submitted for FSIS OCIO approval before use**, per SOO §3.1 — nothing connects out by default.

**What we do not claim (stated plainly):** Mindy does **not** itself hold a FISMA ATO or FedRAMP authorization, and we are not representing that it does. That authorization is carried by the prime / hosting partner whose Azure Gov Cloud environment we deploy into. Mindy is the portable, in-boundary application layer; the prime owns the accredited boundary. This is the intended teaming structure for this requirement.

*Implementation:* containerized, provider-agnostic services → deployed self-managed into the prime's Azure Gov Cloud FedRAMP boundary → in-boundary model + data services → no external data egress.

---

## 7. Robust content & data preparation services

Data preparation is a core, production competency — the quality of a RAG system is the quality of its ingestion, and this is where Mindy is strongest:

- **Ingestion & normalization:** connectors to authoritative and legacy sources; **NUL-safe, encoding-clean normalization** (Postgres-safe text); de-duplication and structural cleanup of messy PDFs/HTML.
- **Semantic chunking & metadata:** documents are split by meaning with structured metadata (agency, document type, date, classification) so retrieval is precise and filterable.
- **Document intelligence:** automated document classification, section/requirement extraction (e.g. pulling every requirement into a compliance matrix), and knowledge capture from long-form documents.
- **Embeddings & indexing:** embedding to a vector store with metadata-filtered indexes; hybrid semantic + keyword retrieval with re-ranking for accuracy.
- **Evaluation of prepared data:** a labeled gold set with precision/recall on retrieval and factuality scoring, so the prepared corpus is measured, not assumed.

*Implementation:* connector ingestion → NUL-safe normalization → classification + extraction → semantic chunking + metadata → embeddings + hybrid index → measured retrieval quality.

---

### One-line summary for the Capability Statement
> **Mindy delivers a production, API-first, grounded-AI/RAG platform over structured and unstructured data — with built-in cost/usage/security observability, layered permissioning that extends into the RAG retrieval boundary, and strong content/data-preparation services — packaged as portable, containerized, provider-agnostic software that deploys self-managed into the prime's FedRAMP-authorized Azure Government Cloud environment. Servexo carries the vehicle, cleared staffing, and hosting authorization; Mindy carries the AI.**

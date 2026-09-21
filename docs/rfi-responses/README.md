# RFI Responses — Mindy Government / Teaming

Home for **federal RFI / market-research (MRAS) responses** where GovCon Giants /
Mindy contributes the **AI / RAG / LLM / document-intelligence** workstream — usually
as a **subcontractor / teaming partner to a prime**, not as the prime.

**Why this folder exists:** these come in as a recurring pattern (a prime forwards an
AI-flavored RFI, tight deadline, "team with us again"). Keeping the SOO + our scoped
capability response + the go/no-go analysis together means the next one is a fast
reference, not a cold start.

## The standing constraint (read first)
Mindy runs on **commercial infrastructure (Vercel/Supabase)** and calls **external
LLMs**. We do **NOT** hold **FedRAMP** authorization or a **FISMA ATO**. Any RFI/SOO
that mandates FedRAMP-hosted / FISMA-authorized / no-external-LLM / in-gov-environment
(common for enterprise-AI platform buys) means **we cannot prime** — we contribute the
AI/RAG/doc-intelligence layer deployed on the prime's (or a partner's) FedRAMP host.
At the **RFI/market-research stage this is a disclosure, not a disqualifier** — RFIs
award nothing; be honest and name the FedRAMP path.

## Our real, groundable contribution (map to the SOO)
- Domain-trained AI — RAG + fine-tune against the agency's docs/data
- Citation-backed regulatory Q&A (source-cited, confidence indicators, human-in-loop)
- AI-assisted drafting (e.g. FSIS Non-compliance Record / Memorandum of Interview)
- Document intelligence / knowledge capture
- Explainability + observability (audit trails, source/confidence transparency)

## Index
| RFI | Agency / Vehicle | Prime | Status | Folder |
|-----|------------------|-------|--------|--------|
| **USDA FSIS Homegrown AI** (RFI1820064, "FSAI") | USDA FSIS via **GSA eBuy MRAS** | **Servexo Protective Services** | RFI due **2026-07-06 5:00 PM EDT**; Eric replied honestly re: no FedRAMP; awaiting Servexo's hosting/FISMA answer + response template | `usda-fsis-homegrown-ai/` |
| **DLA AIACOE** | DLA | Servexo | Response delivered (prior) — reuse as the capability template | `dla-aiacoe/` |
| GSA RFI (last week) | GSA | Servexo | Copy not yet received from Faith | — |

## Contacts
- **Servexo — Faith Bustillo**, Proposal Specialist · fbustillo@servexousa.com · 323-693-5818
- **Servexo — Aswitha Chandrasekaran** · achandrasekaran@servexousa.com
- Servexo procurement: procurement@servexousa.com

## Reuse
`dla-aiacoe/_mindy-ai-capability-for-servexo.md` (+ the PDF) is the canonical scoped
AI-capability write-up. Start there for any new AI RFI — re-point the domain, keep the
FedRAMP-honesty framing.

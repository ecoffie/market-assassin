# USDA FSIS Homegrown AI — RFI1820064 (FSAI)

**Status:** OPEN · RFI / market research (MRAS), **NOT yet an RFQ**
**Response due:** **2026-07-06, 5:00 PM EDT**
**Vehicle:** GSA eBuy (MRAS) · **Prime:** Servexo Protective Services · **We = AI sub**
**Our call:** Contribute the AI/RAG layer as a sub; **cannot prime** (no FedRAMP/FISMA).

## What it is
USDA Food Safety & Inspection Service (FSIS) wants an Enterprise AI Platform (SaaS +
professional services): ingest/search/analyze FSIS docs & data, regulatory Q&A,
inspection decision support, document analysis, predictive risk modeling — via
fine-tuning + RAG. Integrates FSIS systems (PHIS, LIMS) and other agencies (CDC, FDA).
Full SOO saved alongside: `SOO-full-text.md`.

## Why we can't prime (hard gates in the SOO)
- **§2.4 FedRAMP-certified infrastructure** — we run on Vercel/Supabase (not FedRAMP).
- **§2.4 FISMA authorization (ATO)** — not held.
- **§3.1 no external LLM services; all work in USDA-approved secure env** — Mindy is
  entirely external-LLM calls.
- §2.4 NIST AI RMF + USDA AI governance — buildable, program deliverable.
Eric's decision (2026-07-01): "This requires FedRamp which we do not have." Team as sub.

## Why it's still worth doing (grounded in our own data)
- The specific FSAI notice is **NOT in our SAM cache** (searched active+archive: title,
  body, SOW — 0 hits) → it's pre-solicitation / market research, consistent with an
  eBuy MRAS RFI.
- Our agency-intel DB flags FSIS priority verbatim: **"$8M for AI-driven predictive
  analytics tools... solicitations for AI solution providers expected in FY2026."**
  → the requirement is real, budgeted, and early. Good positioning for the eventual RFQ.
- FSIS #1 pain point (our DB): "outdated IT systems... need for modern data analytics
  platforms." Direct match.

## Where we contribute (map to SOO)
- §2.3 domain-trained AI (RAG + fine-tune on FSIS docs/PHIS)
- §4 citation-backed regulatory Q&A (source-cited, confidence, human-in-loop)
- §4 **AI-assisted NR (Non-compliance Record) + MOI (Memo of Interview) drafting** —
  squarely our Proposal Assist / Content Reaper pattern, re-pointed at FSIS
- document intelligence / knowledge capture; explainability + observability
- Same AI/RAG/agentic layer as the **DLA AIACOE** response — reuse that template.

## Candidate FedRAMP hosting / prime partners (real FY2025 USASpending 541512)
- **Accenture Federal Services** — holds the **USDA enterprise FedRAMP cloud hosting**
  contract (~$344M, POP→2027). Most direct USDA incumbent + FedRAMP. Top target.
- General large AI/IT primes (FedRAMP-capable): SAIC, Booz Allen, CACI, Leidos, GDIT,
  Peraton, Deloitte, CGI, GovCIO.
- (Caveat: page-1 pull skewed to biggest awards; FSIS-office-specific pull would sharpen.)

## Open items / next actions
1. **Awaiting from Servexo (Faith):** (a) who carries FedRAMP hosting + FISMA on the
   team, (b) the RFI1820064 response template/questions → we turn AI sections fast.
2. Still awaiting last week's **GSA RFI** copy from Faith.
3. **On request:** draft the scoped §2.3/§4 capability one-pager (reuse DLA AIACOE),
   and/or deeper FSIS-office USASpending pull for the hosting-partner shortlist.

## Correspondence log
- 2026-06-29 — Faith Bustillo (Servexo) → Eric: flags RFI1820064 "USDA FSIS Homegrown
  AI - MRAS" on eBuy; DLA-AIACOE-like scope; invites teaming.
- 2026-06-29 — Eric → Faith: "may be outside scope but we can do it"; will review; asks
  for the prior GSA RFI copy (not received).
- 2026-07-01 — Faith → Eric: deadline reminder (07-06 5pm EDT), asks when feedback comes.
- 2026-07-01 — Eric → Faith (drafted with Claude): teams on AI side; discloses no
  FedRAMP/FISMA up front; frames the FedRAMP-host path; lists our §2.3/§4 contribution;
  asks who carries hosting/FISMA + for the response template; re-asks for GSA RFI copy.

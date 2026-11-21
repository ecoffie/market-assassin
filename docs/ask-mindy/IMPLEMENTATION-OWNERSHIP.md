# Ask Mindy Backend Spec — implementation ownership

Source of truth: [Ask Mindy Backend Spec (2026-11-21)](./ASK-MINDY-BACKEND-SPEC-2026-11-21.md). This is a coordination document, not runtime instructions. Do not duplicate or silently change the source spec.

## Product goal
One plain-language question should return a complete, company-aware, sourced answer with ranked pathways, reasons, contacts, and a concrete next move. Avoid count-only answers, generic advice, and unsourced claims.

## Ownership
- **Ask Mindy**: rules layer, fixed answer format, intent-based recipes, Vault profile loading into conversation, fit scoring and ranking, source checks in answers, contextual next-step buttons, 100–200-question acceptance corpus. Owns feature activation only through reviewed approval.
- **Data Core**: reliable MCP tool outputs and source provenance; find_opportunities relevance; result-size and paging; SAM/SBA entity lookups; contacts; sourced GAO/IG agency intelligence; event and forecast coverage and freshness. Communicate stable tool interface requirements to Ask Mindy; do not build an alternate rules/fit-score layer.
- **Mindy App**: presentation and usability of existing app features; do not independently reimplement Ask Mindy backend contracts.
- **Agent 4**: independent review, owner and overlap checks, release sequencing, CI and deployment verification. Escalate YELLOW/RED.

## Order from the source spec
1. Week 1: rules layer and fixed answer format.
2. Weeks 1–2: tool fixes — relevance, sizes, SAM reliability, sourced agency intel, past-event truth.
3. Weeks 2–3: load company profile and fit scorer; tune 60/100 display threshold against real cases.
4. Weeks 3–4: Where to Start, Opportunity Deep Dive, Profile Setup recipes.
5. Month 2: Event Plan and Buyer Brief, agenda reader and SBA profile lookup.
6. Month 2: weekly opportunity brief, reusing Where to Start.
7. Ongoing: grow company-specific evaluation corpus toward 100–200 cases.

The calendar is an ordering guide, not a promise of release dates. Ship in narrow independent PRs; avoid broad rebuilds.

## Active dependency constraints (2026-11-21 snapshot)
- PR #2237: Ask Mindy first rules-layer implementation; default-off flag. Independently verify flag-off behavior before approving. Its changes overlap PR #2204 in chat/route.ts.
- PR #2204: existing FMP/Export work. Review paid web-search and Vault document access separately before approval. Rebase onto #2237 if #2237 lands first; do not duplicate the rules layer.
- PR #2234: MCP saved-search alert delivery; shared scheduler impact is YELLOW, not automatic GREEN.
- Each builder retains its own branch/PR; Agent 4 sequences merge/deployment one by one. No manual production deployments.

## Acceptance contracts
- Unknown fields stay unknown; never invent company profile or contacts.
- Forecasts are labeled distinctly from posted solicitations; subcontract awards are not primes.
- Sources and dates survive tool-to-answer mapping. Tool output is paged, not silently truncated.
- A fit score is evidence-based, with reasons and eligibility pathways; below-cutoff results do not appear by default.
- Do not enable a feature flag or change customer-facing policies without the necessary approval.
- All PRs: problem → root cause → fix → tests → independent review → controlled Git-backed release → live verification.

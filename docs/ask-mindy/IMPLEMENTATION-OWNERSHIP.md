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

## Binding constraints not in the spec (CLAUDE.md and Eric's decisions, 2026-11-21)
These bind implementation even where the spec lists the item.
1. **PAE freeze.** The spec lists a PAE structure feed. CLAUDE.md says "PAE later. Do not start." No PAE work until Eric lifts that in writing. Until then, answers name a Portfolio Acquisition Executive only when a tool result names one.
2. **Agents never contact customers without approval.** The spec's agents (weekly brief, event prep, profile-change notes, pursuit watcher) reach customers. CLAUDE.md rule 8 forbids contacting customers without Eric's explicit instruction. Each agent ships flag-off; activation is RED (Agent 4 plus Eric). Agents draft; users send.
3. **One shared fit scorer.** The fit scorer is a shared library usable by MCP tools and Ask Mindy chat (CLAUDE.md rule 9). Data Core must not build a second relevance or scoring layer, and chat must not add a second relevance filter.
4. **Paging must not cut before ranking.** Data Core's result-size limits (summary plus top 25, page the rest) must not drop candidates before the fit scorer ranks them (rank-then-filter). The contract is either the full candidate set or server-side scoring before the cut, then paging by score.
5. **Price check ownership.** The Price check recipe (spec skill 8) is owned by Ask Mindy; the wage determination lookup tool is owned by Data Core. The section 2 rule against mentioning Mindy plans or prices covers Mindy's own subscription, credits and billing only; it does not limit helping customers estimate government contract pricing.

## Acceptance contracts
- Unknown fields stay unknown; never invent company profile or contacts.
- Forecasts are labeled distinctly from posted solicitations; subcontract awards are not primes.
- Sources and dates survive tool-to-answer mapping. Tool output is paged, not silently truncated.
- A fit score is evidence-based, with reasons and eligibility pathways; below-cutoff results do not appear by default.
- Do not enable a feature flag or change customer-facing policies without the necessary approval.
- All PRs: problem → root cause → fix → tests → independent review → controlled Git-backed release → live verification.

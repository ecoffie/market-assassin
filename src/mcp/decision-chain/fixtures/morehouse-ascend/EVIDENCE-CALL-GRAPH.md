# capability_market_match — Evidence Call Graph

**No new live external API dependency. No nested MCP call.** This tool orchestrates in-process pure functions and existing lib routes only.

## Entry

```
capabilityMarketMatch(input)
  └─ src/mcp/tools/capability-market-match.ts
```

## Phase 1 — Keyword derivation (candidate extraction, NOT evidence)

```
deriveCompanyKeywords({ description, past_performance, capabilities, brand_exclude })
  └─ src/mcp/tools/company-keywords.ts
       ├─ lexical tokenization + n-grams from user text
       └─ optional embeddings (degraded to lexical when unavailable)
```

**Honest miss:** Keywords are *candidates*. They are not SAM registration or award history.

## Phase 2 — Anchor ranking (capability selection)

```
pickBestAnchor(keywords, { clientName })
  └─ src/lib/market/capability-anchor.ts
       ├─ buildBrandTokenSet — strips company name, acronyms (BMA, IMRI, SRFed)
       ├─ scoreAnchorPhrase — rejects conjunctions, verb-led filler, generic abstractions
       └─ rankAnchorCandidates — never first-keyword order
```

## Phase 3 — Market coverage (USASpending keyword search)

```
keywordCoverage(lead_anchor)
  └─ src/lib/market/keyword-coverage.ts
       └─ USASpending spending_by_award (existing shared lib — not a new dependency)
```

**Honest miss:** Coverage rows are keyword-text matches. They require corroboration before `grounded: true`.

## Phase 4 — SAM registration + award-history evidence (corroboration)

```
loadAnchorEvidence(client_name)
  └─ src/lib/market/capability-anchor-evidence.ts
       ├─ localEntitiesByName(client_name)
       │    └─ src/lib/sam/entity-local-fallback.ts → sam_entities mirror (Supabase)
       │         NAICS from entity.primaryNaics + entity.naicsList
       │         UEI from entity.ueiSAM
       └─ getContractorHistoryByUei({ uei })
            └─ src/lib/contractor/history-by-uei.ts → BigQuery award history by UEI
                 awardNaics from history.topNaics
                 awardObligatedUsd from history.summary.totalObligations
```

**No name-substring BigQuery search.** Evidence attaches only when SAM mirror resolves a **well-formed 12-character UEI** (`isWellFormedUei` in `src/lib/sam/resolve-uei.ts`). Malformed, 11-character, and 13-character identifiers cannot elevate identity to `unique` and contribute no NAICS.

**E2e / regression fixtures:** `evidence-fixtures.json` and `FAKE_COMPETITORS` are **synthetic**. They intercept Phase 4 via `vi.mock('@/lib/market/capability-anchor-evidence')`. They are not live SAM or USASpending reads. BMA's unique row uses `SYNTH0BMA001` (12 characters), replacing the invalid 13-character stub `BMA1BIZMGMT01`.

## Phase 5 — Validation + NAICS alignment

```
resolveLeadNaicsWithEvidence(coverage, evidence, fallback)
validateMarketAnchor({ anchor, coverage, leadNaics, evidence })
  └─ src/lib/market/capability-anchor.ts
       ├─ evaluateTamSanity — scope/evidence-relative TAM bounds
       ├─ dominantNaicsContradictsEvidence — SAM/award vs proposed NAICS
       └─ grounded: true ONLY when high confidence + corroborating evidence
```

## Phase 6 — Parallel sections (each guarded; failure → empty, not fabricated)

| Section | Function | Scope key |
|---------|----------|-----------|
| Buyer vocabulary | `getVocabulary(naics\|psc)` | lead NAICS or pinned PSC |
| Competitors | `searchContractors({ naics })` | **NAICS only — never keyword** |
| Competitors (PSC) | `topRecipientsByPsc(pinnedPscCodes)` | PSC spend overlap |
| Competitor filter | `filterCompetitorsFabricatedRelevance` | drops name-substring false positives |
| Forecasts | `agencyForecasts({ keyword: lead })` | keyword (forecasts table) |
| Recompetes | `expiringContracts({ naics: leadNaics })` | lead NAICS |

Competitor fetch is **skipped** when `anchor_confidence` is `low` or `unverified`.

TAM (`market.total_market`) is **null** unless `tam_verified` (high confidence, no TAM flag, anchor verified).

## _meta evidence payload

```typescript
_meta.evidence: {
  identity: 'unique' | 'ambiguous' | 'none';
  identity_uei: string | null;  // must be well-formed 12-char SAM UEI to corroborate
  identity_candidates: number;
  sam_naics: string[];      // from sam_entities mirror (or synthetic fixture)
  award_naics: string[];   // from UEI award history (or synthetic fixture)
  award_obligated_usd: number | null;
  sources: ('sam_entities' | 'contractor_history')[];
}
_meta.competitor_derivation:
  'naics_spend_overlap' | 'psc_recipient_overlap' | 'none_unverified_anchor' |
  'none_no_naics' | 'none_insufficient_overlap'
_meta.tam_verified: boolean
```

## What is NOT called

- No `runMcpTool` / nested MCP transport
- No live SAM.gov Entity API in this path (mirror only)
- No `searchRecipients` by company name for evidence or competitors
- No `searchContractors({ keyword: lead })` in capability_market_match

# P1 investigation — traced BEFORE any code change (2026-09-22, from d80cad92)

## RC-1 — where capability becomes identity

Path: natural language → `deriveCompanyKeywords` → `keywordCoverage` (BQ) →
`resolveMarketScope` → `basis` / `lead_naics`.

| case | keywords | coverage | basis | lead |
|---|---|---|---|---|
| `drones` (control) | n/a | **MARKET_EVIDENCE_FOUND** $89,964,448 / 17 NAICS | `keyword` | 336411 |
| `building construction and renovation` | n/a | **NO_MATCHES_MEASURED** null / 0 | **undefined** | null |
| Cranston capability sentence | **`[]` (zero keywords)** | null | — | null |

**Root cause (from code, not hypothesis):** `descriptionMatchPattern`
(`keyword-coverage-contract.ts:58`) escapes the WHOLE phrase as one literal:

```
"building construction and renovation" -> \bbuilding construction and renovation\b
```

No award description contains that verbatim, so BQ measures 0 and coverage is
null. `drones` succeeds only because it is a SINGLE TOKEN. Proven:

| keyword | pattern | status |
|---|---|---|
| `drones` | `\bdrones\b` | FOUND $89,964,448 |
| `roofing` | `\broofing\b` | FOUND $180,844,094 |
| `electrical contractor` | `\belectrical contractor\b` | FOUND $79,402 (near-miss) |
| `building construction and renovation` | `\bbuilding construction and renovation\b` | **NO_MATCHES** |

**The synonyms already exist and are never consulted at this stage.**
`sectorSubTradeKeywords("building construction and renovation")` returns
`[electrical contractor, plumbing heating air conditioning, roofing, masonry,
site preparation, concrete, painting, drywall, framing carpentry, glass glazing,
flooring]` — the identity is available, the coverage query just never asks.

**Cranston:** `deriveCompanyKeywords` returns `[]` for the capability sentence,
so nothing reaches coverage at all.

## RC-5 — where the contradictory totals come from

Two independent measurements, reported as if interchangeable:

| figure | source | period | terms | geography |
|---|---|---|---|---|
| **$30.6B** (MA/236220 headline) | `codeMarketSize` | **1 FY** | exact NAICS | **NATIONAL** |
| **$851.3M** (MA/236220 sections) | `spend-query` | **3 FY** | scope filters | **MA-scoped** |
| **$90.0M** (drones headline) | `keywordCoverage` | **1 FY** | raw `drones` | national |
| **$10.3B** (drones sections) | `spend-query` | **3 FY** | **+6 synonyms** | national |

So the gap is never one bug — it is **three axes** (period, term set, geography)
differing silently. The state the customer supplied does not reach the headline.

⚠️ The drones two-tier insight is CORRECT product behaviour and must be kept:
`reconciliation` already reports 336411 = 64.1% of the keyword market, i.e. one
NAICS misses ~35.9%. That is the lesson, not a defect.

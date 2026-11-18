# Pain points: impact of retiring the 278 legacy "(Source: GAO)" items — 2026-11-17

**Status: measurement only. Nothing is retired. The served file `src/data/agency-pain-points.json` is byte-identical to `main`** (SHA-256 `9c5920e5…bbd`, pinned in `legacy-gao-painpoints.unit.test.ts`).

Reproduce every number here (all read-only):

```bash
npx tsx scripts/painpoints/verify-legacy-gao-set.ts            # the 278 set + sources
npx tsx scripts/painpoints/build-replacement-candidates.ts     # dry-run candidates (add --write for the proposal file)
npx tsx scripts/painpoints/measure-retirement-impact.ts        # the tables below
```

## The set (verified)

- **278** strings ending in `(Source: GAO)`, **176** distinct texts, filed under **27** agency keys. Content hash `e96fec33…f5f5`.
- **278 / 278** match an `agency_intelligence` `gao_high_risk` row by **exact title** (0 prefix matches, 0 ambiguous, 0 unmatched).
- Publication dates **1993-10-06 → 2000-09-27**. By year: 1993:4 · 1994:2 · 1995:2 · 1996:15 · 1997:78 · 1998:81 · 1999:62 · 2000:34 (identical to the audit).
- Agency attribution is inherited from the source rows: **226 of 278** come from a document the upstream extractor filed under 2–4 agencies at once (substring matching). The served agency always equals one of the source row's agencies, so agreement with the source row proves nothing.
- 7 of the 27 keys are junk or fragments ("Department of the", "for Agency", "Governing Agency", "Department of Health", "Department of Veterans", "Amtrak" as a key) whose only content is legacy GAO strings.
- Archive: `src/data/agency-pain-points-historical-gao-1993-2000.json` (all 278 with GovInfo package id, GAO product number, date, URL, every filing agency). Not imported anywhere; a test fails if any `src/` file references it.

## Per surface

How each surface reaches the JSON decides what retirement would change. "Raw" = the string is shown as written, including `(Source: GAO)`, with no date. "Labeled" = shown with `[LEGACY_MANUAL — provenance unavailable]` (shared reader). Measured by reading the code on this branch.

| Surface | Path to the JSON | How legacy GAO strings appear today | If the 278 are retired |
|---|---|---|---|
| MCP `get_agency_intel` (`src/mcp/tools/agency-intel.ts`) | `getAgencySourcedIntelligence` (shared reader, legacy cap 50) | Labeled LEGACY_MANUAL, after the 60 living GAO rows | Affected agencies lose the legacy rows (table below); living rows unchanged |
| MCP `understand_customer` (`src/lib/opportunities/understand-customer.ts`) | `getUnifiedAgencyIntelligence` → shared reader | Labeled; `painPointCitations[]` with `source_url: null` | Same as above |
| Ask Mindy (chat) | calls `get_agency_intel` (`src/lib/chat/context-sources.ts`, `card-chat.ts`) | Labeled, via the MCP tool | Same as above |
| Opportunity Map drawer "Know your buyer", buyer/company/opportunity/recompete detail (`opp-intel.ts`, `buyer-detail.ts`, `company-detail.ts`) | `getUnifiedAgencyIntelligence` | Labeled | Same as above |
| Target Market Research ranking (`api/app/target-market-research`) | shared reader, legacy cap 40; `painPointCount` is a **ranking input** | Counted in `painPointCount` | DHS 40→10, EPA 40→10, DOT 36→10, HHS 35→10, VA 34→10, DOD 31→10 legacy count. **Agency order in market research can change.** |
| Market Assassin reports (`api/reports/generate-all`), Content Reaper (`api/content-generator/generate`, `api/generate`), proposal agency context (`lib/proposal/agency-context.ts`), `/api/pain-points` fallback, target enrichment, code lookup | `src/lib/utils/pain-points.ts` (only strips unsupported budget claims) | **Raw**, `(Source: GAO)` and no date — e.g. a 1997 Y2K testimony can be written into a LinkedIn post or a proposal | These stop receiving them; proposal/report text for DHS/EPA/DOT/HHS/VA/DOD shrinks to the 10 manual strings |
| Agency hierarchy API + unified search (`lib/agency-hierarchy/pain-points-linker.ts`) | direct JSON import | **Raw** in search results; search matches title words (table below) | Fewer search hits for historical terms ("year 2000" 15, "strategic plan" 14) |
| Weekly/briefing data aggregator (`lib/briefings/market-assassin/data-aggregator.ts`) | direct JSON import (sanitized) | Raw text into briefing context | Removed from briefing context |
| `/api/budget-intel`, `/api/agency-sources` | direct JSON import | Raw (`relevantPainPoints`, counts) | Counts drop for the 27 keys |
| `/api/lindy/match` | indexes the JSON at the top level, not under `.agencies` | **Never served** (lookup always misses — separate latent bug, not touched) | No change |
| `generate_market_report` (MCP) | does not read pain points | — | No change |
| SEO `/agencies/[slug]` | `src/data/agencies-seo.ts` snapshot | **0 of 176** legacy titles present | No change |
| Admin: `data-inventory`, `data-health`, `tool-health`, `integrity-report`, `build-pain-points` | count the JSON | Counted | Counts drop by 278 |

### Public counts

| Where | Claim | Today's truth | After retirement |
|---|---|---|---|
| `data_sources.agency_pain_points.record_count` (prod, read-only) | 3,045 | 3,036 (already wrong by 9) | 2,758 |
| `data_sources.agency_pain_points.notes` | "every pain point cites a public oversight doc" | false today (278 cite a 1993–2000 doc with no date shown; most manual strings cite nothing) | still false for the manual strings |
| `docs/strategy/MI-VS-DELTEK-ANALYSIS.md`, `docs/strategy/FULL-BUSINESS-INTELLIGENCE-BRIEF.md`, `docs/PRD-agency-intel-scrapers.md` | "3,045 pain points" | 3,036 | 2,758 |
| `docs/PRD-intelligence-platform.md`, `docs/agency-hierarchy-api.md`, `docs/PRD-*` (several), `src/app/api/agency-hierarchy/route.ts` | "2,765 pain points" / "250 agencies" | stale already | stale |
| `docs/MARKETING-FEATURE-LITERATURE.md`, `docs/DATA-SOURCES-REGISTRY.md`, `docs/MINDY-DATA-CORE-SOURCES.md`, strategy docs; govcon-funnels `src/app/data/agencies/[slug]/page.tsx` | "307 agencies" | 307 keys, but only **257** have ≥1 pain point | 307 keys, **250** with ≥1 pain point |
| CLAUDE.md "Agency Pain Points" section | "307 agencies · 3,045 pain points" | 3,036 | 2,758 |

No public page found that states the 3,036 figure literally. `getIntelligenceStats()` and the admin inventory compute counts live, so they move automatically.

## Totals

| measure | today | if the 278 were retired | change |
|---|---:|---:|---:|
| pain point strings in the served JSON | 3036 | 2758 | -278 |
| agencies with at least one pain point | 257 | 250 | -7 |
| agency keys in the JSON (unchanged by retirement) | 307 | 307 | 0 |
| agencies that hold legacy GAO strings | 27 | 0 | -27 |
| agencies left with ZERO pain points | — | 7 ("Department of Health", "Department of the", "National Aeronautics and Space Administration", "Amtrak", "Department of Veterans", "for Agency", "Governing Agency") | |
| legacy strings inside the shared reader's 50-item window today | 278 | 0 | -278 |
| net items the shared reader serves (cap 50, summed over affected agencies) | 486 | 208 | -278 |

## Per agency — loss if retired, gain if candidates adopted

"Reader" = what `getAgencySourcedIntelligence` serves from the JSON (legacy cap 50). "TMR" = the pain-point count Target Market Research uses (cap 40, plus sourced + priorities). "Canonical" is shown only when the JSON key resolves exactly; junk keys do not, and get no candidates.

| JSON agency key | canonical | strings now | legacy GAO | after | reader now→after | TMR legacy now→after | +High-Risk | +Institute new | (Institute already served) | needs review |
|---|---|---:|---:|---:|---|---|---:|---:|---:|---:|
| Department of Homeland Security | Department of Homeland Security | 47 | 37 | 10 | 47→10 | 40→10 | 2 | 3 | 9 | 1 |
| Environmental Protection Agency | Environmental Protection Agency | 42 | 32 | 10 | 42→10 | 40→10 | 1 | 0 | 1 | 0 |
| Department of Transportation | Department of Transportation | 36 | 26 | 10 | 36→10 | 36→10 | 1 | 1 | 3 | 1 |
| Department of Health and Human Services | Department of Health and Human Services | 35 | 25 | 10 | 35→10 | 35→10 | 4 | 3 | 3 | 3 |
| Department of Veterans Affairs | Department of Veterans Affairs | 34 | 24 | 10 | 34→10 | 34→10 | 2 | 2 | 3 | 0 |
| Department of Defense | Department of Defense | 31 | 21 | 10 | 31→10 | 31→10 | 5 | 2 | 10 | 0 |
| Department of the Treasury | Department of the Treasury | 29 | 19 | 10 | 29→10 | 29→10 | 1 | 2 | 3 | 1 |
| Securities and Exchange Commission | Securities and Exchange Commission | 26 | 14 | 12 | 26→12 | 26→12 | 0 | 1 | 1 | 0 |
| Department of Commerce | Department of Commerce | 21 | 11 | 10 | 21→10 | 21→10 | 0 | 0 | 1 | 0 |
| Department of Energy | Department of Energy | 19 | 9 | 10 | 19→10 | 19→10 | 1 | 3 | 1 | 0 |
| Department of Agriculture | Department of Agriculture | 17 | 7 | 10 | 17→10 | 17→10 | 0 | 0 | 1 | 0 |
| Department of Housing and Urban Development | Department of Housing and Urban Development | 17 | 7 | 10 | 17→10 | 17→10 | 0 | 2 | 1 | 0 |
| Office of Personnel Management | Office of Personnel Management | 19 | 7 | 12 | 19→12 | 19→12 | 0 | 1 | 0 | 0 |
| Department of Education | Department of Education | 16 | 6 | 10 | 16→10 | 16→10 | 0 | 2 | 1 | 0 |
| Department of Labor | Department of Labor | 16 | 6 | 10 | 16→10 | 16→10 | 1 | 1 | 2 | 1 |
| Social Security Administration | Social Security Administration | 18 | 6 | 12 | 18→12 | 18→12 | 0 | 0 | 1 | 0 |
| Department of the Interior | Department of the Interior | 15 | 5 | 10 | 15→10 | 15→10 | 1 | 0 | 5 | 1 |
| Department of State | Department of State | 13 | 3 | 10 | 13→10 | 13→10 | 0 | 2 | 2 | 0 |
| Department of Health | — (unresolved) | 2 | 2 | 0 | 2→0 | 2→0 | 0 | 0 | 0 | 0 |
| Department of the | — (unresolved) | 2 | 2 | 0 | 2→0 | 2→0 | 0 | 0 | 0 | 0 |
| General Services Administration | General Services Administration | 12 | 2 | 10 | 12→10 | 12→10 | 0 | 2 | 6 | 0 |
| National Aeronautics and Space Administration | National Aeronautics and Space Administration | 2 | 2 | 0 | 2→0 | 2→0 | 1 | 0 | 1 | 0 |
| Amtrak | — (unresolved) | 1 | 1 | 0 | 1→0 | 1→0 | 0 | 0 | 0 | 0 |
| Department of Veterans | — (unresolved) | 1 | 1 | 0 | 1→0 | 1→0 | 0 | 0 | 0 | 0 |
| for Agency | — (unresolved) | 1 | 1 | 0 | 1→0 | 1→0 | 0 | 0 | 0 | 0 |
| Governing Agency | — (unresolved) | 1 | 1 | 0 | 1→0 | 1→0 | 0 | 0 | 0 | 0 |
| Nuclear Regulatory Commission | Nuclear Regulatory Commission | 13 | 1 | 12 | 13→12 | 13→12 | 0 | 0 | 1 | 0 |

Agencies that GAIN candidates but hold no legacy GAO strings:

| canonical agency | +High-Risk | +Institute new | (Institute already served) | needs review |
|---|---:|---:|---:|---:|
| Agency for International Development | 0 | 0 | 1 | 0 |
| Department of Justice | 1 | 1 | 1 | 1 |
| Export-Import Bank of the United States | 0 | 0 | 1 | 0 |
| Federal Deposit Insurance Corporation | 0 | 1 | 0 | 0 |
| Small Business Administration | 1 | 0 | 1 | 1 |

Candidate totals: 22 High-Risk + 29 new Institute + 60 Institute rows the reader ALREADY serves (not a gain).

## Search — legacy strings matched by sample queries (substring, as `searchAgencies` / `searchPainPoints` do)

| query | legacy strings matched today |
|---|---:|
| year 2000 | 15 |
| acquisition | 14 |
| financial management | 3 |
| contract | 4 |
| information technology | 4 |
| cyber | 0 |
| strategic plan | 14 |
| testimony | 0 |

## SEO

Legacy titles found in src/data/agencies-seo.ts (the /agencies/[slug] pain-point source): 0 of 176.

## Replacement candidates (proposal, not adopted)

`tasks/painpoints-replacement-candidates-2026-11-17.json` — **111 accepted, 73 rejected**:

- **(a) GAO-25-107743 High-Risk List** (Feb 2025, 38 areas, verified on gao.gov 2026-11-17): 23 mapped → **22 accepted** (12 title-named, 10 program-owner flagged `requires_review`), **1 rejected** (USPS is not a canonical toptier agency). **15 areas deliberately unmapped**: 8 government-wide (cybersecurity, IT acquisitions, real property, human capital, clearances, climate exposure, financial regulation, critical technologies) and 7 multi-agency (disaster assistance, disability programs, tribal programs, food safety, drug misuse, housing finance, environmental liability).
- **(b) `institute_sources` GAO reports** (161 rows, published 2026-07-22 → 2026-11-16): **89 accepted** (agency resolved by the anchored resolver, `exact_name`), **68 rejected** unresolved agency, **5 rejected** non-GAO document numbers (GAO's own OIG/standards items). **60 of the 89 are already served today** through `agency_pain_points_db` and the shared reader, so the real gain from (b) is **29**.
- Net new if adopted: **22 + 29 = 51** cited items, versus **278** retired.

## Decisions for Eric

1. **Retire the 278?** Every surface in the "Raw" rows shows a 1993–2000 testimony as a current pain point. Retiring drops 278 strings and leaves 7 keys empty, including **NASA (its only 2 pain points are legacy)**.
2. **Where should candidates live?** Adopting into the JSON would create a second stale copy. The audit's recommendation is the shared reader: add (a) as rows in `agency_pain_points_db` with the GAO-25-107743 URL, and let (b) keep flowing through the existing derive (it already serves 60 of the 89).
3. **The 10 program-owner mappings** (SBA, Treasury/IRS, DOT, Interior, HHS ×3, DHS/FEMA, DOJ/BOP, DOL) need a human check against each area chapter.
4. **The 15 unmapped areas**: keep them unattached, or attach the 7 multi-agency areas to named lead agencies?
5. **TMR ranking**: retirement lowers `painPointCount` for six large agencies; accept the reorder, or change TMR to count only sourced items first?
6. **Counts**: fix `data_sources.record_count` (3,045 → 3,036 now, or 2,758 after) and the notes line, and the doc claims above.

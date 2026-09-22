# POTETO audit — Maps search vs MCP discovery contract (2026-09-22)

Read-only. No code, PR, deploy, or saved-search changes. Production SHA serving: `2574fe8d`.
MCP replay = the shipped `findOpportunities()` lib run locally against prod DB at that SHA
(`src/mcp/tools/find-opportunities.ts` is a 1-line passthrough to it — hosted transport adds only billing).
Maps replay = prod `/api/app/{opportunity,recompete,forecast}-map` (world bbox, mapped + unmapped) +
the shared `applyMapFilters` predicate for Open ID sets. Browser = headless Puppeteer on getmindy.ai/opportunity-map.

## 1. Headline

1. **The query is NOT dropped.** Typing commits `Q` on a 400 ms debounce (no Enter needed; Enter fires no new
   request). All three horizon requests carry `q=ai governance`. Fail-closed holds literally: `zzzxxyyqqq` → 0/0/0
   on both surfaces.
2. **The first failing layer is the shared keyword predicate `buildSearchOr()`** (`src/lib/mi-dashboard/search.ts`):
   whitespace-tokenize → keep tokens ≥2 chars → OR `%token%` ILIKE across title/description/sow_text/department/
   solicitation_number. `ai` matches m**ai**ntenance, rep**ai**r, rem**ai**ns, **Ai**r. Result: **5,087** active
   notices for "ai governance" vs source truth **0** (phrase) / **16** ("artificial intelligence") / **54** (whole-word AI).
3. **MCP is not a clean oracle for this query.** MCP Open uses the SAME `buildSearchOr` (via `openCandidateOrExpr`)
   → identical 5,087 IDs (100% overlap). Its ranking hides it; top-3 are "Distribution Box", "Window Replacement",
   "Comfort Station", DIRECT_MATCH=0. **The oracle must be fixed before it can govern.**
4. **Real MCP↔Maps semantic divergence exists — on taxonomy-mapped queries and on Recompete**, not on "ai governance".
5. The customer's "56,499" is the unfiltered frame's "55,841 not shown on map" line / a pre-debounce frame.
   Post-debounce the header reads 4,375. Not the defect.

## 2. ai governance — field-by-field (browser, prod)

| stage | input | Q (closure) | URL | API q | header | top cards |
|---|---|---|---|---|---|---|
| before | "" | "" | `` | — | 130,344 · 55,841 not shown | Engraving & Printing, Modular Furniture… |
| typing 0 ms | ai governance | "" | `` | — | 130,344 | unchanged; panel = "Try a search" |
| +400 ms debounce | ai governance | ai governance | `` (**q never written to URL**) | `ai governance` ×3 horizons | **4,375** | Modular Furniture, Repair RTS Bldgs, PKA VIP Furniture |
| Enter | ai governance | unchanged | `` | no new request | 4,375 | same |

- Client resolver: `parseSearchIntent("ai governance")` → null (no agency/state/set-aside/lifecycle word) → Enter
  runs `captureSearch` (telemetry only). Correct.
- Server resolver: `resolveQueryIntent` → `keyword`. Correct. `interpretCapability` (MCP-only) → `literal`.
- Agency suggestions (SSA/NSF/SEC/BOP) come from an independent autocomplete fetch `/api/agency-hierarchy?search=`
  — display only, never touches FILT/Q. **But clicking one runs `runSearch(name)` = a KEYWORD search for the agency
  name**, not an agency filter (code-verified, not live-tested).
- Why the cards match: PKA VIP Furniture → `sow_text` "2.1 M**AI**NTENANCE"; Powerhouse Doors → `description`
  "rem**ai**ns"; Window Replacement → "Rep**ai**r".
- Per horizon: Open 4,372 (bbox) · Recompete 0 · Forecast 2 — Forecast is right because `keywordOrExpr` does NOT
  split on spaces (phrase `%ai governance%`).

## 3. Same-fixture replay (full corpus, no viewport)

| query | shared intent | MCP capability | Open Maps / MCP (ID overlap) | Recompete Maps (no window) / MCP (≤18 mo) | Forecast Maps / MCP | verdict |
|---|---|---|---|---|---|---|
| 541320 | naics | literal | 0 / 0 | 0 / 0 | 10 / 10 | identical ✓ (customer's "10" = forecast) |
| pam | keyword | literal | 37 / 37 (100%) | 5 / 5 | 25 / 21 | Open same; forecast Δ = FY policy (likely, unverified) |
| ai governance | keyword | literal | **5,087 / 5,087 (100%)** | 0 / 0 | 3 / 3 | **same AND both wrong** (truth 0–54) |
| artificial intelligence governance | keyword | literal | 157 / 157 | 0 / 0 | 0 / 0 | same; Open token-OR ("intelligence" boilerplate) vs Forecast whole-phrase → 0 |
| cybersecurity | keyword | cyber_with_related_it (518210 + DJ01/DJ10, related IT) | 342 / 361 (MCP +19) | **7 / 16,232** | 180 / 170 | **SEMANTIC divergence** |
| janitorial | keyword | industry_preset (561210/561720/561730) | 34 / 118 (MCP +84) | **25 / 5,323** | 240 / 238 | **SEMANTIC divergence** |
| market research | keyword | literal | 943 / 943 | 0 / 0 | 41 / 40 | same; both over-broad (%market% %research%) |
| zzzxxyyqqq | keyword | literal | 0 / 0 | 0 / 0 | 0 / 0 | fail-closed ✓ |

Legitimate (presentation) differences seen: bbox, mapped vs unmapped, pin caps (open 841–913/viewport, forecast 1000),
Maps `sources=sam,sbir`, `hideCommodity`. Semantic differences: rows marked above.

## 4. Call graphs

| concern | MCP `find_opportunities` | Maps | shared? |
|---|---|---|---|
| raw query | `advanced.keyword_exact ‖ query` | `#zsearchInput` → debounce → closure `Q` (not URL) | — |
| historical vs current | **host instructions only** (KNOWN_ID/HISTORICAL → `lookup_solicitation`); no server code in FIND | none | n/a |
| intent class | `resolveQueryIntent` (setAside/naics/psc/keyword) | same, server-side | ✅ shared |
| NL agency/state/set-aside/lifecycle | host passes `agency`/`location`/`set_aside` params | **client-only `parseSearchIntent`** (route.ts SEARCH_PANEL_JS, own `_AGENCY_NEEDLES`) | ❌ duplicated, divergent vocab |
| buyer identity | `resolveBuyerIdentity` (agency-aliases.json) + `dualBuyerOrExpr` | `FILT.agency` needles / `agencyOrExpr` | ❌ different |
| capability / taxonomy | `interpretMarket` → cyber regex, physical-security exclusion, PHRASE_PRESET → preset NAICS/PSC | **absent** | ❌ MCP-only |
| term-of-art | recompete: `termOfArtNaicsCodes`; open: `termOfArtSynonyms` inside buildSearchOr | same two calls | ✅ partly |
| tokenization | Open: `queryWords` (whitespace OR, ≥2 chars); Recompete: whole phrase; Forecast: `keywordOrExpr` (split `, ; and`, ≥3 chars) | identical per horizon | ✅ shared — **but 3 tokenizers disagree across horizons** |
| Open match | `applyMapFilters` (q nulled on keyword path) + `openCandidateOrExpr` = `buildSearchOr` ∪ preset NAICS/PSC | `applyMapFilters` → `buildSearchOr` | ⚠️ half-shared |
| Open rank | `rankOpenRows` + `classifyRecord` evidence tiers | deadline / Recommended sort | ❌ |
| Recompete match | inline in `queryComingBack`: preset pinned NAICS → ToA → keyword on 4 cols (+sub_agency); 18 mo window; `classifyRecord` drops unclassified | inline in `recompete-map/route.ts`: ToA → keyword on 3 cols; no window; no classification | ❌ **two parallel copies, diverged** |
| Forecast match | `applyForecastFilters` + FY ≥ current floor + forecast agency coverage | `applyForecastFilters` | ✅ predicate shared; FY policy differs |
| fail-closed | empty vs unavailable vs grounded; nonsense → 0 | nonsense → 0 | ✅ literal; ❌ 2-char substring = effectively fail-open |

## 5. Blast radius (every consumer of the matchers)

- `buildSearchOr`: mi-dashboard search, `map-filters` (→ all `applyMapFilters` consumers), `open-relevance` (MCP).
- `applyMapFilters` (13): opportunity-map page + `/saved`, `/api/app/opportunity-map`, watchlist-brief, market-dashboard,
  buying-agencies, saved-searches, **cron/snapshot-watchlist**, **cron/saved-search-alerts**, today/ContinueExploring,
  find-opportunities (MCP), current-acquisition-intelligence (MCP CAI).
- `applyForecastFilters`: map, forecast-map, forecasts/unplaced, **saved-search-alerts**, MCP.
- Recompete: `recompete-map/route.ts` + MCP `queryComingBack` (no shared function).
- Third matcher exists: `/try` (`src/lib/beginner/activity.ts` + `relevance.ts`) already fixed THIS class
  (`person` ⊂ `personnel`) with word-boundary tiers — evaluate before designing a new tokenizer.

Any change to `buildSearchOr` changes existing saved-search alert result sets and mi-dashboard search the same day.

## 6. Proposed canonical seam

`src/lib/discovery/` (server-only, pure where possible):

```
interpretDiscovery(raw, ctx) → DiscoveryPlan
  { intent (resolveQueryIntent), capability + buyer (interpretMarket),
    matcher: { phrase, terms[], boundary:'word', minLen }, horizons: { open, recompete, forecast } }
openPredicate(plan) / recompetePredicate(plan) / forecastPredicate(plan)   → PostgREST expr (pure)
rankOpen(rows, plan) / classify(row, plan)
```
Surface POLICY is an explicit parameter, never a reinterpretation: recompete window, FY floor, sources, commodity,
viewport/mapped, caps, delivery horizons (Daily Alerts = open+recompete).
Client sends raw `q`; server returns `plan.interpreted` so the UI renders chips from the SAME interpretation
(retires client `parseSearchIntent` as a semantic authority).

## 7. Migration sequence

0. **Fix the oracle first**: one word-boundary tokenizer + phrase preference in the seam; prove MCP against source
   truth (ai governance → the 16–54 AI notices, not 5,087). Decide: does a short token require word boundary (`\mai\M`)?
1. Extract seam from `find-opportunities.ts` with zero behavior change otherwise (golden snapshot of MCP per fixture).
2. `/api/app/opportunity-map` Open → seam (adds taxonomy union + ranking).
3. `recompete-map` → seam recompete plan. **Product decision needed:** does the Map apply MCP's 18 mo window and
   preset-NAICS widening (janitorial 25 → ~5k pins)?
4. `forecast-map` FY policy decision (explicit param).
5. saved-search-alerts / snapshot-watchlist / watchlist-brief → seam. Before ship: per-saved-search preview diff
   (old vs new counts) — alert volume will change.
6. Client: write `q` to URL; agency autocomplete click → agency param, not keyword; stop client-side intent authority.

## 8. Regression gates

- **Hermetic contract test**: for each fixture class (6-digit NAICS, partial NAICS, keyword, multi-word concept,
  term of art, agency name, nonsense, distinctive, generic, multi-horizon) assert the Maps route handlers and
  `findOpportunities` emit the **identical normalized plan + per-horizon predicate** (not HTML).
- **Live oracle** (`verify:oracles` pattern): per fixture, Maps ID set ⊆ MCP ID set modulo bbox/mapped; nonsense = 0
  every horizon; any non-empty q count < unfiltered count by a margin; "ai governance" top-N each carry
  word-boundary evidence. Prove each check inject→red→revert→green.

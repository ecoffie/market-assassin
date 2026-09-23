# Canonical Discovery — Phase C3: Maps Forecast on the seam (2026-09-23)

**Scope:** the Maps **Forecast** surface — `/api/app/forecast-map` AND `/api/forecasts/unplaced` (approved decision 1).
Maps Open and Maps Recompete (frozen), Saved Searches, alert crons, client behaviour and historical-Forecast UI are untouched.
MCP is the reference. Previous: `tasks/canonical-discovery-phase-c2-maps-recompete-2026-09-22.md`.

## 1. Old path (@ `7158ca98`)

Both routes interpreted the query through the shared `applyForecastFilters` (`src/lib/opportunities/map-data.ts`):

| concern | old Maps Forecast | canonical (MCP) |
|---|---|---|
| free text | `keywordOrExpr`: split on `,` `;` "and", `%piece%` ILIKE on title / naics_description / department / description | whole-word concept matcher on the same columns |
| NAICS / PSC / set-aside typed in q | only when the WHOLE query was one code / set-aside | canonical structured extraction + keyword |
| agency | canonical forecast identity resolver (already) | same, plus agencies named in the text; multi-select = OR |
| state | param only | param ∪ state named in the text |
| exclusions / positive scope | none | canonical |
| **fiscal year** | **forecast-map: NONE (past FY shown)** · unplaced: its own `excludePastFy` | **current + future FY by default** |

The two routes already DISAGREED on fiscal year before this change: the map counted past-FY forecasts, the unplaced list
excluded them.

## 2. What changed

- **`src/lib/opportunities/maps-forecast-discovery.ts`** (new): `mapsForecastRequest(get)` → ONE canonical plan under
  `MAPS_POLICY` (forecast `includePastFiscalYears: false`) with `apply = applyForecastPlan(query, plan)`; `dropAgency` builds
  the same request minus the agency filter (the unplaced list's agency-facet tally).
- **`/api/app/forecast-map`**: pins, drawable (market) count, unmapped count and unplaced list rows all use the one plan.
- **`/api/forecasts/unplaced`**: rows + facets through the same adapter; its private `excludePastFy` is gone — the FY rule
  now comes from the plan, so the list is exactly the unplaced subset of the map's Forecast market.
- **Shared helpers:** `getForecastViewportPins` / `getUnplacedForecastRows` gained an OPTIONAL `apply` parameter. Omitted,
  they run `applyForecastFilters` exactly as before — the Saved Search alert cron (the other consumer) is unchanged.
- Additive `discovery: {version, status, refinement, via, coverage, include_past_fiscal_years}` on both responses.
  `coverage: 'unestablished'` = the buyer publishes no forecasts we hold (MCP reports that horizon unavailable).
- No Maps past-FY opt-in (approved decision 2). Pin cap, mappability, unplaced-list gating, response contracts preserved.

## 3. Replay — old vs FY-only vs canonical Maps vs MCP, plus the unplaced subset

`npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-forecast` — complete identity sets on `agency_forecasts.id`
(cap 60k, never truncated). Columns: **old** → **− past FY** (removed by the FY policy ALONE) → **old (cur+fut FY)** →
**new** (production adapter) vs **MCP**; **sem old-only / new-only** = the semantic delta with FY held constant;
**unplaced new = MCP (old route)** = what `/api/forecasts/unplaced` returns now, MCP's unplaced subset, and the old route's
count. Exits 1 on any unclassified semantic delta, any Maps≠MCP identity, or any unplaced≠MCP-unplaced identity.

| fixture | status · via | old | − past FY | = old (cur+fut FY) | new | MCP | Maps≡MCP | sem old-only | sem new-only | drawable | unplaced new = MCP (old route) | unplaced parity | class | evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (no query — baseline) | ok · structured_only | 35,928 | 3,517 | 32,411 | 32,411 | 32,411 | IDENTICAL | 0 | 0 | 18,446 | 13,965 = 13,965 (13,965) | IDENTICAL ⊂ market | expected_policy_change (FY only) | 3517 past-FY forecasts removed by the canonical current+future-FY default; nothing else changed. |
| ai governance | ok · text | 3 | 0 | 3 | 13 | 13 | IDENTICAL | 0 | 10 | 4 | 9 = 9 (1) | IDENTICAL ⊂ market | canonical_correction | Old split-and-substring ("ai governance" as one %phrase%) found 3; canonical AI ∧ governance (AI acronym case-sensitive, word-bounded) → 13 ≡ MCP (Phase B forecast 0→13), incl. "AI Governance - RFI (VA-26-00070202)". Some hits are body co-occurrence (Qlik, Varonis) — the recorded far-apart-concepts limitation, MCP-identical. |
| artificial intelligence governance | ok · text | 0 | 0 | 0 | 13 | 13 | IDENTICAL | 0 | 13 | 4 | 9 = 9 (0) | IDENTICAL ⊂ market | canonical_correction | Old found 0 (literal phrase). Now the same 13 as "ai governance" (one concept, both forms) ≡ MCP. |
| janitorial | ok · text | 240 | 2 | 238 | 238 | 238 | IDENTICAL | 0 | 0 | 198 | 40 = 40 (40) | IDENTICAL ⊂ market | expected_policy_change (FY only) | 2 past-FY forecasts removed by the canonical current+future-FY default; nothing else changed. |
| cybersecurity | ok · text | 180 | 10 | 170 | 286 | 286 | IDENTICAL | 0 | 116 | 181 | 105 = 105 (67) | IDENTICAL ⊂ market | canonical_correction | Cyber concept forms (cyber / cyber security / cybersecurity) → 286 ≡ MCP (Phase B: 170→286). 0 rows dropped. Includes vendor-name title hits ("ASRC Federal Cyber, LLC") and body mentions — recorded limitation. |
| SIEM | ok · text | 32 | 7 | 25 | 4 | 4 | IDENTICAL | 21 | 0 | 4 | 0 = 0 (5) | IDENTICAL ⊂ market | canonical_correction | Old %siem% substring: all 21 dropped forecasts are SIEMENS products (0 contain the word SIEM, audited). Canonical word-bounded SIEM → 4 ≡ MCP. |
| drones | ok · text | 5 | 0 | 5 | 52 | 52 | IDENTICAL | 0 | 47 | 39 | 13 = 13 (2) | IDENTICAL ⊂ market | canonical_correction | Term-of-art aliases (drone, UAS, unmanned aircraft) now apply to forecasts: 5 → 52 ≡ MCP (Phase B: 5→52). 0 dropped. |
| Show me USDA opportunities | ok · structured_only | 0 | 0 | 0 | 5,028 | 5,028 | IDENTICAL | 0 | 5,028 | 1,770 | 3,258 = 3,258 (0) | IDENTICAL ⊂ market | canonical_correction | Old searched the literal sentence → 0. Structured agency intent → USDA forecast identity → 5,028 ≡ MCP. |
| SDVOSB cybersecurity opportunities in Virginia | ok · text | 324 | 12 | 312 | 1 | 1 | IDENTICAL | 311 | 0 | 0 | 1 = 1 (52) | IDENTICAL ⊂ market | canonical_correction | Old resolved the WHOLE query as a set-aside → 312 SDVOSB forecasts of any kind (settlement admin, flood rehab…). Now SDVOSB ∧ cyber ∧ VA → 1 ≡ MCP (Phase B: 1). |
| janitorial in Florida | ok · text | 0 | 0 | 0 | 4 | 4 | IDENTICAL | 0 | 4 | 4 | 0 = 0 (0) | IDENTICAL ⊂ market | canonical_correction | Old searched the literal phrase → 0. State FL extracted from the text; janitorial ∧ FL → 4 ≡ MCP (3 DOI janitorial + 1 portable-restroom). |
| 541512 | ok · structured_only | 604 | 80 | 524 | 524 | 524 | IDENTICAL | 0 | 0 | 364 | 160 = 160 (160) | IDENTICAL ⊂ market | expected_policy_change (FY only) | 80 past-FY forecasts removed by the canonical current+future-FY default; nothing else changed. |
| R408 | ok · structured_only | 6,258 | 495 | 5,763 | 5,763 | 5,763 | IDENTICAL | 0 | 0 | 4,091 | 1,672 = 1,672 (1,672) | IDENTICAL ⊂ market | expected_policy_change (FY only) | 495 past-FY forecasts removed by the canonical current+future-FY default; nothing else changed. |
| D302 | ok · structured_only | 11 | 0 | 11 | 11 | 11 | IDENTICAL | 0 | 0 | 8 | 3 = 3 (3) | IDENTICAL ⊂ market | unchanged |  |
| 541512 -computers | ok · structured_only | 0 | 0 | 0 | 287 | 287 | IDENTICAL | 0 | 287 | 167 | 120 = 120 (0) | IDENTICAL ⊂ market | canonical_correction | Old searched the literal text → 0. Now NAICS 541512 minus forecasts mentioning computers → 287 ≡ MCP (Phase B: 287). |
| USDA -computers | ok · structured_only | 0 | 0 | 0 | 4,884 | 4,884 | IDENTICAL | 0 | 4,884 | 1,717 | 3,167 = 3,167 (0) | IDENTICAL ⊂ market | canonical_correction | Old literal text → 0. Now USDA forecasts minus computers → 4,884 ≡ MCP. |
| -computers | needs_positive_scope · needs_positive_scope | 0 | 0 | 0 | 0 | 0 | IDENTICAL | 0 | 0 | 0 | 0 = 0 (0) | IDENTICAL ⊂ market | unchanged |  |
| zzzxxyyqqq | ok · text | 0 | 0 | 0 | 0 | 0 | IDENTICAL | 0 | 0 | 0 | 0 = 0 (0) | IDENTICAL ⊂ market | unchanged |  |
| agency=USDA | ok · structured_only | 5,028 | 0 | 5,028 | 5,028 | 5,028 | IDENTICAL | 0 | 0 | 1,770 | 3,258 = 3,258 (3,258) | IDENTICAL ⊂ market | unchanged |  |
| agency=VA | ok · structured_only | 1,390 | 0 | 1,390 | 1,390 | 1,390 | IDENTICAL | 0 | 0 | 1,371 | 19 = 19 (19) | IDENTICAL ⊂ market | unchanged |  |
| agency=USDA\|VA | ok · structured_only | 6,418 | 0 | 6,418 | 6,418 | 6,418 | IDENTICAL | 0 | 0 | 3,141 | 3,277 = 3,277 (3,277) | IDENTICAL ⊂ market | unchanged |  |
| janitorial + agency=USDA\|VA | ok · text | 51 | 0 | 51 | 51 | 51 | IDENTICAL | 0 | 0 | 51 | 0 = 0 (0) | IDENTICAL ⊂ market | unchanged |  |
| naics=541512 | ok · structured_only | 604 | 80 | 524 | 524 | 524 | IDENTICAL | 0 | 0 | 364 | 160 = 160 (160) | IDENTICAL ⊂ market | expected_policy_change (FY only) | 80 past-FY forecasts removed by the canonical current+future-FY default; nothing else changed. |
| -computers + naics=541512 | ok · structured_only | 0 | 0 | 0 | 287 | 287 | IDENTICAL | 0 | 287 | 167 | 120 = 120 (0) | IDENTICAL ⊂ market | canonical_correction | Old: literal "-computers" keyword AND naics → 0. The NAICS filter is canonical positive scope, so the exclusion is valid → 287 ≡ MCP (same set as "541512 -computers"). |
| janitorial + state=FL | ok · text | 4 | 0 | 4 | 4 | 4 | IDENTICAL | 0 | 0 | 4 | 0 = 0 (0) | IDENTICAL ⊂ market | unchanged |  |

24 fixtures · 5 expected_policy_change (FY only) · 11 canonical_correction · 8 unchanged · parity failures 0 · unplaced failures 0

**Identity parity:** 24/24 fixtures — Maps Forecast market ≡ MCP Forecast market, forecast id for forecast id.
**Unplaced:** 24/24 — `/api/forecasts/unplaced`'s identities equal MCP's unplaced subset AND are all inside the same market
(never a separately interpreted search).

**Fiscal-year policy measured on its own:** the unfiltered map drops **3,517** past-FY forecasts (35,928 → 32,411) and nothing
else; `541512` / `naics=541512` −80, `R408` −495, `janitorial` −2, `cybersecurity` −10, `SIEM` −7, SDVOSB/cyber/VA −12.
Recorded as expected policy change (approved decision 2), not a regression.

**SIEM audit:** all 21 forecasts the new path drops are Siemens products; 0 contain the word SIEM.

## 4. Gates

- `cross-surface-plan.unit.test.ts`: `maps_forecast` → **migrated** (production `mapsForecastRequest`). `meaning()` now also
  compares Forecast filters + query ops (excluding only the FY policy clause). Source guard over BOTH routes and the adapter:
  no `applyForecastFilters`, `keywordOrExpr`, `resolveQueryIntent`, `setAsideOrExpr`, `pscToNaicsCodes`,
  `resolveForecastAgencies`, `forecastAgencyOrExpr`, `naicsMatchConds`, `parseStateList`, `excludePastFy`, `currentFiscalYear`;
  one plan in forecast-map; pins/market/unmapped/unplaced all through it; unplaced rows + facets through the adapter.
- **Proven:** adapter passing `agency: null` → red (`maps_forecast: janitorial` ≠ MCP); `/api/forecasts/unplaced` re-importing
  `applyForecastFilters` for its rows → red (source guard). Both restored → green. Never committed.
- `maps-forecast-discovery.unit.test.ts` (13): MCP op/filter equality, whole-word text, multi-agency, FY clause always present
  and no opt-in, positive scope + fail-closed, facet plan = same request minus agency only, discovery metadata.
- `unplaced-entry.unit.test.ts`: the FY assertion now checks the plan the route executes (keeps undated, excludes past FY).

## 5. Known limitations (recorded, NOT fixed — shared canonical layer)

- Body co-occurrence: `ai governance` admits forecasts whose long description mentions AI and governance apart (Qlik, Varonis).
- Vendor names in forecast titles match concepts ("ASRC Federal Cyber, LLC – SP13 Financial Management Service").
- Forecast has no taxonomy expansion (MCP's cyber related-IT market is Recompete/Open only) — SIEM → 4 forecasts.
- The Maps set-aside checkbox is not sent to/read by the Forecast routes (unchanged; the checkbox defect is tracked separately).

## 6. Next (not started)
Rerun `scripts/discovery-saved-search-blast.ts` (sign-off on changed rows) → Saved Searches → alerts → client.

## 7. Production acceptance (2026-09-23) — ✅ FROZEN

Merges: #1656 → `2a4bd151` (Maps Forecast on the seam) and #1659 → `d131e272` (unplaced paging tiebreaker, value → id).
Production proven to serve `d131e272` (live `maps-account-build` stamp; Vercel commit status complete; normal main deploy).

The first acceptance run on `2a4bd151` failed 2/13 on exact unplaced IDs (USDA, USDA|VA): `total` correct, but the list
ordered by `estimated_value_max` alone — USDA's 3,258 unplaced forecasts carry 12 distinct values — so offset pages overlapped
(509 duplicated, 509 unreachable; deterministic across 6 passes). Pre-existing (same ordering at `a647860c`). Fixed in #1659.

Re-run on `d131e272` — live `https://getmindy.ai/api/app/forecast-map` (tiled past the pin cap) and
`/api/forecasts/unplaced` (every page) vs MCP's canonical Forecast query on the production DB at the same moment:

| fixture | drawable + unmapped = MCP | drawable ids | unplaced total | unplaced paged: rows · unique · dup · missing | order | FY cur+fut | past-FY excluded (all past) |
|---|---|---|---|---|---|---|---|
| ai governance | 4 + 9 = 13 | IDENTICAL | 9/9 | 9 · 9 · 0 · 0 | ✅ | ✅ | 0 |
| artificial intelligence governance | 4 + 9 = 13 | IDENTICAL | 9/9 | 9 · 9 · 0 · 0 | ✅ | ✅ | 0 |
| janitorial | 198 + 40 = 238 | IDENTICAL | 40/40 | 40 · 40 · 0 · 0 | ✅ | ✅ | 2 |
| cybersecurity | 181 + 106 = 287 | IDENTICAL | 106/106 | 106 · 106 · 0 · 0 | ✅ | ✅ | 19 |
| SIEM | 4 + 0 = 4 | IDENTICAL | 0/0 | 0 · 0 · 0 · 0 | ✅ | ✅ | 0 |
| SDVOSB cybersecurity opportunities in Virginia | 0 + 1 = 1 | IDENTICAL | 1/1 | 1 · 1 · 0 · 0 | ✅ | ✅ | 0 |
| janitorial in Florida | 4 + 0 = 4 | IDENTICAL | 0/0 | 0 · 0 · 0 · 0 | ✅ | ✅ | 0 |
| 541512 -computers | 167 + 120 = 287 | IDENTICAL | 120/120 | 120 · 120 · 0 · 0 | ✅ | ✅ | 45 |
| -computers (needs_positive_scope) | 0 + 0 = 0 | IDENTICAL | 0/0 | 0 · 0 · 0 · 0 | ✅ | ✅ | 0 |
| zzzxxyyqqq | 0 + 0 = 0 | IDENTICAL | 0/0 | 0 · 0 · 0 · 0 | ✅ | ✅ | 0 |
| agency=USDA | 1,770 + 3,258 = 5,028 | IDENTICAL | 3,258/3,258 | 3,258 · 3,258 · 0 · 0 | ✅ | ✅ | 0 |
| agency=VA | 1,371 + 19 = 1,390 | IDENTICAL | 19/19 | 19 · 19 · 0 · 0 | ✅ | ✅ | 0 |
| agency=USDA\|VA | 3,141 + 3,277 = 6,418 | IDENTICAL | 3,277/3,277 | 3,277 · 3,277 · 0 · 0 | ✅ | ✅ | 0 |

**13/13** on market count, drawable ids, unplaced totals, exact unplaced ids (every id reachable, exactly once), ordering
(`estimated_value_max` desc, nulls last; `id` ascending only within ties) and fiscal-year policy. Every row the FY policy
removed has a past fiscal year (excluded by policy, not lost). Absolute counts are today's corpus.

Regression isolation: Maps Open (vs `b3e37cf0`), Maps Recompete (vs `566c1fe9`) and Forecast membership (adapter, plan,
forecast-map, map-data vs `2a4bd151`) — 0 lines changed; live Open and Recompete still return their `discovery` blocks.
Saved searches and daily alerts remain `pending` in the gate registry; no saved-search, alert or client file touched.

Latent, recorded only: the unplaced agency-facet tally pages without an ORDER BY. Measured correct today (13,975 rows, all
unique, identical per-agency counts with and without `id` ordering). Not part of this incident; not changed.

**Maps Forecast is frozen.** All three Maps horizons are on the canonical layer: Open ✓ · Recompete ✓ · Forecast ✓.
Next: `scripts/discovery-saved-search-blast.ts` against production for sign-off — no Saved Search migration before that.

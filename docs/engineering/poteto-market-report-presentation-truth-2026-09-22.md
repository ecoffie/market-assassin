# POTETO — Market Report Presentation Truth ✓

**MEASURE → EXPLAIN → LIST → COUNT → DATE → PRESENT** · surface `generate_market_report`
Merged PR #1627 (head `e5e1df4f`, merge `2c5e4b52`), production-verified on the hosted MCP 2026-09-22. **FROZEN.**

## Production before (hosted MCP)
| fixture | customer-visible contradiction |
|---|---|
| construction | `$919.7M` headline beside an unexplained `$0` literal tier. `competition`/`forecasts` `ok` with 0 rows; `sections_grounded 2/7` beside 4 `ok`. "15 recompetes" above 12 rows. |
| drones | `$90.0M` headline beside `$11.0B ← reported — "This is the market the report measures"`. 15 contractors counted, 12 rendered. |
| MA/236220 | 4 forecasts listed twice (`7799` + `GW-L:7799`). Set-aside cells `True`/`true`. No headline window. |
| all | `estimated_recompete_date` = PoP end − 12 months → past for every row. |

## Root causes → fixes
- **Grounding had two definitions.** `guard()` classified any object as `ok`; grounding counted a separate flag list. Now each section declares its evidence predicate and `sections_grounded` is derived from statuses. `_meta.degraded` and USAspending failures (`fetchSpendingCategory` `strict`) are `failed`, never `empty`.
- **Measurements presented without roles.** Tiers carry `role` + `note`; the headline is its own row in "How this market was measured".
- **Display cap presented as a count.** Every counted row renders; KPIs show the source total + "N shown below".
- **Cross-listed forecasts.** Deduped on agency-scoped listing id (`GW-L:` stripped); same-title/different-incumbent rows kept.
- **Capture date named as recompete date.** Presented as `capture_start_date` + `capture_start_passed`; shared MINDY-006 query untouched.
- **Boolean set-aside.** Normalized; booleans → "Not stated", raw kept as `set_aside_source_value`.
- **Code total labelled "description match".** Now "all awards coded NAICS 236220".

## Did not reproduce as defects
Noble Supply ×5 (186 distinct PIIDs), Vision's Sown ×2 (2 PIIDs), Northrop Grumman ×2 (two UEIs) — distinct records, now distinguishable by contract number / UEI. Construction `top_agencies` empty = genuine (USAspending `results: []` for the phrase), now explained.

## Production after (hosted MCP, merge `2c5e4b52`)
- construction: $919.7M via 8 trade terms; `$0` note "NOT that the market is $0"; 2/7 grounded == 2 ok; agencies/contractors/forecasts `empty`; 15 recompetes rendered of 24,663 found.
- drones: $90.0M headline + $11.0B synonym tier "← basis of the agency & contractor tables"; 336411 = 64% of 17 codes, misses 36%; 5/7 == 5 ok; recompete NAICS 541990/336411/423850 (no P0 off-subject codes).
- MA/236220: "Total market (national)", window "FY2025 (1 complete fiscal year · all awards coded NAICS 236220)"; 4 cross-listed forecasts removed (21 records, 11 shown); no boolean set-aside rendered.
- all: no `estimated_recompete_date`; `capture_start_date` + `capture_start_passed` present.
- Locks on merged main: Poteto suite, P0, P1, P2, Pursuit Dossier — all green.

## Locks
`src/mcp/tools/market-report-presentation-truth.unit.test.ts` · `src/lib/market/report-presentation.unit.test.ts` · `src/lib/market/spend-query-strict.unit.test.ts` · live `scripts/acceptance/poteto-market-report-presentation.mts`.
Changed with approval: `market-report-html.unit.test.ts` no longer asserts `← reported` (it asserted the contradiction this Poteto removes); stale `code_total` fixture tier removed.

## Deliberately unresolved (not this Poteto)
Generic 541990 rows in drones recompetes (P0 subject boundary) · fleet-level forecast twins in `agency_forecasts` (3,311) · 1-FY headline vs 3-FY sections methodology · incumbent `matchConfidence` semantics · contractor entity resolution.

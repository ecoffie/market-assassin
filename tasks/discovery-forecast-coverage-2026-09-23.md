# Discovery — canonical Forecast publisher coverage: "unavailable ≠ zero" (2026-09-23)

This is the gate before the Forecast half of the Saved Search migration.
- Saved Searches are **not** migrated.
- No saved-search definition was written.
- No email was sent.

Refreshed acceptance artifact: PR #1664 (not merged).

## Model

### Before

`buildDiscoveryPlan` computed `coverage: 'ok' | 'unestablished'`.
- `unestablished` fired only for a *known* forecast identity with `coverage: 'none'` (FAA, FBI, DLA …).
- An **unresolved** publisher (NOAA, COMMERCE, HUD, SBA) fell through as `ok`. Its agency needle then went to the text fallback (`department.imatch`), which returned 0.
- MCP and Maps therefore reported a measured-looking **0**.
- A multi-agency list with any uncovered buyer was either `unestablished` for the whole list or silently `ok`.

### After

Coverage is decided **per requested buyer** in the canonical plan (`src/lib/discovery/plan.ts`).

| buyer resolves to … | buyer state | example |
|---|---|---|
| ≥1 publisher code or child anchor we hold | covered | VA, DOJ, EPA, "STATE, DEPARTMENT" (STATE resolves) |
| a known identity with no forecasts | gap `publisher_without_forecasts` (+ label, parentWithData, note) | FAA → DOT |
| no forecast publisher identity at all | gap `unresolved_publisher` | NOAA, COMMERCE, HUD, SBA |

| horizon `coverage` | when | records / counts |
|---|---|---|
| `ok` | all buyers covered, or no buyer asked | normal; **a 0 is a measured zero** |
| `partial` | some covered, some gaps | the OR filter runs over the **covered buyers only**; `coverageGaps` names the rest; counts never include a zero for them |
| `unestablished` | no buyer covered | fails closed (`id IS NULL`); `via: coverage_unestablished`; **no count** |

- The OR semantics across covered buyers are unchanged.
- An uncovered buyer is removed from the filter instead of being left to the text fallback. `department` only ever holds the full names of the 20 publishers we hold (measured), so the fallback could only return 0 or leak another publisher's rows.

### Consumers (same result, no surface-specific logic)

- **MCP `find_opportunities`, `coming_soon`:**
  - `unestablished` → `status: unavailable`, `matched_count: null`, `coverage.gaps`, `error.class: coverage_unestablished`, with a message that says whether the publisher was unresolved or has no forecasts.
  - `partial` → `status: partial`, a count over covered buyers only, `coverage.gaps`, and a semantics note plus headline naming the gaps.
  - New host rule: COMING SOON PARTIAL.
- **Maps** (`/api/app/forecast-map`, `/api/forecasts/unplaced`):
  - `discovery.coverage` + `discovery.coverage_gaps`.
  - When unavailable, `totalForFilters`, `unmappedForFilters`, `unplacedTotal` and `total` are **null**, never 0.
- **Saved Searches:** will read the same `plan.horizons.forecast.coverage` / `coverageGaps` (not migrated yet).

## Acceptance (production DB, read-only; no deploy needed)

| case | coverage | gaps | MCP coming_soon | Maps meta | Maps route counts | records MCP ≡ Maps |
|---|---|---|---|---|---|---|
| NOAA | unestablished | NOAA: unresolved_publisher | unavailable · matched null | unestablished · NOAA | null / null | IDENTICAL (0) |
| National Oceanic and Atmospheric Administration | unestablished | unresolved_publisher | unavailable · null | unestablished | null / null | IDENTICAL (0) |
| COMMERCE | unestablished | unresolved_publisher | unavailable · null | unestablished | null / null | IDENTICAL (0) |
| HUD | unestablished | unresolved_publisher | unavailable · null | unestablished | null / null | IDENTICAL (0) |
| SBA | unestablished | unresolved_publisher | unavailable · null | unestablished | null / null | IDENTICAL (0) |
| FAA (known, no forecasts) | unestablished | FAA: publisher_without_forecasts (parent DOT) | unavailable · null | unestablished · FAA | null / null | IDENTICAL (0) |
| VA + janitorial (known, results) | ok | — | grounded · 14 | ok | 14 | IDENTICAL (14) |
| EPA + submarine / NRC + janitorial / EPA + dredging (**genuine zero**) | ok | — | **empty · matched 0** | ok | **0** (not null) | IDENTICAL (0) |
| VA\|DOJ + janitorial (all covered) | ok | — | canonical library | ok | 16 | IDENTICAL (16) |
| VA\|NOAA\|DOJ + janitorial (partial) | **partial** | NOAA | canonical library | partial · NOAA | **16 = the VA\|DOJ count** | IDENTICAL (16) |
| NOAA\|HUD\|SBA\|COMMERCE (none covered) | unestablished | all four | canonical library | unestablished · all four | null / null | IDENTICAL (0) |

The MCP `find_opportunities` tool takes ONE agency string, so its multi-agency parity is proven against the canonical library that Maps and Saved Searches call.

## Replay

**Record blast** (`scripts/discovery-forecast-coverage-blast.ts`, read-only):
- 812 buyer names were checked (the shared alias corpus plus live SAM department / sub_tier).
- 677 are uncovered. 673 of those returned **0** before and are now `unavailable`: the coverage correction.
- **4** returned rows before. All 4 were leaks of *other* publishers through a comma fragment:
  - "COMMERCE, DEPARTMENT OF" / "EDUCATION, DEPARTMENT OF" / "HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF" → the fragment "DEPARTMENT OF" matched 7,195 Interior / Transportation / Navy rows.
  - "SENATE, THE" matched 3,190 rows on "THE".
- These are the only records the fix removes, and every one is a canonical bug correction.

**Saved-search blast** (`scripts/discovery-saved-search-blast.ts --all`, 108 searches, 0 errors, 0 unknown) vs the pre-fix run 33 minutes earlier. 14 searches changed:

| search | change | class |
|---|---|---|
| e00435f7 NOAA | Forecast 0 (`ok`) → **unavailable**. The 3 legacy rows were DOI/DHS text mentions of NOAA | coverage correction |
| 61d1ca1f Show me HUD | Forecast 0 → **unavailable** | coverage correction |
| b032f39f Show me SBA | Forecast 0 → **unavailable** | coverage correction |
| a5f952c7 15-department list incl. COMMERCE | Forecast 3,586 `ok` → 3,586 **partial**, gap COMMERCE. The count is unchanged, so COMMERCE contributed nothing | coverage correction |
| 02dc20b6, 175a893e, 1b018df4, 0c87be33, 14466713, 14d902aa, 03ce338a, 1c3b715a (no query) | Open −2 … −57 | **corpus drift**: the legacy side moved by the same amount; old−canonical gap 0 → 0 (the 30-day posted window rolled) |
| 386e228b, 9ca2d2de | Recompete map +2 / +1 | corpus drift (hourly recompete sync; Forecast code cannot reach this horizon) |

**Maps Forecast replay** (`discovery-replay.ts --maps-forecast`):
- Before and after both show 24 fixtures: 5 FY-policy, 11 canonical corrections, 8 unchanged.
- 0 parity failures, 0 unplaced failures.
- No fixture's class changed.

## Gates

- **Tests:** discovery suite 97 passed; related suites 2,498 passed.
- **New tests:** `src/lib/discovery/forecast-coverage.unit.test.ts` covers:
  - NOAA / COMMERCE / HUD / SBA
  - FAA
  - VA results
  - EPA genuine zero
  - "STATE, DEPARTMENT" fragment
  - multi-agency all / partial / none
  - MCP ≡ Maps coverage and gaps
  - the headline never zeroes a gap
- **Break-and-restore:** marking every buyer covered turns 10 tests red; restoring makes them green.
- **Golden plans:** 3 fixtures ADDED (agency=NOAA, agency=FAA, agency=HUD + janitorial); **0 existing plans changed**.
- **Cross-surface gate:** green with the new fixtures.

## Out of scope — recorded separately

- **#1665:** `recompete-map/route.ts:100` renders a failed count as 0 (`totalForFilters ?? 0`). Observed as 0 under load vs 5,207 normally.
- **#1666:** within a *covered* buyer, the comma fragment "DEPARTMENT" still leaks. `STATE, DEPARTMENT` returns 7,196 other-agency forecasts, while State alone returns 0. Records for covered buyers were deliberately left unchanged here.
- **Maps UI:** the client still coerces a null forecast total to 0 in its display (`d.totalForFilters||0`, `d.total||0`). The API is now honest; rendering "unavailable" on the map is presentation work.

# #1666 — forecast agency comma-fragment leak (2026-09-23)

This blocks the Forecast Saved Search migration. Nothing here migrates Saved Searches, writes saved-search definitions or sends email.

## Root cause

It sits in the ONE forecast agency resolver (`src/lib/forecasts/agency-identity.ts` → `resolveForecastAgencies`). The problem is fragment handling that feeds SQL filter construction.

1. The resolver split every buyer name on `|` **and** `,` *before* trying to resolve it. The comment claimed a comma name "falls through to the text fallback intact", but the intact name was never tried.
2. `"STATE, DEPARTMENT"` therefore became two needles:
   - `STATE` → code `STATE` (a registered publisher that holds 0 rows today; ingest pending)
   - `DEPARTMENT` → unresolved
3. `forecastAgencyOrExpr` turns an unresolved needle into a word-boundary text fallback. For "DEPARTMENT" that is `source_agency.imatch.\mDEPARTMENT\M, department.imatch.\mDEPARTMENT\M`.
4. `agency_forecasts.department` holds the full names of the publishers we hold ("Department of the Interior", "Department of Agriculture" …). So the clause matched **every** "Department of …" row: 7,196 forecasts.

**Not the cause:**
- **Aliases:** they are correct. `normalize()` turns "STATE, DEPARTMENT" into "STATE DEPARTMENT", which is already a registered State alias; it just was never tried.
- **Canonical agency normalization / buyer resolution (SAM side):** the leak is forecast-side only.
- **Shared discovery:** #1667's coverage fix removes *uncovered* buyers, but "STATE, DEPARTMENT" is covered, so its leaking fragment passed through.

**Blast of the same mechanism (before the fix):**
- **Every** SAM-style `X, DEPARTMENT OF` name was affected: HHS 12,702 (5,506 real), Energy 8,497 (1,301), Justice 7,815 (619), Labor 7,218 (166), Treasury 3,391 (200), and more.
- "SENATE, THE" leaked 3,190 rows through "THE".

## Fix (one resolver, every forecast surface)

1. Resolve each pipe part **whole** first: child → identity → bare code.
2. Only if that fails, split on commas. That path is still needed for MCP's documented comma list, `"NAVY,HHS"`.
3. A fragment made only of generic words (department, dept, of, the, and, for, bureau, office, agency, administration, U.S.) is **never** an identity and **never** a text-fallback needle.

No saved-search code, no Maps code and no surface-specific logic changed. Every consumer shares this resolver: the canonical plan, Maps via `applyForecastFilters`, `/api/forecasts`, MCP `get_agency_forecasts`, and today's saved-search cron.

## Acceptance

| requirement | result |
|---|---|
| A. `STATE, DEPARTMENT` returns only State's records | 7,196 → **0**. State holds 0 rows; every removed row was DOI 3,131 · USDA 2,509 · VA 692 · DOT 660 · DOL 144 · ONR 48 · NRL 12 |
| B. State covered + genuinely zero | plan coverage `ok`, count 0 (a measured zero). State is registered `represented` ahead of its FCO ingest |
| C. no cross-match on DEPARTMENT / OF | no Maps preset or SAM-style name emits a generic-word fallback clause (unit test + live scan below) |
| D. valid aliases keep working | 802 of 822 names resolve byte-identically; `NAVY,HHS`, `VA\|DOJ`, `DEFENSE`, `DEPARTMENT OF STATE`, `NAVFAC` unchanged |

### E. The three 15-department saved searches

Forecast horizon, current + future FY, covered buyers. COMMERCE remains a named gap (`partial`, from #1667).

| search | alerts on Forecast | before → after | removed rows (all from a publisher NOT in the list) |
|---|---|---|---|
| a5f952c7 | yes | 20,798 → 20,738 (−60) | ONR 48 · NRL 12 ("Department of the Navy"; DEFENSE not in its list) |
| f465fbd8 | no | 29,095 → 25,965 (−3,130) | DOI 3,130 (INTERIOR not in its list) |
| fa66531f | no | 28,877 → 28,185 (−692) | VA 692 (VETERANS AFFAIRS not in its list) |

With all saved filters applied (the saved-search blast), a5f952c7's alert count goes **3,586 → 3,578**. The −8 are Navy rows. No other saved search's Forecast count changed. Every Open delta in that run was corpus drift: old and canonical moved together.

### F. Broader agency regression

822 names were checked: the alias corpus, live SAM department / sub_tier / office values, the 16 Maps presets, and saved-search agency values.

| | count |
|---|---|
| resolver output identical | 802 |
| changed | 20 |
| of the changed, rows **added** | **0** |
| of the changed, rows removed that belonged to the named publisher | **0** |

### G. Every changed name, classified

| name | before → after | class |
|---|---|---|
| HEALTH AND HUMAN SERVICES, DEPARTMENT OF | 12,702 → 5,506 | leak removed (bug correction) |
| AGRICULTURE, DEPARTMENT OF | 9,715 → 5,028 | leak removed |
| HOMELAND SECURITY, DEPARTMENT OF | 9,026 → 1,830 | leak removed |
| ENERGY, DEPARTMENT OF | 8,497 → 1,301 | leak removed |
| VETERANS AFFAIRS, DEPARTMENT OF | 7,894 → 1,390 | leak removed |
| JUSTICE, DEPARTMENT OF | 7,815 → 619 | leak removed |
| TRANSPORTATION, DEPARTMENT OF | 7,433 → 897 | leak removed |
| LABOR, DEPARTMENT OF | 7,218 → 166 | leak removed |
| STATE, DEPARTMENT / STATE, DEPARTMENT OF | 7,196 → 0 | leak removed (State holds 0) |
| COMMERCE / EDUCATION / HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF | 7,196 → 0 | leak removed (unresolved publisher; canonical plan = unavailable) |
| INTERIOR, DEPARTMENT OF THE | 6,224 → 6,164 | leak removed (Navy rows via "DEPARTMENT OF THE") |
| TREASURY, DEPARTMENT OF THE | 3,391 → 200 | leak removed |
| SENATE, THE | 3,191 → 0 | leak removed ("THE") |
| 3 multi-agency lists (the saved searches above) | −60 / −692 / −3,131 | leak removed |
| Bureau of Alcohol, Tobacco, Firearms and Explosives | 0 → 0 | now resolves whole to the ATF identity (publisher_without_forecasts) instead of three fragments |

(Counts are whole corpus, no FY clause.)

**No remaining leakage:** after the fix, the 652 distinct unresolved fallback needles across all 819 known buyer names (including every saved-search agency value) match **0** forecast rows.

## Gates

- `src/lib/forecasts/agency-fragment-leak.unit.test.ts`: 18 tests.
- Break-and-restore: swapping in the old resolver turns 13 red; restoring makes them green.
- Related suites: 2,488 tests passing.

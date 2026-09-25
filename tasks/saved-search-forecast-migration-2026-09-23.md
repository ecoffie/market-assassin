# Saved Search Forecast → Canonical Discovery (2026-09-23) — FOR REVIEW, NOT ENABLED

**Status:** code + read-only proof. The canonical engine ships **OFF**. The cron keeps running the legacy Forecast engine
unless `SAVED_SEARCH_FORECAST_CANONICAL` is exactly `true` (not set anywhere). No saved-search definition or alert state
was written, and no email was sent.

- Baseline: production `9efc6c73` (#1667 coverage semantics · #1672 whole-name agency resolution · #1669 Maps presentation).
- Acceptance artifact: #1664 (108-search blast). Replayed here against the migrated adapter.
- Out of scope, untouched: #1665 (recompete map count → 0 under load), #1673 (legacy `/api/forecasts` false zero), the Open
  and Recompete halves of Saved Searches.

## 1. Current Saved Search Forecast path (traced before editing)

| step | where | what it does today |
|---|---|---|
| definition | `saved_searches` (`mode`, `filters` jsonb, `alert_frequency`, `alerts_enabled`, `last_seen_notice_ids` ≤500, `last_alerted_at`, `total_alerts_sent`) | written by the map's Save / MCP `schedule_market_search`; `filters.horizons.forecast===true` opts into Forecast |
| scheduler | `cron_jobs` → `/api/cron/saved-search-alerts` → `runSavedSearchAlertDrain` | due rows: `alerts_enabled`, not `anon:`, **`mode='open'` only**, daily (+weekly on Mondays), oldest `last_alerted_at` first |
| horizon selection | `wantsForecasts()` | Forecast iff `filters.horizons.forecast===true`; Open iff `mode==='open'` (ignores `horizons.open`); Recompete is never alerted (rejected at save time) |
| query | `fetchForecastMatches()` | `applyForecastFilters(q, naics, agency, state)` — the legacy interpreter (keywordOrExpr / resolveQueryIntent, identity-resolved agency with a word-boundary **text fallback for unresolved names**); **no fiscal-year policy**; `limit 200` ordered `last_synced_at desc`; no `map_lat` bound |
| filters honored | — | only `q`, `naics`, `agency`, `state` (same keys the map client sends to its Forecast horizon). psc/set-aside/strategy/profile scope do not reach Forecast |
| multi-agency | `agency` stored as `A|B|C` | passed whole to `resolveForecastAgencies` (pipe = buyers) |
| typed query | `filters.q` | interpreted by the legacy `applyForecastFilters` keyword path |
| count | none | the alert has no count; the window is the 200 most recently synced matches |
| dedupe / new | inline in `evaluateSavedSearch` | first run → store ids as seen, no email; new = id ∉ `last_seen_notice_ids` (forecast id = `external_id`, mapped onto `notice_id` by `toAlertRow`); after send seen = current ids + prior, deduped, capped 500; Open and Forecast share one seen list; **new-record only** (an amended forecast keeps its id) |
| failure | `forecast_query_failed` | returned before any stamp — state untouched |
| rendering | `buildEmail` (`src/lib/alerts/saved-search-email.ts`) | "N new matches in …" + 3 evidence rows; forecast rows via `toAlertRow` |
| coverage | — | **none.** An unresolved publisher (NOAA/HUD/SBA/COMMERCE) silently contributes whatever the text fallback returns (0, or substring noise) |
| delivery | `sendEmail` (`saved_search_alert`) | send only when there are new ids; no zero-result email exists |

### Exact divergence from canonical Discovery
1. Query meaning came from `applyForecastFilters` (legacy interpreter), not `buildDiscoveryPlan` — typed sentences ("Show me USDA opportunities")
   were substring token-ORs.
2. No fiscal-year policy (canonical: current + future FY by default on every surface).
3. No coverage state: unresolved publishers went through a text fallback and read as a measured 0 (or noise); a partly
   covered multi-agency list hid its missing buyer.
4. Everything else (window, ordering, dedupe, shared seen list, rendering, delivery) is Saved-Search-specific and is kept.

## 2. Migration architecture

```
saved_searches.filters ──► savedSearchForecastRequest()        (src/lib/saved-searches/forecast-discovery.ts)
   keys q·agency·naics·state        │  forecastDiscoveryRequest(get, SAVED_SEARCH_POLICY)   ← the SAME builder Maps Forecast uses
                                    ▼                                                          (maps-forecast-discovery.ts)
                            canonical DiscoveryPlan  ── coverage ok | partial | unestablished · FY policy · buyers · concepts
                                    │
     fetchSavedSearchForecasts() ──►  ForecastHorizonOutcome:  measured(ok|partial, rows, gaps) | unavailable | needs_refinement | failed
                                    │   (window: 200 by last_synced_at, unchanged)
cron evaluateSavedSearch ──────────►  failed → forecast_query_failed, NO state write (unchanged)
                                      decideSavedSearchAlert()  (src/lib/saved-searches/alert-decision.ts — the legacy rules, extracted verbatim, shared by both engines)
                                      buildEmail(search, fresh, [forecastCoverageNotice(outcome)])
```

- **No forked semantics.** The adapter only chooses which saved keys feed the builder: exactly the keys the map sends to
  its Forecast horizon (`_buildOppUrl`, m==='forecast'), so the alert and the restored `?ss=` map watch the same market.
  A saved PSC never crosswalks into Forecast, for the same reason.
- `mapsForecastRequest` is now a one-line wrapper over `forecastDiscoveryRequest(get, MAPS_POLICY)` — Maps behavior unchanged
  (all Maps / discovery tests unchanged and green).
- **Engine switch:** `resolveForecastEngine` — canonical only when `SAVED_SEARCH_FORECAST_CANONICAL === 'true'`, or for a
  read-only `?mode=preview&forecastEngine=canonical`. Default legacy.
- **Coverage copy comes from the canonical state, never a count** (`forecastCoverageNotice`). It is rendered only inside an
  alert that already has new matches — no email is ever sent just to report a gap (that would be a new notification rule).
- Cron response gains `forecastEngine` and `forecastCoverage: {covered, partial, unavailable, needs_refinement}` tallies, so an
  unavailable horizon is never counted as "checked, nothing found".
- Cross-surface gate: `saved_searches_forecast` is **migrated** (gated on shared interpretation + Forecast meaning + coverage
  vs MCP); `saved_searches_open` stays **pending**.

## 3. 108-search read-only replay

`npx tsx --env-file=.env.local scripts/saved-search-forecast-migration-replay.ts --json … --md …`
Measured 2026-09-23T23:16Z against production (FY2026). **109** alerting searches exist now: the 108 of #1664 plus `ad3f8e7c`,
created 2026-09-23 20:39 UTC (after the #1664 corpus). **0 query failures, 0 unknown counts, 0 unexplained differences.**

- OLD = the legacy cron Forecast query exactly · PLAN = `buildDiscoveryPlan` built independently in the script ·
  ADAPTER = the migrated code under test.
- **PLAN ≡ ADAPTER for all 55 Forecast-alerting searches**: plan JSON byte-identical and full record-id sets identical.
- Open: both engines execute the identical Open code, so Open is evaluated once (a5f952c7 Open window now 83; #1664 recorded 88 —
  ordinary drift, notices closing).

| | searches |
|---|---|
| total replayed | 109 (108 in #1664 corpus) |
| **identical** | **57** (54 not Forecast-alerting + 3 Forecast searches with no change) |
| fiscal-year policy only | 41 (40 in the 108) |
| canonical bug correction | 3 (+1 with FY) |
| approved canonical concept | 3 |
| coverage correction — unavailable | 3 (NOAA, HUD, SBA) |
| coverage correction — partial (+FY) | 1 (a5f952c7) |
| unexplained / unknown | **0** |

Totals over the 55 Forecast searches: old 738,668 rows → canonical 674,503 measured (+3 unavailable). Removed: 71,406 past-FY
(policy) · 3 NOAA substring-noise rows (coverage) · 0 agency-leak (both engines already share the #1672 resolver). Added: 7,244
(the accepted bug corrections/concepts). **Past-FY rows in any canonical set: 0. Duplicate ids in any alert window: 0.**

### Every Forecast-alerting search

| search | user | q / agency | cron-eligible | class | coverage | old → plan = adapter | FY Δ | leak Δ | meaning Δ | window old/new (overlap) | fresh forecast old → new | decision old → new |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02dc20b6 | user-47c14468 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (91) | 15 → 118 | send → send |
| 0678583e | user-47c14468 | Pro Audio | yes | canonical_bug_correction | ok | 0 → 2 = 2 | −0 | −0 | +2/−0 | 0/2 (0) | 0 → 2 | send → send |
| 08d970cb | user-967749f2 | 6114 | yes | fiscal_year_policy | ok | 170 → 138 = 138 | −32 | −0 | +0/−0 | 170/138 (138) | 0 → 0 | send → send |
| 14466713 | user-771a461c | — | yes | fiscal_year_policy | ok | 9649 → 8455 = 8455 | −1194 | −0 | +0/−0 | 200/200 (87) | 98 → 77 | send → send |
| 14d902aa | user-d1bd4f44 | — | yes | fiscal_year_policy | ok | 5154 → 4850 = 4850 | −304 | −0 | +0/−0 | 200/200 (191) | 27 → 27 | send → send |
| 175a893e | user-a2faea35 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (97) | 15 → 104 | send → send |
| 1b018df4 | user-7a1ef98e | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (125) | 15 → 88 | send → send |
| 1c3b715a | user-0433ca73 | — | yes | fiscal_year_policy | ok | 3264 → 2968 = 2968 | −296 | −0 | +0/−0 | 200/200 (182) | 13 → 15 | send → send |
| 1f01ad20 | user-3f7b8b97 | — | no | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (130) | 0 → 0 | baseline → baseline |
| 32846637 | user-967749f2 | — | yes | fiscal_year_policy | ok | 5189 → 4701 = 4701 | −488 | −0 | +0/−0 | 200/200 (200) | 1 → 1 | send → send |
| 32acc010 | user-158441db | — | yes | fiscal_year_policy | ok | 2353 → 2002 = 2002 | −351 | −0 | +0/−0 | 200/200 (182) | 5 → 21 | send → send |
| 386e228b | user-9a975bb5 | Show me USDA opportunities | yes | canonical_bug_correction | ok | 0 → 5028 = 5028 | −0 | −0 | +5028/−0 | 0/200 (0) | 0 → 200 | send → send |
| 46275c5f | user-55c0d4eb | — | no | fiscal_year_policy | ok | 1673 → 1541 = 1541 | −132 | −0 | +0/−0 | 200/200 (192) | 0 → 0 | baseline → baseline |
| 4692743e | user-994f9435 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (120) | 14 → 76 | send → send |
| 48df9f00 | user-dc6033cf | — | no | fiscal_year_policy | ok | 7326 → 6655 = 6655 | −671 | −0 | +0/−0 | 200/200 (200) | 0 → 0 | baseline → baseline |
| 507cdd28 | user-879bbe36 | — | no | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (119) | 0 → 0 | baseline → baseline |
| 54fd0605 | user-a38e7c2c | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (123) | 15 → 88 | send → send |
| 5759ff87 | user-623b5e4e | — | yes | identical | ok | 17 → 17 = 17 | −0 | −0 | +0/−0 | 17/17 (17) | 0 → 0 | send → send |
| 5b867c2f | user-994f9435 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (133) | 14 → 59 | send → send |
| 5c25203a | user-5547f32c | — | yes | fiscal_year_policy | ok | 5154 → 4850 = 4850 | −304 | −0 | +0/−0 | 200/200 (191) | 8 → 8 | send → send |
| 5e4bcd5a | user-7a1ef98e | — | yes | fiscal_year_policy | ok | 236 → 233 = 233 | −3 | −0 | +0/−0 | 200/200 (197) | 0 → 0 | no_new → no_new |
| 5eaba2aa | user-3df39dc5 | — | no | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (147) | 0 → 0 | baseline → baseline |
| 61d1ca1f | user-9a975bb5 | Show me HUD opportunities | yes | coverage_correction | unestablished (HUD (unresolved_publisher)) | 0 → UNAVAILABLE | −0 | −0 | +0/−0 | 0/0 (0) | 0 → 0 | send → send |
| 64eb46b6 | user-47c14468 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (101) | 15 → 109 | send → send |
| 6f121c25 | user-6b385d82 | — | yes | fiscal_year_policy | ok | 788 → 767 = 767 | −21 | −0 | +0/−0 | 200/200 (196) | 0 → 0 | no_new → no_new |
| 74839699 | user-422417ef | — | yes | fiscal_year_policy | ok | 3872 → 3534 = 3534 | −338 | −0 | +0/−0 | 200/200 (200) | 1 → 1 | send → send |
| 749d017b | user-6b385d82 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (108) | 15 → 101 | send → send |
| 7d3a2556 | user-994f9435 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (114) | 15 → 94 | send → send |
| 7ef11325 | user-b7f6c56e | — | yes | identical | ok | 0 → 0 = 0 | −0 | −0 | +0/−0 | 0/0 (0) | 0 → 0 | no_new → no_new |
| 81bf2414 | user-967749f2 | — | yes | fiscal_year_policy | ok | 5189 → 4701 = 4701 | −488 | −0 | +0/−0 | 200/200 (200) | 1 → 1 | send → send |
| 88d24ae2 | user-dd8c4f78 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (88) | 15 → 121 | send → send |
| 915af605 | user-6fbe166e | — | no | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (125) | 0 → 0 | baseline → baseline |
| 943f7486 | user-8011bfb7 | — | yes | identical | ok | 26 → 26 = 26 | −0 | −0 | +0/−0 | 26/26 (26) | 0 → 0 | no_new → no_new |
| 983d2867 | user-967749f2 | — | yes | fiscal_year_policy | ok | 5159 → 4672 = 4672 | −487 | −0 | +0/−0 | 200/200 (200) | 1 → 1 | send → send |
| 994c599e | user-7a1ef98e | -computers | yes | approved_canonical_concept | ok | 0 → 1575 = 1575 | −0 | −0 | +1575/−0 | 0/200 (0) | 0 → 200 | no_new → send |
| 9953d49b | user-447fb7d0 | — | no | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (89) | 0 → 0 | baseline → baseline |
| 9ca2d2de | user-9a975bb5 | Show me DOJ opportunities | yes | canonical_bug_correction | ok | 0 → 619 = 619 | −0 | −0 | +619/−0 | 0/200 (0) | 0 → 200 | send → send |
| a5f952c7 | user-05fcaba6 | agency=VETERANS AFFAIRS|INTERIOR|HOMELAND SECUR… | no | fiscal_year_policy + coverage_correction(partial) | partial (COMMERCE (unresolved_publisher)) | 4153 → 3578 = 3578 | −575 | −0 | +0/−0 | 200/200 (200) | 0 → 0 | baseline → baseline |
| a82d3d77 | user-2abbe630 | — | yes | fiscal_year_policy | ok | 4660 → 4301 = 4301 | −359 | −0 | +0/−0 | 200/200 (200) | 14 → 14 | send → send |
| ab8bb3c8 | user-6b385d82 | — | yes | fiscal_year_policy | ok | 236 → 233 = 233 | −3 | −0 | +0/−0 | 200/200 (197) | 0 → 0 | no_new → no_new |
| ad3f8e7c | user-745d9e92 | — | no | fiscal_year_policy | ok | 190 → 153 = 153 | −37 | −0 | +0/−0 | 190/153 (153) | 0 → 0 | baseline → baseline |
| ae5ddb00 | user-6b385d82 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (110) | 15 → 102 | send → send |
| b032f39f | user-9a975bb5 | Show me SBA opportunities | yes | coverage_correction | unestablished (SBA (unresolved_publisher)) | 0 → UNAVAILABLE | −0 | −0 | +0/−0 | 0/0 (0) | 0 → 0 | send → send |
| b4e40d05 | user-e3bc863d | fiber optic installation | yes | approved_canonical_concept | ok | 2 → 5 = 5 | −0 | −0 | +3/−0 | 2/5 (2) | 0 → 3 | no_new → send |
| bfe464e2 | user-eba918fa | — | no | fiscal_year_policy | ok | 4894 → 4100 = 4100 | −794 | −0 | +0/−0 | 200/200 (200) | 0 → 0 | baseline → baseline |
| c3f908e3 | user-47c14468 | shoe me opportunities in the Virgin Islands | yes | approved_canonical_concept | ok | 0 → 11 = 11 | −0 | −0 | +11/−0 | 0/11 (0) | 0 → 11 | send → send |
| c4158f3a | user-971c7980 | — | yes | fiscal_year_policy | ok | 5942 → 5617 = 5617 | −325 | −0 | +0/−0 | 200/200 (172) | 2 → 5 | send → send |
| c55dbe32 | user-c168c42e | — | no | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (139) | 0 → 0 | baseline → baseline |
| c75b5e65 | user-f2f06956 | — | yes | fiscal_year_policy | ok | 613 → 493 = 493 | −120 | −0 | +0/−0 | 200/200 (190) | 2 → 2 | send → send |
| dd024647 | user-994f9435 | — | yes | fiscal_year_policy | ok | 35939 → 32422 = 32422 | −3517 | −0 | +0/−0 | 200/200 (115) | 15 → 97 | send → send |
| e00435f7 | user-387ba736 | National Oceanic and Atmospheric Administration | yes | coverage_correction | unestablished (National Oceanic and Atmospheric Administration (unresolved_publisher)) | 3 → UNAVAILABLE | −0 | −0 | +0/−3 | 3/0 (0) | 0 → 0 | send → send |
| e2466850 | user-1d4d0e3f | agency=DEFENSE | yes | fiscal_year_policy | ok | 11789 → 11389 = 11389 | −400 | −0 | +0/−0 | 200/200 (199) | 0 → 1 | send → send |
| e9c0f9be | user-47c14468 | revenue cycle management | yes | fiscal_year_policy | ok | 2 → 0 = 0 | −2 | −0 | +0/−0 | 2/0 (0) | 0 → 0 | send → send |
| f587f86b | user-37b96f97 | — | no | fiscal_year_policy | ok | 4062 → 3687 = 3687 | −375 | −0 | +0/−0 | 200/200 (200) | 0 → 0 | baseline → baseline |
| ff372605 | user-47c14468 | medical billing | yes | fiscal_year_policy + canonical_bug_correction | ok | 1 → 6 = 6 | −1 | −0 | +6/−0 | 1/6 (0) | 0 → 6 | send → send |

Column notes: *FY Δ* past-fiscal-year rows dropped by policy · *leak Δ* rows from publishers outside the saved agencies ·
*meaning Δ* +added / −removed beyond FY and leak · *window* the 200-row alert window, old/new (ids in both) · *fresh forecast* ids the
alert decision would treat as new against the search's **stored** seen list · *decision* baseline / no_new / send.

### Classification detail
- **Bug corrections** (#1664 §3): 386e228b USDA 0→5,028 · 9ca2d2de DOJ 0→619 · ff372605 medical billing 1→6 (−1 FY) · 0678583e Pro Audio 0→2.
- **Approved canonical concepts**: c3f908e3 Virgin Islands typo 0→11 · 994c599e `-computers` 0→1,575 · b4e40d05 fiber optic installation 2→5.
- **Coverage corrections**: 61d1ca1f HUD 0→UNAVAILABLE · b032f39f SBA 0→UNAVAILABLE · e00435f7 NOAA 3→UNAVAILABLE (the 3 were substring
  noise: 2 DOI "NOAA NMFS ESA consultation", 1 DHS) · a5f952c7 PARTIAL, COMMERCE named.
- **FY policy only**: 41 — including e9c0f9be "revenue cycle management" 2→0, which is a **covered, measured zero** (coverage ok).
- **ad3f8e7c** (outside the 108): FY policy only, 190→153.

### Coverage-state comparison
| state | legacy engine | canonical |
|---|---|---|
| ok (measured; a 0 is real) | 55 (no state existed) | 51 |
| partial (covered buyers only, gaps named) | — | 1 (a5f952c7: COMMERCE) |
| unavailable (no measurement) | — (read as 0 or noise) | 3 (NOAA, HUD, SBA — `unresolved_publisher`) |

### Alert-eligible comparison (against stored state, read-only)
43 Forecast searches are cron-eligible. Decision changes: **2** (994c599e and b4e40d05 go no_new→send because the approved
concepts admit rows). Fresh forecast ids, cron-eligible total: **351 legacy → 1,953 canonical**; 19 searches unchanged.
See §5 — this is the one blocker.

## 4. Alert-decision proof (Phase 5)

All without sending email and without writing production state.

**Route-level** (`src/app/api/cron/saved-search-alerts/forecast-engine.unit.test.ts` — the real GET handler, Supabase + sendEmail
replaced by recording fakes):
1. previously-seen forecast → no send; only `last_alerted_at` stamped ✅
2. new forecast → exactly one send, seen stamped `[current…, prior…]`, `total_alerts_sent+1` ✅
3. same forecast next run → no send ✅
4. amended forecast (same `external_id`, new title/quarter/set-aside) → not new ✅
5. covered zero → no send, tallied `covered` ✅
6. unavailable → **agency_forecasts never queried**, no send of its own, tallied `unavailable`; with a new Open match the
   email carries the unavailable notice ✅
7. partial → sends covered results with the partial warning naming COMMERCE; the query filters `source_agency.in.(VA)` only ✅
8. forecast query failure → `forecast_query_failed`, **zero state writes, zero sends**, HTTP 500 ✅ (legacy engine: same)
- first run under partial → baseline, no email ✅ · preview + `forecastEngine=canonical` with the flag OFF → no writes, no sends ✅
- flag unset / `'1'` → legacy engine; legacy email byte-identical (no notice) ✅

Mutation-proven: making a canonical failure fall through as zero fails test 8; making unavailable a measured zero fails 4 tests;
dropping `agency` from the adapter's keys fails the cross-surface gate.

**Live** (`scripts/saved-search-forecast-alert-proof.ts`, production data, state simulated in memory) — **16/16 PASS**:
a5f952c7 partial · COMMERCE named · canonical count **3,578** · **0 rows from any publisher outside the 14 covered departments**
(Navy leak stays removed) · first run baseline · one unseen forecast alerts exactly once · not again next run · amended not new ·
e2466850 DEFENSE covered with results, no notice · 0 past-FY rows in window · e9c0f9be measured zero, no alert · e00435f7 NOAA
unavailable, notice never implies "checked and found nothing" · simulated failure → `failed`.

## 5. BLOCKER before enabling — the cutover burst

The canonical window differs from the legacy window (FY policy removes past-year rows; corrections admit new ones), so on the
**first canonical run** rows that were never in the user's seen list enter the 200-row window and would be alerted as "new":

| | value |
|---|---|
| cron-eligible searches that would alert forecasts on the first canonical run | **32** |
| forecast rows labelled "new" | **1,934** |
| of those, created in the last 30 days | **189** |
| of those, created in the last 7 days | 48 |

~90% are old records, not new opportunities (e.g. 386e228b/9ca2d2de/994c599e would each email "200 new matches").
Dedupe is working as designed: none of them were ever seen. What's missing is a decision about the cutover.

**Decision needed (not implemented — it writes production state or adds a rule):**
- **(a) One-time cutover re-baseline (recommended).** Immediately before enabling, for every Forecast-alerting search, set
  `last_seen_notice_ids = [...canonicalWindowIds, ...stored]` deduped/capped 500 — the exact rule a successful send already
  applies — with no email. Needs a reviewed `--go` script and sign-off, since it writes user state.
- (b) Accept the one-time burst.
- (c) Per-horizon first-run baseline keyed on an engine marker (needs a column; larger change).

Same mechanism, pre-existing and not changed here: legacy corpus-wide searches already surface ~15 "new" per day that are
re-synced old rows (window ordered by `last_synced_at`). Worth a separate look.

## 6. Rendered examples (no delivery)

Unavailable (e00435f7, NOAA; two live NOAA Open notices stand in for "Open had new matches"):
```
Subject: 2 new matches in “National Oceanic and Atmospheric Administration — Open + Recompetes + Forecasts”

2 new matches in "National Oceanic and Atmospheric Administration — Open + Recompetes + Forecasts"

Note: Upcoming (forecast) buys: not available for National Oceanic and Atmospheric Administration. Mindy holds no forecast publisher for this buyer, so nothing was measured. This is not a zero.

Open updated map (your filters restored): https://getmindy.ai/opportunity-map?ss=e00435f7-4c68-4dde-bb8b-270385a4f57a&src=saved_search_alert

• Maritime Activity Reports, Inc. advertising space
  Commerce, Department of · NAICS 513120 · Solicitation · due Sep 25

• (1 ) Methane and Ethane Gas Analyzer and, one (1) Formaldehyde Gas Analyzer.
  Commerce, Department of · NAICS 334516 · Total SB · Combined Synopsis/Sol. · due Sep 24
```

Partial (a5f952c7, simulated one unseen forecast):
```
Subject: 1 new match in “NAICS 541511,541512,541513,541519,621,622,623 · VETERANS AFFAIRS|INTERIOR|HOMELA”

1 new match in "NAICS 541511,541512,541513,541519,621,622,623 · VETERANS AFFAIRS|INTERIOR|HOMELA"

Note: Upcoming (forecast) buys: partial coverage. The forecasts here cover 14 of your 15 agencies. Not measured: COMMERCE. Mindy holds no forecast publisher for it, so this is not a zero.

Open updated map (your filters restored): https://getmindy.ai/opportunity-map?ss=a5f952c7-b8cc-48e1-9ab8-184a42153b04&src=saved_search_alert

• - HHS Modernization Discovery Engagement
  Hhs · NAICS 541512 · Forecast · Q4 FY2026 · due —
```

Covered zero: Saved Searches render no zero-result email (unchanged). Failure: no email, no state write.

## 7. Tests
- `src/lib/saved-searches/forecast-discovery.unit.test.ts` (24) — builder parity with Maps for typed / no-query / single / multi
  agency / state+naics; keys; distinct ORed buyers; surface scope; FY policy; unresolved; known-publisher-without-forecasts (FAA);
  covered zero; partial; failure (error + throw) never zero; refused plan; a5f952c7 locked fixture; engine switch.
- `src/lib/saved-searches/alert-decision.unit.test.ts` (8) — seen / new-once / repeat / amended / covered zero / 500 cap order.
- `src/app/api/cron/saved-search-alerts/forecast-engine.unit.test.ts` (13) — route-level, above.
- `src/lib/discovery/cross-surface-plan.unit.test.ts` — `saved_searches_forecast` migrated.
- Full suite: 664 files / 7,596 tests passed, 0 failed (one vitest worker RPC timeout, `onTaskUpdate`, not a test failure).
  `tsc` clean · supabase-errors and rank-then-filter audits: no new findings.

## 8. Before merge / enable
1. Review this PR (it changes no production behavior while the flag is unset).
2. Decide §5 (cutover).
3. After merge+deploy: `GET /api/cron/saved-search-alerts?mode=preview&forecastEngine=canonical` (read-only) and compare with this replay.
4. Only then set `SAVED_SEARCH_FORECAST_CANONICAL=true` (printf, fresh deploy).

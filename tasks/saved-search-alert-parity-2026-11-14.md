# Saved-search alert parity — one intent, one meaning (Agent 3, 2026-11-14)

**Status:** built on `fix/agent3-alert-search-parity`, flag OFF, migration authored + dry-run only.
Nothing deployed, no production data written, no alert sent. Awaiting approval.
Does not touch PR #2040's files (`saved-searches/{service,types,validate-filters,alert-activation,watch-scope-client}.ts`,
map-watch / saved-searches routes, opportunity-map route).

Customer-identifying per-search detail (owner, saved text) is deliberately NOT in this public repo. Re-derive it
privately with `npx tsx scripts/audit-saved-search-parity.ts --all`.

## 1. Root cause (code)

| Surface | Open-horizon evaluator |
|---|---|
| Opportunity Map (`/api/app/opportunity-map`) | `mapsOpenRequest` + `applyMapsOpenFilters` (canonical discovery plan owns text, buyer, query-named codes/states/set-asides) |
| Saved-search alert cron (`cron/saved-search-alerts/route.ts:336`) | `parseMapFilters` + `applyMapFilters` with a LIVE `search` → legacy `buildSearchOr` text brain + substring agency match |
| MCP `schedule_market_search` reach probe (`search-delivery-status.ts probeFilterReach`) | legacy, same as the cron |

`maps-open-discovery.ts` says it outright: "saved searches, alert crons … still call [applyMapFilters] with a live
`search`. Those migrate in their own phases." That phase never happened. MCP, Ask Mindy and the Map all write the
same `saved_searches` row (`createSavedSearch`), so the fix is one seam, not three.

Second, independent defect found by the parity test: stored rows are JSON, so `fullOpen: true` is a boolean, and
`parseMapFilters` accepts only `'1'`/`'true'`. The alert silently dropped Full & Open (also `hideCommodity`,
`hasDocs`, `hasContact`) while the Map applied it. 4 alerting searches store `fullOpen` as a boolean.

## 2. Architecture (no third evaluator)

`src/lib/saved-searches/open-evaluator.ts`:
- `savedSearchOpenEvaluation(filters, profile, engine)` — `canonical` IS the Map adapter; `legacy` IS the old path,
  kept byte-identical for rollback. Adds only the alert's 30-day posted window (Map: `postedDays=30`).
- `savedFilterGetter` — reads a stored row exactly as the Map reads its URL (booleans → strings, arrays comma-joined,
  agency arrays `|`-joined because names contain commas).
- A refused plan (`needs_refinement` / `needs_positive_scope`) returns `blocked`; the cron reports
  `search_needs_refinement` (config-action class) and writes nothing. Run naively it would be `notice_id IS NULL` →
  a zero stamped as a healthy, quiet search.
- `resolveOpenEngine` — `SAVED_SEARCH_OPEN_CANONICAL=true` (same contract as `SAVED_SEARCH_FORECAST_CANONICAL`);
  preview may opt in per request: `?mode=preview&openEngine=canonical`.
- Engine-change re-baseline: `saved_searches.open_engine` (migration `20261114_saved_search_open_engine.sql`). If the
  engine that evaluates a search differs from the one that wrote `last_seen_notice_ids`, the run stores current ∪ prior
  ids as seen and sends nothing — in EITHER direction. Without it the first canonical run emails every match legacy
  never stored (legacy kept only its newest-200 slice of e.g. an 8,880-row result) as "new", up to 30 days old; a
  rollback would email the legacy broad set. Canonical refuses to run without the column (500); legacy runs unchanged
  without it, so code can deploy before the migration.

Time windows / freshness / schedules: unchanged. 30-day posted window, 200-row newest-first retrieval, 500-id seen cap,
daily/weekly cadence, Forecast watermark engine — all untouched. Recompete is not an alert horizon
(`SAVED_SEARCH_POLICY`).

## 3. Before / after (live DB, the cron's own 30-day window, read-only)

Agent 2's figures reproduce exactly: HVAC maintenance 1,389 → 133 · medical staffing 612 → 75 · janitorial 36 → 144.

186 alerting searches, 82 owners (`audit-saved-search-parity.ts`, on the shipped code path):

| | searches |
|---|---|
| identical results | 149 (all 113 with no text/agency/boolean filter: 0 gained, 0 lost — proven, not assumed) |
| lose rows only | 15 |
| gain rows only | 5 |
| gain and lose | 16 |
| refused by canonical plan | 0 |
| owners affected | 21 |
| ≥5,000-row results | legacy 22 → canonical 16 (remaining are broad structured scopes, e.g. agency=DEFENSE, identical on both) |

Patterns among the 36 changed (no customer text):
- **Whole-market overmatch removed.** Plain-English requests ("show me <agency> opportunities", a place name) returned
  ~8,880 of 9,193 window rows under legacy. Canonical resolves the buyer/place.
- **Agency undermatch fixed.** "Department of Veterans Affairs / the Army / the Air Force" returned 0 under legacy
  (substring vs `VETERANS AFFAIRS, DEPARTMENT OF`); canonical 21 / 16 / 18.
- **3 searches go to 0**, each verified: a buyer with genuinely 0 notices in the window (checked directly); a phrase +
  strategy chips whose 26 legacy hits were all unrelated; and a misspelled phrase that loses its single correct hit
  (real undermatch — see §5).
- **Full & Open finally honored** on 2 searches (1,610 → 665; 32 → 6).

## 4. Precision / recall (independent blind labels)

`scripts/eval-saved-search-relevance.ts`, fixture `tests/fixtures/saved-search-relevance-2026-11-14/` (437 items,
3 blind labelers who saw only intent + notice, never which evaluator returned it). Strata: legacy-only,
canonical-only, both, and a recall pool neither returned (target NAICS + loose title terms). Stratum-weighted.

| intent | legacy n | canon n | legacy P | canon P | legacy R | canon R |
|---|---|---|---|---|---|---|
| hvac maintenance | 1389 | 133 | 2% | 20% | 63% | 63% |
| medical staffing | 612 | 75 | 1% | 7% | 40% | 40% |
| janitorial services | 36 | 144 | 93% | 43% | 48% | 89% |
| novice: "we clean office buildings" | 4487 | 46 | 0% | 0% | 0% | 0% |
| novice: "I fix air conditioners for government buildings" | 4818 | 1206 | 2% | 7% | 90% | 90% |
| novice: "nurses for VA hospitals" | 7571 | 8 | 0% | 0% | — | — |
| geo: "security guard services in Texas" | 2393 | 12 | 0% | 0% | — | — |
| geo: "construction in Georgia" | 883 | 31 | 15% | 51% | 74% | 9% |
| set-aside: IT help desk + 8(a) | 0 | 0 | — | — | — | — |
| multi-select NAICS + VA,MD | 10 | 10 | 30% | 30% | 39% | 39% |
| agency VA + 561720 | 0 | 13 | — | 100% | 0% | 100% |
| broad: "construction" | 860 | 1169 | 73% | 79% | 68% | 100% |
| nonsense text | 0 | 0 | — | — | — | — |

(— = undefined: no results, or no relevant rows found in any stratum.) Sample is 15 per stratum; treat single-digit
differences as noise.

**Reading:** canonical is never worse on precision and is equal or better on recall in every intent except
"construction in Georgia" (where legacy's recall comes from returning 883 rows at 15% precision). Switching removes the
gross overmatch and the agency undermatch. **It does not make plain-English alerts accurate** — see §5.

## 5. Defects in the SHARED canonical matcher (out of scope here; affect Map + MCP today)

1. `concept_query` ANDs every word including stopwords ("we", "for", "in") across title + description + **full
   `sow_text`** + department. Long SOW bodies contain nearly every common word → "we clean office buildings" matches
   ball bearings and snow removal. (`discovery/plan.ts` OPEN_TEXT_COLS; stopword handling in the matcher.)
2. `capability_list` ORs words → "I fix air conditioners…" admits on "fix" or "air" alone (1,206 rows, 7% precision).
3. Taxonomy expansion noise: "dry ice" admits snow removal; "fiber optic installation" admits a radiation safety officer.
4. Buyer resolution: "HUD" also matches the Federal Housing Finance Agency (independent agency).
5. No typo tolerance: "janitoral" loses the one correct notice.
6. "IT help desk" + 8(a): 0 on both engines — unconfirmed whether a true zero (no labeled relevant rows in the window).

These need a separate, cross-surface phase (Map, MCP and alerts move together) with this eval as its gate.

## 6. Customer protection

Requires notice/confirmation (owner-visible change in what they receive): the 36 changed searches / 21 owners —
especially the 3 that go to 0 and the 2 whose Full & Open now applies. Overlaps Agent 2's 26-search remediation
list; reconcile before any customer message. Nothing is changed on any search by this branch; the only write the
cron makes after the flip is `open_engine` + the re-baselined seen list, through the normal evaluation write.
Gained matches within the last 30 days are NOT emailed (re-baseline); they remain visible on the Map.

## 7. Release / rollback

1. Review + merge (code is inert: flag OFF, legacy path byte-identical).
2. `npm run migrate -- --go --only 20261114_saved_search_open_engine.sql` → `npm run db:check -- saved_searches open_engine`.
3. Deploy. Verify legacy unchanged: next cron run `failedSearches` empty, sent counts in the usual band.
4. Prod preview, no writes: `/api/cron/saved-search-alerts?mode=preview&openEngine=canonical` → every row
   `openEngineTransition:true`, `newCount:0`.
5. Customer notice for the affected owners (separate, approved comm).
6. Set `SAVED_SEARCH_OPEN_CANONICAL=true` in Vercel prod + redeploy. First run: expect 0 sends from transitioned
   searches, `open_engine='canonical'` stamped, no `search_needs_refinement` among existing searches.
7. Watch 3 daily runs: sends resume only for genuinely new notices.

Rollback: unset `SAVED_SEARCH_OPEN_CANONICAL` + redeploy. The next run re-baselines each search on legacy (no catch-up
email) and stamps `open_engine='legacy'`. The column is additive and can stay.

Marketing literature entry (rule #8) goes in with the flag flip, when the behavior actually ships.

# Grants.gov path health — investigation (2026-09-26)

**Why this exists:** the SBIR retirement (#1710) must not recommend Mindy's Grants chip for SBIR/STTR
coverage until the Grants.gov path is verified. This is a **read-only investigation**:
- no feed reactivated;
- no production configuration changed;
- no data written.

It is not part of #1710. The repair below is a **proposal**.

## Two paths, not one

| Path | Serves | Source | Cache? |
|---|---|---|---|
| **Live panel / MCP** | Grants panel + its "SBIR/STTR" chip (`/api/grants`), MCP `search_grants` (`src/lib/grants/search.ts`) | **live** call to the legacy Grants.gov REST endpoint `apply07.grants.gov/grantsws/rest/opportunities/search` per request | last-good snapshot **only on upstream outage** (`_fresh` / `_degraded` flags on the response) |
| **Stored mirror** | Grants layer of the Opportunities map (`src/lib/opportunities/map-data.ts`, `/api/app/grants-map`), data inventory | `grants_cache`, filled nightly by `sync-grants` → `ingestGrants()` (posted + forecasted) | the table **is** the cache |

## Measurements (2026-09-26, read-only)

### Live path — healthy

- **API access:** `apply07` (legacy) and `api.grants.gov/v1/api/search2` (current) both answer HTTP 200
  in ~0.2 s from a workstation. Both return `keyword=SBIR, posted` → hitCount **22**.
- **Production panel** (`getmindy.ai/api/grants?keyword=SBIR&status=posted&sort=newest&limit=10`,
  offsets 0/10/20):
  - **Live, not cached:** `_fresh: true`, `_degraded: false`, `_servedAt` current, total 22.
  - **Pagination:** 10 + 10 + 2 rows, **22 unique IDs**, `hasMore` correct on every page.
  - **Currently open:** every row `posted`; **0** past their close date; 2 have no close date.
  - **Valid source links:** all **22/22** IDs resolve via Grants.gov's official `fetchOpportunity`
    API; links are `https://www.grants.gov/search-results-detail/<id>`.
- **MCP `search_grants`:** the last 200 calls were 38 `success` and 6 `rejected_no_credits`, with
  **0 failed/uncharged**; latest 2026-09-26 12:26Z. `tool_errors` has **no** Grants entries.

### Ingest path — running and writing, but never forgets

- **Last successful ingestion that actually wrote data:** `sync-grants` ran 2026-09-26 09:00Z (HTTP 200,
  6.5 s). `grants_cache.synced_at` max = 2026-09-26 09:00:31Z, and **1,536 rows** were touched that
  day. `pg_stat_user_tables`: `n_tup_upd` 90,199 (writes are real).
- **Run history:** daily 200s since 09-20. **One failure: 2026-09-19 09:00Z, HTTP 500** ("route
  returned 500"). The route returns 500 for a 0-row fetch (STARVED) or an exception. The specific cause
  is **not recoverable**: `cron_job_runs` stores only the generic text, and runtime logs are past
  retention.
- **Completeness:** in the last 24 h the ingest touched **925 posted + 611 forecasted** rows, which is
  **exactly** Grants.gov's live counts (search2 hitCount posted 925, forecasted 611). The fetch is
  complete.
- **Staleness (the defect):** rows the ingest no longer sees are never demoted or removed. The ingest
  only upserts; `n_tup_del` = 0.
  - **588** rows still say `status='posted'` after their close date. The map filters these out at read
    time (`close_date >= today OR null OR forecasted`), so they are not shown.
  - **103** rows **not re-seen today** still pass that filter (future/null close, or `forecasted`),
    **all 103 have map coordinates**, and they render on the Grants map as actionable.
  - **A sample of 12 checked against `fetchOpportunity`:**
    - **8 are archived synopses.** For example, `PD-24-110Z` was archived 2026-09-23, but the cache
      says posted, close 09-29; `PD-19-7479` was archived 2026-08-19.
    - **3 are forecasts** that are no longer returned by the forecasted search.
    - **1 no longer exists.**
  - The data-inventory count (`headCount(grants_cache)` = 2,227) also includes expired and stale rows.
- **SBIR-related coverage in the cache:** 6 actionable posted rows have SBIR/STTR in the title. The
  live keyword search finds 22, but it also matches descriptions, so this is **not** evidence of
  missing rows: the ingest total matches live exactly.

## The "unresolved Grants.gov API issue"

**No current API failure could be reproduced.**
- Both endpoints respond, and production serves live results.
- MCP calls succeed, and `tool_errors` is empty for Grants.

The only recorded failure is the **2026-09-19 `sync-grants` 500**, whose cause was not retained.
**If a different issue was meant, it needs a pointer** (a date, screenshot, or error text).

Two real risks that are not current failures:
1. **Legacy endpoint dependency.** Everything calls `apply07.grants.gov/grantsws`. It works today, but
   Grants.gov's documented public API is `api.grants.gov/v1/api/search2`, which returned identical
   counts. Migrating is a hardening step, not a fix for an observed outage.
2. **A silent 500 cause.** The route's error text did not survive, so the next occurrence would be
   just as undiagnosable.

## Proposed repair (NOT applied — needs sign-off; it changes stored data semantics)

1. **Stop showing rows the latest complete ingest did not see.** Add `last_seen_run_at` (or reuse
   `synced_at`) and, **only after a non-degraded run whose per-status fetch equals the live
   hitCount**, mark unseen actionable rows as `status='stale'`. Do not delete them, which keeps
   history. The map and grants-map reads add `synced_at >= last complete run`, or exclude `stale`.
   A degraded/partial run must never demote anything; otherwise one bad fetch empties the map.
2. **Expired posted rows:** demote `posted` + `close_date < today` to `closed` in the same pass, so the
   inventory count stops including them. The read filter already hides them.
3. **Make failures diagnosable:** persist the ingest's `{fetched, perStatus, degraded, error}` into
   `cron_job_runs` (or the self-report), so a future 500 has a cause.
4. **Hardening (separate, optional):** move `searchGrants` from legacy `apply07` to `search2` behind a
   parity check (same hitCount and IDs for a fixed query set) before switching.

Tests for (1): a behavioural ingest test over an in-memory table.
- A complete run demotes an unseen row.
- A degraded run demotes nothing.
- A seen row stays actionable.
- The map read excludes stale rows.

## Implication for #1710

The **live** Grants panel path is healthy on the evidence above: live, paginated, open, valid links.
Even so, #1710's notice points users **directly** to Grants.gov, SBIR.gov and DoD DSIP, and does not
claim Mindy provides reliable SBIR/STTR coverage through the Grants chip. The stored **map** layer
currently shows about 103 stale grants as actionable, which is another reason not to recommend a
Mindy grants surface in the retirement notice.

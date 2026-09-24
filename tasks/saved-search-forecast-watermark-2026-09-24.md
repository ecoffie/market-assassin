# Saved Search Forecast — the created_at WATERMARK (2026-09-24) — FOR REVIEW, NOT ENABLED

**Status:** stacked on PR #1674.
- The canonical engine stays OFF: `SAVED_SEARCH_FORECAST_CANONICAL` is set in no environment, and the code accepts only
  the literal `'true'`.
- The migration is **not applied**. No saved-search state was written, no floor was set, no email was sent.
- The companion identity fix is **PR #1682** (DHS `*` republish ids). It blocks enabling this engine.

## 1. Is one global watermark sufficient? — NO (proof)

**Counterexample.** Take a saved search for `VETERANS AFFAIRS | X` whose buyer X is uncovered (the resolver has no
publisher identity for it) while X's rows are already arriving in `agency_forecasts`.
1. **Days 1–2:** the run is partial. VA is measured, so W advances to each snapshot.
2. **Day 1:** a genuinely new X forecast is created, with `created_at` inside day 1.
3. **Day 3:** a resolver change makes X covered. The next interval is (W₂, S₃], and the day-1 X row is before W₂.

That row is never read by any future run: a **permanent blind spot**. Pinned as test `11b` (the global-only state finds
0 rows); test `11+12` shows the gap boundary finding it.

When does the corpus actually hold rows for an uncovered buyer? Today the four unresolved publishers (NOAA, COMMERCE,
HUD, SBA) hold 0 rows, so the blind spot is latent. It opens whenever an ingest lands before, or without, the resolver
mapping, or when a child identity or anchor is added later. The design must not depend on that ordering.

## 2. Final schema — `supabase/migrations/20260924_saved_search_forecast_watermark.sql`

```sql
-- Saved Search FORECAST newness = a created_at watermark (2026-09-24).
-- Record: tasks/saved-search-forecast-watermark-2026-09-24.md
--
-- Every object here is ADDITIVE and NULLABLE. The legacy Forecast engine reads none of them, and the
-- canonical engine only runs when SAVED_SEARCH_FORECAST_CANONICAL = 'true'. Idempotent.
--
-- A Forecast is new for a saved search iff it matches the canonical plan, its publisher is covered,
-- created_at ∈ (watermark, snapshot], and created_at > its publisher's alert floor.

-- 1 · Per-search watermark. NULL = never measured by the canonical engine → the next run baselines silently.
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS forecast_seen_through TIMESTAMPTZ;

-- 2 · Per-requested-buyer catch-up boundaries for PARTIAL coverage. {"<saved buyer>": "<timestamptz>"}.
--     A buyer the plan cannot cover keeps the boundary it had when it went uncovered, so its Forecasts
--     stay discoverable once it becomes covered (no permanent blind spot). Bounded by the number of saved
--     buyers (≤ the agency multi-select), never by the number of Forecasts.
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS forecast_gap_since JSONB;

-- 3 · Publisher alert floors. Key = agency_forecasts.source_agency — the canonical publisher code Discovery
--     resolves buyers to (resolveForecastAgencies().codes / child parentSourceAgency).
--     A publisher WITHOUT a row, or with state 'suspended', is NOT alertable (fail closed): a new publisher's
--     historical onboarding can never become user alerts by accident. Written only by the explicit floor path
--     (src/lib/forecasts/alert-floor.ts) — never by the daily sync.
CREATE TABLE IF NOT EXISTS forecast_publisher_alert_floor (
  source_agency    TEXT PRIMARY KEY,
  state            TEXT NOT NULL CHECK (state IN ('active', 'suspended')),
  alertable_after  TIMESTAMPTZ,              -- rows with created_at <= this are never "new"
  reason           TEXT NOT NULL,
  set_by           TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (state = 'suspended' OR alertable_after IS NOT NULL)
);

-- Append-only history, so every floor move is attributable and reversible.
CREATE TABLE IF NOT EXISTS forecast_publisher_alert_floor_log (
  id                    BIGSERIAL PRIMARY KEY,
  source_agency         TEXT NOT NULL,
  prev_state            TEXT,
  prev_alertable_after  TIMESTAMPTZ,
  new_state             TEXT NOT NULL,
  new_alertable_after   TIMESTAMPTZ,
  reason                TEXT NOT NULL,
  set_by                TEXT NOT NULL,
  logged_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE forecast_publisher_alert_floor ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_publisher_alert_floor_log ENABLE ROW LEVEL SECURITY;

-- 4 · Snapshot time from the DATABASE clock (created_at is a DB default), lagged so rows written by a
--     transaction still in flight at snapshot time cannot fall between two runs: they land in the next
--     interval instead. One immutable value per evaluation.
CREATE OR REPLACE FUNCTION saved_search_forecast_snapshot()
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE
AS $$ SELECT now() - interval '5 minutes' $$;

REVOKE ALL ON FUNCTION saved_search_forecast_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION saved_search_forecast_snapshot() TO service_role;

-- 5 · Candidate selection filters on created_at.
CREATE INDEX IF NOT EXISTS idx_agency_forecasts_created_at ON agency_forecasts (created_at);
```

All objects are additive. `forecast_seen_through` / `forecast_gap_since` are selected **only** by the canonical engine, so
code deployed before the migration cannot break the legacy cron. That is pinned by the route test "legacy engine: no
watermark columns selected".

## 3. Partial-coverage state design

State per search is `W = forecast_seen_through` plus `G = forecast_gap_since {saved buyer → boundary}`. It is bounded by
the number of saved buyers, never by Forecast volume. Each evaluation captures **one** snapshot S from the database clock,
lagged 5 minutes, so a transaction still in flight cannot straddle two runs.

| run outcome | Forecast read | state after (written only if the whole run succeeds) |
|---|---|---|
| W is NULL (new search, missed migration) | nothing | W=S; every currently uncovered buyer g gets G[g]=S; **no Forecast alert** |
| fully covered | plan ∧ created_at ∈ (W,S] ∧ > floor | W=S |
| covered zero | the same, 0 rows | W=S |
| partial | covered buyers over (W,S]; buyers newly uncovered: G[g]=W (kept if already set) | W=S, G updated |
| buyer g in G becomes covered | adds g over (G[g], W] (catch-up), then g leaves G | W=S |
| unavailable (no buyer covered) | nothing | **unchanged** |
| plan refused (nothing positive to search) | nothing | **unchanged** |
| failed query / snapshot / floor read / email send | — | **nothing written** |

Open state: under this engine `last_seen_notice_ids` receives **Open ids only**, so neither horizon can evict the other.
Route tests "Open + Forecast both new → the Open seen list gains ONLY Open ids" and "unavailable → … last_seen = Open ids".

## 4. Publisher floors

Floors are keyed on `agency_forecasts.source_agency`. That is the canonical publisher code Discovery resolves buyers to
(`resolveForecastAgencies().codes`; a child identity's rows live under its `parentSourceAgency`). A floor is validated
against `FORECAST_SOURCE_AGENCY_CODES`. A row is alertable only when its publisher has an **ACTIVE** floor and
`created_at > alertable_after`.

| situation | floor behaviour | tested |
|---|---|---|
| normal publisher already in the corpus | seeded once at cutover to its last `created_at` (`--seed`); a re-seed never overwrites | alert-floor.unit |
| newly onboarded publisher with history | no floor row = **not alertable (fail closed)** → `runPublisherBackfill`: suspend → load → activate at the load's last `created_at` | watermark #13, alert-floor.unit |
| unresolved publisher becoming available | same as onboarding; the saved-search gap boundary makes post-floor rows discoverable | watermark #11/#12 |
| historical backfill into an existing publisher | suspend → load → floor moves forward to the load's last `created_at`; backward only with an explicit `allowRewind` | alert-floor.unit |
| ordinary daily sync | **never touches floors** (guard test: no cron or forecasts module imports `alert-floor`); re-stamps never change `created_at` | alert-floor.unit, watermark #14 |
| genuinely new Forecast after the floor | alerts once | watermark #2, #13 |
| correction / amendment to an existing record | `created_at` unchanged → not new | watermark #15 |
| failed ingest | the floor stays **suspended** (no burst, no silent reopen); the error propagates | alert-floor.unit |

Stated cost: rows a routine sync creates *during* a backfill's suspended window are floored out. Run backfills outside
the 13:00 UTC sync.

## 5. Adversarial tests (Phase D) — all pass, mutation-checked

`src/lib/saved-searches/forecast-watermark.unit.test.ts` (20) runs the **real** `evaluateForecastWatermark` over an
in-memory corpus that honours `created_at`, floors, agency and paging. `src/lib/forecasts/alert-floor.unit.test.ts` (7).
`src/app/api/cron/saved-search-alerts/forecast-engine.unit.test.ts` (17) runs the **real route** with recording fakes.

| # | property | result |
|---|---|---|
| 1 | historical row before W → no alert | ✅ |
| 2/3 | new row alerts once; the same row re-synced → never again | ✅ |
| 4 | 2,519 rows with one `last_synced_at` → no effect | ✅ |
| 5 | 650 genuinely new of 1,250 matching → all 650, then 0, then 0 | ✅ |
| 6 | 32,500 matching → state stays `{W, null}` (< 120 bytes) | ✅ |
| 7 | row inserted during the run (after S) → next run, W = S (not the wall clock) | ✅ |
| 8 | failed run → W unchanged | ✅ |
| 9 | covered zero → W advances | ✅ |
| 10 | unavailable → W unchanged, 0 queries | ✅ |
| 11 | partial → no permanent blind spot (+ `11b` global-only counterexample) | ✅ |
| 12 | publisher covered later → post-floor rows discoverable (catch-up) | ✅ |
| 13 | historical onboarding (1,861 rows) → 0 while suspended, 0 after the floor, then the next genuine row alerts; no floor → never | ✅ |
| 14 | daily sync re-stamps 870 old rows → 0 | ✅ |
| 15 | amendment to an old row → not new | ✅ |
| 16 | new search (NULL W) → silent baseline, 0 queries | ✅ |
| 17 | explicit baseline → first run alerts only rows created after it | ✅ |
| 18 | Open seen state gains Open ids only; a send failure writes nothing | ✅ (route) |
| + | candidate overflow (> 5,000) → failed, W unchanged | ✅ |

Mutants caught, each then reverted:
- drop the catch-up → #11 fails
- gap boundary advances with W → #11 fails
- a missing floor admits rows → the floor test fails
- Forecast ids enter the Open seen list → 3 route tests fail
- watermark written before the send → 4 route tests fail

## 6. Real-corpus replay (Phase E) — read-only

`npx tsx --env-file=.env.local scripts/saved-search-forecast-watermark-replay.ts`, measured 2026-09-24T04:01Z.
- 56 Forecast-alerting searches, 43 of them cron-eligible.
- The watermark side runs the **real SQL** (`evaluateForecastWatermark`) with the snapshot and floors injected, so it runs
  before the migration exists.
- **SQL ≡ JS mirror on every search (0 mismatches).**

| cron-eligible totals (search × alert pairs) | legacy | #1674 ID-list | watermark |
|---|---|---|---|
| treated as "new" | 332 | 1,941 | cutover **0** · steady 172 |
| of which old rows (created before the last run) | **303** | **1,907** | **0** |
| genuinely new | 29 | 34 | **172** |

What the numbers mean:
- **Cutover:** the explicit baseline produces 0 migration alerts. The previously measured 1,934 (#1674's first run)
  and today's 1,941 both become 0.
- **Steady state:** W is each search's last real run (2026-09-23 ~11:00). Only **11 distinct rows** were created since:
  10 genuinely new (9 DHS, 1 HHS) and 1 DHS `*` republish. Every corpus-wide search matches all 11.
  - The legacy engine alerted only 1 of those 11 per corpus-wide search: its 200-row window was full of re-stamped DOE
    rows. So the legacy engine was **missing genuine new forecasts while alerting old ones**.
  - The watermark alerts exactly the 11.
  - **13** of the 172 pairs are the one DHS `*` republish, which PR #1682 removes.
- **Previously measured, carried forward:** 352 legacy new → today 332. 323 old → today 303, all avoided. 29 genuine →
  all preserved, plus the genuine rows legacy never showed. DOE/DHS re-sync churn → 0.
- **Publisher floors in steady state:** 0 rows removed (no onboarding in the interval).
- **HHS onboarding simulation** (the 1,861 rows created 2026-09-13, W just before): **24,920** search-alert pairs without
  a floor → **0** with the floor at the load's end.

### Every Forecast-alerting search

| search | cron | coverage | matches | legacy new (old) | ID-list new (old) | WM cutover | WM steady | floor removed | DHS `*` | W before → after | HHS onboard no floor → floor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 02dc20b6 | yes | ok | 32,422 | 15 (14 old) | 86 (85 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 175a893e | yes | ok | 32,422 | 15 (14 old) | 97 (96 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:00 → 2026-09-24T03:55 | 1861 → 0 |
| 1b018df4 | yes | ok | 32,422 | 15 (14 old) | 94 (93 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 4692743e | yes | ok | 32,422 | 14 (13 old) | 48 (47 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 54fd0605 | yes | ok | 32,422 | 15 (14 old) | 127 (126 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 5b867c2f | yes | ok | 32,422 | 14 (13 old) | 60 (59 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 64eb46b6 | yes | ok | 32,422 | 15 (14 old) | 126 (125 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 749d017b | yes | ok | 32,422 | 15 (14 old) | 109 (108 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 7d3a2556 | yes | ok | 32,422 | 15 (14 old) | 129 (128 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| 88d24ae2 | yes | ok | 32,422 | 15 (14 old) | 84 (83 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| ae5ddb00 | yes | ok | 32,422 | 15 (14 old) | 80 (79 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 1861 → 0 |
| dd024647 | yes | ok | 32,422 | 15 (14 old) | 95 (94 old) | 0 | 11 | 0 | 1 | 2026-09-23T11:00 → 2026-09-24T03:55 | 1861 → 0 |
| e2466850 | yes | ok | 11,389 | 0 (0 old) | 1 (1 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| 14466713 | yes | ok | 8,455 | 79 (78 old) | 96 (95 old) | 0 | 6 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 763 → 0 |
| c4158f3a | yes | ok | 5,617 | 2 (2 old) | 5 (5 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 154 → 0 |
| 386e228b | yes | ok | 5,028 | 0 (0 old) | 200 (200 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| 14d902aa | yes | ok | 4,850 | 27 (27 old) | 27 (27 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 131 → 0 |
| 5c25203a | yes | ok | 4,850 | 8 (4 old) | 8 (4 old) | 0 | 4 | 0 | 0 | 2026-09-21T11:01 → 2026-09-24T03:55 | 131 → 0 |
| 32846637 | yes | ok | 4,701 | 1 (0 old) | 1 (0 old) | 0 | 4 | 0 | 0 | 2026-09-23T11:00 → 2026-09-24T03:55 | 193 → 0 |
| 81bf2414 | yes | ok | 4,701 | 1 (0 old) | 1 (0 old) | 0 | 4 | 0 | 0 | 2026-09-23T11:00 → 2026-09-24T03:55 | 193 → 0 |
| 983d2867 | yes | ok | 4,672 | 1 (0 old) | 1 (0 old) | 0 | 4 | 0 | 0 | 2026-09-23T11:00 → 2026-09-24T03:55 | 180 → 0 |
| a82d3d77 | yes | ok | 4,301 | 14 (13 old) | 14 (13 old) | 0 | 3 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 103 → 0 |
| 74839699 | yes | ok | 3,534 | 1 (0 old) | 1 (0 old) | 0 | 3 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 80 → 0 |
| 1c3b715a | yes | ok | 2,968 | 13 (12 old) | 15 (13 old) | 0 | 2 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 138 → 0 |
| 32acc010 | yes | ok | 2,002 | 5 (1 old) | 12 (8 old) | 0 | 4 | 0 | 1 | 2026-09-23T11:01 → 2026-09-24T03:55 | 358 → 0 |
| 994c599e | yes | ok | 1,575 | 0 (0 old) | 200 (197 old) | 0 | 3 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 79 → 0 |
| 6f121c25 | yes | ok | 767 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 23 → 0 |
| 9ca2d2de | yes | ok | 619 | 0 (0 old) | 200 (200 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| c75b5e65 | yes | ok | 493 | 2 (0 old) | 2 (0 old) | 0 | 2 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 20 → 0 |
| 5e4bcd5a | yes | ok | 233 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 4 → 0 |
| ab8bb3c8 | yes | ok | 233 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 4 → 0 |
| 08d970cb | yes | ok | 138 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:00 → 2026-09-24T03:55 | 26 → 0 |
| 943f7486 | yes | ok | 26 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:00 → 2026-09-24T03:55 | 0 → 0 |
| 5759ff87 | yes | ok | 17 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 2 → 0 |
| c3f908e3 | yes | ok | 11 | 0 (0 old) | 11 (11 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| ff372605 | yes | ok | 6 | 0 (0 old) | 6 (6 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 6 → 0 |
| b4e40d05 | yes | ok | 5 | 0 (0 old) | 3 (3 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| 0678583e | yes | ok | 2 | 0 (0 old) | 2 (1 old) | 0 | 1 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| 61d1ca1f | yes | unestablished (HUD) | 0 | 0 (0 old) | unavailable (0 old) | unavailable | unavailable | 0 | 0 | 2026-09-23T11:02 → 2026-09-23T11:02 | 0 → 0 |
| 7ef11325 | yes | ok | 0 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| b032f39f | yes | unestablished (SBA) | 0 | 0 (0 old) | unavailable (0 old) | unavailable | unavailable | 0 | 0 | 2026-09-23T11:01 → 2026-09-23T11:01 | 0 → 0 |
| e00435f7 | yes | unestablished (National Oceanic and Atmospheric Administration) | 0 | 0 (0 old) | unavailable (0 old) | unavailable | unavailable | 0 | 0 | 2026-09-23T11:01 → 2026-09-23T11:01 | 0 → 0 |
| e9c0f9be | yes | ok | 0 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | 0 | 2026-09-23T11:01 → 2026-09-24T03:55 | 0 → 0 |
| 1f01ad20 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 1861 → 0 |
| 507cdd28 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 1861 → 0 |
| 5eaba2aa | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 1861 → 0 |
| 915af605 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 1861 → 0 |
| 9953d49b | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 1861 → 0 |
| c55dbe32 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 1861 → 0 |
| 48df9f00 | no | ok | 6,655 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 237 → 0 |
| 2cca41bc | no | ok | 4,850 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 131 → 0 |
| bfe464e2 | no | ok | 4,100 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 135 → 0 |
| f587f86b | no | ok | 3,687 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 99 → 0 |
| a5f952c7 | no | partial (COMMERCE) | 3,578 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 380 → 0 |
| 46275c5f | no | ok | 1,541 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 147 → 0 |
| ad3f8e7c | no | ok | 153 | 190 (0 old) | 153 (0 old) | 0 | baseline(never alerted) | 0 | 0 | — → 2026-09-24T03:55 | 19 → 0 |

## 7. Scripts (none run with `--go`)

| script | default | writes on `--go` | guards |
|---|---|---|---|
| `scripts/saved-search-forecast-baseline.ts` | dry run: counts + DB snapshot | `forecast_seen_through` / `forecast_gap_since` on Forecast-alerting rows where W IS NULL | refuses without the migration; backup file first; idempotent (`.is('forecast_seen_through', null)`, `count: 'exact'`); verifies 0 NULL left and Open state byte-identical; no email path |
| `… --rollback <backup.json> [--go]` | dry run | restores both columns from the backup | — |
| `scripts/forecast-publisher-floor.ts` | dry run | `--seed` (never overwrites) / `--suspend` / `--activate` + append-only log | canonical codes only, reason and actor required, monotonic unless `--allow-rewind` |
| `scripts/saved-search-forecast-watermark-replay.ts` | read-only | — | exits 1 on any SQL-vs-mirror mismatch |

Verified against production today: the baseline dry run **refuses** (columns missing), and the floor seed **refuses per
publisher** (table missing). Both fail closed, nothing written.

## 8. Cutover (proposed, for sign-off)

| # | step | writes | check | reverse |
|---|---|---|---|---|
| 1 | merge #1674 + this PR dark | none (flag absent) | serving SHA contains the merge | revert |
| 2 | DHS identity window (PR #1682 run order) | agency_forecasts DHS rows | 1,738 DHS rows, 0 `*` | backup file |
| 3 | apply the migration (`npm run migrate`) | new columns/tables/function/index | `db:check` + PostgREST read of each; the RPC returns now()−5m | drop objects (legacy never reads them) |
| 4 | seed floors | 19 floor rows + log | `--status` lists 19 active; STATE has none (no rows) | delete floor rows |
| 5 | explicit baseline | W on the 56 Forecast-alerting rows | 0 NULL; Open state byte-identical to the backup | `--rollback <backup>` |
| 6 | shadow | none: `?mode=preview&forecastEngine=canonical` after the next 13:00 sync | `forecastNewCount` = rows created after the baseline only; 0 old; DHS `*` 0 | — |
| 7 | enable | `printf true \| vercel env add SAVED_SEARCH_FORECAST_CANONICAL production` + fresh deploy | first 11:00 run: `cron_job_runs` 200; sends ≈ shadow; W advanced to that run's S | unset the env + redeploy → the legacy engine resumes (see rollback note) |

**Rollback note:** the legacy engine keeps its shared seen list. After a canonical period that list holds only Open ids,
so falling back to legacy would re-alert the legacy Forecast window once. The legacy window is at most 200 per search;
accept it, or re-run the legacy seed. Stated so it is a decision, not a surprise.

## 9. Remaining blockers before production cutover
1. **Review and decision on this design + #1674 + #1682.**
2. **DHS identity (#1682) run window.** Until it runs, every DHS republish is a false "new" (1 row in the last day,
   13 search-alert pairs).
3. Migration apply + floor seed + explicit baseline, in the order above, each with its check.
4. A shadow cycle across one real 13:00 sync, before the flag.
5. Operator rule: historical onboarding and backfills must go through `runPublisherBackfill` (or `--suspend`/`--activate`);
   the existing importer scripts do not yet call it.
6. NAVY hyphen-variant pairs (2) are data-quality follow-up, not blocking.

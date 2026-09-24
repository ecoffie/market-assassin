# Saved Search Forecast — the created_at WATERMARK (2026-09-24) — FOR REVIEW, NOT ENABLED

**Status:** stacked on PR #1674.
- The canonical engine stays OFF: `SAVED_SEARCH_FORECAST_CANONICAL` is set in no environment, and the code accepts only
  the literal `'true'`.
- The migration is **not applied**. No saved-search state was written, no floor was set, no email was sent.
- The companion identity fix is **PR #1682** (DHS `*` republish ids). It blocks enabling this engine.
- Review round 2 (this revision) closes three issues: the 5,000-candidate dead-end (§5), backfill enforcement (§6),
  and a rollback that cannot burst (§7).

## 1. Is one global watermark sufficient? — NO (proof)

**Counterexample.** Take a saved search for `VETERANS AFFAIRS | X`, where buyer X is uncovered while X's rows are
already arriving.
1. **Days 1–2:** the run is partial. VA is measured and W advances.
2. **Day 1:** a genuinely new X forecast is created.
3. **Day 3:** X becomes covered. The next interval starts at W₂, past the day-1 row.

That row is never read again: a permanent blind spot. Pinned as test `11b`. The fix is `forecast_gap_since`, a
per-buyer catch-up boundary.

## 2. Schema — `supabase/migrations/20260924_saved_search_forecast_watermark.sql` (additive, NOT applied)

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

-- 2b · Durable progress of an interval that could not be processed in one run (> 20 keyset pages). Holds the
--      fixed snapshot, one (created_at, id) keyset cursor per segment, a running count and 3 evidence ids. The
--      watermark moves only when every segment is done. Bounded size; never a list of Forecasts.
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS forecast_pending JSONB;

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

-- 6 · BACKFILL SAFETY GUARD. Creating a row stamps created_at = now(), which is what makes a Forecast "new".
--     While a publisher's floor is ACTIVE, only the declared DAILY SYNC may create rows for it:
--       PostgREST header  x-forecast-writer: daily_sync   (src/lib/forecasts/writer.ts forecastWriterClient)
--       or, in SQL,       SET LOCAL app.forecast_writer = 'daily_sync'
--     Any other writer (a historical import, a backfill script, psql) is refused until the publisher is suspended
--     (scripts/forecast-publisher-floor.ts --suspend / runPublisherBackfill). Upserts that only UPDATE an existing
--     (source_agency, external_id) are never refused — they cannot create a new created_at.
CREATE OR REPLACE FUNCTION agency_forecasts_floor_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  floor_state TEXT;
  writer      TEXT;
  hdrs        TEXT;
BEGIN
  SELECT state INTO floor_state FROM forecast_publisher_alert_floor WHERE source_agency = NEW.source_agency;
  IF floor_state IS NULL OR floor_state = 'suspended' THEN
    RETURN NEW;   -- no floor (not alertable) or suspended (a sanctioned load): nothing here can become an alert
  END IF;
  IF EXISTS (SELECT 1 FROM agency_forecasts WHERE source_agency = NEW.source_agency AND external_id = NEW.external_id) THEN
    RETURN NEW;   -- the ON CONFLICT path of an upsert: an update, created_at is kept
  END IF;
  writer := NULLIF(current_setting('app.forecast_writer', true), '');
  IF writer IS NULL THEN
    hdrs := NULLIF(current_setting('request.headers', true), '');
    IF hdrs IS NOT NULL THEN
      writer := hdrs::json ->> 'x-forecast-writer';
    END IF;
  END IF;
  IF writer = 'daily_sync' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = format('agency_forecasts: refusing to create %s/%s while the %s alert floor is ACTIVE (writer=%s).',
                     NEW.source_agency, NEW.external_id, NEW.source_agency, COALESCE(writer, 'undeclared')),
    HINT = 'Historical/bulk loads must suspend the publisher first: scripts/forecast-publisher-floor.ts --suspend, load, reconcile, --activate (or runPublisherBackfill).';
END
$$;

DROP TRIGGER IF EXISTS agency_forecasts_floor_guard ON agency_forecasts;
CREATE TRIGGER agency_forecasts_floor_guard
  BEFORE INSERT ON agency_forecasts
  FOR EACH ROW EXECUTE FUNCTION agency_forecasts_floor_guard();
```

Executed end to end, never against a real database:
`NODE_PATH=<pglite>/node_modules node scripts/proofs/forecast-floor-guard.pglite.mjs` → **12/12 PASS**
(details in §6).

## 3. State model

- **Per search:** `W = forecast_seen_through` and `G = forecast_gap_since {saved buyer → boundary}`. Both are bounded by
  the number of saved buyers.
- **`P = forecast_pending`:** only while an interval is in progress (§5). It holds the fixed snapshot, one keyset cursor
  per segment, a count, and 3 evidence ids.
- **Snapshot:** one per interval, from the database clock lagged 5 minutes, kept as exact text. Timestamps are compared
  at microsecond precision and never rounded through a JS `Date`; test `13b` pins a row created exactly at a floor.

| run outcome | state after (written only if the whole run succeeds) |
|---|---|
| W NULL (new / unmigrated search) | W=S; each uncovered buyer g gets G[g]=S; **no Forecast alert** |
| interval complete, fully covered (incl. zero) | W=S; P cleared |
| interval complete, partial | W=S; a newly uncovered g gets G[g]=W (an existing boundary is kept); P cleared |
| buyer g in G becomes covered | the interval gets a `gap:g` segment over (G[g], W]; g leaves G **only when the whole interval completes** |
| interval NOT complete (> 20,000 rows) | P saved with its cursors; **W and G unchanged** |
| unavailable / refused plan | **nothing written** |
| failed query / snapshot / floor read / email send | **nothing written**; the retry resumes from the last durable P |

## 4. Partial-coverage proofs (all pass)

| requirement | test |
|---|---|
| newly uncovered buyer gets the pre-gap boundary | G1 |
| repeated partial runs never move it forward | G2 (4 runs) |
| becoming covered catches up from the ORIGINAL boundary | G3+G7 |
| the publisher floor still applies during catch-up | G4 |
| a successful catch-up clears only that buyer's gap | G5 |
| a failed catch-up preserves the gap (and W) | G6 |
| an interrupted catch-up keeps the gap until its segment completes | G6b |
| other covered buyers keep advancing normally | G3+G7 |

## 5. High-volume processing — the 5,000-candidate dead-end is removed

**Discovery.** Each segment is read by **keyset pagination** over the unique, stable tuple **(created_at, id)**:
`created_at > c OR (created_at = c AND id > i)`, ordered `created_at, id`. There is no OFFSET, and `created_at` alone is
never assumed unique. Each page is 500 rows plus one look-ahead row; a run reads at most 40 pages (20,000 rows). Only one
page is in memory.

**Progress.** `forecast_pending` stores the snapshot, one cursor per segment, the running count and 3 evidence ids, and
nothing else (under 2 KB at 100,000 rows). The next run **resumes the same interval with the same snapshot** before a new
interval can start. W moves only when every segment is done, so the watermark never passes an unprocessed row. A failed
run writes nothing and the retry resumes from the last durable cursor, so there are no drops and no double counts.

**Presentation.** One email per completed interval: the count plus 3 evidence rows (the template renders at most 3). Open
alerts are **not held back** while a Forecast interval is still being processed.

⚠️ **PostgREST caps every response at 1,000 rows.** The first version used 1,000-row pages. It asked for 1,001, got
1,000, read that as "no more pages", and **dropped 1,018 of 2,018 rows**. The unit fakes did not cap, so only the
real-SQL replay caught it. Fixed: pages stay below the cap, a response at the cap always means "more", and the fake now
enforces the cap. A regression test fails with both guards removed.

| adversarial | result |
|---|---|
| 5,001 new rows | 1 run, count 5,001, all 5,001 visited once, 3 evidence rows, then 0 |
| 25,000 new rows | run 1 `in_progress` (20,000 processed, **W unchanged**); run 2 completes 25,000; 0 repeats; state back to `{W, null, null}` |
| 100,000 new rows, **all with one identical created_at** | 4 runs; 100,000 distinct ids visited once (the id tiebreak) |
| failure mid-interval | the failed run writes nothing; the retry completes the exact count; W = the ORIGINAL snapshot |
| row created during a pending interval | excluded (after its snapshot); alerted by the next interval |
| 2,018 rows at a 1,000-row page size (server cap) | exact, at page sizes 1,000 / 999 / 500 |
| real SQL, production (02dc20b6, HHS onboarding window) | 2,018 rows over 11 resumed runs (100-row pages) = single pass = JS mirror; 0 missing, 0 repeated |

### ❓ DECISION NEEDED — high-volume notification behaviour (not implemented as policy)
The engine emails **one count + 3 examples per completed interval**. It never sends thousands of cards. What it does not
decide is whether a very large genuine interval should be emailed at all, or how it should be framed. Options:
- **(a) As built:** "N new matches" plus 3 examples plus "See all N on the map". This is the existing template, with no
  new rule.
- **(b) Threshold summary:** above a threshold (e.g. 500) the email says it's a bulk publication ("HHS published 1,861
  forecasts") instead of "new matches", perhaps grouped by publisher.
- **(c) Hold for review:** above a threshold, record the interval but do not email until an operator releases it.

The floors (§6) mean a genuine interval above ~500 should be rare: bulk loads are floored, and daily-sync volume is
capped. Recommendation: (a) now, and revisit with (b) once real volumes are observed.

## 6. Backfill safety — enforced, not remembered

**Forecast writer inventory** (every path that can insert `agency_forecasts` rows):

| path | kind | how it is governed |
|---|---|---|
| `cron/sync-forecasts` (DHS, DOE) | daily sync | declared `daily_sync` client + new-row guard per publisher |
| `cron/hhs-forecast-sync` → `hhs-ingest` | daily sync | declared client + guard on `toInsert` |
| `cron/doj-forecast-sync` → `doj-ingest` | daily sync | declared client + guard |
| `cron/nasa-forecast-sync` → `nasa-ingest` | daily sync | declared client + guard |
| `cron/ssa-forecast-sync` → `ssa-ingest` | daily sync | declared client + guard (row-by-row inserts) |
| `admin/run-forecast-scraper` | admin bulk | **DB guard refuses new rows while the floor is active** |
| `scripts/import-forecasts.js`, `import-forecast-refresh.js`, `import-gsa-forecasts.js`, `import-nsf-forecasts.js`, `import-ssa-forecasts.js`, `run-all-forecast-scrapers.js`, `run-scrapers-tsx.ts`, `ingest-doe-forecast.ts`, `ingest-usace-forecast.ts` | historical / manual loads | **DB guard refuses**; they must run through suspend → load → reconcile → activate |
| `scripts/import-forecasts-live.js` | RETIRED ("DO NOT RUN") | DB guard refuses anyway |
| psql / SQL editor | manual | DB guard refuses unless the publisher is suspended |

**Enforcement, strongest first:**
1. **Database trigger `agency_forecasts_floor_guard`** (BEFORE INSERT). While a publisher's floor is ACTIVE it refuses to
   **create** a row unless the writer is the declared daily sync (`x-forecast-writer: daily_sync` header, or
   `SET LOCAL app.forecast_writer`). Upserts that only update an existing `(source_agency, external_id)` pass, because
   they keep `created_at`. No floor or suspended passes, because those rows are not alertable. This covers every path,
   including JS scripts and psql.
2. **Declared identity is allowlisted.** Only the five daily crons may call `forecastWriterClient('daily_sync')`, and none
   of them has a raw `createClient` left. `writer.unit.test.ts` scans `src/` and `scripts/`, and nothing else may set the
   header or setting.
3. **Daily-sync breaker** (`guardForecastInserts`). With an active floor, one daily run may create at most **500** new
   rows per publisher. Above that its inserts are refused, and the run fails loudly with an ops alert, because a bulk
   arriving through the daily sync is a re-key or a publication dump and must become a backfill.
   - Measured: DHS, the only publisher with daily history (45 days), creates a median of 17 rows a day, p90 44, max 759
     (its first load).
   - ❓ **The 500 threshold is a DECISION** for review.
4. **Lifecycle** (`runPublisherBackfill`): suspend → **verify suspended** (refuses to load otherwise) → load →
   **reconcile** (required callback) → **stop, still suspended, with a proposed floor**. It **never re-activates**.
   Activation is a separate explicit act: `scripts/forecast-publisher-floor.ts --activate <CODE> --after <floor>`.
   A failed load or reconcile leaves the publisher suspended.

**Tests:**
- PGlite (the real migration SQL, 12/12):
  - an undeclared new row is refused under an active floor;
  - a `backfill` writer that did not suspend is refused;
  - `daily_sync` is allowed;
  - an update-only upsert keeps `created_at`;
  - a 2,519-row load is allowed only while suspended;
  - re-activation refuses again;
  - `active` requires `alertable_after`;
  - the migration is idempotent;
  - the snapshot is `now() − 5 min`.
- `writer.unit.test.ts` (11): the guard decision table and bypass detection.
- `alert-floor.unit.test.ts` (10):
  - the daily sync can never import the floor module;
  - a backfill cannot run with an active floor;
  - a failed backfill stays suspended;
  - a failed reconcile stays suspended;
  - success needs explicit activation;
  - floors keep microseconds.
- Mutants:
  - breaker set to unlimited → caught;
  - auto-activation re-added → caught.

## 7. Emergency rollback — cannot send a Forecast burst

**Rule:** once a search has been measured by the canonical engine (`forecast_seen_through` set), the **legacy engine
never delivers Forecasts for it**. The cron probes once per invocation whether the watermark columns exist.

| columns | flag | Forecast behaviour | Open |
|---|---|---|---|
| absent (pre-migration) | any | legacy exactly as today | normal |
| present | `'true'` | canonical watermark engine | normal |
| present | unset / not `'true'` | legacy only for never-measured searches; **paused** (`rollback_paused`) for measured ones | normal |
| probe inconclusive | unset | **paused for all** (fail safe) | normal |
| absent | `'true'` | refuses with a 500 and writes nothing (the migration is required) | — |

So an emergency rollback is just **unsetting the flag**. There is no repopulation of the shared id list and no new env
var. During rollback the Forecast state (`W`, `G`, `P`) is untouched. When the flag is set again, the engine resumes from
W and the forecasts created during the rollback alert **exactly once**.

Route test "canonical ON → OFF → ON":
- The rollback run faces an Open-only seen list with 200 old forecasts in the legacy window plus a genuinely new
  forecast. It makes **0 Forecast emails and 0 Forecast queries**. Open still delivers ("1 new match"). The seen list
  gains Open ids only. The `forecast_*` columns are not written.
- A second rollback day sends nothing.
- Canonical back ON: the forecast created during the rollback alerts once and never again.

Mutant with the rollback guard disabled → 2 tests fail.

## 8. Real-corpus replay (read-only) — `scripts/saved-search-forecast-watermark-replay.ts`

Measured 2026-09-24T11:19:31.317Z. The replay covers 56 Forecast-alerting searches, 43 of them cron-eligible.
Everything runs through **real production SQL** with an injected snapshot and injected floors.
- **0 problems.** SQL ≡ JS mirror on every search.
- The live cron had run at 11:00 UTC today, so each search's W (its last real run) is recent.

| cron-eligible search-alert pairs | legacy | #1674 ID-list | watermark |
|---|---|---|---|
| treated as new | 68 | 1,872 | cutover **0** · steady **4** |
| old rows (created before the last run) | **64** (DOE 60, DHS 4) | **1,868** | **0** |
| genuinely new | 4 | 4 | **4** (every genuine row legacy alerted is also alerted ✓) |
| HHS 1,861-row onboarding (simulated) | — | — | **24,920 pairs without a floor → 0 with the floor** |

Earlier measurements carried forward:
- 1,934 migration-generated first-run alerts (#1674): **0** at cutover (1,872 today).
- The daily DOE/DHS re-sync churn: **0**.
- The 352 / 323 / 29 of 2026-09-23 were replaced by today's 68 / 64 / 4 on a much shorter interval. Every old row is
  still excluded, and every genuine row is still preserved.
- Open is unchanged: the Open path is the same code under both engines, apart from Forecast ids no longer entering the
  shared seen list.

Real-SQL resumption proof: search 02dc20b6, 2,018 rows, 11 runs at 100-row
pages: count 2,018 = distinct 2,018 = mirror; missing 0, repeated
0; equals the single pass: True.

### Every Forecast-alerting search

| search | cron | coverage | matches | legacy new (old) | ID-list new (old) | WM cutover | WM steady | WM old rows | genuine preserved | HHS onboard no floor → floor |
|---|---|---|---|---|---|---|---|---|---|---|
| 02dc20b6 | yes | ok | 32,422 | 0 (0 old) | 103 (103 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 175a893e | yes | ok | 32,422 | 0 (0 old) | 87 (87 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 1b018df4 | yes | ok | 32,422 | 0 (0 old) | 93 (93 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 4692743e | yes | ok | 32,422 | 0 (0 old) | 68 (68 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 54fd0605 | yes | ok | 32,422 | 0 (0 old) | 133 (133 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 5b867c2f | yes | ok | 32,422 | 0 (0 old) | 66 (66 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 64eb46b6 | yes | ok | 32,422 | 0 (0 old) | 126 (126 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 749d017b | yes | ok | 32,422 | 0 (0 old) | 126 (126 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 7d3a2556 | yes | ok | 32,422 | 0 (0 old) | 91 (91 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| 88d24ae2 | yes | ok | 32,422 | 0 (0 old) | 74 (74 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| ae5ddb00 | yes | ok | 32,422 | 0 (0 old) | 69 (69 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| dd024647 | yes | ok | 32,422 | 0 (0 old) | 86 (86 old) | 0 | 0 | 0 | ✓ | 1861 → 0 |
| e2466850 | yes | ok | 11,389 | 0 (0 old) | 1 (1 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| 14466713 | yes | ok | 8,455 | 60 (60 old) | 91 (91 old) | 0 | 0 | 0 | ✓ | 763 → 0 |
| c4158f3a | yes | ok | 5,617 | 0 (0 old) | 3 (3 old) | 0 | 0 | 0 | ✓ | 154 → 0 |
| 386e228b | yes | ok | 5,028 | 0 (0 old) | 200 (200 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| 14d902aa | yes | ok | 4,850 | 0 (0 old) | 8 (8 old) | 0 | 0 | 0 | ✓ | 131 → 0 |
| 5c25203a | yes | ok | 4,850 | 8 (4 old) | 8 (4 old) | 0 | 4 | 0 | ✓ | 131 → 0 |
| 32846637 | yes | ok | 4,701 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 193 → 0 |
| 81bf2414 | yes | ok | 4,701 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 193 → 0 |
| 983d2867 | yes | ok | 4,672 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 180 → 0 |
| a82d3d77 | yes | ok | 4,301 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 103 → 0 |
| 74839699 | yes | ok | 3,534 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 80 → 0 |
| 1c3b715a | yes | ok | 2,968 | 0 (0 old) | 4 (4 old) | 0 | 0 | 0 | ✓ | 138 → 0 |
| 32acc010 | yes | ok | 2,002 | 0 (0 old) | 13 (13 old) | 0 | 0 | 0 | ✓ | 358 → 0 |
| 994c599e | yes | ok | 1,575 | 0 (0 old) | 200 (200 old) | 0 | 0 | 0 | ✓ | 79 → 0 |
| 6f121c25 | yes | ok | 767 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 23 → 0 |
| 9ca2d2de | yes | ok | 619 | 0 (0 old) | 200 (200 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| c75b5e65 | yes | ok | 493 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 20 → 0 |
| 5e4bcd5a | yes | ok | 233 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 4 → 0 |
| ab8bb3c8 | yes | ok | 233 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 4 → 0 |
| 08d970cb | yes | ok | 138 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 26 → 0 |
| 943f7486 | yes | ok | 26 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| 5759ff87 | yes | ok | 17 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 2 → 0 |
| c3f908e3 | yes | ok | 11 | 0 (0 old) | 11 (11 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| ff372605 | yes | ok | 6 | 0 (0 old) | 6 (6 old) | 0 | 0 | 0 | ✓ | 6 → 0 |
| b4e40d05 | yes | ok | 5 | 0 (0 old) | 3 (3 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| 0678583e | yes | ok | 2 | 0 (0 old) | 2 (2 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| 61d1ca1f | yes | unestablished (HUD) | 0 | 0 (0 old) | unavailable (0 old) | 0 | unavailable | 0 | ✓ | 0 → 0 |
| 7ef11325 | yes | ok | 0 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| b032f39f | yes | unestablished (SBA) | 0 | 0 (0 old) | unavailable (0 old) | 0 | unavailable | 0 | ✓ | 0 → 0 |
| e00435f7 | yes | unestablished (National Oceanic and Atmospheric Administration) | 0 | 0 (0 old) | unavailable (0 old) | 0 | unavailable | 0 | ✓ | 0 → 0 |
| e9c0f9be | yes | ok | 0 | 0 (0 old) | 0 (0 old) | 0 | 0 | 0 | ✓ | 0 → 0 |
| 1f01ad20 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 1861 → 0 |
| 507cdd28 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 1861 → 0 |
| 5eaba2aa | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 1861 → 0 |
| 915af605 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 1861 → 0 |
| 9953d49b | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 1861 → 0 |
| c55dbe32 | no | ok | 32,422 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 1861 → 0 |
| 48df9f00 | no | ok | 6,655 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 237 → 0 |
| 2cca41bc | no | ok | 4,850 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 131 → 0 |
| bfe464e2 | no | ok | 4,100 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 135 → 0 |
| f587f86b | no | ok | 3,687 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 99 → 0 |
| a5f952c7 | no | partial (COMMERCE) | 3,578 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 380 → 0 |
| 46275c5f | no | ok | 1,541 | 200 (0 old) | 200 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 147 → 0 |
| ad3f8e7c | no | ok | 153 | 190 (0 old) | 153 (0 old) | 0 | baseline(never alerted) | 0 | ✓ | 19 → 0 |

## 9. Scripts (none run with `--go`)

| script | default | on `--go` | guards |
|---|---|---|---|
| `saved-search-forecast-baseline.ts` | dry run | sets W (and G for uncovered buyers) where W IS NULL | refuses without the migration; backup first; idempotent; verifies 0 NULL left and Open state byte-identical; no email path; `--rollback <backup>` |
| `forecast-publisher-floor.ts` | dry run | `--seed` (never overwrites), `--suspend`, `--activate` (+ an append-only log) | canonical codes only; reason and actor required; monotonic unless `--allow-rewind` |
| `saved-search-forecast-watermark-replay.ts` | read-only | — | exits 1 on any mismatch, old-row alert, cutover alert, or lost genuine row |
| `proofs/forecast-floor-guard.pglite.mjs` | in-process Postgres only | — | exits 1 on any failed expectation |

## 10. Cutover (proposed)

| # | step | writes | check | reverse |
|---|---|---|---|---|
| 1 | merge #1674 + this PR dark | none | serving SHA contains the merge; `watermarkColumns: absent` in the cron response | revert |
| 2 | DHS identity window (#1682 run order) | DHS rows | its own assertions; `--check-resume` | backup |
| 3 | apply the migration (`npm run migrate`) | columns, tables, function, index, **trigger** | `db:check` + PostgREST read; the RPC works; cron `watermarkColumns: present` | drop the trigger/objects |
| 4 | seed floors | 19 active floors + log | `--status`; from here, bulk loads without a suspend are refused | delete floor rows |
| 5 | explicit baseline | W on the 56 Forecast-alerting rows | 0 NULL; Open state byte-identical | `--rollback <backup>` |
| 6 | shadow | none (`?mode=preview&forecastEngine=canonical` after a 13:00 sync) | Forecast-new = rows created after the baseline only | — |
| 7 | enable | `printf true \| vercel env add …` + fresh deploy | the first 11:00 run matches the shadow | **unset the flag → Forecast paused, Open continues (§7)** |

## 11. Decisions for review
1. High-volume notification behaviour (§5): (a) as built, (b) threshold summary, or (c) hold for review.
2. Daily-sync breaker threshold: 500 new rows per publisher per run (§6).

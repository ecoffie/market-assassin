# Set-aside enrichment for recompete rows — SCOPE (2026-07-29)

**Status:** SCOPED, awaiting Eric's approval before any bulk write. Surfaced by the map data-integrity
audit (map is verified clean; this is a coverage upgrade, NOT a bug fix).

## The gap (measured, not assumed)

`recompete_opportunities.set_aside_type` is **NULL on all 132,312 live rows** (quality_flag IS NULL) —
the USASpending recompete sync deliberately omits it (the endpoint returns NULL for that field). The map
correctly shows "unknown" and never fabricates a set-aside. But the value **is recoverable** from
BigQuery `awards.set_aside` via the PIID (every recompete row has a PIID = the join key).

## What the numbers actually say (measured against BQ awards, 2026-07-29)

Sampled real recompete PIIDs against `market-assasin.usaspending.awards`:
- **~67% of PIIDs match** in BQ awards.
- Of matched, **only ~17% carry a REAL set-aside** — the rest are `"NO SET ASIDE USED."` (= full & open).
  ⚠️ The audit's "3/5" was optimistic: it counted `"NO SET ASIDE USED."` as a value. It is NOT — that's
  full-and-open, a distinct honest signal.
- **Net enrichable: ~11% of rows (~15K)** gain a real set-aside label; another chunk gain a definite
  **"Full & Open"** label (also useful — "no set-aside barrier"); the rest stay honest-null (unmatched).

Real values seen (clean, mappable): `SMALL BUSINESS SET ASIDE - TOTAL`, `SERVICE DISABLED VETERAN OWNED
SMALL BUSINESS SET-ASIDE`, `NO SET ASIDE USED.` → map to `Full & Open`.

## Why it's still worth doing

~15K rows gaining a real eligibility signal + a large slice gaining a confirmed "Full & Open" is a
genuine bid-decision upgrade — and it **stays honest**: unmatched rows keep showing "unknown", never a
guess. Three states per row: real set-aside · Full & Open · unknown (unmatched).

## The plan (each step gated on your approval)

### 1. Migration (you hand-run — this DB has no in-app DDL)
```sql
-- Add an ENRICHED set-aside column + provenance, leaving the raw sync field untouched.
ALTER TABLE recompete_opportunities
  ADD COLUMN IF NOT EXISTS set_aside_enriched   text,   -- normalized: '8(a)','SDVOSB','WOSB','HUBZone','SB-Total','Full & Open', or NULL
  ADD COLUMN IF NOT EXISTS set_aside_source     text,   -- 'bq_awards' | NULL (never guessed)
  ADD COLUMN IF NOT EXISTS set_aside_checked_at timestamptz; -- resumability stamp
```
Read side never infers — it reads `set_aside_enriched` (NULL → "unknown", exactly as today).

### 2. Local tsx backfill runner (rule #7 — NOT an HTTP cron loop)
- `scripts/enrich-recompete-setaside.ts`, dry-run by default, resumable via `set_aside_checked_at`.
- Batches PIIDs → one BQ query per batch against `awards` (filtered `fiscal_year >= 2020`, cost-capped)
  → normalize `set_aside` → write `set_aside_enriched` + `set_aside_source='bq_awards'` + stamp.
- `"NO SET ASIDE USED."` / `"NONE"` → `set_aside_enriched='Full & Open'`. Unmatched → leave NULL.
- Concurrency pool (~500/min); ~132K rows ≈ a few passes. BQ cost: sampled ~1–2 GB/batch → budget-check
  each batch, refuse over cap.

### 3. Dry-run → show scope → APPROVE → run (rule #11)
Before any write: run `--dry`, show you **count + filter + a sample of the enriched values**, then run
the real backfill only on your OK.

### 4. Read side (small, after the column lands)
- `query.ts` selects `set_aside_enriched`; the map/drawer shows the real value, "Full & Open", or
  "unknown". A one-line map wiring change; no inference anywhere.
- Optional: refresh in the recompete sync cron so new rows enrich automatically (steady-state).

## Also folded in here (the geocoding "polish" that turned out to be a bulk write)

The ~400 real-state recompete rows with `map_loc_source='state_approx'` but `map_lat IS NULL` are a
**stale-backfill artifact** — the geocode function is correct (VA/MD/FL all have centroids), those rows
just predate the fix. Re-running `scripts/backfill-recompete-map-latlng.ts` for the null-lat + known-state
slice pins them. (~7,799 null-STATE rows and the AP/AE/MH/PW/FM overseas-territory codes are correctly
unpinnable — adding fake centroids would violate the no-fabrication rule. Leave them.) This is a bulk
write too → same approval gate.

## Decision needed from Eric
1. Approve the migration SQL (I'll `pbcopy` it for you to run in Supabase).
2. Approve building the backfill runner.
3. Approve running the 132K backfill after you see the dry-run scope.
(The geocoding backfill re-run can ride along or be skipped — your call.)

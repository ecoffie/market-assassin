# Search cache — preview round 1 (2026-11-16)

Agent 3, branch `agent3/cache-hardening-on-rc3` @ fe7eae993 (RC3 + cache-hardening + preview-only gate). Eric (via Agent 5)
approved cache infrastructure for **preparation and preview testing only**; production activation is on hold.

**Preview:** `market-assassin-4pc0rxytq-eric-coffies-projects.vercel.app` (VERCEL_ENV=preview, commit fe7eae993).
**Source:** `OPEN_SNAPSHOT_SOURCE=db` (each instance builds the snapshot from the database; no bucket yet).
**Data:** live production `sam_opportunities`, because Vercel previews use the production Supabase project (verified). All
reads; nothing written.

## What stayed off

- `SNAPSHOT_SEAM_RELEASED` = false. The seam is released only by `previewSeamRelease()` = `VERCEL_ENV === 'preview'` and
  `OPEN_SNAPSHOT_PREVIEW === 'true'`, so production cannot enable it whatever flags are set (unit-tested).
- No Vercel env change. The diagnostic route sets the flags in-process for its own run only.
- No `cron_jobs` row. No bucket in round 1. The `snapshot_changed_at` trigger is NOT applied (it is DDL on prod
  `sam_opportunities`, i.e. activation; it needs Eric's explicit OK).
- Diagnostic route `/api/cron/open-snapshot-preview-check`: 404 outside preview, 401 without CRON_SECRET (both checked).
  On getmindy.ai the path does not exist (it falls through to the HTML page like any unknown path). Branch only, never merge.

## 1. Fill, hit, miss (real Vercel function)

| Step | Path | Time | Notes |
|---|---|---|---|
| First request, no snapshot | SQL, reason "no snapshot" | 5.6 s | starts one background load |
| Snapshot fill (DB build) | — | 7.3 s (later fills 9.6–12.3 s) | 8,821 open rows |
| Next request | **snapshot** (age 13 s) | 4.8 s | count 1,228 = SQL count 1,228 |

Memory: heap 73 MB at start → 149 MB after the fill; 375 MB heap / 708 MB RSS after the whole lifecycle (three snapshot
builds plus 9 searches in one instance). Matches the local measurement (+372 MB heap). Not verified here: the project's
function memory limit.

## 2. Staleness under the current change detection (writers' timestamps; no trigger)

| Case | Result |
|---|---|
| Snapshot older than 6 h | not used: SQL ("no snapshot"), one reload started; reload took 10.3 s, then the snapshot path again |
| Rows changed since the snapshot, by snapshot age | 5 min: 1 · 30 min: 1 · 60 min: 79 · 2 h: 490 · 4 h: 490 · **5 h 55 min: 16,741** |
| Snapshot from before the last sync (16,741 changed > 1,500) | SQL ("16741 rows changed since the snapshot (rebuild requested)"); rebuild took 9.6 s, then the snapshot path again |

**Reading for Eric's trigger decision.** Every case fails safe: a stale or over-changed snapshot is never used, and the answer
comes from SQL. The cost is availability, not correctness. Without the trigger, a SAM sync stamps `synced_at` on far more
rows than actually change (16,741 "changed" against 8,821 open rows), so after every sync each instance refuses the cache
until it rebuilds (about 10 s of DB reads per instance, at most one per 10 minutes). The trigger would count only real
content changes, so a sync would not force rebuilds.

## 3. Parity: snapshot path vs SQL path, 28 phrasings (queries_v4), same instance, back to back

Run under the heavy-test lock. The snapshot path answered **28/28**.

| | Short phrasings (14) | Long phrasings (14) |
|---|---|---|
| SQL path | answered 14 | **timed out on 14 of 28** ("search too long", about 8.6 s) — see correction below |
| Snapshot path | answered 14 | answered 14 (median 4.3 s, max 6.1 s) |
| Open-now count, cache vs SQL | **identical 14/14** | — (SQL has no count) |
| Median time, cache vs SQL | 3.3 s vs 4.7 s | — |

A local re-run against the same live DB reproduced it exactly: the SQL path timed out on the same 14 phrasings (12 long, 2 short),
twice in a row each.

**Top-25 differences, where both answered.** The set of distinct solicitations in the top 20 is identical for 11 of the 14;
order differs for 5 of those 11. Every single difference, including the 3 set differences (guards short, parts short, parts
long), is between **rows with exactly the same response deadline** (here a batch of NAVSUP/DLA items all closing
2026-11-16 20:30Z, plus duplicate versions of one notice). SQL is repeatable (two SQL runs gave identical lists), but the
two paths break deadline ties differently: Postgres `ORDER BY response_deadline LIMIT 500` vs the cache's in-memory merge
sort. When more than 500 notices match, that also changes which tied rows make the 500-row window.

**Fix (proposed, not made):** add `notice_id` as a tie-breaker to the deadline order in both paths (the SQL `.order` and the
cache's merge sort). Both paths then become deterministic and should match exactly. It slightly changes RC3's ranking among
same-deadline rows, so it belongs on a dev branch with a re-measure, not on the frozen RC line.

## 4. Two findings beyond the cache

1. **CORRECTION (2026-11-16, round 2):** the 14 SQL timeouts are 12 long + 2 short (nursing short, steel short), not "all 14 long"; RC3's SQL answered parts long and valves long. See CACHE-PREVIEW-ROUND2.md. **RC3's SQL path times out on most long phrasings against the live database.** The holdout runner scores a fixture
   snapshot in memory, so it cannot see statement timeouts. Whether production (main) does the same on long descriptions was
   not checked here. That should be measured before any decision that relies on the long phrasings.
2. The diagnostic route's `classes_same` field is not meaningful: FIND items carry no `evidence_class` field, so it compared
   empty strings. Ignore it.

## Round 2 (pending)

Storage path: create the private `open-snapshots` bucket (approved by Agent 5 under conditions), call
`build-open-snapshot` manually on the preview, then rerun lifecycle and parity with `source: 'storage'`. Still no cron row,
no trigger, no production flag.

Raw outputs (scratchpad, not committed): `lifecycle.json`, `parity-{0,7,14,21}.json`, `local-parity.json`.

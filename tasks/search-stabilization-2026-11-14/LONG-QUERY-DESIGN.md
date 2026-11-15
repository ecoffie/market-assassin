# Long-query failures: design recommendation (Agent 3, 2026-11-14)

**Status:** recommendation only. Safe handling is built (commit `293155b98`, `search-failure.ts`): a timed-out search now says
"too long, shorten it", never a raw 500 or an empty map. **That does not pass gate A2.** No migration, cache or index has
been built. Every number below is measured read-only on production (READ ONLY transactions; harness
`harness/explain.mts`, `harness/shapes.mts`).

## 1. Why it fails (query plan)

Open text search is a Postgres filter over the ~9.7k open rows: `active AND response_deadline > now()` narrows by two btree
indexes (BitmapAnd, 8 ms), then every regex clause runs on every remaining row. No text index is used (the trigram
indexes on title/description cannot serve an OR of word-boundary regexes across five columns; `sow_text` has none).

Janitorial paragraph, `EXPLAIN (ANALYZE, BUFFERS)`: 55 clauses, Bitmap Heap Scan, Rows Removed by Filter 9,219,
**shared buffer hits 406,394, execution 4,824 ms for the count alone**. Each clause re-reads (de-TOASTs) the column,
and the open set holds ~64 MB of text (description 36 MB, SOW 27 MB). The Map runs the count and the pin page together
through PostgREST, which crosses the ~8.3 s statement timeout; that is the 500 customers saw.

## 2. Measured options (same four paragraphs; counts identical across shapes)

| Shape | Latency (count) | Change needed |
|---|---|---|
| A. Current (5 columns, clause per concept × column) | 4.1–5.0 s | none |
| B. 3 columns (drop department, solicitation_number) | 4.0–4.9 s (≈3% faster) | code only |
| C. Read each row's text once (materialized CTE, one clause per concept) | 2.9–3.4 s (≈35% faster) | an RPC function = migration |
| **J. In-memory match over a cached open snapshot** (`matchesText`, the matcher's own JS mirror) | **0.33–0.44 s** | code + a stored snapshot |
| D. Bounded planner (cap clauses ≈ 25) | under limit by construction | code; **drops meaning** (fails narrow) |
| E. Text index on sow_text (pg_trgm GIN) | not measurable without building it | migration; ≈490 MB index (description's trigram index is 362 MB for 462 MB of text; sow_text is 632 MB); write load on ~18k rows/day |

## 3. Recommendation: J, cached open-notice retrieval (no migration)

- **What:** after each SAM sync (01:00, 09:00, 13:00 UTC) a job writes a compressed snapshot of the open set: notice_id,
  the five text columns, codes, deadline (68 MB JSON, **20 MB gzipped**). The request path loads it once per warm
  instance, applies the deadline at match time, runs the SAME `matchesText` the SQL predicate is generated from, then
  reads full rows by `notice_id` (the ranked window). Identical semantics by construction: same function, verified
  equal counts (±2 = snapshot drift).
- **Wins beyond A2:** removes the silent 500-row deadline window (all matches can be ranked), and makes C2 full-set
  group totals cheap (PR #2048 finding F8).
- **Cost:** ~3 blob writes/day ≈ 60 MB/day of storage writes; no database writes; ~200–300 MB memory per warm
  function instance; cold load ≈ download 20 MB + parse (estimate 1–3 s; measure on a preview before approval).
- **Failure behaviour:** snapshot missing, unreadable, or older than 2 sync cycles → fall back to today's SQL path
  (which still reports "too long" on a timeout). Never an empty result for a failed load.
- **Rollback:** one flag (default off) selects the SQL path; the snapshot is additive and can be deleted.
- **Saved searches and alerts:** unaffected. Alert crons keep the SQL path. Caveat for #2043: if the Map moves to the
  snapshot and alerts stay on SQL, the two can differ by up to one sync cycle of staleness; parity must be decided
  before #2043 is activated (either both on the snapshot or both on SQL).
- **Staleness disclosure:** the snapshot carries its build time; surfaces show it the way the DIBBS panel now does.

## 4. If a migration is preferred instead

C (single-read RPC) is the smallest migration but only buys ~35%; paragraphs would still sit near the limit under load.
E needs a build on a branch database first; required before proposing it: `EXPLAIN ANALYZE` with the index, index size,
sync upsert latency before/after, a `CREATE INDEX CONCURRENTLY` plan, and a `DROP INDEX CONCURRENTLY` rollback. Neither is
recommended ahead of J.

## 5. What stays failing

Gate A2 (long paragraphs return results) fails until J or E ships. The "too long" message is honest handling, not a pass.

## 6. Integration (RC3 branch, development only; flag `OPEN_SNAPSHOT_RETRIEVAL` off)

Built: `open-cache.ts` (`buildOpenSnapshot`, `compileOps`, `CachedOpenQuery`, `openQueryFactory`, `currentOpenSnapshot`) and
FIND wiring (`queryOpenNow` → `openQ`). Commits `cf8a04690`, `ea5870d46`.

| Requirement (Eric) | How it is met | Evidence |
|---|---|---|
| No migration | none; one route now stamps `description_checked_at` | `cf8a04690` |
| Source freshness + notice identity | rows always come from the live DB (by id); snapshot only proposes candidates | integration tests |
| Customer filters | the plan's own ops (closed parser) in memory; structured filters + caller chains run live | parity on 17/17 live searches |
| Never substitute stale / incomplete | complete-or-refuse build; age ≤ 6 h; > 1,500 changed rows → SQL; changed rows always via SQL | unit + integration tests |
| Timeout vs partial vs zero | cache unavailable → SQL (timeout → "too long"); part error → error; genuine zero → 0 | tests |
| Updates / deletes / new notices | delta (stamped changes) + by-id verification (deletes) | integration tests |
| Concurrency / failures | single-flight build; 20 parallel queries; verify error, overflow, unknown method | integration tests |
| Latency | 0.9–2.5 s on all 28 phrasings (SQL: 1.3–6 s, 11 timeouts) | `harness/cache-bench.mts` |
| Memory / cost | parse 0.25 s, +~220 MB heap (RSS 470 MB measured); 20.5 MB gzip per build; ~3–4 builds/day | measured |

**Agent 5's first review (2026-11-14), pending full review after their P0:** store a cron-built snapshot in a PRIVATE
Supabase Storage bucket (service-role only; assert the policy, since default grants recently exposed objects); a
`cron_jobs` row after each SAM sync, verified via `cron_job_runs.http_status` and recording age + row count; Map viewport
wiring in a separate PR after FIND is proven; confirm function memory for ~0.5 GB. Blocker: the matcher path is the one
#2043 would make alerts inherit, so Agent 4 must evaluate the same SHA, and the flag stays off.

**Not built (needs approval):** the storage bucket and its policy, the `cron_jobs` row, the snapshot-writer cron route,
Map wiring, any flag flip.

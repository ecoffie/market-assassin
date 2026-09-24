# Recompete text-index prototype (2026-09-24)

**No production DDL was applied.** Kept separate from PR #1684 (Maps P0).

Scripts live in the session scratchpad (`proto.js`, `proto2.js`, `proto3.js`, `ops7.json`, `proto-results.json`).

## Method

- **Canonical plans.** The seven queries are built with the real canonical plan: `buildDiscoveryPlan(input, MAPS_POLICY)` → `horizons.recompete.ops`, translated to SQL.
- **Translation verified.** For all seven queries, `totalForFilters` and `unmappedForFilters` equal the live `getmindy.ai/api/app/recompete-map`, 7/7 exact.
- **Baseline.** The real table, read-only, exactly as production runs it (PG 17.6, `max_parallel_workers_per_gather=1`).
- **Prototype.** One transaction that is **always rolled back**:
  - `CREATE TEMP TABLE rc AS SELECT * FROM recompete_opportunities` (a session-private copy).
  - All existing indexes recreated on the copy.
  - `ANALYZE`, then measure.
  - Six `gin_trgm_ops` indexes built on the copy, then `ANALYZE` and measure again.
  - `ROLLBACK`. 0 leftover objects, verified.
  - The real table only ever took ACCESS SHARE.
- **Like-for-like.** The fair comparison is **copy-before vs copy-after**: same snapshot, same storage, no parallel workers.
  - Temp tables cannot use parallel workers and use local buffers, so the copy runs 1.3–2× slower than the real table.
  - Expect the real table with the indexes to be at least as fast as copy-after.
- **The complete request.** The four reads `recompete-map` issues:
  - (a) market total
  - (b) unmapped
  - (c) pins with `count:'exact'`: page plus an unlimited count in one statement, so the predicate is evaluated twice
  - (d) follow-ons

  Every EXPLAIN is a median of 3.

Queries: `ai governance`, `cybersecurity`, `janitorial`, `software license`, the nonsense query `xqzvplk florbnax`, a broad list, and NAICS 541512 as the fast control.

- The broad list is `program management, training, technical writing, logistics, data analytics, systems engineering`.
- The first broad list tried ("cloud migration, cybersecurity, help desk…") collapses to the cybersecurity industry preset: exactly the same ops, so it would not be a distinct test.

## Results

Read (a), the market total. Median ms.

| Query | Prod table | Copy before | Copy after | Index used? | Rows examined (a): before → after | Results identical? |
|---|---|---|---|---|---|---|
| ai governance | 438 | 805 | **10** | trgm: description, psc_description, naics_description, incumbent_name | 141,947 → 279 | **yes** |
| cybersecurity | 922 | 1,627 | **49** | btree naics + psc, plus trgm description / incumbent / naics_description | 102,608 → 11,609 | **yes** |
| janitorial | 18 | 12 | 12 | btree naics only (industry preset, no text) | 5,313 → 5,313 | **yes** |
| software license | 2,604 | 3,955 | **1,018** | trgm, all 6 | 141,947 → 24,545 (15,993 removed on recheck) | **yes** |
| nonsense | 363 | 646 | **1** | trgm, all 6 | 141,947 → 0 | **yes** |
| broad capability list | 2,923 | 5,721 | **1,391** | trgm, all 6 | 102,608 → 22,760 | **yes** |
| NAICS 541512 (control) | 17 | 10 | 10 | btree naics | 4,250 → 4,250 | **yes** |

"Identical" means the same snapshot before and after the indexes, byte for byte. The comparison covered:
- every matching `contract_id`
- the market total, unmapped count and in-view count
- the 1,000-pin page: its IDs in order, and the full row JSON
- the follow-on set

### The complete request (database ms; a+b+c+d = total DB work)

| Query | Endpoint on prod today (wall) | DB work: copy before → after | Longest single read: before → after | One pass, after |
|---|---|---|---|---|
| ai governance | 3.2 s | 2,904 → **50** | 1,715 → 21 | 11 |
| cybersecurity | 3.4 s | 4,034 → **298** | 1,708 → 170 | 98 |
| janitorial | 1.0 s | 94 → 94 | 55 → 55 | 35 |
| software license | **11.2 s** | 13,304 → **4,408** | 7,761 → 2,044 | **1,108** |
| nonsense | 2.4 s | 2,261 → **4** | 1,286 → 1 | 1 |
| broad capability list | **8.7 s** | 13,867 → **4,362** | 5,863 → 1,632 | **1,939** |
| NAICS 541512 | 0.85 s | 90 → 90 | 53 → 53 | 31 |

Endpoint wall times are the median of 3 via curl. The P0 preview, with its concurrent reads, was not materially better for the regex-heavy queries (software license 8.4 s, broad 8.6 s).

The reads are CPU-bound on a small database instance, so running them concurrently mostly makes them compete for the same CPU. **Total DB work is the number that predicts wall time, not the slowest single read.**

## Which columns and predicates dominate

**Before indexing** (real table; each column's regexes alone, window + mapped, ms):

| Query | description | psc_description | naics_description | incumbent_name | awarding_agency | awarding_sub_agency |
|---|---|---|---|---|---|---|
| ai governance | 174 | 160 | 71 | 145 | 136 | 143 |
| cybersecurity | 598 | — | 74 | 436 | — | — |
| software license | 866 | 856 | 74 | 732 | 706 | 745 |
| broad list | 577 | 521 | 91 | 563 | 385 | 422 |

- The window-only floor (no text filter) is 104 ms.
- The cost is **regex count × ~142k rows**, spread across every column. No single column is the culprit.
- The agency and sub-agency columns cost about as much as `description` despite rarely matching.
- `naics_description` is the cheapest, because it is 0% filled.

**After indexing:**
- The trigram lookups themselves are cheap: ≤ 50 ms per column, even summed across 10 terms.
- What remains is the heap recheck, which runs the regexes on the candidate rows:
  - **software license:** `psc_description` alone yields 34,947 candidates, and 15,993 are removed on recheck. ~945 ms per evaluation.
  - **broad list:** description 34k + psc 34k + sub-agency 31k candidates; 22,071 real matches. ~840 ms per evaluation.
- For common words the matching set itself is large, and that cost is inherent to the regex semantics.

**A new regression the indexes introduce:**
- Read (d), the follow-ons, flips to a trigram plan: 774–824 ms, against 134–149 ms with bitmap scans off.
- The follow-on set is only 396 rows, so filtering on `data_source` first is far cheaper; the planner misestimates regex selectivity.
- Must be handled together with the indexes. One pass (below) removes it naturally.

## Tie finding (already true in production, independent of the index)

- The page orders by `period_of_performance_current_end` **only**.
- On the prod table vs the copy, the software-license page differed by **30 rows, all on the tied cutoff date 2026-11-30**. The same 30 differed before any index existed: it is the parallel scan on prod vs the bitmap scan on the copy.
- So today, *which* tied contracts make the 1,000-pin cut depends on the query plan.
- Adding `, contract_id ASC` makes the page deterministic under every plan. Proven: the trigram plan and a forced sequential scan return identical pages with the tie-break.
- **Any "byte-for-byte identical" guarantee across a production plan change requires this tie-break.**

## Is indexing alone enough?

**No.** It is the biggest first step, and it changes zero results.
- **Selective and nonsense queries become effectively free:** 1–300 ms of DB work, down from 2.3–4.0 s.
- **Common-word and broad queries** still cost 4.4 s of DB work per request. The predicate matches 5–30k rows and is evaluated **~5 times per request**: (a), (b), (c) twice, (d).
- **The next architectural win is computing the canonical market ONCE** (proven in `proto3.js`):
  - One materialized pass derives total, unmapped, in-view, pins and follow-ons.
  - Byte-identical to the four separate reads on all 7 queries: counts, pin row JSON, follow-ons.
  - With the indexes: software license 4,408 → **1,108 ms**, broad list 4,362 → **1,939 ms**.
  - It also removes the (d) misplan, and a pan becomes one cheap pass.
  - Risk: the plan must be expressed as one SQL statement (an RPC). Keep the op-to-SQL translation generated from the same canonical ops (this prototype's translator matched the API 7/7) and gate it with a parity test against the PostgREST path.

## Proposed sequence (nothing applied)

1. **Code:** add the `contract_id` tie-break to `recompete-map`'s page order, the prerequisite for identity guarantees. Then the six trigram indexes. As an idempotent migration it would look like the block below, but **do not create this file until approved**: the migration runner applies whatever is in `supabase/migrations`.

   ```sql
   -- migrate:no-transaction
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recompete_trgm_description        ON recompete_opportunities USING gin (description gin_trgm_ops);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recompete_trgm_psc_description    ON recompete_opportunities USING gin (psc_description gin_trgm_ops);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recompete_trgm_naics_description  ON recompete_opportunities USING gin (naics_description gin_trgm_ops);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recompete_trgm_incumbent_name     ON recompete_opportunities USING gin (incumbent_name gin_trgm_ops);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recompete_trgm_awarding_agency    ON recompete_opportunities USING gin (awarding_agency gin_trgm_ops);
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recompete_trgm_awarding_sub_agency ON recompete_opportunities USING gin (awarding_sub_agency gin_trgm_ops);
   ```

   - Measured on the copy: ~79 MB total (description 28 MB, psc 17 MB, incumbent 14 MB, sub-agency 10 MB, agency 8 MB, naics_description 1.3 MB).
   - Build time on the copy: 0.25–3.5 s each. CONCURRENTLY on prod will be slower but non-blocking.
   - Every hourly recompete sync will also pay GIN maintenance. It is modest at this table's churn, but should be measured after the build.
   - The (d) follow-on read must be rewritten to filter `data_source` first in the same change, or it regresses ~0.7 s.
2. **Then** the one-pass RPC with a parity gate.
3. **Optional:** drop the agency columns from the Recompete text matcher. This is a matching-behaviour change and needs the relevance fixtures.

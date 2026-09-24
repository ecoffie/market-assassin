# Recompete performance Gate 1 — determinism + text indexes (2026-09-24)

Approved by Eric after the prototype: `tasks/recompete-trgm-prototype-2026-09-24.md`.

Scope:
- Deterministic pagination.
- A planner-independent follow-on read.
- The six proven trigram indexes.
- No Canonical Discovery semantics change, no compute-once (that is Gate 2), nothing touched in #1684.

## 1 · Deterministic pagination
- `recompete-map` orders by **`period_of_performance_current_end` ASC, then `contract_id` ASC**. `contract_id` is a tie-breaker only, and it is unique (`recompete_opportunities_contract_id_key`).
- **Proof on the live table** (read-only, one REPEATABLE READ snapshot). The 1,000-pin page was fetched under 6 valid plans: default, index scan off, bitmap off, seq scan off, parallel off, and a trigram-indexed copy (rolled back).
  - **New order:** an identical page across all 6 plans for all 7 queries.
  - **Old order (expiry only):** "software license" returned **5 distinct pages**; cybersecurity, janitorial and the broad list returned 2 each.
- **Regression test:** `src/app/api/app/recompete-map/deterministic-page.unit.test.ts` drives the real route against an in-memory PostgREST stand-in with **1,200 contracts sharing one expiry date**, which crosses the cap. It fails 2/3 on the pre-gate route and passes 3/3 on this branch.

## 2 · Follow-on read (`src/lib/recompete/map-follow-ons.ts`)
The old read left the join order to the planner: plan ∧ mapped ∧ bbox ∧ `data_source='usaspending_followon'`. With the text indexes present it flips to a trigram BitmapOr, **727–1,021 ms** instead of ~80 ms.

The new read makes that impossible:
1. **Candidates** — follow-on ∧ mapped ∧ bbox, with no text predicate: 388 ids in the CONUS view; 410 follow-on rows exist in the whole table.
2. **Unchanged canonical plan** on `contract_id IN (chunk of 100)`, which is a unique-index lookup.

It returns the same set by construction, in deterministic `contract_id` order, keeping the old 1,000 cap. Measured:

| Setup | Old read | New read |
|---|---|---|
| Indexed copy | 727–1,021 ms | **74–78 ms** (step 1 ~72 ms + worst chunk ≤ 6 ms) |
| Real table (no indexes yet) | 31–149 ms | 69–89 ms |

- Follow-on IDs are **identical** for old vs new reads, on both the real table and the indexed copy, for all 7 queries.
- The flat ~72 ms of step 1 runs concurrently with the pin page read, so it is not on the critical path.

## 3 · The six trigram indexes — pre-apply record

| Index | Column / expression | Estimated size | Existing equivalent? |
|---|---|---|---|
| `idx_recompete_trgm_description` | `gin (description public.gin_trgm_ops)` | ~28 MB | `idx_recompete_fts` is a GIN **tsvector** (description‖incumbent): full-text, and it cannot serve `~*` regexes, so it is **not equivalent** |
| `idx_recompete_trgm_psc_description` | `gin (psc_description public.gin_trgm_ops)` | ~17 MB | none |
| `idx_recompete_trgm_naics_description` | `gin (naics_description public.gin_trgm_ops)` | ~1.3 MB | none |
| `idx_recompete_trgm_incumbent_name` | `gin (incumbent_name public.gin_trgm_ops)` | ~14 MB | `idx_recompete_incumbent` is a **btree**, which cannot serve regex, so it is **not equivalent** |
| `idx_recompete_trgm_awarding_agency` | `gin (awarding_agency public.gin_trgm_ops)` | ~8 MB | `idx_recompete_agency` is a **btree**, so **not equivalent** |
| `idx_recompete_trgm_awarding_sub_agency` | `gin (awarding_sub_agency public.gin_trgm_ops)` | ~10 MB | none |

- Total ~79 MB, against today's 173 MB of indexes and 331 MB for the table. Sizes were measured on a full copy.
- `pg_trgm` 1.6 is installed in `public`.
- No trigram index existed on any of these columns before this gate, so there are no duplicates.

**Mechanism:**
- Six files, `supabase/migrations/20260924_recompete_trgm_*.sql`, each with `-- migrate:no-transaction` and one `CREATE INDEX CONCURRENTLY IF NOT EXISTS`.
- One file per index is required: the runner sends a file as one query, and CONCURRENTLY cannot run inside the implicit transaction a multi-statement query opens.
- The runner gained **`--only a.sql,b.sql`**. `20260924_saved_search_forecast_watermark.sql` (#1683) is pending in the ledger, and its PR says **"do not apply the migration"**, so a bare `--go` would have applied it along with these files.

  Applied with:
  ```
  npm run migrate -- --go --only 20260924_recompete_trgm_awarding_agency.sql,…(all six)
  ```

## Acceptance (production)
- Oracle: `scripts/recompete-replay.ts` runs the route's own query code against the live database for all 7 fixtures. It fingerprints the market IDs, the market total, the unmapped total, the ordered page rows (full JSON) and the follow-on IDs.
- **Baseline self-check:** two runs before the apply, taken back to back, came out byte-identical.

## Production results (2026-09-24)

**Timeline (UTC):**
- 17:29 — prod baseline on the old code.
- 17:43 — #1686 merged (`70bd0600`). Production serving it, verified by the `maps-account-build` stamp.
- 17:45–17:49 — pre-index replay. It matched the 17:14 baseline hash for hash, so the data did not change in between.
- 17:49:26–17:49:44 — `npm run migrate -- --go --only <six files>` applied 6 of 6, each "ok". `20260924_saved_search_forecast_watermark.sql` stayed pending.
- 17:52 — post-index replay and latency.

**Indexes, verified in `pg_index`:** all six `indisvalid` and `indisready`. Six ledger rows, `baselined=false`.

| Index | Estimated size | Actual size |
|---|---|---|
| awarding_agency | ~8 MB | 8.4 MB |
| awarding_sub_agency | ~10 MB | 11 MB |
| description | ~28 MB | 29 MB |
| incumbent_name | ~14 MB | 14 MB |
| naics_description | ~1.3 MB | 1.3 MB |
| psc_description | ~17 MB | 18 MB |

Table indexes went from 173 MB to 255 MB.

**Identity:** `scripts/recompete-replay.ts --compare`, post-index vs pre-index, is **✓ byte-identical on all 7 fixtures**: market IDs, market total, unmapped total, ordered page rows (full JSON) and follow-on IDs.

**Production endpoint `GET /api/app/recompete-map`**, CONUS bbox:

| Query | Before: old code, no indexes (median of 5) | Code deployed, no indexes (median of 3) | **After: code + indexes (median of 5)** | Change |
|---|---|---|---|---|
| ai governance | 2.82 s | 3.49 s | **0.98 s** | −65% |
| cybersecurity | 3.19 s | 3.22 s | **1.46 s** | −54% |
| janitorial | 0.85 s | 1.05 s | **0.81 s** | ≈ |
| software license | 11.96 s | 11.09 s | **4.45 s** | −63% |
| nonsense | 2.40 s | 2.64 s | **0.94 s** | −61% |
| broad capability list | 8.71 s | 10.17 s | **4.53 s** | −48% |
| NAICS 541512 | 0.97 s | 1.06 s | **0.72 s** | ≈ |

**Follow-on read on the live indexed table** (EXPLAIN ANALYZE):
- The old single read, which is no longer used, would now take **1,279 ms** for software license and **862 ms** for the broad list.
- The new two-step read takes **73–78 ms flat** on every fixture.
- So the Gate 1 fix is what keeps the indexes from regressing that read.

**What is left:**
- "Software license" and the broad list are still 4.4–4.5 s.
- The regex recheck runs on 5–30k candidate rows, and it is evaluated about 4 times per request: the market total, the unmapped count, and the pins read, which counts twice.
- That is Gate 2 (compute-once).

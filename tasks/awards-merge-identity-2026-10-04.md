# Awards MERGE identity — permanent fix for the A1 duplicate defect (2026-10-04)

**Status: BUILT + TESTED. NOT run against production.** No production ingest or write happened.
Review comes first: the next scheduled Sunday ingest will execute this code once it is merged.

## The defect (A1, `tasks/bq-dod-awards-integrity-2026-10-04.md` F3)

The weekly MERGE matched `ON T.txn_id = S.txn_id AND T.action_date >= window_start − 2 days`.
- When USASpending **re-dated** an existing transaction INTO the pull window, the existing row
  (old date, before the bound) did not match, and the MERGE **inserted a second copy**.
- A1 created **126 stale rows / $17.23M across 9 FYs** this way; A1b deleted them by hand.
- 91 of those txns spanned two fiscal years.

**The bound never did what it was for.** Its comment (#808) said it "prunes the 63M-row scan to the
affected partitions". The table is partitioned `RANGE_BUCKET(fiscal_year)`, so an `action_date` predicate
prunes nothing. Measured: **both the date-bounded and the unbounded MERGE dry-run at 42.97 GiB.**

## The fix: identity = `txn_id`, wherever the row lives

| Step | What | Live dry-run / measured (current staging, 813,220 keys) |
|---|---|---|
| 1 locate | ONE read-only query: staged keys, and the `fiscal_year` partitions that already hold them | **3.14 GiB**, 1.9 s |
| 2 plan | `planMergeIdentity`: refuse if staging repeats a key; FY list → literal constants; NULL-FY match → unbounded fallback | — |
| 3 MERGE | `ON T.txn_id = S.txn_id AND T.fiscal_year IN (<located FYs>)` — matches exactly what an unbounded `txn_id` join would; literal FYs partition-prune | **3.86 GiB** (1 FY) · 8.21 GiB (2 FY) · 0.54 GiB (`ON FALSE`, nothing located) |
| 4 guard | Same BigQuery **transaction**: `ASSERT` that the staged keys own exactly `located_rows + new_keys` rows across the WHOLE table, else the MERGE rolls back | **2.64 GiB** |

**Per run: 9.6–14.0 GiB, against 42.97 GiB today.**
- The whole script (`BEGIN TRANSACTION … MERGE … ASSERT … COMMIT TRANSACTION`) parses on live BigQuery (dry run).
- Live locate on the current staging (A1 window 2, already merged):
  - 813,220 keys, all FY2026, owning 813,271 rows;
  - the ASSERT count today = 813,271 = the plan's expected value.
  So a re-run is an idempotent no-op.

**Why the guard reads the whole table.** A partition-scoped ASSERT shares the plan's blind spot: a
writer landing a copy in a year the plan never located would pass. Tested both ways; only the
whole-table count catches it. It is ~2.6 GiB, the price of a guarantee that does not depend on the plan
being right.

## Duplicate baseline (live, read-only, 2026-10-04)

`awards` 66,322,795 rows · **140 txn_ids with 2 rows (140 excess)** · 21 of them span two FYs · all 140 touch FY2026 ·
0 NULL `fiscal_year` / `action_date` / `txn_id`.
- This change **never increases** that number: existing copies are both matched and both corrected, none added.
- It does **not** remove existing duplicates either. Cleanup is a separate, authorized operation.

## Regression proof — `src/lib/awards-ingest/merge-identity.pglite.unit.test.ts`

Executes the REAL generated SQL (narrow BigQuery→Postgres shim) in PGlite against the real 58-column shape.

| Scenario | main's production statement¹ | this branch |
|---|---|---|
| **A1 exact:** X 2025-12-15 (before window 2026-01-20) → source 2026-02-10 | ✗ 2 rows | ✓ 1 row, source truth |
| A1 across FY: FY2025 2025-09-20 → FY2026 2025-10-05 | ✗ 2 rows | ✓ 1 row, moves to FY2026 |
| inverse: re-dated earlier inside the window | ✓ | ✓ |
| inverse across FY: FY2026 → FY2025 | ✓ | ✓ |
| normal incremental: insert new, update in-window correction, others untouched | ✓ | ✓ |
| existing duplicate pair (FY2025 + FY2026) | ✗ stale FY2025 copy left uncorrected | ✓ both corrected, still 2 (not worsened) |
| plan names exactly the partitions holding staged keys | n/a | ✓ |
| nothing located → `ON FALSE`, all insert | n/a | ✓ |
| NULL-FY existing match → unbounded fallback, 1 row | n/a | ✓ |
| staging repeats a key → refused, nothing written | n/a | ✓ |
| writer lands a copy between locate and MERGE → ASSERT rolls the MERGE back | n/a | ✓ |
| injection-shaped fiscal_year refused | n/a | ✓ |

¹ `AWARDS_MERGE_UNDER_TEST=legacy-golden` runs the committed #1658 golden. main's own parity test
proves that golden is byte-equal to main's builder output. Result: **3 failed / 3 passed** on the
shared scenarios; the current code passes **13/13**. The awards-ingest suite is 227/227 green.

## Behaviour changes to review

1. **A staging table with a repeated `contract_transaction_unique_key` now stops the ingest before the MERGE**
   (`failed at merge`, nothing written). Before, a repeat either failed inside the MERGE (if matched) or
   inserted duplicates (if new). The last staging had 0 repeats (813,220 / 813,220).
2. **The MERGE runs inside a BigQuery multi-statement transaction.** Any ASSERT failure rolls it back,
   and the run then fails before the recipients rebuild and the clock stamp.
3. **Cost falls from ~43 GiB to ~10–14 GiB per run.**

## Not done (out of scope, by instruction)

- No production ingest, write or dispatch. The next scheduled run is the first execution.
- Existing 140 duplicate pairs: untouched.
- Cross-state Coming Back location rows: unrelated.
- `PLAYERS_REBUILD_AFTER_INGEST` stays off.

---

## First-production-run acceptance (approved by Eric 2026-10-04, PR #1831)

**First execution = the next normal scheduled ingest: Sun 2026-10-11, cron `0 14 * * 0`.**
- Today's 14:00 UTC slot was skipped by the A1 maintenance pause.
- No manual dispatch to exercise it.

**Frozen duplicate baseline (live, read-only, measured 2026-10-04 after A1b):**
- **140 duplicated txn_ids · 140 excess rows** (280 rows)
- 21 of them span two fiscal years
- all 140 touch FY2026
- `awards` = 66,322,795 rows

The 140 pairs are NOT cleaned by this PR.

| # | Requirement | Where it shows |
|---|---|---|
| 1 | locate succeeds | log `MERGE identity: txn_id within fiscal_year [...]` |
| 2 | staging keys unique | `planMergeIdentity` refuses otherwise (`staging holds N rows for M transaction keys`) |
| 3 | planned FY partitions recorded | the same log line names the FYs, staged keys, already-present keys and expected rows |
| 4 | MERGE transactional | `BEGIN TRANSACTION … COMMIT TRANSACTION`; `[bytes]` child statements BEGIN_TRANSACTION / MERGE / ASSERT / COMMIT_TRANSACTION |
| 5 | whole-table ASSERT passes | a script job in state DONE with no error. **An ASSERT failure = rollback = the guard working. Do not bypass or retry around it.** |
| 6 | recipients rebuild succeeds | `rebuilding recipients…` then no `failed_after_merge`/`rebuild_recipients` error |
| 7 | freshness/coverage published only afterwards | the clock stamp runs after the rebuild (unchanged order); `post-apply verify` step |
| 8 | duplicate txn_id count ≤ 140 | read-only: `SELECT COUNT(*) FROM (SELECT txn_id FROM awards GROUP BY txn_id HAVING COUNT(*)>1)` |
| 9 | no new re-dated duplicate | any duplicate not in the frozen 140 must be investigated. Expected: none. |
| 10 | settled cohort completeness healthy | the workflow's post-apply verify / `cohort completeness` line |
| 11 | measured cost recorded | `[bytes] locate …`, `[bytes] merge-script …` and the per-statement lines. Compare with the dry run: locate 3.14 GiB · MERGE 3.86 GiB per FY · ASSERT 2.64 GiB |

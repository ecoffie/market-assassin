# IDV vehicle data foundation — execution plan (⛔ NOTHING HERE HAS BEEN EXECUTED)

Branch `fix/idv-vehicle-data-foundation` (uncommitted). Data foundation for a future "Sub Under"
view only — no UI, no tool. Every write below needs Eric's approval; all measurements were
read-only against production (BigQuery dry-run first, bytes reported) on 2026-09-23. The two SQL
files were EXECUTED, byte-for-byte, only against BigQuery session temp copies — see "Validation".

## What is wrong today (measured)

| # | Finding | Evidence |
|---|---|---|
| 1 | `awards` has no solicitation id, ordering end, or single/multiple flag; the weekly MERGE drops them although staging has them | `awards` = 51 cols; `awards_ingest_staging` = 297 cols incl. `solicitation_identifier`, `ordering_period_end_date`, `multiple_or_single_award_idv_code` |
| 2 | ~1.2M DoD transactions dated 2026-01-25..2026-05-03 are missing | DoD weekly counts: 83,949 (wk 01-19) → 10–25/wk → 94,977 (wk 05-04). Monthly: Feb 71 / Mar 74 / Apr 50 vs 369,957 / 409,484 / 414,853 a year earlier |
| 3 | The freshness oracle is green over that hole | `MAX(action_date)` = 2026-09-18 (civilian); DoD `MAX` is also 2026-09-18 from a ~300-row/week trickle published without the 90-day delay |
| 4 | Mech-Elec II in BQ: 26/31 orders, $8,655,978 / $17,001,286 (50.9%) | every missing dollar is explained: 11 txns $8,145,270 in the hole + 1 txn $200,038 (F0112, 2026-06-23) past the DoD frontier; 0 unexplained |

Cause of #2 is our window rule, not USASpending: the weekly window is `global MAX − 100d`, and
the global max says nothing about DoD. Fixed in code (`src/lib/awards-ingest/ingest-window.ts`:
window also starts at DoD's DENSE frontier − 14d). The existing hole still needs a one-time re-pull.

## Order of execution

| Step | What | Command | Cost / size | Reversible by |
|---|---|---|---|---|
| 0 | Snapshot `awards` | `99-rollback.sql` §0 (uncomment) | metadata; storage only for bytes later changed | drop snapshot |
| 1 | Ship the code (PR) | merge branch | — (MERGE is byte-identical until step 2) | revert PR |
| 2 | Additive DDL: 7 columns | `bq --project_id=market-assasin query --nouse_legacy_sql --dataset_id=market-assasin:usaspending < tasks/idv-vehicle-foundation/01-ddl-add-columns.sql` | metadata-only (0 bytes when executed on the validation copy) | `99-rollback.sql` §A |
| 3 | Re-pull the DoD hole (all award types), writes identity cols too | `npx tsx scripts/ingest-usaspending-awards.ts --from=2026-01-20` (dry-run, eyeball) then `… --from=2026-01-20 --apply` | ~8 months of all transactions (estimate ~3–4M rows: civilian ~1.5M already present + DoD ~1.9M incl. the ~1.2M missing); raise the poll limit — a 100-day window took ~51 min; ⚠️ `awards` is partitioned by RANGE_BUCKET(fiscal_year), so the MERGE's action_date bound does NOT prune (existing behaviour, see data debt); full recipients rebuild once | §C (restore snapshot) |
| 4 | Historical IDV identity, one FY per run | for FY in 2016..2025: `npx tsx scripts/ingest-usaspending-awards.ts --idv-only --from=<FY-1>-10-01 --to=<FY>-09-30 --apply` (dry-run each first) | 200–312K IDV txns per FY (measured, 2.64M total FY2016–2026); MERGE does not partition-prune (same caveat); no recipients rebuild, no clock stamp | §C |
| 5 | Verify | `05-verify-after-execution.sql` + `npm run verify:oracles -- --only freshness` | reads, < 5 GiB each | — |

`02-backfill-from-current-staging.sql` is OPTIONAL and redundant with step 3 (which re-pulls the
same window with the new columns). It is guarded by ASSERTs that abort if staging was replaced.
Run it with `--dataset_id=market-assasin:usaspending` (tables are unqualified by design).

Mech-Elec II needs step 4 for FY2024 (4 base IDV txns, 2024-08-14) or FY2025 (4 mods,
2025-05-27): none of its IDV transactions are in the current staging window.

If USASpending's bulk endpoint rejects a multi-month range, run step 3 as monthly `--from/--to`
chunks (the `--to` flag exists for this; partial `--to` runs don't stamp freshness clocks).
The acquisition poll limit is `BQ_AWARDS_ACQUISITION_POLL_MINUTES` (a 100-day window measured ~51 min).

## Validation — 01 and 02 EXECUTED rollback-safe (2026-09-23; production never a target)

Runner: `npx tsx tasks/idv-vehicle-foundation/validate-rollback-safe.ts`; full log with every SQL
text, sha256, bytes and per-statement result: `validate-rollback-safe.log.json`.

**Context.** The service account cannot create a dataset (`Access Denied: … bigquery.datasets.create`)
or tables in `nsn` (`bigquery.tables.create denied on dataset market-assasin:nsn`), and `usaspending`
already holds the real `awards`, so a same-named zero-copy CLONE was impossible. Instead the files'
UNQUALIFIED table names resolve to BigQuery **session TEMP tables** copied from production
(`awards WHERE fiscal_year >= 2024` — partition-pruned, 11.3 GiB; `awards_ingest_staging` in full),
with the same partitioning + clustering. The jobs carry **no default dataset**, so an unqualified
name can only be a session temp table. The session was aborted at the end (temp tables dropped).
The only difference from the production run is that resolution: production resolves the same bytes
through `--dataset_id=market-assasin:usaspending`.

Copy fidelity: 17,114,105 rows and Σobligation $2,083,313,710,470.93 in both production FY2024+ and
the copy; staging 855,543 = 855,543.

| Step | SQL executed | Result |
|---|---|---|
| 01 attempt A | `BEGIN TRANSACTION;` + exact 01 file + probe + `ROLLBACK TRANSACTION;` | **Rejected**: `Query error: DDL statements are not supported in a transaction, except for those creating or droping temporary tables or temporary functions. at [30:1]` — the copy was unchanged (51 columns) |
| 01 attempt B | exact 01 file (sha256 `c163e9c4…`), outside a transaction, on the copy | OK, 0 bytes. Columns 51 → **58**; rows 17,114,105 → 17,114,105; Σobligation unchanged; full-row checksum of the 903,491 June–Sept rows over the 51 legacy columns `-8951510374347572432` before and after (identical); all 7 new columns NULL on every row |
| 02 | `BEGIN TRANSACTION;` + exact 02 file (sha256 `e0fe2ec4…`) + probes + `ROLLBACK TRANSACTION;` | both ASSERTs passed; `UPDATE` affected **855,561** rows (= 855,543 staging txns + the 18 duplicated `txn_id`s, see data debt); legacy-column checksum of the window unchanged; rows outside the window touched: **0** |
| 02 probes (inside the txn) | fill of the window | IDV rows 72,024; with solicitation id 63,660 (41,836 distinct IDVs); with ordering end 72,024; with single/multiple flag 72,007; rows with `parent_award_agency_id` 611,191 |
| after ROLLBACK | same fill probe | every new column back to 0 rows; rows / Σobligation unchanged |

Mech-Elec II on the copy — **before** (today's data): 4 holder IDVs found (by UEI), 26 orders,
$8,655,978. **After executing 02**: 4 holder IDVs, **0 groupable by solicitation id, 0 with an
ordering end**, 26 orders, $8,655,978, parent-agency id on 1 of 35 order transactions. 02 changes
nothing for Mech-Elec: none of its IDV transactions and only one of its order transactions is
dated inside the staging window.

## NOT executed — what only steps 3–4 (re-acquisition) would add

- Step 3 (all types from 2026-01-20): live USASpending shows the 11 missing Mech-Elec transactions
  ($8,145,270) and the one past the DoD frontier ($200,038) all carry an action date ≥ 2026-01-20.
  If USASpending serves them in the bulk file as it does in `/transactions`, BQ would hold 31 orders /
  $17,001,286. That is a re-derivation from the live API, not a measurement of a loaded table.
- Step 4 (IDV history, FY2024/FY2025 for Mech-Elec): the four holder IDVs' base (2024-08-14) and
  mod (2025-05-27) transactions would carry `FA850124R0001`, `M` and ordering end 2029-04-23 —
  as live USASpending award detail reports them today. Not measured in BQ.

## Expected after steps 2–4 (second derivation)

- Mech-Elec II: 4 holders grouped by `solicitation_identifier = FA850124R0001`; ordering end
  2029-04-23; `M`; ceiling $95,000,000 shown once; 31 orders / $17,001,286 (USASpending
  `/idvs/amounts` + per-order `/transactions` re-derivation: 100% of live obligations have an
  `action_date ≥ 2026-01-20` or are already in BQ).
- Cohort completeness oracle: `complete` (today: `incomplete`, 3 holes).
- IDV fill (FY24+ active, 188,634 IDVs): solicitation id ≈ staging's 88.4% txn-level rate;
  ordering end ≈ 100%. These are projections from staging fill rates, not measured on `awards`.

## Rollback

`99-rollback.sql` — all statements commented out; uncomment one section. Code: the MERGE is
schema-gated (`resolveIdvIdentityColumnsMode`), so dropping the columns returns ingest to the
legacy statement automatically; a partial schema makes ingest refuse rather than half-write.

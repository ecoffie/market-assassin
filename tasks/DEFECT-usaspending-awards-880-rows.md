# DEFECT — `usaspending_awards` is a corpus-shaped table holding 880 rows

**Filed 2026-08-25, surfaced by the CHAIN-2 trace. P1 infrastructure.**

> "A table named like a corpus but containing 880 rows is dangerous." — Eric

## The measurement

| | |
|---|---|
| rows | **880** |
| distinct recipients | **373** |
| newest `synced_at` | 2026-08-23 |
| enabled `cron_jobs` row | **NONE** — the sync never runs |

The sync route `/api/cron/sync-usaspending-awards` exists and works, but has no enabled
dispatcher row. The 880 rows are whatever a manual invocation once wrote.

## Why it is dangerous rather than merely incomplete

Nothing about the name, the schema, or a query result reveals the table is a sample.
`SELECT … WHERE recipient_name ILIKE '%X%'` returning 0 rows looks identical whether the
contractor has no awards or the table simply does not contain them.

**Measured consequence (CHAIN-2):** `get_contractor_award_history` answered the existential
question "does this contractor have federal award history?" from this table and told a
$20.2M contractor they had none. Of the 789 distinct incumbents we hold award data for in
`recompete_opportunities`, only ~45 appear here — **~94% of contractors we demonstrably
have award data on would be reported as having none.**

## Consumer audit (complete, 2026-08-25)

| consumer | reads the table? | risk |
|---|---|---|
| `src/lib/contractor-sales-history.ts:262` | **YES** — `ILIKE recipient_name` | **the CHAIN-2 defect.** Mitigated by the existence seam (#1351), not by fixing the source |
| `api/cron/sync-usaspending-awards` | writes | the sync itself — unscheduled |
| `scripts/build-naics-vocabulary.ts:250` | **YES** | builds NAICS vocabulary from an 880-row sample. **Unassessed** — vocabulary derived from 373 recipients may be thin or skewed |
| `api/app/vault/prefill/route.ts:57` | **no** — comment says it deliberately uses live REST | safe, and the comment shows someone already knew |
| `src/lib/usaspending/awards-by-uei.ts:8` | **no** — same deliberate bypass | safe |

Two call sites independently chose to bypass this table and left comments explaining why.
That is evidence the problem was known locally but never filed.

## Decide before acting

1. **Backfill or retire?** `recompete_opportunities` already holds 150,691 per-contract rows
   with 100% `incumbent_uei`, and the live USASpending API resolves any UEI on demand. It is
   not obvious this table should exist at all.
2. **If retained, schedule the sync** — an unscheduled sync is worse than no table, because
   the staleness is invisible.
3. **Assess `build-naics-vocabulary`** — the one consumer whose exposure was NOT measured.
   Vocabulary built from 373 recipients may be quietly skewed.

## The generalizable rule

A partial dataset must be **self-describing**. Either the name says so (`*_sample`,
`*_cache`), or a query against it can report its own coverage. Silence from an incomplete
source must never be readable as absence — that is the `count ?? 0` class at table scale.

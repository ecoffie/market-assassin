# Collation version mismatch — runbook (2026-07-16)

**Symptom:** `WARNING: database "postgres" has a collation version mismatch`, SQLSTATE
`01000`, ~142/hr (≈10.9k/day) — Postgres emits it on **every connection**, which is
why it dominates the warning chart.

**Cause:** Postgres records the collation version the database was created with. When the
OS supplies a different glibc/ICU version, it warns. The **documented** triggers are a
change in the underlying collation library — an OS upgrade, or `pg_upgrade` onto binaries
linked against a newer ICU.

**Suspected trigger here (UNVERIFIED):** the Micro→Small compute bump (June 2026). A resize
*can* move the instance to a host image carrying a different glibc, which would fit the
timing — but neither Postgres nor Supabase documents a resize as a cause, and this has not
been confirmed. Treat it as a plausible story, not a finding. Step 1a's version numbers are
the real evidence.

**Why it matters beyond log noise:** a changed collation = changed sort order. Affected:
- **btree indexes on text/varchar** — may be subtly mis-ordered → queries can silently miss
  rows that are really there.
- **UNIQUE constraints on text** — enforced by a collation-sensitive btree. If equality/sort
  semantics shifted, uniqueness can be enforced incorrectly (duplicates slip through).

The warning flags a *possibility*, not confirmed corruption — but it is not cosmetic.

> ⚠️ **The trap:** `ALTER DATABASE postgres REFRESH COLLATION VERSION` on its own makes the
> warning vanish instantly and fixes NOTHING. The Postgres docs are explicit that it "does
> not actually check whether all affected objects have been rebuilt correctly" — it only
> records that the current version is fine. Run it before reindexing and you permanently
> mask a real problem. Rebuild with `REINDEX` **first**, then refresh.
> https://www.postgresql.org/docs/current/sql-altercollation.html

**Not affected:** integer/numeric/timestamp/uuid indexes; hash indexes (not order-based);
and GIN `pg_trgm` indexes (trigram matching isn't sort-order dependent — your
`sam_opportunities` / `federal_contacts` trigram indexes from the June load-reduction
migration are safe). The exposure is text btrees.

---

## STEP 1 — Diagnose (read-only, instant). Run this FIRST.

Tells you the recorded vs actual version, and exactly which indexes are collation-dependent
and how big they are (= how long step 2 takes).

```sql
-- 1a. Recorded vs actual collation version.
SELECT datname,
       datcollate,
       datctype,
       datcollversion                                AS recorded_version,
       pg_database_collation_actual_version(oid)     AS actual_version
  FROM pg_database
 WHERE datname = current_database();

-- 1b. Every collation-dependent index on a USER table, largest first.
--     These are the only ones needing a rebuild.
SELECT i.indexrelid::regclass                        AS index_name,
       t.relname                                     AS table_name,
       pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
       am.amname                                     AS index_type
  FROM pg_index i
  JOIN pg_class t   ON t.oid = i.indrelid
  JOIN pg_class ic  ON ic.oid = i.indexrelid
  JOIN pg_am am     ON am.oid = ic.relam
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public'
   AND EXISTS (SELECT 1 FROM unnest(i.indcollation) c WHERE c <> 0)
 ORDER BY pg_relation_size(i.indexrelid) DESC;

-- 1c. Total bytes to rebuild (rough duration signal).
SELECT pg_size_pretty(COALESCE(SUM(pg_relation_size(i.indexrelid)), 0)) AS total_to_reindex
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public'
   AND EXISTS (SELECT 1 FROM unnest(i.indcollation) c WHERE c <> 0);
```

**If `recorded_version` = `actual_version`** in 1a, the mismatch is already resolved and
you only need step 3. Otherwise continue.

---

## STEP 2 — Reindex CONCURRENTLY (the heavy part)

**Use `CONCURRENTLY`. Do not run a bare `REINDEX DATABASE` on production.**

| | lock taken | app impact |
|---|---|---|
| `REINDEX` (plain) | `ACCESS EXCLUSIVE` on each index | **blocks writes, and blocks reads using that index** — effectively downtime |
| `REINDEX ... CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | reads + writes continue; slower, some perf drag |

Source: https://www.postgresql.org/docs/current/sql-reindex.html

### Two known Supabase gotchas

1. **`REINDEX ... CONCURRENTLY` cannot run inside a transaction block.** If the SQL editor
   wraps statements, you'll get `ERROR: REINDEX CONCURRENTLY cannot run inside a
   transaction block`. If that happens, connect via **psql / the session pooler** using the
   connection string in Dashboard → Connect, and run it there. Run it as the ONLY statement
   in the tab — no other statements, no explicit `BEGIN`.
2. **Statement timeout.** The dashboard cancels long statements
   (`ERROR: canceling statement due to statement timeout`). Raise it for the session first:
   ```sql
   SET statement_timeout = '60min';
   ```
   This must be in the SAME session as the reindex. (Not usable in the same tab as a
   CONCURRENTLY statement if the editor wraps in a transaction — another reason to use psql.)

### Preferred: whole database, one command

```sql
SET statement_timeout = '60min';
REINDEX DATABASE CONCURRENTLY postgres;
```

Note: system catalogs **cannot** be reindexed concurrently and are skipped (Postgres docs:
"REINDEX SYSTEM does not support CONCURRENTLY"). That's fine — catalog indexes on a 3.8 GB
DB are tiny, and the app's exposure is the public text btrees.

### Safer alternative: table-by-table, biggest first

Lets you stop between tables and watch impact. Use the table list from step 1b:

```sql
SET statement_timeout = '60min';
REINDEX TABLE CONCURRENTLY public.sam_opportunities;
REINDEX TABLE CONCURRENTLY public.federal_contacts;
-- …one per table from 1b, run individually
```

### If a concurrent reindex fails partway

It leaves an INVALID index behind. Find and clean:

```sql
-- Find leftovers
SELECT indexrelid::regclass AS invalid_index
  FROM pg_index WHERE NOT indisvalid;

-- '*_ccnew' = failed new build → drop it and retry that table
-- '*_ccold' = rebuild SUCCEEDED, old copy left behind → safe to drop
DROP INDEX CONCURRENTLY public.<name>_ccnew;
```

---

## STEP 3 — Refresh the recorded version (instant, only AFTER step 2)

```sql
ALTER DATABASE postgres REFRESH COLLATION VERSION;
```

---

## STEP 4 — Verify

```sql
-- recorded should now equal actual
SELECT datname, datcollversion AS recorded,
       pg_database_collation_actual_version(oid) AS actual
  FROM pg_database WHERE datname = current_database();

-- no invalid indexes left behind
SELECT count(*) AS invalid_indexes FROM pg_index WHERE NOT indisvalid;
```

Then watch Logs → filter `Status = 01000`. New connections should stop emitting the
warning. The Postgres warning count should fall from ~142/hr to ~0.

---

## Decision note

If you want the log quiet **now** and accept the risk, step 3 alone does it in a second.
That is a real tradeoff, not a shortcut: it permanently masks whether the text indexes are
mis-sorted. Recommendation is step 2 then step 3 — the reindex is the point, the refresh is
just bookkeeping.

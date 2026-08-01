-- NSN parts — wipe duplicates + make the loader idempotent.
--
-- Bug: nsn_part_numbers was loaded with INSERT (no conflict key), so every crashed-and-restarted
-- load run re-inserted the same rows → 29M+ rows with massive duplication (niin 000000057 had 6,930
-- rows for ~4 real parts). TRUNCATE the garbage (instant, reclaims disk — important, we're disk-tight)
-- and add a UNIQUE constraint so the reload can UPSERT (re-runs become harmless no-ops).

truncate table nsn_part_numbers;

-- One row per (niin, part_number, cage_code). company_name is denormalized off cage, so it's not
-- part of identity. A null cage_code is possible; coalesce in the constraint via a normalized
-- expression index is overkill — treat (niin, part_number, cage_code) with nulls as distinct is
-- fine here (a null-cage part is genuinely a different reference row). Use a UNIQUE INDEX that
-- treats nulls as NOT distinct (Postgres 15+) so a repeated null-cage row can't duplicate either.
alter table nsn_part_numbers drop constraint if exists nsn_part_numbers_uniq;
create unique index if not exists nsn_part_numbers_uniq
  on nsn_part_numbers (niin, part_number, cage_code) nulls not distinct;

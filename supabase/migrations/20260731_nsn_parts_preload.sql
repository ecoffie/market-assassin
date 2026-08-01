-- NSN parts — PRE-LOAD: drop the unique index + truncate for a fast bulk INSERT.
--
-- Upsert-on-a-unique-index at 15M rows exhausted the connection pool / hit statement timeouts
-- (each row did an index probe). Standard bulk pattern: load into an UNINDEXED table with plain
-- INSERT, then build the index ONCE afterward (20260731_nsn_parts_reindex.sql). The loader dedups
-- the source in-memory, so no in-load duplicates even without the index.
--
-- Run this, THEN run the loader (--parts-only), THEN run the reindex migration.

drop index if exists nsn_part_numbers_uniq;
truncate table nsn_part_numbers;   -- clears the ~2,468 partial rows from the aborted upsert run

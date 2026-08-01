-- NSN parts — POST-LOAD: rebuild the anti-duplicate unique index after the bulk INSERT.
--
-- Run this AFTER the loader (--parts-only) finishes and the row count is verified (~15M, not 29M).
-- Building the index once over the finished table is far cheaper than maintaining it per-row during
-- the load. If this errors on a duplicate, the source-dedup in the loader missed a case — investigate
-- before forcing (a dup here means the drawer could show a repeated part).
--
-- CONCURRENTLY so it doesn't lock the table against the live app while it builds.

create unique index concurrently if not exists nsn_part_numbers_uniq
  on nsn_part_numbers (niin, part_number, cage_code) nulls not distinct;

-- NSN Intelligence — defer the heavy trigram (GIN) indexes to free disk + de-risk the parts load.
--
-- Context: loading the 7.2M-row nsn_reference + its item_name GIN trigram index filled the prod
-- Supabase disk ("No space left on device"). The GIN trigram indexes are the biggest consumers
-- (~2-6 GB each) and are ONLY needed for FUTURE fuzzy SEARCH surfaces:
--   - nsn_reference.item_name trigram  → "search catalog by item name"
--   - nsn_part_numbers.part_number trigram → "reverse lookup: part # → NSN"
-- Neither is needed by the DLA bid DRAWER, which looks up by NIIN (btree PK / niin index).
--
-- So drop both trigram indexes now: frees the item_name index's disk immediately, and stops the
-- part_number index from building (and blowing the disk again) during the parts bulk load.
-- Re-add them later — AFTER a disk upgrade — only if/when we ship the search/reverse-lookup surface.

drop index if exists nsn_reference_item_name_trgm;
drop index if exists nsn_part_numbers_part_trgm;

-- The btree indexes the drawer/app actually use stay:
--   nsn_reference PK (niin), nsn_reference_nsn_idx, nsn_reference_fsc_idx
--   nsn_part_numbers_niin_idx (the drawer's part lookup), nsn_part_numbers_cage_idx

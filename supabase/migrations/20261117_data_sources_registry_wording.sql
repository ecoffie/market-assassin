-- Data Core PR 1 (2026-11-17): correct misleading registry wording on two data_sources rows.
-- Wording and cadence only. Does NOT touch last_built or record_count (no freshness stamp moves).
-- Idempotent: each UPDATE only changes a row still holding the old text.
--
-- 1. dodaac_directory: the producer is a monthly cron, not "as-published", and freshness is now
--    measured from the table's rows (src/lib/data-sources/table-measured.ts), never from last_built.
-- 2. tier2_sblo: built_from still named ~/Bootcamp/compile-sblo-list.py, the SUPERSEDED scraper that
--    the June 2026 roster replaced (docs/DATA-SOURCES-REGISTRY.md §SBLO lineage). Pointing anyone at
--    it as the producer risks reintroducing regex-scraped contacts.
--
-- Rollback:
--   UPDATE public.data_sources SET refresh_cadence = 'as-published',
--     built_from = 'BigQuery FPDS awards → dodaac_directory', notes = 'Office code → office name'
--   WHERE key = 'dodaac_directory';
--   UPDATE public.data_sources SET built_from =
--     'SBA Prime Directory + DoD CSP + DHS OSDBU + company-site scraping (~/Bootcamp/compile-sblo-list.py)'
--   WHERE key = 'tier2_sblo';

UPDATE public.data_sources
SET refresh_cadence = 'monthly',
    built_from = 'BigQuery FPDS awards → /api/cron/refresh-dodaac-directory (cron 0 9 6 * *) → dodaac_directory',
    notes = 'Office code → office name. Freshness is measured from the table (newest updated_at ≤ 40d and ≥ 90% of rows refreshed), never from last_built — the producer does not stamp it.',
    updated_at = now()
WHERE key = 'dodaac_directory'
  AND refresh_cadence IS DISTINCT FROM 'monthly';

UPDATE public.data_sources
SET built_from = 'MANUAL curation (no automated producer): SBA Prime Directory roster → official legal names → contacts verified against company-published sources → src/data/sblo-roster-2026-06.json. NOT ~/Bootcamp/compile-sblo-list.py (superseded).',
    updated_at = now()
WHERE key = 'tier2_sblo'
  AND built_from LIKE '%compile-sblo-list.py)%';

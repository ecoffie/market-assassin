-- Register the curated federal events catalog (src/data/federal-events-sources.json) with the
-- data_sources registry. It had no row, so nothing ever flagged it stale: on 2026-11-09 its last
-- full review was 2026-04-05. check-data-freshness reads review age from the FILE's
-- lastFullReview (not this last_built), so this row is for the registry/inventory; last_built
-- records the review the row was created from. Idempotent.
INSERT INTO data_sources (key, name, category, built_from, refresh_cadence, record_count, last_built, notes)
VALUES (
  'federal_events_catalog',
  'Federal events catalog (curated series + dated conferences)',
  'built_curated',
  'src/data/federal-events-sources.json — hand-verified against organizer sites',
  'monthly',
  52,
  '2026-11-09',
  'Freshness is derived from the file''s lastFullReview; per-entry verification inside the file. Weekly link check + passed-date check in check-data-freshness.'
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, built_from = EXCLUDED.built_from,
  refresh_cadence = EXCLUDED.refresh_cadence, notes = EXCLUDED.notes, updated_at = now();

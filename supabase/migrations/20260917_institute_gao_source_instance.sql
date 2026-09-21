-- Register the living GAO Institute source in the control plane.
--
-- THE SPLIT:
--   data_sources[strategic_intelligence]  LOGICAL DATASET (Institute / SI corpus)
--   data_source_instances[institute_gao]  MATERIAL UPSTREAM (GAO RSS → institute_sources)
--
-- `data_sources[institute_gao]` already exists and held clocks in a notes sentinel
-- (`[gao-ingest-clocks:v1]`). That sentinel is retired as AUTHORITY once this instance
-- is written by `/api/cron/institute-gao-sync`. The catalogue row stays for discovery;
-- its notes are updated to point here.
--
-- CLOCKS ARE NULL ON PURPOSE at seed. The cron stamps each one only when it has
-- evidence. Seeding now() would be the "stamp ahead of the data" defect.
--
-- upstream_population stays NULL: the GAO RSS feed is a recent-window feed, not an
-- exact complete catalogue of all GAO reports. Recording feed.length as "upstream
-- population" would invent a corpus size. held_population is measured from
-- institute_sources (source_type = gao_report) by the runner.

INSERT INTO data_sources (key, name, category, built_from, refresh_cadence, notes)
VALUES (
  'strategic_intelligence',
  'Strategic Intelligence (Institute document corpus)',
  'built_curated',
  'institute_sources → agency_pain_points_db / intelligence_changes',
  'daily',
  'Living Institute evidence + derived claims. Producer instances live in data_source_instances (institute_gao first). Legacy JSON agency-pain-points.json is a separate fallback surface — not this dataset.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO data_source_instances (
  dataset_key, source_key, name, discovery_url, ingest_mode, owner,
  watch_cadence_days, source_state, intervention_state, manual_action_type, runbook_path,
  upstream_population, held_population
)
VALUES (
  'strategic_intelligence',
  'institute_gao',
  'GAO reports RSS → Institute sources → sourced pain points',
  'https://www.gao.gov/rss/reports.xml',
  'automated',
  'data-core',
  1,
  'unmeasured',
  'none_required',
  NULL,
  'docs/runbooks/institute-gao.md',
  NULL,
  (SELECT count(*)::int FROM institute_sources WHERE source_type = 'gao_report')
)
ON CONFLICT (source_key) DO NOTHING;

-- Point the legacy catalogue row at the instance. Do NOT clear the sentinel yet —
-- the first successful cron stamp on the instance is the cutover proof; readers that
-- still decode notes remain compatible during deploy.
UPDATE data_sources
   SET notes = COALESCE(notes, '')
             || E'\n\n[control-plane] Authority: data_source_instances.source_key=institute_gao '
             || '(dataset strategic_intelligence). Notes sentinel is legacy/compat only.',
       updated_at = NOW()
 WHERE key = 'institute_gao'
   AND notes IS NOT NULL
   AND notes NOT LIKE '%data_source_instances.source_key=institute_gao%';

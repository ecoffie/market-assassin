-- Data Sources registry table (#30) — the Command Center "Data Sources" view,
-- like the Forecast list. Backs docs/DATA-SOURCES-REGISTRY.md so an acquirer's
-- diligence sees every source, its provenance, freshness, and refresh cadence.

CREATE TABLE IF NOT EXISTS data_sources (
  id           BIGSERIAL PRIMARY KEY,
  key          TEXT UNIQUE NOT NULL,         -- 'tier2_sblo', 'dod_command_osbp', 'usaspending_awards'
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,                -- 'live_api' | 'built_curated' | 'reference'
  built_from   TEXT,                          -- official origin / build script
  refresh_cadence TEXT,                       -- 'real-time' | 'quarterly' | 'annual' | 'as-published'
  record_count INTEGER,
  last_built   DATE,
  is_active    BOOLEAN DEFAULT true,
  notes        TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Seed from the registry doc (the verified provenance). Idempotent upserts.
INSERT INTO data_sources (key, name, category, built_from, refresh_cadence, record_count, last_built, notes) VALUES
  ('usaspending_awards', 'USASpending — awards', 'live_api', 'api.usaspending.gov spending_by_category/award', 'real-time', NULL, NULL, 'Market totals, suggest-codes $, teaming primes, bid/no-bid, IDV/IDIQ, office drill-down'),
  ('sam_opportunities', 'SAM.gov opportunities + POCs', 'live_api', 'api.sam.gov + federal_contacts cache', 'real-time', 123255, NULL, 'Solicitations + contracting POCs'),
  ('grants_gov', 'Grants.gov', 'live_api', 'api.grants.gov/v1/api/search2', 'real-time', NULL, NULL, 'Federal grants'),
  ('tier2_sblo', 'Tier-2 / SBLO contractor DB', 'built_curated', 'SBA Prime Directory + DoD CSP + DHS OSDBU + company-site scraping (~/Bootcamp/compile-sblo-list.py)', 'quarterly', 2768, '2025-12-23', 'The 2,700+ contractor DB behind database-locked'),
  ('dod_command_osbp', 'DoD command / OSBP directory', 'reference', 'src/data/dod-command-info.json (gov org hierarchy)', 'quarterly', 170, '2025-12-27', 'Structure stable; director name rotates'),
  ('agency_pain_points', 'Agency pain points / intelligence', 'built_curated', 'GAO high-risk reports + NDAA (scripts/merge-agency-intelligence.js, ~/Bootcamp/scan-ndaa-sections.py)', 'quarterly', 3045, '2026-04-01', '307 agencies; every pain point cites a public oversight doc'),
  ('forecast_intelligence', 'Forecast intelligence', 'built_curated', '13 agency forecast portals (Excel/CSV/Puppeteer)', 'as-published', 7764, NULL, 'See forecast_sources table for per-source detail'),
  ('dodaac_directory', 'DoDAAC directory', 'reference', 'BigQuery FPDS awards → dodaac_directory', 'as-published', NULL, '2026-06-01', 'Office code → office name')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, built_from = EXCLUDED.built_from,
  refresh_cadence = EXCLUDED.refresh_cadence, record_count = EXCLUDED.record_count,
  last_built = EXCLUDED.last_built, notes = EXCLUDED.notes, updated_at = now();

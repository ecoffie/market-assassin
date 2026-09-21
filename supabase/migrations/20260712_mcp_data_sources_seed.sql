-- Seed the three Mindy MCP live-API sources into data_sources (2026-07-12).
-- Mirrors the 20260608_data_sources_registry.sql idempotent-upsert shape. These
-- are LIVE PASSTHROUGH sources (no mirrored row count we can claim as ours) —
-- record_count reflects the upstream's own size where known (CALC ~240K),
-- NULL where the live count isn't ours to state (EDGAR / Federal Register).
-- category='live_api', refresh_cadence='real-time' (fetched on demand, cached
-- short-TTL in mcp_external_cache — NOT a cron-mirrored dataset).

INSERT INTO data_sources (key, name, category, built_from, refresh_cadence, record_count, last_built, notes) VALUES
  ('gsa_calc_pricing', 'GSA CALC+ — pricing intel', 'live_api', 'api.gsa.gov/acquisition/calc/v3/api/ceilingrates (MCP get_pricing_intel)', 'real-time', 240000, NULL, 'Price-to-win labor rates p25/p50/p75, small-vs-large gap, top vendors. ~240K awarded labor categories, daily refresh, keyless. Response cache 12h (mcp_external_cache).'),
  ('sec_edgar_financials', 'SEC EDGAR — incumbent financials', 'live_api', 'www.sec.gov/files/company_tickers.json + data.sec.gov/companyfacts + submissions (MCP get_incumbent_financials)', 'real-time', NULL, NULL, 'Public filers only — private contractors return grounded=false (no invented figures). Revenue/net income/gross margin/public float/employees/latest 10-K. Keyless, requires User-Agent. Cache 24h/6h.'),
  ('federal_register', 'Federal Register — regulatory demand', 'live_api', 'federalregister.gov/api/v1/documents.json (MCP get_regulatory_demand)', 'real-time', NULL, NULL, '"Demand before SAM" leading indicator — proposed/final rules precede solicitations 6-18mo. Does NOT tag items to NAICS (inference only). Keyless. Cache 1h.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, built_from = EXCLUDED.built_from,
  refresh_cadence = EXCLUDED.refresh_cadence, record_count = EXCLUDED.record_count,
  last_built = EXCLUDED.last_built, notes = EXCLUDED.notes, updated_at = now();
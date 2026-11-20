-- NEEDS ERIC'S AUTHORIZATION. Do not apply in this change.
-- Does not DELETE rows. Clears only the NAICS the 2026-04-05 collector wrote
-- onto six hardcoded DARPA ids. Grants.gov did not provide 541715.
--
--   npm run migrate -- --go --only 20261119_clear_manufactured_darpa_naics.sql
--
-- Until this runs, customer reads already withhold these six rows
-- (search_sbir and the briefings multisite pipeline) while naics_code is 541715.

UPDATE public.aggregated_opportunities
SET naics_code = NULL,
    updated_at = NOW()
WHERE source = 'darpa_baa'
  AND naics_code = '541715'
  AND external_id IN (
    'HR001125S0013',
    'HR001126S0003',
    'HR001125S0011',
    'HR001126S0001',
    'HR001126S0008',
    'DARPARA2601'
  );

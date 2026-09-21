-- Forecast Search Analytics
-- Tracks what NAICS codes users search for to prioritize future database builds

CREATE TABLE IF NOT EXISTS forecast_search_analytics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  naics_code text NOT NULL,
  naics_prefix text GENERATED ALWAYS AS (LEFT(naics_code, 2)) STORED,
  search_count int DEFAULT 1,
  results_count int DEFAULT 0,
  zero_results_count int DEFAULT 0,  -- Track demand for codes with no matches
  last_searched_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(naics_code)
);

-- Index for finding high-demand codes with no results
CREATE INDEX idx_forecast_search_zero_results ON forecast_search_analytics(zero_results_count DESC) WHERE zero_results_count > 0;

-- Index for finding most searched codes
CREATE INDEX idx_forecast_search_count ON forecast_search_analytics(search_count DESC);

-- View to identify gaps in coverage (high demand, low/no results)
CREATE OR REPLACE VIEW forecast_coverage_gaps AS
SELECT
  naics_code,
  naics_prefix,
  search_count,
  results_count,
  zero_results_count,
  CASE
    WHEN results_count = 0 THEN 'NO COVERAGE'
    WHEN results_count < 10 THEN 'LOW COVERAGE'
    WHEN results_count < 50 THEN 'MODERATE'
    ELSE 'GOOD'
  END as coverage_status,
  last_searched_at
FROM forecast_search_analytics
WHERE search_count > 1
ORDER BY
  CASE WHEN results_count = 0 THEN 0 ELSE 1 END,
  search_count DESC;

COMMENT ON TABLE forecast_search_analytics IS 'Tracks NAICS code searches to identify coverage gaps for future forecast database builds';

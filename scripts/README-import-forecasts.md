# Forecast Intelligence Import Script

## Overview

The `import-forecasts.js` script automates downloading and importing federal agency forecast Excel files into the `agency_forecasts` Supabase table. It handles Phase 1 agencies (DOE, NASA, DOJ) with built-in Excel parsing, normalization, and upsert logic.

## Features

- **Automatic Downloads**: Fetches Excel files directly from agency URLs
- **Excel Parsing**: Uses `xlsx` library to parse agency-specific formats
- **Data Normalization**: Standardizes NAICS codes, fiscal years, set-aside types, and value ranges
- **Upsert Logic**: Prevents duplicates using `(source_agency, external_id)` unique constraint
- **Batch Processing**: Imports in 100-record batches to avoid memory issues
- **Sync Tracking**: Logs all imports to `forecast_sync_runs` table
- **Dry Run Mode**: Preview records without writing to database

## Usage

```bash
# Full import: Download all sources and import to Supabase
node scripts/import-forecasts.js

# Import specific source only
node scripts/import-forecasts.js --source=DOE
node scripts/import-forecasts.js --source=NASA
node scripts/import-forecasts.js --source=DOJ

# Dry run: Preview data without writing to database
node scripts/import-forecasts.js --dry-run

# Skip download: Use existing local files (if already downloaded)
node scripts/import-forecasts.js --skip-download

# Combine flags
node scripts/import-forecasts.js --source=NASA --dry-run
```

## Phase 1 Sources

### DOE (Department of Energy)
- **URL**: https://www.energy.gov/sites/default/files/2024-10/DOE%20Forecast%20of%20Contracting%20Opportunities%20October%202024.xlsx
- **Local Path**: `tmp/forecasts/doe-forecast.xlsx`
- **Header Row**: 16 (0-indexed, row 17 in Excel)
- **Key Columns**:
  - Performance End Date
  - NAICS Code, NAICS Description
  - Program Office
  - Current Incumbent, Current Contract Number
  - Acquisition Description
  - Estimated Value Range (e.g., "R2 – $250K–$7.5M")
  - Contracting Officers Business Size Selection
  - Type of Set Aside
  - Contract Type
  - Principal Place of Performance State
  - Small Business Program Manager

### NASA
- **URL**: https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx
- **Local Path**: `tmp/forecasts/nasa-agency.xlsx`
- **Header Row**: 0
- **Key Columns**:
  - Buying Office
  - Acquisition Status
  - ID, Title of Requirement
  - POC Email Address, POC Name
  - NAICS Code
  - Product Service Code, PSC Category
  - Anticipated FY of Award, Anticipated Qtr of Award
  - Value
  - Socio Economic Preference
  - Type of Requirement, Competition
  - Detailed Description (synopsis)
  - Incumbent Contractor, Incumbent Contract #
  - Period of Performance

### DOJ (Department of Justice)
- **URL**: https://www.justice.gov/media/1381791/dl
- **Local Path**: `tmp/forecasts/doj-forecast.xlsx`
- **Sheet Name**: "Contracting Opportunities Curre"
- **Header Row**: 0
- **Key Columns**:
  - Fiscal Year
  - Action Tracking Number
  - Bureau, OBD, Contracting Office
  - DOJ Small Business POC - Name, Email Address
  - DOJ Requirement POC - Name, Phone Number, Email Address
  - FBO Notice Title, FBO Description
  - NAICS Code
  - Current Incumbent, Current Contract or PO Number
  - Estimated Total Value ($)
  - Set-Aside Type
  - Anticipated Quarter of Award

## Data Normalization

### NAICS Code
- **Input**: "541512 - Computer Systems Design", "541512", "54-1512"
- **Output**: "541512" (numeric only, 4-6 digits)

### Fiscal Year
- **Input**: "FY2026", "2026", "26", "FY26"
- **Output**: "FY2026" (standardized format)

### Set-Aside Type
- **Input**: "8(a) Business Development", "Total Small Business", "Service-Disabled Veteran-Owned"
- **Output**: "8(a)", "Small Business", "SDVOSB" (canonical names)
- **Mappings**:
  - `8(a)` - 8(a) Business Development
  - `HUBZone` - Historically Underutilized Business Zone
  - `SDVOSB` - Service-Disabled Veteran-Owned Small Business
  - `VOSB` - Veteran-Owned Small Business
  - `WOSB` - Women-Owned Small Business
  - `Small Business` - Total Small Business Set-Aside
  - `Full & Open` - Unrestricted Competition
  - `Sole Source` - Sole Source

### Value Range
- **Input**: "$250K–$7.5M", "$5M - $25M", "5000000"
- **Output**:
  - `estimated_value_min`: 250000
  - `estimated_value_max`: 7500000
  - `estimated_value_range`: "$250K–$7.5M" (preserved original text)

### Status
- **Input**: "Awarded", "Pre-Solicitation", "RFP Released", "Withdrawn"
- **Output**: `awarded`, `pre-solicitation`, `solicitation`, `cancelled`, `forecast` (default)

## Database Schema

### Main Table: `agency_forecasts`

```sql
CREATE TABLE agency_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source_agency TEXT NOT NULL,                    -- DOE, NASA, DOJ
  source_type TEXT NOT NULL DEFAULT 'excel',      -- excel, puppeteer, api
  source_url TEXT,
  external_id TEXT,                               -- Agency's tracking number

  -- Core data
  title TEXT NOT NULL,
  description TEXT,

  -- Agency/Office hierarchy
  department TEXT,
  bureau TEXT,
  contracting_office TEXT,
  program_office TEXT,

  -- Classification
  naics_code TEXT,
  naics_description TEXT,
  psc_code TEXT,
  psc_description TEXT,

  -- Timing
  fiscal_year TEXT,
  anticipated_quarter TEXT,
  anticipated_award_date DATE,
  solicitation_date DATE,
  performance_end_date DATE,

  -- Value
  estimated_value_min BIGINT,
  estimated_value_max BIGINT,
  estimated_value_range TEXT,

  -- Contract details
  contract_type TEXT,
  set_aside_type TEXT,
  competition_type TEXT,

  -- Incumbent
  incumbent_name TEXT,
  incumbent_contract_number TEXT,

  -- Contact
  poc_name TEXT,
  poc_email TEXT,
  poc_phone TEXT,

  -- Place of performance
  pop_state TEXT,
  pop_city TEXT,
  pop_zip TEXT,
  pop_country TEXT DEFAULT 'USA',

  -- Status
  status TEXT DEFAULT 'forecast',

  -- Metadata
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),

  -- Deduplication
  UNIQUE(source_agency, external_id)
);
```

### Tracking Table: `forecast_sync_runs`

Logs every import run with:
- `source_agency`, `source_type`, `run_type` (full/incremental)
- `status` (running/completed/failed)
- `records_fetched`, `records_added`, `records_updated`
- `started_at`, `completed_at`
- `error_message` (if failed)

### Configuration Table: `forecast_sources`

Tracks all known forecast sources with:
- `agency_code`, `agency_name`
- `source_type` (excel_direct, puppeteer, api)
- `source_url`
- `sync_frequency` (daily, weekly, monthly)
- `is_active` (true for Phase 1: DOE, NASA, DOJ)
- `estimated_spend_coverage` (% of federal procurement)
- `last_sync_at`, `last_success_at`, `consecutive_failures`

## Expected Record Counts (Phase 1)

| Agency | Estimated Records | Spend Coverage |
|--------|-------------------|----------------|
| DOE    | ~1,500           | 3.5%           |
| NASA   | ~2,000           | 2.5%           |
| DOJ    | ~1,200           | 3.0%           |
| **Total** | **~4,700**    | **9.0%**       |

## Error Handling

### Download Errors
- **HTTP 301/302**: Follows redirects automatically
- **HTTP 404/500**: Logs error and skips source
- **Network timeout**: Retries are NOT automatic (run script again)

### Parse Errors
- **Missing headers**: Logs error and skips file
- **Invalid NAICS**: Skips row (NAICS is required)
- **Empty rows**: Skips automatically

### Database Errors
- **Duplicate external_id**: Upsert updates existing record
- **Constraint violations**: Logs error and skips batch
- **Connection errors**: Script exits with error code

## Monitoring

### Check Import Status
```sql
-- Recent sync runs
SELECT
  source_agency,
  status,
  records_added,
  started_at,
  completed_at
FROM forecast_sync_runs
ORDER BY started_at DESC
LIMIT 10;

-- Coverage dashboard
SELECT * FROM forecast_coverage_dashboard
WHERE is_active = true;

-- Records by agency
SELECT
  source_agency,
  COUNT(*) as total_records,
  COUNT(DISTINCT naics_code) as unique_naics,
  MIN(created_at) as first_import,
  MAX(last_synced_at) as last_sync
FROM agency_forecasts
GROUP BY source_agency;
```

### API Endpoint
```bash
# View forecast sources (requires auth)
curl "https://tools.govcongiants.org/api/forecasts/sources"

# Search forecasts by NAICS
curl "https://tools.govcongiants.org/api/forecasts?naics=541512"

# Admin: Trigger import (future feature)
curl -X POST "https://tools.govcongiants.org/api/admin/sync-forecasts?password=galata-assassin-2026&source=DOE"
```

## Troubleshooting

### "File not found" error
```bash
# Option 1: Remove --skip-download flag
node scripts/import-forecasts.js

# Option 2: Manually download and place in tmp/forecasts/
mkdir -p tmp/forecasts
# Download files manually to tmp/forecasts/doe-forecast.xlsx, etc.
node scripts/import-forecasts.js --skip-download
```

### "Missing Supabase credentials" error
```bash
# Check .env.local has:
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

### "Batch error" during upsert
- Check `forecast_sync_runs` table for `error_message`
- Verify table schema matches migration
- Run migration: `node scripts/run-forecast-migration.js`

### Empty results
- Run with `--dry-run` to see if records are parsed
- Check header row index (some files have blank rows at top)
- Verify sheet name for DOJ ("Contracting Opportunities Curre")

## Future Enhancements

### Phase 2: Puppeteer Sources
- GSA Acquisition Gateway (~5,000 records, 8% coverage)
- Requires headless Chrome for dynamic content

### Phase 3: Additional Excel Sources
- VA, DHS, HHS, Treasury (~10,000 records, 22% coverage)
- Similar to Phase 1 but with different column mappings

### Phase 4: DOD Multi-Source
- APEX, DIBBS, Navy SeaPort, Air Force BCF (~20,000+ records, 40% coverage)
- Requires API keys and specialized parsing

### Automation
- Scheduled cron job at `/api/cron/sync-forecasts`
- Weekly sync for all active sources
- Email alerts on failures
- Slack notifications for new forecasts in target NAICS

## Related Files

| File | Purpose |
|------|---------|
| `scripts/import-forecasts.js` | Main import script |
| `scripts/run-forecast-migration.js` | Run database migration |
| `supabase/migrations/20260405_forecast_intelligence.sql` | Table schema |
| `src/lib/forecasts/types.ts` | TypeScript types and helpers |
| `src/lib/forecasts/scrapers/index.ts` | Scraper orchestration (Phase 2+) |
| `src/app/api/forecasts/route.ts` | API endpoint for searching forecasts |
| `docs/intelligence-systems/forecasts.md` | System documentation |

## Support

- **Errors**: Check `forecast_sync_runs.error_message` in database
- **Questions**: service@govcongiants.com
- **Slack**: #forecast-intelligence channel

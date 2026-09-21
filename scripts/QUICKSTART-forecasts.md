# Forecast Import - Quick Start Guide

## 5-Minute Setup

### Step 1: Test Download (Optional)
```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
node scripts/test-forecast-download.js
```

This downloads NASA's forecast file as a test. If it works, you're good to go!

### Step 2: Dry Run (Preview Data)
```bash
node scripts/import-forecasts.js --dry-run
```

This will:
- Download all 3 Excel files (DOE, NASA, DOJ)
- Parse and normalize the data
- Show sample records
- **NOT** write to database

### Step 3: Full Import
```bash
node scripts/import-forecasts.js
```

This will:
- Download all 3 Excel files
- Parse and normalize data
- Write ~4,700 records to `agency_forecasts` table
- Log sync runs to `forecast_sync_runs` table

Expected output:
```
🚀 FORECAST INTELLIGENCE IMPORT
================================

============================================================
Importing Department of Energy (DOE)
============================================================
  Downloading from https://www.energy.gov/...
  Downloaded 1,234.5 KB
  Sheet: Sheet1
  Total rows: 1,543
  Headers: Performance End Date, NAICS Code, NAICS Description...
  Parsed: 1,487 records
  Skipped: 56 rows
  Imported 1487/1487...
  ✅ Added/Updated: 1487
  ❌ Errors: 0

[... NASA and DOJ ...]

============================================================
IMPORT COMPLETE
============================================================
Total records: 4,729
Total errors: 0

Database total: 4,729 forecasts

Active sources:
  DOE: 1,487 records (3.5% spend coverage)
  NASA: 2,056 records (2.5% spend coverage)
  DOJ: 1,186 records (3.0% spend coverage)

Total spend coverage: 9.0%
```

## Common Commands

```bash
# Import just DOE
node scripts/import-forecasts.js --source=DOE

# Import just NASA
node scripts/import-forecasts.js --source=NASA

# Import just DOJ
node scripts/import-forecasts.js --source=DOJ

# Dry run for NASA only
node scripts/import-forecasts.js --source=NASA --dry-run

# Skip download (use existing files)
node scripts/import-forecasts.js --skip-download
```

## Verify Import in Database

```sql
-- Check record counts
SELECT
  source_agency,
  COUNT(*) as total,
  COUNT(DISTINCT naics_code) as unique_naics
FROM agency_forecasts
GROUP BY source_agency;

-- Check recent sync runs
SELECT
  source_agency,
  status,
  records_added,
  started_at,
  completed_at
FROM forecast_sync_runs
ORDER BY started_at DESC
LIMIT 5;

-- Sample forecasts
SELECT
  source_agency,
  title,
  naics_code,
  fiscal_year,
  set_aside_type,
  estimated_value_range
FROM agency_forecasts
LIMIT 10;

-- Search by NAICS
SELECT
  source_agency,
  title,
  fiscal_year,
  set_aside_type
FROM agency_forecasts
WHERE naics_code = '541512';
```

## Troubleshooting

### "Missing Supabase credentials"
Check `.env.local` has:
```env
NEXT_PUBLIC_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...
```

### Download fails (network error)
- Check internet connection
- Try again (agency sites can be slow)
- Manually download and use `--skip-download`

### "File not found" with `--skip-download`
Files must be in: `tmp/forecasts/doe-forecast.xlsx`, etc.

### Parse errors ("Batch error")
- Check `forecast_sync_runs.error_message` in database
- Verify migration ran: `node scripts/run-forecast-migration.js`

## What Gets Created

### Files Downloaded
```
tmp/forecasts/
├── doe-forecast.xlsx       (~1.2 MB)
├── nasa-agency.xlsx        (~800 KB)
└── doj-forecast.xlsx       (~600 KB)
```

### Database Records
- **agency_forecasts**: 4,700+ forecast records
- **forecast_sync_runs**: 3 sync run logs
- **forecast_sources**: Already seeded (11 agencies)

## Next Steps

### Query the API
```bash
# Search by NAICS
curl "https://tools.govcongiants.org/api/forecasts?naics=541512"

# Search by agency
curl "https://tools.govcongiants.org/api/forecasts?agency=NASA"

# Search by set-aside
curl "https://tools.govcongiants.org/api/forecasts?setAside=8(a)"

# Full-text search
curl "https://tools.govcongiants.org/api/forecasts?search=cybersecurity"
```

### Schedule Regular Syncs
Add to cron (weekly on Sundays at 2 AM):
```bash
0 2 * * 0 cd /path/to/market-assassin && node scripts/import-forecasts.js >> logs/forecast-import.log 2>&1
```

Or create Vercel cron endpoint:
```typescript
// src/app/api/cron/sync-forecasts/route.ts
export async function GET(request: Request) {
  // Run import script via child_process.exec()
  // Send email on failure
}
```

### Build UI Features
- Search page at `/forecasts`
- Email alerts for new forecasts in user's NAICS
- Win probability scoring (like briefings)
- "Watchlist" for specific agencies/NAICS

## Support

- Full docs: `scripts/README-import-forecasts.md`
- System docs: `docs/intelligence-systems/forecasts.md`
- Questions: service@govcongiants.com

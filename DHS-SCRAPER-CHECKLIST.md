# DHS Scraper - Deployment Checklist

## Pre-Flight Checks

### ✅ Code Implementation
- [x] Scraper file created/updated: `src/lib/forecasts/scrapers/dhs-apfs.ts`
- [x] API interception strategy implemented
- [x] Table scraping fallback implemented
- [x] Field mapping for DHS data structure
- [x] Error handling and logging
- [x] Proper TypeScript types (ForecastRecord)
- [x] Exported in index: `src/lib/forecasts/scrapers/index.ts`

### ✅ Testing Infrastructure
- [x] Test script created: `scripts/test-dhs-scraper.ts`
- [x] Multiple test modes: basic, verbose, save
- [x] Data quality analysis
- [x] Performance metrics
- [x] Exit codes for CI/CD

### ✅ Documentation
- [x] Main README: `src/lib/forecasts/scrapers/README.md`
- [x] DHS usage guide: `src/lib/forecasts/scrapers/DHS-USAGE.md`
- [x] Build summary: `SCRAPER-BUILD-SUMMARY.md`
- [x] Quick start: `QUICK-START-DHS-SCRAPER.md`
- [x] Deployment checklist: This file

### ✅ Dependencies
- [x] Puppeteer installed (v24.40.0 confirmed)
- [x] TypeScript configured
- [x] TSX available for testing
- [x] Node.js compatible

### ✅ Integration
- [x] Registered in SCRAPERS registry
- [x] Compatible with import script
- [x] Matches ForecastRecord interface
- [x] Database schema compatible

---

## Testing Plan

### 1. Unit Test (5 minutes)

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npx tsx scripts/test-dhs-scraper.ts
```

**Expected:**
- Success: true
- Records: 100-500
- Errors: 0
- Timing: 15-30s
- Data quality >75%

**If fails:** Check documentation troubleshooting section

### 2. Save Test (2 minutes)

```bash
npx tsx scripts/test-dhs-scraper.ts --save test-output.json
```

**Verify:**
- File created: `test-output.json`
- Valid JSON format
- Contains array of records
- Records match schema

### 3. Verbose Test (Optional)

```bash
npx tsx scripts/test-dhs-scraper.ts --verbose
```

**Verify:**
- All records displayed
- No parsing errors
- Fields populated correctly

### 4. Integration Test (10 minutes)

```bash
# Dry run (no database writes)
node scripts/import-forecasts.js --source=DHS --dry-run
```

**Expected:**
- Scraper runs successfully
- Records parsed
- No database errors
- Preview shows correct count

### 5. Database Import (Production)

```bash
# ONLY RUN AFTER DRY RUN SUCCEEDS
node scripts/import-forecasts.js --source=DHS
```

**Verify:**
- Records inserted to `agency_forecasts` table
- No duplicates (external_id constraint)
- `forecast_sync_runs` table updated
- Data visible in `/forecasts` UI

---

## Deployment Steps

### Step 1: Verify Environment

```bash
# Check Node.js version
node --version  # Should be v18+

# Check Puppeteer
npm list puppeteer

# Check TypeScript
npx tsc --version
```

### Step 2: Run Unit Tests

```bash
npx tsx scripts/test-dhs-scraper.ts
```

**Pass criteria:** Records > 50, Errors = 0

### Step 3: Run Dry Import

```bash
node scripts/import-forecasts.js --source=DHS --dry-run
```

**Pass criteria:** No errors, preview shows data

### Step 4: Import to Database

```bash
node scripts/import-forecasts.js --source=DHS
```

**Pass criteria:** Records saved, sync run logged

### Step 5: Verify in UI

```bash
# Visit forecast page
open https://tools.govcongiants.org/forecasts

# Filter by DHS
# Verify records appear
# Check data completeness
```

### Step 6: Set Up Cron (Optional)

```typescript
// In vercel.json or cron config
{
  "crons": [
    {
      "path": "/api/cron/sync-forecasts?source=DHS&password=galata-assassin-2026",
      "schedule": "0 2 * * *" // 2 AM daily
    }
  ]
}
```

---

## Success Metrics

### Minimum Viable

- ✅ Scraper runs without errors
- ✅ Extracts >50 records
- ✅ Data saves to database
- ✅ Records visible in UI

### Production Ready

- ✅ Extracts 100+ records
- ✅ 80%+ data quality (NAICS, value, location)
- ✅ <30s execution time
- ✅ 95%+ success rate over 7 days
- ✅ Error monitoring in place

### Excellence

- ✅ Extracts 200+ records
- ✅ 90%+ data quality
- ✅ <20s execution time
- ✅ 99%+ success rate over 30 days
- ✅ Automated alerts on failures

---

## Rollback Plan

If scraper fails in production:

### Option 1: Disable Scraper

```typescript
// In scrapers/index.ts
export const SCRAPERS = {
  // DHS: { ... }, // Comment out
  // ...
};
```

### Option 2: Revert to Previous Version

```bash
git log src/lib/forecasts/scrapers/dhs-apfs.ts
git checkout <previous-hash> src/lib/forecasts/scrapers/dhs-apfs.ts
```

### Option 3: Manual Import

Use Excel import for DHS data if available:
```bash
node scripts/import-forecasts.js --source=DHS --excel
```

---

## Monitoring

### Daily Health Check

```bash
# Run test script
npx tsx scripts/test-dhs-scraper.ts

# Check success
if [ $? -eq 0 ]; then
  echo "✓ DHS scraper healthy"
else
  echo "✗ DHS scraper failed"
  # Send alert
fi
```

### Weekly Audit

```sql
-- Check record count
SELECT COUNT(*) FROM agency_forecasts WHERE source_agency = 'DHS';

-- Check freshness
SELECT MAX(updated_at) FROM agency_forecasts WHERE source_agency = 'DHS';

-- Check data quality
SELECT
  COUNT(*) as total,
  COUNT(naics_code) as with_naics,
  COUNT(estimated_value_min) as with_value,
  COUNT(pop_state) as with_location
FROM agency_forecasts
WHERE source_agency = 'DHS';
```

### Alerting

Set up alerts for:
- Scraper failures (error rate >5%)
- Record count drops (>20% decrease)
- Execution time spikes (>60s)
- Data quality degradation (<70%)

---

## Support

### Documentation
- **Usage:** src/lib/forecasts/scrapers/DHS-USAGE.md
- **General:** src/lib/forecasts/scrapers/README.md
- **Summary:** SCRAPER-BUILD-SUMMARY.md

### Key Files
- **Scraper:** src/lib/forecasts/scrapers/dhs-apfs.ts
- **Test:** scripts/test-dhs-scraper.ts
- **Types:** src/lib/forecasts/types.ts

### Troubleshooting
See DHS-USAGE.md section "Troubleshooting" for common issues and solutions.

---

## Sign-Off

- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Documentation complete
- [ ] Database schema verified
- [ ] UI displays data correctly
- [ ] Monitoring configured
- [ ] Team notified

**Deployed by:** _____________
**Date:** _____________
**Status:** _____________

---

*Checklist Version: 1.0*
*Last Updated: April 5, 2026*

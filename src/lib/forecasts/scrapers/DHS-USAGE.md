# DHS APFS Scraper - Usage Guide

## Quick Start

```bash
# Test the scraper
npx tsx scripts/test-dhs-scraper.ts

# Save results to file
npx tsx scripts/test-dhs-scraper.ts --save output/dhs-results.json

# Verbose mode (show all records)
npx tsx scripts/test-dhs-scraper.ts --verbose
```

## Programmatic Usage

```typescript
import { scrapeDHS } from '@/lib/forecasts/scrapers/dhs-apfs';

const result = await scrapeDHS();

console.log(`Success: ${result.success}`);
console.log(`Records: ${result.records.length}`);
console.log(`Errors: ${result.errors.length}`);

// Access individual records
result.records.forEach(record => {
  console.log(record.title);
  console.log(record.bureau);
  console.log(record.naics_code);
  console.log(record.estimated_value_range);
});
```

## What It Does

The DHS APFS scraper collects procurement forecast data from the Department of Homeland Security's Acquisition Planning Forecast System.

**Target URL:** https://apfs-cloud.dhs.gov/forecast/

### Two-Stage Strategy

1. **API Interception (Primary)** - Captures AJAX requests to `/api/forecast/` endpoint
   - Fastest and most reliable
   - Gets complete, structured data
   - No HTML parsing required

2. **Table Scraping (Fallback)** - Parses rendered DataTable if API fails
   - Extracts data from visible table
   - Handles pagination
   - More brittle but works as backup

## Expected Output

### Success Case

```typescript
{
  success: true,
  agency: 'DHS',
  records: [
    {
      source_agency: 'DHS',
      source_type: 'api',
      source_url: 'https://apfs-cloud.dhs.gov/forecast/',
      external_id: 'DHS-APFS-123456',

      title: 'Cybersecurity Operations Center Support',
      description: null,

      department: 'Department of Homeland Security',
      bureau: 'CISA',
      contracting_office: null,

      naics_code: '541512',
      psc_code: null,

      anticipated_award_date: '2026-Q3',
      solicitation_date: '2026-Q3',

      estimated_value_min: 5000000,
      estimated_value_max: 25000000,
      estimated_value_range: '$5M - $25M',

      contract_type: 'IDIQ',
      set_aside_type: 'Small Business',

      incumbent_name: null,

      pop_city: 'Washington',
      pop_state: 'DC',
      pop_country: 'USA',

      poc_name: null,
      poc_email: null,
      poc_phone: null,

      status: 'forecast',
      raw_data: '{...}'
    },
    // ... more records
  ],
  errors: [],
  timing: 15234
}
```

### Failure Case

```typescript
{
  success: false,
  agency: 'DHS',
  records: [],
  errors: [
    'Table not found after 30s wait',
    'No API data intercepted'
  ],
  timing: 45000
}
```

## Data Fields

### Core Fields (Always Present)

- `source_agency` - Always "DHS"
- `source_type` - "api" or "puppeteer"
- `external_id` - Unique identifier (APFS Number or generated)
- `title` - Requirement title
- `status` - Always "forecast"

### Common Fields (Usually Present)

- `bureau` - Component (CISA, FEMA, CBP, ICE, TSA, etc.)
- `naics_code` - NAICS code (cleaned to 6 digits)
- `estimated_value_range` - Dollar range as string
- `estimated_value_min` - Minimum value in dollars
- `estimated_value_max` - Maximum value in dollars
- `contract_type` - Contract type (IDIQ, FFP, T&M, etc.)
- `pop_state` - State abbreviation
- `pop_city` - City name

### Optional Fields (Sometimes Present)

- `description` - Detailed description
- `contracting_office` - Specific contracting office
- `psc_code` - Product/Service Code
- `set_aside_type` - Set-aside type
- `incumbent_name` - Current contractor
- `poc_name`, `poc_email`, `poc_phone` - Point of contact
- `anticipated_award_date` - Expected award date
- `solicitation_date` - Expected solicitation date

## Typical Performance

- **Records:** 100-500 forecasts (varies by season)
- **Time:** 15-30 seconds
- **Success Rate:** ~95% (API interception works most of the time)

## Common Issues

### 1. Timeout Errors

**Symptom:** "Table not found after 30s wait"

**Solution:**
- Site may be slow - try again later
- Increase timeout in config
- Check if site is accessible manually

### 2. No Data Extracted

**Symptom:** `records: []` with no errors

**Solution:**
- API endpoint may have changed
- Check browser DevTools for new endpoint
- Update API URL in scraper config

### 3. Partial Data

**Symptom:** Only getting 25-50 records instead of hundreds

**Solution:**
- Pagination not working
- Page length selector changed
- Need to click through multiple pages

### 4. Parse Errors

**Symptom:** Many "Parse error: ..." in errors array

**Solution:**
- Field names changed on DHS site
- Update field mapping in `parseDHSAPIRecord()`
- Check raw_data to see actual structure

## Maintenance

### When to Update

Update the scraper if:
- Site redesign changes selectors
- API endpoint changes
- New fields become available
- Field names change

### Where to Update

1. **API URL:** `DHS_CONFIG.api_url`
2. **Selectors:** `DHS_CONFIG.waitForSelector`
3. **Field Mapping:** `parseDHSAPIRecord()` function
4. **Table Parsing:** `parseDHSTableRow()` function

### Testing After Updates

```bash
# Quick test
npx tsx scripts/test-dhs-scraper.ts

# Full test with save
npx tsx scripts/test-dhs-scraper.ts --save test-output.json --verbose

# Verify data quality
cat test-output.json | jq '.records | length'
cat test-output.json | jq '.records[] | select(.naics_code != null) | .naics_code' | sort -u
```

## Integration

### With Import Script

```bash
# Run as part of full import
node scripts/import-forecasts.js --source=DHS

# Dry run (no database writes)
node scripts/import-forecasts.js --source=DHS --dry-run
```

### With Forecast Intelligence System

The scraper integrates with the Forecast Intelligence System (`/src/app/forecasts/`):

1. Scraper runs via import script
2. Records saved to `agency_forecasts` table
3. Records made searchable via `/forecasts` page
4. Users can filter by NAICS, bureau, value, etc.

## Advanced Usage

### Customize for Specific Components

```typescript
// Only get CISA forecasts
const result = await scrapeDHS();
const cisaForecasts = result.records.filter(r => r.bureau === 'CISA');
```

### Combine with Other Agencies

```typescript
import { scrapeDHS } from '@/lib/forecasts/scrapers/dhs-apfs';
import { scrapeVA } from '@/lib/forecasts/scrapers/va-vendor-portal';
import { scrapeGSA } from '@/lib/forecasts/scrapers/gsa-acquisition-gateway';

const [dhs, va, gsa] = await Promise.all([
  scrapeDHS(),
  scrapeVA(),
  scrapeGSA()
]);

const allRecords = [
  ...dhs.records,
  ...va.records,
  ...gsa.records
];
```

### Filter by NAICS

```typescript
const result = await scrapeDHS();

// Only IT services (541512, 541519)
const itForecasts = result.records.filter(r =>
  r.naics_code === '541512' || r.naics_code === '541519'
);
```

## Troubleshooting

### Enable Debug Mode

To see what Puppeteer is doing:

1. Edit `dhs-apfs.ts`
2. Change `headless: true` to `headless: false`
3. Run scraper - browser window will open
4. Watch data loading in real-time

### Check Network Traffic

```typescript
// Add to scraper before page.goto()
page.on('request', req => {
  console.log('Request:', req.url());
});

page.on('response', async res => {
  console.log('Response:', res.url(), res.status());
});
```

### Save Screenshot on Error

```typescript
try {
  await page.waitForSelector(selector, { timeout: 30000 });
} catch (e) {
  await page.screenshot({ path: 'error-screenshot.png' });
  throw e;
}
```

## Support

- **Documentation:** See `README.md` in scrapers directory
- **Types:** See `../types.ts` for full interface
- **Database Schema:** See `supabase/migrations/20260405_forecast_intelligence.sql`

---

*Last Updated: April 5, 2026*

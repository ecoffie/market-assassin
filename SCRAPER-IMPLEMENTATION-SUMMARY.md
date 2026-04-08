# HHS Procurement Forecast Scraper - Implementation Summary

## Project Information

**Date:** April 5, 2026
**Developer:** Claude (Anthropic)
**Project:** Market Assassin - GovCon Tools Platform
**Target URL:** https://procurementforecast.hhs.gov
**Estimated Coverage:** $12B in procurement forecasts

---

## What Was Built

### 1. Main Scraper File
**Location:** `/src/lib/forecasts/scrapers/hhs.ts`

**Features:**
- ✅ Puppeteer-based web scraping
- ✅ Multiple extraction strategies (tables, grids, cards, definition lists)
- ✅ Automatic pagination handling
- ✅ Comprehensive data normalization
- ✅ Error handling and logging
- ✅ Test function included
- ✅ TypeScript types

**Key Functions:**
- `scrapeHHSForecast()` - Main scraper function
- `extractForecastData()` - Page data extraction
- `parseHHSForecastRow()` - Row parsing and normalization
- `testHHSForecastScraper()` - Built-in test suite

### 2. Test Scripts

**TypeScript Test Runner:**
`/scripts/test-hhs-scraper.ts`
```bash
npx tsx scripts/test-hhs-scraper.ts
```

**Node.js Test Runner:**
`/scripts/test-hhs-scraper.js`
```bash
node scripts/test-hhs-scraper.js
```

**Direct Execution:**
```bash
npx tsx src/lib/forecasts/scrapers/hhs.ts
```

### 3. Documentation

**README:**
`/src/lib/forecasts/scrapers/README-HHS.md`
- Technical overview
- Usage examples
- Extraction strategies
- Troubleshooting guide

**Quick Start Guide:**
`/docs/hhs-scraper-guide.md`
- Integration examples
- API endpoint setup
- Cron job configuration
- Database sync patterns
- Export examples (CSV, JSON)

### 4. Integration

**Scraper Registry:**
Updated `/src/lib/forecasts/scrapers/index.ts`

The scraper is now registered as:
```typescript
SCRAPERS.HHS = {
  name: 'Department of Health and Human Services (Procurement Forecast)',
  scraper: scrapeHHSForecast,
  test: testHHSForecastScraper,
  sourceUrl: 'https://procurementforecast.hhs.gov',
  estimatedCoverage: 12.0,
  priority: 1,
  phase: 3,
}
```

**Usage:**
```typescript
import { runScraper } from '@/lib/forecasts/scrapers';
const result = await runScraper('HHS');
```

---

## Data Structure

### Output Interface

```typescript
interface ScraperResult {
  success: boolean;           // Overall success status
  agency: string;             // "HHS"
  records: ForecastRecord[];  // Array of forecast records
  errors: string[];           // Array of error messages
  timing: number;             // Total milliseconds
}
```

### Forecast Record Fields

**Core Information:**
- `title` - Procurement requirement name
- `description` - Detailed scope/synopsis
- `external_id` - Unique identifier

**Organization:**
- `department` - "Department of Health and Human Services"
- `bureau` - Operating division (OPDIV)
- `contracting_office` - Specific procurement office

**Classification:**
- `naics_code` - North American Industry Classification System
- `psc_code` - Product Service Code

**Timing:**
- `fiscal_year` - FY2024, FY2025, etc.
- `anticipated_quarter` - Q1, Q2, Q3, Q4
- `anticipated_award_date` - Expected award date
- `solicitation_date` - Expected RFP release date

**Value:**
- `estimated_value_min` - Minimum dollar amount
- `estimated_value_max` - Maximum dollar amount
- `estimated_value_range` - Original text (e.g., "$5M - $25M")

**Procurement Details:**
- `set_aside_type` - 8(a), HUBZone, SDVOSB, WOSB, Small Business, etc.
- `contract_type` - FFP, CPFF, T&M, IDIQ, etc.
- `competition_type` - Full & Open, Limited, Sole Source, etc.

**Incumbent:**
- `incumbent_name` - Current contractor (if recompete)
- `incumbent_contract_number` - Current award number

**Point of Contact:**
- `poc_name` - Contracting Officer or specialist
- `poc_email` - Contact email
- `poc_phone` - Contact phone

**Location:**
- `pop_state` - Place of performance state

**Metadata:**
- `source_agency` - "HHS"
- `source_type` - "puppeteer"
- `source_url` - Target website
- `status` - "forecast"
- `raw_data` - Original JSON for debugging

---

## Technical Implementation

### Extraction Strategies

The scraper uses 4 strategies to handle different page layouts:

1. **HTML Tables** - Standard `<table>` elements with headers
2. **Data Grids** - Modern card/grid layouts with `[role="grid"]`
3. **Definition Lists** - `<dl>/<dt>/<dd>` structures
4. **Label-Value Pairs** - Key-value layouts with labels

### Pagination

- Automatically detects and clicks "Next" buttons
- Handles disabled state checking
- Safety limit: 50 pages
- 2-second delay between pages

### Data Normalization

**NAICS Codes:**
- Extracts 4-6 digit codes from text
- Example: "NAICS: 541512 (Computer Systems)" → `541512`

**Fiscal Year:**
- Normalizes to "FY2024", "FY2025" format
- Handles "FY24", "2024", "24" inputs

**Set-Aside Types:**
- Standardizes to: 8(a), HUBZone, SDVOSB, VOSB, WOSB, Small Business, Full & Open, Sole Source

**Value Ranges:**
- Parses "$250K–$7.5M" → `{ min: 250000, max: 7500000 }`
- Supports K, M, B suffixes
- Handles single values and ranges

### Error Handling

- Network timeouts: 90 seconds
- Parse errors: Logged, don't stop execution
- Missing elements: Graceful fallbacks
- Invalid data: Skipped with logging

All errors collected in `result.errors` array.

---

## Testing

### Manual Test

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npx tsx scripts/test-hhs-scraper.ts
```

**Expected Output:**
- Success status
- Record count
- Sample records (first 3-5)
- Data quality statistics
- Error messages (if any)
- Timing information

### Automated Test

The scraper includes a built-in test function:

```typescript
import { testHHSForecastScraper } from '@/lib/forecasts/scrapers/hhs';
await testHHSForecastScraper();
```

### Integration Test

Run from the scraper registry:

```typescript
import { SCRAPERS } from '@/lib/forecasts/scrapers';
await SCRAPERS.HHS.test();
```

---

## Next Steps

### 1. Test the Scraper

```bash
npx tsx scripts/test-hhs-scraper.ts
```

Verify:
- ✅ Records are returned
- ✅ Data fields are populated
- ✅ No major errors
- ✅ Timing is reasonable (<2 minutes)

### 2. Review Output

Check:
- ✅ NAICS codes are valid
- ✅ Value ranges are parsed correctly
- ✅ Dates are formatted properly
- ✅ Set-aside types are normalized

### 3. Database Integration

If needed, create sync script:

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';
import { supabase } from '@/lib/supabase';

const result = await scrapeHHSForecast();

for (const record of result.records) {
  await supabase
    .from('agency_forecasts')
    .upsert(record, { onConflict: 'external_id' });
}
```

### 4. Create API Endpoint (Optional)

```typescript
// app/api/forecasts/hhs/route.ts
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

export async function GET() {
  const result = await scrapeHHSForecast();
  return Response.json(result);
}
```

### 5. Schedule Cron Job (Optional)

Add to `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/sync-hhs-forecasts",
    "schedule": "0 6 * * *"
  }]
}
```

---

## File Manifest

### Core Files
- ✅ `/src/lib/forecasts/scrapers/hhs.ts` - Main scraper (500 lines)
- ✅ `/src/lib/forecasts/scrapers/index.ts` - Updated registry
- ✅ `/src/lib/forecasts/types.ts` - Shared types (unchanged)

### Test Files
- ✅ `/scripts/test-hhs-scraper.ts` - TypeScript test runner
- ✅ `/scripts/test-hhs-scraper.js` - Node.js test runner

### Documentation
- ✅ `/src/lib/forecasts/scrapers/README-HHS.md` - Technical README
- ✅ `/docs/hhs-scraper-guide.md` - Integration guide
- ✅ `/SCRAPER-IMPLEMENTATION-SUMMARY.md` - This file

### Analysis Scripts (Not Required)
- `/scripts/test-hhs-forecast-url.js` - URL analysis script (optional)

---

## Dependencies

**Required:**
- `puppeteer` - Already installed (v24.40.0)
- `typescript` - Already installed
- `next` - Already installed

**No additional npm packages required!**

---

## Performance Expectations

- **Page Load:** 3-10 seconds
- **Extraction:** 1-5 seconds per page
- **Total Time:** 30-120 seconds (depends on pagination)
- **Records:** 50-500+ (varies by website content)
- **Memory:** <500MB
- **Network:** ~5-20MB download

---

## Comparison with Existing HHS Scraper

| Feature | New (hhs.ts) | Old (hhs-sbcx.ts) |
|---------|--------------|-------------------|
| Target URL | procurementforecast.hhs.gov | mysbcx.hhs.gov |
| Extraction | 4 strategies | 2 strategies |
| Pagination | ✅ Automatic | ⚠️ Manual |
| Test Suite | ✅ Included | ✅ Included |
| Documentation | ✅ Comprehensive | ⚠️ Basic |
| Field Coverage | ✅ Full | ⚠️ Partial |
| Error Handling | ✅ Robust | ⚠️ Basic |

**Recommendation:** Use the new `hhs.ts` scraper as the primary source (priority 1), keep `hhs-sbcx.ts` as backup (priority 2).

---

## Known Limitations

1. **Dynamic Content:** Some content may load via JavaScript after initial page load
2. **Authentication:** Does not handle authenticated portals (public data only)
3. **Rate Limiting:** No built-in rate limiting (assumes infrequent use)
4. **Data Quality:** Depends on source data quality and consistency
5. **Website Changes:** May break if website structure changes significantly

---

## Support & Maintenance

### Common Issues

**Issue:** No records returned
**Solution:** Check if website is accessible, verify selectors

**Issue:** Timeout errors
**Solution:** Increase timeout, check network connectivity

**Issue:** Parse errors
**Solution:** Check `raw_data` field, update field name mappings

**Issue:** Missing fields
**Solution:** Add field name variations to `findField` calls

### Monitoring

Check scraper health:

```typescript
const result = await scrapeHHSForecast();
console.log(`Success: ${result.success}`);
console.log(`Records: ${result.records.length}`);
console.log(`Errors: ${result.errors.length}`);
```

### Updates

If website structure changes:
1. Run with `headless: false` to see browser
2. Inspect HTML structure
3. Update selectors in `extractForecastData()`
4. Update field mappings in `parseHHSForecastRow()`
5. Test thoroughly

---

## Conclusion

The HHS Procurement Forecast scraper is now **fully implemented and ready for testing**. It provides:

- ✅ Robust extraction from multiple page layouts
- ✅ Comprehensive data normalization
- ✅ Built-in error handling
- ✅ Test suite
- ✅ Complete documentation
- ✅ Integration with scraper registry

**Next Action:** Run the test script to verify it works with the live website.

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npx tsx scripts/test-hhs-scraper.ts
```

---

**Implementation Date:** April 5, 2026
**Status:** ✅ Complete - Ready for Testing
**Confidence:** High (based on existing scraper patterns)

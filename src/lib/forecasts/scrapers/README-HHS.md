# HHS Procurement Forecast Scraper

## Overview

This scraper extracts procurement forecast data from the Department of Health and Human Services (HHS) procurement forecast portal at `https://procurementforecast.hhs.gov`.

**Estimated Coverage:** $12B in forecasted opportunities

## Features

- ✅ Puppeteer-based web scraping
- ✅ Multiple extraction strategies (tables, grids, cards, definition lists)
- ✅ Pagination handling
- ✅ Comprehensive data normalization (NAICS, fiscal year, set-aside types)
- ✅ Value range parsing ($250K–$7.5M, etc.)
- ✅ Error handling and logging
- ✅ Test function included

## Data Extracted

Each forecast record includes:

### Core Information
- **Title** - Procurement requirement name
- **Description** - Detailed scope/synopsis
- **External ID** - Unique identifier for deduplication

### Organization
- **Department** - Always "Department of Health and Human Services"
- **Bureau** - Operating division (OPDIV)
- **Contracting Office** - Specific procurement office

### Classification
- **NAICS Code** - North American Industry Classification System
- **PSC Code** - Product Service Code

### Timing
- **Fiscal Year** - FY2024, FY2025, etc.
- **Anticipated Quarter** - Q1, Q2, Q3, Q4
- **Anticipated Award Date** - Expected award date
- **Solicitation Date** - Expected RFP release date

### Value
- **Estimated Value Min/Max** - Dollar amounts
- **Estimated Value Range** - Original text (e.g., "$5M - $25M")

### Procurement Details
- **Set-Aside Type** - 8(a), HUBZone, SDVOSB, WOSB, Small Business, etc.
- **Contract Type** - FFP, CPFF, T&M, IDIQ, etc.
- **Competition Type** - Full & Open, Limited, Sole Source, etc.

### Incumbent Information
- **Incumbent Name** - Current contractor (if recompete)
- **Contract Number** - Current award number

### Point of Contact
- **POC Name** - Contracting Officer or specialist
- **POC Email** - Contact email
- **POC Phone** - Contact phone

### Location
- **State** - Place of performance

## Usage

### From TypeScript/Node.js

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

const result = await scrapeHHSForecast();

console.log(`Success: ${result.success}`);
console.log(`Records: ${result.records.length}`);
console.log(`Errors: ${result.errors.length}`);
console.log(`Timing: ${result.timing}ms`);

// Access records
result.records.forEach(record => {
  console.log(`${record.title} - ${record.naics_code} - ${record.estimated_value_range}`);
});
```

### Test the Scraper

```bash
# Using TypeScript
npx tsx scripts/test-hhs-scraper.ts

# OR using ts-node
ts-node scripts/test-hhs-scraper.ts

# OR from the scraper file directly
npx tsx src/lib/forecasts/scrapers/hhs.ts
```

### From the Scrapers Index

```typescript
import { runScraper } from '@/lib/forecasts/scrapers';

const result = await runScraper('HHS');
```

## Extraction Strategies

The scraper uses multiple strategies to handle different page layouts:

### Strategy 1: HTML Tables
- Looks for `<table>` elements
- Extracts headers from `<thead>`
- Maps data from `<tbody>` rows

### Strategy 2: Data Grids
- Targets `[role="grid"]`, `.data-grid`, `.forecast-list`
- Extracts card/item layouts
- Handles key-value pairs

### Strategy 3: Definition Lists
- Parses `<dl>`, `<dt>`, `<dd>` structures
- Common in government sites

### Strategy 4: Label-Value Pairs
- Finds `<label>`, `<strong>`, `.field-label` elements
- Extracts associated values

## Pagination

The scraper automatically handles pagination:
- Looks for "Next", "›", "»" buttons
- Checks for disabled state
- Safety limit: 50 pages max
- 2-second delay between pages

## Data Normalization

### NAICS Codes
- Extracts 4-6 digit codes from text
- Example: "NAICS: 541512 (Computer Systems)" → `541512`

### Fiscal Year
- Normalizes to "FY2024", "FY2025" format
- Handles "FY24", "2024", "24" inputs

### Set-Aside Types
- Standardizes to: 8(a), HUBZone, SDVOSB, VOSB, WOSB, Small Business, Full & Open, Sole Source

### Value Ranges
- Parses "$250K–$7.5M" → `{ min: 250000, max: 7500000 }`
- Supports K, M, B suffixes
- Handles single values and ranges

## Error Handling

The scraper includes comprehensive error handling:
- Network timeouts (90 seconds)
- Parse errors (logged, don't stop execution)
- Missing elements (graceful fallbacks)
- Invalid data (skipped with logging)

All errors are collected in the `errors` array of the result.

## Performance

- **Timeout:** 90 seconds per page load
- **Headless mode:** Yes (for production)
- **User agent:** Chrome 120
- **Viewport:** 1920x1080
- **Wait between actions:** 2-3 seconds

## Output Format

```typescript
interface ScraperResult {
  success: boolean;           // Overall success
  agency: string;             // "HHS"
  records: ForecastRecord[];  // Array of forecast records
  errors: string[];           // Array of error messages
  timing: number;             // Total milliseconds
}
```

## Known Limitations

1. **Dynamic Content:** Some content may load via JavaScript after initial page load
2. **Authentication:** Does not handle authenticated portals (public data only)
3. **Rate Limiting:** No built-in rate limiting (assumes infrequent use)
4. **Data Quality:** Depends on source data quality and consistency

## Troubleshooting

### No records found
1. Check if the website structure has changed
2. Enable headless:false in the launch options to see what's happening
3. Increase timeout values
4. Check console logs for specific errors

### Parse errors
1. Examine the `raw_data` field in records
2. Check field name variations in the source HTML
3. Update the `findField` function keys

### Timeout errors
1. Increase `HHS_FORECAST_CONFIG.timeout`
2. Check network connectivity
3. Verify the website is accessible

## Future Enhancements

- [ ] Retry logic for failed requests
- [ ] Incremental updates (only fetch new records)
- [ ] Export to Excel/CSV
- [ ] Integration with database sync
- [ ] Email notifications for new forecasts
- [ ] Advanced filtering by NAICS, value, date

## Related Files

- `/src/lib/forecasts/scrapers/hhs.ts` - Main scraper
- `/src/lib/forecasts/scrapers/hhs-sbcx.ts` - Alternative HHS source (SBCX portal)
- `/src/lib/forecasts/scrapers/index.ts` - Scraper registry
- `/src/lib/forecasts/types.ts` - Shared types and utilities
- `/scripts/test-hhs-scraper.ts` - Test runner
- `/scripts/test-hhs-scraper.js` - Node.js test runner

## Changelog

### 2026-04-05
- ✅ Initial implementation
- ✅ Multi-strategy extraction
- ✅ Pagination handling
- ✅ Data normalization
- ✅ Test suite
- ✅ Comprehensive documentation

# Federal Agency Forecast Scrapers

This directory contains Puppeteer-based web scrapers for federal agency procurement forecast systems.

## Overview

Federal agencies publish acquisition forecasts 6-18 months before solicitation. These scrapers aggregate data from multiple agency forecast portals into a unified format for the Forecast Intelligence System.

## Available Scrapers

| Agency | Source | Type | Status | Est. Coverage |
|--------|--------|------|--------|---------------|
| **DHS** | apfs-cloud.dhs.gov | Puppeteer | ✅ Active | $8B |
| **GSA** | acquisitiongateway.gov | API + Puppeteer | ✅ Phase 2 | $8B |
| **VA** | vendorportal.ecms.va.gov | Puppeteer | 🔄 Phase 2 | $10B |
| **HHS** | procurementforecast.hhs.gov | Puppeteer | 🔄 Phase 3 | $12B |
| **Treasury** | osdbu.forecast.treasury.gov | Puppeteer | ✅ Active | $2B |
| **EPA** | ofmpub.epa.gov/apex/forecast | Puppeteer | ✅ Active | $1.5B |
| **DOD** | Multi-source | Puppeteer | 🔄 Phase 4 | $40B |

## Architecture

### Unified Interface

All scrapers implement the same interface:

```typescript
export async function scrapeXXX(): Promise<ScraperResult>

interface ScraperResult {
  success: boolean;
  agency: string;
  records: ForecastRecord[];
  errors: string[];
  timing: number;
}
```

### ForecastRecord Schema

```typescript
interface ForecastRecord {
  source_agency: string;
  source_type: 'excel' | 'puppeteer' | 'api';
  source_url?: string;
  external_id: string;

  title: string;
  description?: string;

  department?: string;
  bureau?: string;
  contracting_office?: string;

  naics_code?: string;
  psc_code?: string;

  fiscal_year?: string;
  anticipated_quarter?: string;
  anticipated_award_date?: string;

  estimated_value_min?: number;
  estimated_value_max?: number;
  estimated_value_range?: string;

  contract_type?: string;
  set_aside_type?: string;

  incumbent_name?: string;

  pop_state?: string;
  pop_city?: string;

  poc_name?: string;
  poc_email?: string;
  poc_phone?: string;

  status?: 'forecast' | 'pre-solicitation' | 'solicitation' | 'awarded' | 'cancelled';
  raw_data?: string;
}
```

## GSA Acquisition Gateway Scraper

### Overview

**URL:** https://acquisitiongateway.gov/forecast
**Technology:** React/Angular SPA with potential API endpoints
**Strategy:** API-first with Puppeteer fallback
**File:** `gsa-acquisition-gateway.ts`

### Key Features

1. **Dual-Approach Strategy**
   - **Primary:** API endpoint discovery (tries multiple potential paths)
   - **Fallback:** Puppeteer browser automation with comprehensive selector matching

2. **Robust Data Extraction**
   - Multi-selector strategy for tables, grids, cards, and list layouts
   - Embedded JSON extraction from `<script type="application/json">` tags
   - Dynamic field mapping with fuzzy matching

3. **Full Data Normalization**
   - NAICS code extraction and validation
   - Fiscal year standardization (FY2026 format)
   - Set-aside type mapping (8(a), SDVOSB, HUBZone, etc.)
   - Value range parsing ($5M-$25M → min/max integers)

### Implementation Details

The scraper implements a waterfall strategy:

```typescript
1. Try API endpoints:
   - https://acquisitiongateway.gov/api/v1/forecasts
   - https://acquisitiongateway.gov/api/forecast/search
   - https://api.acquisitiongateway.gov/forecasts

2. If API fails → Launch Puppeteer:
   - Navigate to forecast page
   - Wait for JavaScript to render (5s)
   - Try to expand results ("Show All" buttons)
   - Set page size to maximum (100 items)
   - Extract data from multiple container types
   - Parse embedded JSON data

3. Parse and normalize all extracted records
```

### Data Fields Extracted

From either API or Puppeteer extraction:

- **Core:** title, description, external_id
- **Classification:** naics_code, psc_code
- **Organization:** department, bureau, contracting_office, program_office
- **Timing:** fiscal_year, anticipated_quarter, anticipated_award_date, solicitation_date
- **Value:** estimated_value_min/max, estimated_value_range
- **Contract:** contract_type, set_aside_type, competition_type
- **Incumbent:** incumbent_name, incumbent_contract_number
- **Contact:** poc_name, poc_email, poc_phone
- **Location:** pop_state, pop_city, pop_zip
- **Status:** 'forecast' | 'pre-solicitation' | 'solicitation' | 'awarded'

### Testing

```bash
# Run GSA scraper test
node scripts/run-gsa-scraper.js

# Verbose output with detailed logs
node scripts/run-gsa-scraper.js --verbose

# Using TypeScript/ESM import
import { testGSAScraper } from '@/lib/forecasts/scrapers/gsa-acquisition-gateway';
await testGSAScraper();
```

### Example Output

**API Response (if available):**
```json
{
  "source_agency": "GSA",
  "source_type": "api",
  "external_id": "GSA-12345",
  "title": "Enterprise IT Infrastructure Modernization",
  "description": "Modernization of legacy systems...",
  "naics_code": "541512",
  "psc_code": "D302",
  "fiscal_year": "FY2026",
  "anticipated_quarter": "Q2",
  "estimated_value_min": 10000000,
  "estimated_value_max": 50000000,
  "estimated_value_range": "$10M-$50M",
  "set_aside_type": "Small Business",
  "contract_type": "IDIQ",
  "status": "forecast"
}
```

**Puppeteer Extraction:**
```json
{
  "source_agency": "GSA",
  "source_type": "puppeteer",
  "external_id": "GSA-541512-Enterprise IT-1733456789",
  "title": "Enterprise IT Infrastructure Modernization",
  "naics_code": "541512",
  "fiscal_year": "FY2026",
  "estimated_value_range": "$10M-$50M",
  "raw_data": "{\"title\":\"Enterprise IT...\",\"naics\":\"541512\"}"
}
```

### Troubleshooting

**No records extracted:**
1. Check if page requires authentication (look for login forms)
2. Inspect Network tab in browser DevTools for new API endpoints
3. Run with `--verbose` to see which selectors are being tried
4. Verify page structure hasn't changed (React component updates)

**API endpoints returning 404:**
1. Open browser DevTools → Network tab
2. Load https://acquisitiongateway.gov/forecast
3. Filter by XHR/Fetch requests
4. Find the actual API endpoint being called
5. Update `apiEndpoints` array in `scrapeGSAViaAPI()`

**Parsing errors:**
1. Check browser screenshot: `page.screenshot({ path: '/tmp/gsa-debug.png' })`
2. Add debug logging in `page.evaluate()` function
3. Inspect the HTML structure for changed class names or IDs
4. Update CSS selectors in the extraction logic

### Performance

- **API approach:** 2-5 seconds
- **Puppeteer approach:** 10-30 seconds
- **Memory:** ~100-200MB (headless Chrome)
- **Recommended schedule:** Daily at 2 AM ET

### Configuration

Edit `GSA_CONFIG` in the scraper file:

```typescript
const GSA_CONFIG = {
  agency_code: 'GSA',
  agency_name: 'General Services Administration',
  source_url: 'https://acquisitiongateway.gov/forecast',
  api_url: 'https://acquisitiongateway.gov/api/forecast',
  timeout: 60000, // Increase if page loads slowly
};
```

### Database Integration

Save scraped records to Supabase:

```typescript
import { scrapeGSA } from '@/lib/forecasts/scrapers/gsa-acquisition-gateway';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const result = await scrapeGSA();

if (result.success && result.records.length > 0) {
  const { data, error } = await supabase
    .from('agency_forecasts')
    .upsert(result.records, {
      onConflict: 'external_id',
      ignoreDuplicates: false,
    });

  console.log(`Saved ${result.records.length} GSA forecasts`);
}
```

## Treasury OSDBU Scraper

### Overview

**URL:** https://osdbu.forecast.treasury.gov/
**Technology:** Angular/Angular Material SPA
**Strategy:** Puppeteer with Angular Material table extraction
**File:** `treasury.ts`

### Key Features

1. **Dual URL Support** - Tries both main OSDBU URL and alternate SBECS URL
2. **Angular Material Detection** - Handles `mat-table`, `mat-row`, `mat-cell` components
3. **Fallback Strategies** - Falls back to standard tables and card layouts
4. **Flexible Field Matching** - Fuzzy field name matching for robust extraction

### Data Fields Extracted

- **Core:** title, description
- **Classification:** naics, psc
- **Timing:** fiscalYear, quarter, awardDate
- **Value:** valueMin, valueMax, valueRange
- **Contract:** setAside, contractType
- **Other:** incumbent, state, office, contact

### Implementation Details

```typescript
export async function scrapeTreasury(): Promise<ForecastRecord[]>
```

The scraper implements a waterfall strategy:

1. **Load page** with main URL, fallback to alternate
2. **Wait for Angular** to render (5 seconds)
3. **Try to expand** using "View All" buttons
4. **Extract from:**
   - Angular Material tables (`mat-table`)
   - Standard HTML tables
   - Card-based layouts (`mat-card`)
5. **Parse and normalize** all records

### Testing

```bash
# Run Treasury scraper test
node scripts/test-treasury-scraper.js

# Quick connection test
node scripts/test-scrapers-simple.js treasury

# Programmatic test
import { testTreasuryScraper } from '@/lib/forecasts/scrapers/treasury';
await testTreasuryScraper();
```

### Example Output

```json
{
  "title": "Enterprise Resource Planning System",
  "agency": "Treasury",
  "naics": "541512",
  "fiscalYear": "FY2026",
  "quarter": "Q3",
  "valueRange": "$5M-$15M",
  "valueMin": 5000000,
  "valueMax": 15000000,
  "setAside": "Small Business",
  "office": "Bureau of the Fiscal Service",
  "contact": {
    "name": "John Doe",
    "email": "john.doe@treasury.gov"
  }
}
```

### Troubleshooting

**No records extracted:**
- Check if Angular has loaded: increase wait time from 5s to 10s
- Inspect browser DevTools for Angular Material components
- Try alternate URL: https://sbecs.treas.gov/forecast

**Parse errors:**
- Field names may have changed in Angular templates
- Add more field aliases to `findField()` calls
- Check for nested Angular components

### Performance

- **Typical execution:** 15-25 seconds
- **Memory:** ~150MB (headless Chrome + Angular)
- **Recommended schedule:** Daily at 3 AM ET

---

## EPA Forecast Scraper

### Overview

**URL:** https://ofmpub.epa.gov/apex/forecast/f?p=forecast
**Technology:** Oracle APEX application
**Strategy:** Puppeteer with APEX-specific selectors and pagination
**File:** `epa.ts`

### Key Features

1. **APEX-Specific Extraction** - Handles Oracle APEX table classes (`a-IRR-table`, `apexir_WORKSHEET_DATA`)
2. **Automatic Pagination** - Navigates through all pages (up to 20 by default)
3. **Rows Per Page Expansion** - Attempts to set page size to maximum (500/10000)
4. **Fallback Strategies** - Falls back to standard tables and card layouts

### Data Fields Extracted

- **Core:** title, description
- **Classification:** naics, psc
- **Timing:** fiscalYear, quarter, awardDate
- **Value:** valueMin, valueMax, valueRange
- **Contract:** setAside, contractType
- **Other:** incumbent, state, office, contact

### Implementation Details

```typescript
export async function scrapeEPA(): Promise<ForecastRecord[]>
```

The scraper implements pagination with comprehensive extraction:

1. **Load page** and wait for APEX to render
2. **Expand page size:**
   - Try to select "All" or 10000 rows
   - Fallback to 500 or 100
3. **Paginate through all pages:**
   - Extract data from current page
   - Click "Next" button
   - Repeat until no more pages (max 20)
4. **Extract from:**
   - APEX Interactive Report tables
   - Standard HTML tables
   - Card/list layouts
5. **Parse and normalize** all records

### Pagination Logic

```typescript
let currentPage = 1;
let hasMorePages = true;

while (hasMorePages && currentPage <= maxPages) {
  const pageData = await extractEPAData(page);
  records.push(...pageData);
  hasMorePages = await tryNextPage(page); // Clicks "Next" button
  currentPage++;
  await sleep(2000); // Wait for page load
}
```

### Testing

```bash
# Run EPA scraper test
node scripts/test-epa-scraper.js

# Quick connection test
node scripts/test-scrapers-simple.js epa

# Test both scrapers
node scripts/test-scrapers-simple.js both

# Programmatic test
import { testEPAScraper } from '@/lib/forecasts/scrapers/epa';
await testEPAScraper();
```

### Example Output

```json
{
  "title": "Hazardous Waste Site Remediation",
  "agency": "EPA",
  "naics": "562910",
  "psc": "S212",
  "fiscalYear": "FY2026",
  "quarter": "Q2",
  "awardDate": "03/15/2026",
  "valueRange": "$2M-$8M",
  "valueMin": 2000000,
  "valueMax": 8000000,
  "setAside": "8(a)",
  "contractType": "Firm Fixed Price",
  "office": "Region 5",
  "state": "IL",
  "contact": {
    "name": "Jane Smith",
    "email": "smith.jane@epa.gov"
  }
}
```

### Troubleshooting

**No records extracted:**
- Check if APEX has loaded: look for `.a-IRR-table` in browser
- Increase wait time from 5s to 10s
- Check for authentication requirements

**Pagination not working:**
- Next button selector may have changed
- Check for `.a-Button--next:not([disabled])` in DevTools
- Verify pagination controls are visible

**Parse errors:**
- APEX field names may have changed
- Add more field aliases to `findField()` calls
- Check for custom APEX components

### Performance

- **Typical execution:** 30-90 seconds (depends on page count)
- **Memory:** ~150MB (headless Chrome + APEX)
- **Recommended schedule:** Daily at 4 AM ET

### Configuration

Edit `EPA_CONFIG` to adjust behavior:

```typescript
const EPA_CONFIG = {
  agency_code: 'EPA',
  agency_name: 'Environmental Protection Agency',
  source_url: 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast',
  timeout: 60000,
  maxPages: 20, // Reduce for faster testing
};
```

---

## DHS APFS Scraper

### Overview

**URL:** https://apfs-cloud.dhs.gov/forecast/
**Technology:** DataTables with AJAX data loading
**Strategy:** Intercept API calls + fallback to table scraping

### Key Features

1. **API Interception** - Captures AJAX requests to `/api/forecast/` for fastest, most reliable data
2. **Table Scraping Fallback** - Parses rendered DataTable if API interception fails
3. **Pagination Handling** - Attempts to set page length to "All" to get complete dataset
4. **SearchPanes Support** - Can handle filtered views

### Data Fields

Based on WebFetch analysis, the DHS APFS provides:

- **Visible Columns:**
  - APFS Number
  - Component (bureau/office)
  - Requirements Title
  - Contract Status
  - Place of Performance (City/State)
  - Dollar Range
  - Estimated Solicitation Release Date
  - Forecast Published Date
  - Contract Type

- **Hidden Columns (may be in API):**
  - NAICS Code
  - PSC Code
  - Contact Information
  - Incumbent Details

### Testing

```bash
# Run DHS scraper test
npx tsx scripts/test-dhs-scraper.ts
```

### Example Output

```json
{
  "source_agency": "DHS",
  "source_type": "api",
  "external_id": "DHS-APFS-123456",
  "title": "Cybersecurity Operations Center Support",
  "bureau": "CISA",
  "naics_code": "541512",
  "estimated_value_range": "$5M - $25M",
  "estimated_value_min": 5000000,
  "estimated_value_max": 25000000,
  "contract_type": "IDIQ",
  "pop_city": "Washington",
  "pop_state": "DC",
  "status": "forecast"
}
```

## Common Scraping Patterns

### 1. AJAX/SPA Sites (DHS, GSA)

```typescript
// Intercept API calls
page.on('response', async (response) => {
  if (response.url().includes('/api/forecast')) {
    const data = await response.json();
    // Process data...
  }
});
```

### 2. Static Tables (HHS, Treasury)

```typescript
await page.waitForSelector('table');
const data = await page.evaluate(() => {
  // Extract table data...
});
```

### 3. Pagination

```typescript
// Change page length
await page.select('select[name$="_length"]', '-1');

// Or click "Next" repeatedly
while (await page.$('.next:not(.disabled)')) {
  await page.click('.next');
  await sleep(2000);
  // Extract data...
}
```

## Error Handling

All scrapers include comprehensive error handling:

```typescript
const errors: string[] = [];

try {
  // Scraping logic...
} catch (error) {
  errors.push(`Scraper error: ${error}`);
}

return {
  success: records.length > 0,
  errors,
  // ...
};
```

## Utility Functions

Located in `../types.ts`:

- `normalizeNaics()` - Extract clean NAICS code
- `normalizeFY()` - Standardize fiscal year format
- `normalizeSetAside()` - Map set-aside types to standard values
- `parseValueRange()` - Parse dollar amounts (handles $5M, $5M-$25M, etc.)
- `sleep()` - Add delays for page loading

## Development Guidelines

### 1. Always Test First

```bash
# Visit the URL manually
open https://apfs-cloud.dhs.gov/forecast/

# Inspect network calls
# Check for API endpoints
# Note data structure
```

### 2. Prefer API Over Scraping

If the site loads data via AJAX, intercept the API call rather than parsing HTML:

```typescript
page.on('response', async (response) => {
  if (response.url().includes('/api/')) {
    // Much more reliable than HTML parsing
  }
});
```

### 3. Handle Pagination

Most forecast systems paginate. Either:
- Set page length to max
- Click through all pages
- Make multiple API calls

### 4. Validate Data Quality

```typescript
// Skip empty records
if (!title && !naics) {
  return null;
}

// Log data quality stats
const withNAICS = records.filter(r => r.naics_code).length;
console.log(`Records with NAICS: ${withNAICS}/${records.length}`);
```

### 5. Use Realistic User Agents

```typescript
await page.setUserAgent(
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
);
```

### 6. Add Delays for Dynamic Content

```typescript
await page.goto(url, { waitUntil: 'networkidle0' });
await sleep(3000); // Let Angular/React render
```

## Production Usage

### Import Script

The `scripts/import-forecasts.js` script orchestrates scraper execution:

```bash
# Run all Puppeteer scrapers
node scripts/import-forecasts.js --puppeteer

# Run specific agency
node scripts/import-forecasts.js --source=DHS

# Dry run (no database writes)
node scripts/import-forecasts.js --dry-run
```

### Cron Schedule

Scrapers should run:
- **Daily** - Check for new forecasts
- **Off-peak hours** - Avoid high-traffic periods
- **With retry logic** - Handle transient failures

## Troubleshooting

### "Table not found"

- Page may need more time to load
- Selector may have changed
- Try increasing timeout or wait time

### "No data extracted"

- Check if site requires authentication
- Verify network requests in browser DevTools
- API endpoint may have changed

### "Parse errors"

- Field names may have changed
- Data format may be inconsistent
- Add more flexible field matching

### Puppeteer Issues

```bash
# On Linux, install dependencies
apt-get install -y chromium-browser

# On macOS, ensure Chromium is accessible
brew install chromium
```

## Future Enhancements

1. **Proxy Support** - Rotate IPs to avoid rate limits
2. **Headful Mode Toggle** - Debug with visible browser
3. **Screenshot Capture** - Save screenshots on errors
4. **Retry Logic** - Auto-retry failed scrapes
5. **Change Detection** - Only update changed records
6. **Email Alerts** - Notify on scraper failures

## Contributing

When adding a new scraper:

1. Copy `dhs-apfs.ts` as template
2. Update config constants
3. Implement parsing logic
4. Add to `index.ts` exports
5. Create test script in `scripts/`
6. Update this README

## Resources

- [Puppeteer Docs](https://pptr.dev/)
- [Forecast Intelligence PRD](../../../docs/PRD-forecast-intelligence.md)
- [Database Schema](../../../supabase/migrations/20260405_forecast_intelligence.sql)

---

*Last Updated: April 5, 2026*

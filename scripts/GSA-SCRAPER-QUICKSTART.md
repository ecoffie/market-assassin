# GSA Scraper - Quick Start Guide

## Test the Scraper

```bash
# Navigate to project
cd "/Users/ericcoffie/Market Assasin/market-assassin"

# Run test script
node scripts/run-gsa-scraper.js

# Verbose output
node scripts/run-gsa-scraper.js --verbose
```

## Use in Code

### Option 1: Direct Import

```typescript
import { scrapeGSA } from '@/lib/forecasts/scrapers/gsa-acquisition-gateway';

const result = await scrapeGSA();

console.log(`Found ${result.records.length} forecasts in ${result.timing}ms`);
```

### Option 2: Test Function

```typescript
import { testGSAScraper } from '@/lib/forecasts/scrapers/gsa-acquisition-gateway';

await testGSAScraper(); // Logs detailed output
```

### Option 3: Via Registry

```typescript
import { runScraper } from '@/lib/forecasts/scrapers';

const result = await runScraper('GSA');
```

## Save to Database

```typescript
import { scrapeGSA } from '@/lib/forecasts/scrapers/gsa-acquisition-gateway';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const result = await scrapeGSA();

if (result.success && result.records.length > 0) {
  await supabase
    .from('agency_forecasts')
    .upsert(result.records, { onConflict: 'external_id' });

  console.log(`✓ Saved ${result.records.length} forecasts`);
}
```

## Key Files

| File | Location |
|------|----------|
| Scraper | `src/lib/forecasts/scrapers/gsa-acquisition-gateway.ts` |
| Test Script | `scripts/run-gsa-scraper.js` |
| Types | `src/lib/forecasts/types.ts` |
| Registry | `src/lib/forecasts/scrapers/index.ts` |
| API | `src/app/api/forecasts/route.ts` |

## Scraper Config

```typescript
const GSA_CONFIG = {
  agency_code: 'GSA',
  agency_name: 'General Services Administration',
  source_url: 'https://acquisitiongateway.gov/forecast',
  timeout: 60000, // 60 seconds
};
```

## Result Format

```typescript
{
  success: boolean,        // True if records found
  agency: 'GSA',
  records: ForecastRecord[], // Array of forecasts
  errors: string[],        // Error messages
  timing: number          // Milliseconds
}
```

## Common Issues

### No Records?
1. Check if page requires auth: `open https://acquisitiongateway.gov/forecast`
2. Run with `--verbose` flag
3. Check Network tab in DevTools for API endpoints

### API Not Working?
1. Update API endpoints in `scrapeGSAViaAPI()`
2. Check browser DevTools → Network → XHR/Fetch

### Parse Errors?
1. Update CSS selectors in `tableData` extraction
2. Check page structure hasn't changed

## Documentation

Full docs: `src/lib/forecasts/scrapers/README.md`
Summary: `GSA-SCRAPER-SUMMARY.md`

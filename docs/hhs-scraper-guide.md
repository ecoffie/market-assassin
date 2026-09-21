# HHS Procurement Forecast Scraper - Quick Start Guide

## Overview

The HHS Procurement Forecast scraper extracts procurement forecast data from `https://procurementforecast.hhs.gov` covering approximately **$12B** in upcoming federal opportunities.

## Quick Test

```bash
# From project root
cd "/Users/ericcoffie/Market Assasin/market-assassin"

# Run the test (TypeScript)
npx tsx scripts/test-hhs-scraper.ts

# OR run directly from source
npx tsx src/lib/forecasts/scrapers/hhs.ts
```

## Integration Examples

### Example 1: Basic Usage

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

async function getHHSForecasts() {
  const result = await scrapeHHSForecast();

  if (result.success) {
    console.log(`Found ${result.records.length} forecasts`);

    result.records.forEach(record => {
      console.log(`${record.title}`);
      console.log(`  NAICS: ${record.naics_code}`);
      console.log(`  Value: ${record.estimated_value_range}`);
      console.log(`  Award: ${record.anticipated_award_date}`);
    });
  }
}
```

### Example 2: Filter by NAICS

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

async function getITServiceForecasts() {
  const result = await scrapeHHSForecast();

  // Filter for IT services (NAICS 541512, 541511, 541519)
  const itForecasts = result.records.filter(record =>
    record.naics_code?.startsWith('5415')
  );

  console.log(`Found ${itForecasts.length} IT service forecasts`);
}
```

### Example 3: Filter by Value

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

async function getLargeForecasts() {
  const result = await scrapeHHSForecast();

  // Filter for opportunities > $5M
  const largeForecasts = result.records.filter(record =>
    (record.estimated_value_min || 0) > 5_000_000
  );

  console.log(`Found ${largeForecasts.length} forecasts over $5M`);
}
```

### Example 4: Filter by Set-Aside

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

async function getSmallBusinessForecasts() {
  const result = await scrapeHHSForecast();

  // Filter for small business set-asides
  const sbForecasts = result.records.filter(record =>
    record.set_aside_type &&
    record.set_aside_type !== 'Full & Open'
  );

  console.log(`Found ${sbForecasts.length} small business opportunities`);
}
```

### Example 5: Save to Database

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';
import { supabase } from '@/lib/supabase';

async function syncHHSForecasts() {
  const result = await scrapeHHSForecast();

  if (!result.success) {
    console.error('Scraper failed:', result.errors);
    return;
  }

  // Upsert to database (based on external_id)
  for (const record of result.records) {
    const { error } = await supabase
      .from('agency_forecasts')
      .upsert(record, { onConflict: 'external_id' });

    if (error) {
      console.error(`Failed to save ${record.external_id}:`, error);
    }
  }

  console.log(`Synced ${result.records.length} HHS forecasts`);
}
```

### Example 6: Export to CSV

```typescript
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';
import { writeFileSync } from 'fs';

async function exportToCSV() {
  const result = await scrapeHHSForecast();

  const headers = [
    'Title',
    'NAICS',
    'PSC',
    'Value Range',
    'FY',
    'Award Date',
    'Set-Aside',
    'Bureau',
    'POC Name',
    'POC Email',
  ];

  const rows = result.records.map(r => [
    r.title,
    r.naics_code || '',
    r.psc_code || '',
    r.estimated_value_range || '',
    r.fiscal_year || '',
    r.anticipated_award_date || '',
    r.set_aside_type || '',
    r.bureau || '',
    r.poc_name || '',
    r.poc_email || '',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  writeFileSync('hhs-forecasts.csv', csv);
  console.log('Exported to hhs-forecasts.csv');
}
```

## Using the Scraper Registry

```typescript
import { runScraper, SCRAPERS } from '@/lib/forecasts/scrapers';

// Get scraper info
const hhsInfo = SCRAPERS.HHS;
console.log(hhsInfo.name);           // "Department of Health and Human Services (Procurement Forecast)"
console.log(hhsInfo.sourceUrl);      // "https://procurementforecast.hhs.gov"
console.log(hhsInfo.estimatedCoverage); // 12.0

// Run scraper
const result = await runScraper('HHS');
```

## API Endpoint Integration

Create an API endpoint to expose the scraper:

```typescript
// app/api/forecasts/hhs/route.ts
import { NextResponse } from 'next/server';
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';

export async function GET() {
  try {
    const result = await scrapeHHSForecast();

    return NextResponse.json({
      success: result.success,
      count: result.records.length,
      records: result.records,
      errors: result.errors,
      timing: result.timing,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
```

Then call it:

```bash
curl https://tools.govcongiants.org/api/forecasts/hhs
```

## Scheduled Sync (Cron Job)

```typescript
// app/api/cron/sync-hhs-forecasts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { scrapeHHSForecast } from '@/lib/forecasts/scrapers/hhs';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Cron] Starting HHS forecast sync...');
  const result = await scrapeHHSForecast();

  if (!result.success) {
    console.error('[Cron] Scraper failed:', result.errors);
    return NextResponse.json({
      success: false,
      errors: result.errors
    }, { status: 500 });
  }

  // Log sync run
  const { data: syncRun } = await supabase
    .from('forecast_sync_runs')
    .insert({
      source_agency: 'HHS',
      source_url: 'https://procurementforecast.hhs.gov',
      records_found: result.records.length,
      success: true,
      duration_ms: result.timing,
    })
    .select()
    .single();

  // Upsert records
  let inserted = 0;
  for (const record of result.records) {
    const { error } = await supabase
      .from('agency_forecasts')
      .upsert({
        ...record,
        sync_run_id: syncRun?.id,
      }, {
        onConflict: 'external_id'
      });

    if (!error) inserted++;
  }

  console.log(`[Cron] Synced ${inserted}/${result.records.length} records`);

  return NextResponse.json({
    success: true,
    records_found: result.records.length,
    records_inserted: inserted,
    timing: result.timing,
  });
}
```

Add to `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/sync-hhs-forecasts",
    "schedule": "0 6 * * *"
  }]
}
```

## Monitoring

### Check Last Sync

```typescript
import { supabase } from '@/lib/supabase';

const { data } = await supabase
  .from('forecast_sync_runs')
  .select('*')
  .eq('source_agency', 'HHS')
  .order('created_at', { ascending: false })
  .limit(1)
  .single();

console.log(`Last sync: ${data.created_at}`);
console.log(`Records: ${data.records_found}`);
console.log(`Success: ${data.success}`);
```

### View Recent Forecasts

```typescript
import { supabase } from '@/lib/supabase';

const { data: forecasts } = await supabase
  .from('agency_forecasts')
  .select('*')
  .eq('source_agency', 'HHS')
  .order('created_at', { ascending: false })
  .limit(10);

forecasts.forEach(f => {
  console.log(`${f.title} - ${f.naics_code} - ${f.estimated_value_range}`);
});
```

## Troubleshooting

### Problem: No records returned

**Solutions:**
1. Check if website is accessible: `curl https://procurementforecast.hhs.gov`
2. Run with `headless: false` to see browser
3. Check console logs for specific errors
4. Verify selectors haven't changed

### Problem: Timeout errors

**Solutions:**
1. Increase timeout in config (default: 90s)
2. Check network connectivity
3. Run during off-peak hours

### Problem: Parse errors

**Solutions:**
1. Check the `raw_data` field in records
2. Verify field names in source HTML
3. Update `findField` keys in parser

### Problem: Missing data fields

**Solutions:**
1. Check if fields are optional in source
2. Verify field name variations
3. Add fallback field names to `findField` calls

## Performance Tips

1. **Run during off-peak hours** - Faster page loads
2. **Cache results** - Store in database, refresh daily
3. **Filter early** - Apply filters after scraping, not during
4. **Use pagination limits** - If only recent data needed

## File Locations

| File | Purpose |
|------|---------|
| `/src/lib/forecasts/scrapers/hhs.ts` | Main scraper |
| `/src/lib/forecasts/scrapers/index.ts` | Scraper registry |
| `/src/lib/forecasts/types.ts` | Shared types |
| `/scripts/test-hhs-scraper.ts` | Test runner |
| `/docs/hhs-scraper-guide.md` | This guide |

## Support

For issues or questions:
- Check logs: `console.log` statements throughout scraper
- Review errors: `result.errors` array
- Inspect raw data: `record.raw_data` field
- Test selectors: Use browser dev tools on source site

---

**Last Updated:** April 5, 2026

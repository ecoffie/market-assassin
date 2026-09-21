# DHS Scraper - Quick Start

## 1-Minute Test

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npx tsx scripts/test-dhs-scraper.ts
```

## Expected Output

```
Success: true
Records: 100-500
Errors: 0
Timing: 15-30s
```

## Save Results

```bash
npx tsx scripts/test-dhs-scraper.ts --save output.json
```

## Programmatic Usage

```typescript
import { scrapeDHS } from '@/lib/forecasts/scrapers/dhs-apfs';

const result = await scrapeDHS();
console.log(`Got ${result.records.length} forecasts`);
```

## Import to Database

```bash
node scripts/import-forecasts.js --source=DHS
```

## Full Documentation

- **Usage Guide:** src/lib/forecasts/scrapers/DHS-USAGE.md
- **General README:** src/lib/forecasts/scrapers/README.md
- **Build Summary:** SCRAPER-BUILD-SUMMARY.md

## Key Files

- **Scraper:** src/lib/forecasts/scrapers/dhs-apfs.ts
- **Test:** scripts/test-dhs-scraper.ts
- **Types:** src/lib/forecasts/types.ts

---

**Target:** https://apfs-cloud.dhs.gov/forecast/
**Coverage:** ~$8B in DHS procurement forecasts
**Records:** 100-500 opportunities (6-18 months ahead)

#!/usr/bin/env tsx

/**
 * Test HHS Procurement Forecast Scraper (TypeScript version)
 *
 * Usage:
 *   npx tsx scripts/test-hhs-scraper.ts
 *   OR
 *   ts-node scripts/test-hhs-scraper.ts
 */

import { testHHSForecastScraper } from '../src/lib/forecasts/scrapers/hhs';

async function main() {
  try {
    await testHHSForecastScraper();
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();

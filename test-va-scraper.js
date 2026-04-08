#!/usr/bin/env node

/**
 * Test VA Vendor Portal Scraper
 */

import { scrapeVA } from './src/lib/forecasts/scrapers/va-vendor-portal.ts';

async function main() {
  console.log('Testing VA Vendor Portal scraper...\n');

  const result = await scrapeVA();

  console.log(`\n=== Results ===`);
  console.log(`Success: ${result.success}`);
  console.log(`Records found: ${result.records.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Timing: ${result.timing}ms`);

  if (result.errors.length > 0) {
    console.log(`\n=== Errors ===`);
    result.errors.forEach((err, i) => {
      console.log(`${i + 1}. ${err}`);
    });
  }

  if (result.records.length > 0) {
    console.log(`\n=== Sample Records (first 3) ===`);
    result.records.slice(0, 3).forEach((record, i) => {
      console.log(`\n--- Record ${i + 1} ---`);
      console.log(`Title: ${record.title}`);
      console.log(`NAICS: ${record.naics_code || 'N/A'}`);
      console.log(`Office: ${record.contracting_office || record.bureau || 'N/A'}`);
      console.log(`Value: ${record.estimated_value_range || 'N/A'}`);
      console.log(`FY: ${record.fiscal_year || 'N/A'}`);
      console.log(`Set-Aside: ${record.set_aside_type || 'N/A'}`);
    });
  } else {
    console.log(`\nNo records extracted. This may mean:`);
    console.log(`  - Authentication required`);
    console.log(`  - Page structure changed`);
    console.log(`  - No forecasts currently posted`);
  }
}

main().catch(console.error);

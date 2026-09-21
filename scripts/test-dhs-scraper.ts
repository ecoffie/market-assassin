#!/usr/bin/env tsx
/**
 * Test DHS APFS Scraper
 *
 * Usage:
 *   npx tsx scripts/test-dhs-scraper.ts
 *   npx tsx scripts/test-dhs-scraper.ts --verbose
 *   npx tsx scripts/test-dhs-scraper.ts --save [output.json]
 */

import { scrapeDHS } from '../src/lib/forecasts/scrapers/dhs-apfs.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const saveIndex = args.indexOf('--save');
  const outputFile = saveIndex !== -1 ? args[saveIndex + 1] : null;

  console.log('========================================');
  console.log('DHS APFS Scraper Test');
  console.log('========================================\n');
  console.log('Target: https://apfs-cloud.dhs.gov/forecast/');
  console.log('Strategy: API interception + table scraping fallback\n');

  console.log('Starting scraper...\n');
  const startTime = Date.now();
  const result = await scrapeDHS();
  const duration = Date.now() - startTime;

  console.log('========================================');
  console.log('RESULTS');
  console.log('========================================');
  console.log(`Success: ${result.success}`);
  console.log(`Records: ${result.records.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Timing: ${(result.timing / 1000).toFixed(2)}s`);

  if (result.errors.length > 0) {
    console.log('\n========================================');
    console.log('ERRORS');
    console.log('========================================');
    result.errors.forEach((error, idx) => {
      console.log(`${idx + 1}. ${error}`);
    });
  }

  if (result.records.length > 0) {
    console.log('\n========================================');
    console.log('SAMPLE RECORDS (First 3)');
    console.log('========================================');
    result.records.slice(0, 3).forEach((record, idx) => {
      console.log(`\n--- Record ${idx + 1} ---`);
      console.log(`Title: ${record.title}`);
      console.log(`Bureau: ${record.bureau || 'N/A'}`);
      console.log(`NAICS: ${record.naics_code || 'N/A'}`);
      console.log(`Value: ${record.estimated_value_range || 'N/A'}`);
      console.log(`Contract Type: ${record.contract_type || 'N/A'}`);
      console.log(`Location: ${record.pop_city ? `${record.pop_city}, ${record.pop_state}` : record.pop_state || 'N/A'}`);
      console.log(`Set-Aside: ${record.set_aside_type || 'N/A'}`);
      console.log(`External ID: ${record.external_id}`);
    });

    console.log('\n========================================');
    console.log('FULL FIRST RECORD (JSON)');
    console.log('========================================');
    console.log(JSON.stringify(result.records[0], null, 2));
  }

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Total records scraped: ${result.records.length}`);
  console.log(`Success rate: ${result.success ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Total time: ${(duration / 1000).toFixed(2)}s`);

  if (result.records.length > 0) {
    const withNAICS = result.records.filter(r => r.naics_code).length;
    const withValue = result.records.filter(r => r.estimated_value_min || r.estimated_value_max).length;
    const withLocation = result.records.filter(r => r.pop_state).length;
    const withBureau = result.records.filter(r => r.bureau).length;
    const withContractType = result.records.filter(r => r.contract_type).length;

    console.log(`\nData Quality:`);
    console.log(`  - With NAICS: ${withNAICS}/${result.records.length} (${((withNAICS/result.records.length)*100).toFixed(1)}%)`);
    console.log(`  - With Value: ${withValue}/${result.records.length} (${((withValue/result.records.length)*100).toFixed(1)}%)`);
    console.log(`  - With Location: ${withLocation}/${result.records.length} (${((withLocation/result.records.length)*100).toFixed(1)}%)`);
    console.log(`  - With Bureau: ${withBureau}/${result.records.length} (${((withBureau/result.records.length)*100).toFixed(1)}%)`);
    console.log(`  - With Contract Type: ${withContractType}/${result.records.length} (${((withContractType/result.records.length)*100).toFixed(1)}%)`);

    // Source type breakdown
    const sourceTypes = result.records.reduce((acc, r) => {
      acc[r.source_type] = (acc[r.source_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`\nSource Types:`);
    Object.entries(sourceTypes).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count} records`);
    });
  }

  // Save to file if requested
  if (outputFile) {
    const outputPath = path.resolve(outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n✓ Results saved to: ${outputPath}`);
  }

  // Show verbose output if requested
  if (verbose && result.records.length > 0) {
    console.log('\n========================================');
    console.log('ALL RECORDS (VERBOSE)');
    console.log('========================================');
    result.records.forEach((record, idx) => {
      console.log(`\n--- Record ${idx + 1}/${result.records.length} ---`);
      console.log(JSON.stringify(record, null, 2));
    });
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Test script for EPA Forecast Scraper
 *
 * Usage:
 *   node scripts/test-epa-scraper.js
 */

const path = require('path');

async function main() {
  console.log('='.repeat(60));
  console.log('EPA Forecast Scraper Test');
  console.log('='.repeat(60));
  console.log();

  try {
    // Dynamic import for ES module
    const scraperModule = await import(path.join(process.cwd(), 'src/lib/forecasts/scrapers/epa.ts'));
    const { scrapeEPA } = scraperModule;

    const startTime = Date.now();
    console.log('Starting scraper...\n');

    const records = await scrapeEPA();
    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Records found: ${records.length}`);
    console.log();

    if (records.length > 0) {
      console.log('Sample records (first 3):');
      console.log('-'.repeat(60));

      records.slice(0, 3).forEach((record, i) => {
        console.log(`\n[${i + 1}] ${record.title}`);
        console.log(`    Agency: ${record.agency}`);
        if (record.naics) console.log(`    NAICS: ${record.naics}`);
        if (record.psc) console.log(`    PSC: ${record.psc}`);
        if (record.valueRange) console.log(`    Value: ${record.valueRange}`);
        if (record.fiscalYear) console.log(`    FY: ${record.fiscalYear}`);
        if (record.quarter) console.log(`    Quarter: ${record.quarter}`);
        if (record.setAside) console.log(`    Set-Aside: ${record.setAside}`);
        if (record.office) console.log(`    Office: ${record.office}`);
        if (record.contact?.name || record.contact?.email) {
          console.log(`    Contact: ${record.contact.name || ''} ${record.contact.email || ''}`);
        }
      });

      console.log('\n' + '='.repeat(60));
      console.log('FIELD COVERAGE');
      console.log('='.repeat(60));

      const coverage = {
        title: records.filter(r => r.title).length,
        description: records.filter(r => r.description).length,
        naics: records.filter(r => r.naics).length,
        psc: records.filter(r => r.psc).length,
        fiscalYear: records.filter(r => r.fiscalYear).length,
        quarter: records.filter(r => r.quarter).length,
        awardDate: records.filter(r => r.awardDate).length,
        valueRange: records.filter(r => r.valueRange).length,
        setAside: records.filter(r => r.setAside).length,
        contractType: records.filter(r => r.contractType).length,
        incumbent: records.filter(r => r.incumbent).length,
        office: records.filter(r => r.office).length,
        contact: records.filter(r => r.contact?.name || r.contact?.email).length,
      };

      Object.entries(coverage).forEach(([field, count]) => {
        const percentage = ((count / records.length) * 100).toFixed(1);
        console.log(`${field.padEnd(20)}: ${count.toString().padStart(4)} / ${records.length} (${percentage}%)`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR');
    console.error('='.repeat(60));
    console.error(error);
    process.exit(1);
  }
}

main();

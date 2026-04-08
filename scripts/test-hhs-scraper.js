/**
 * Test HHS Procurement Forecast Scraper
 *
 * Usage:
 *   node scripts/test-hhs-scraper.js
 */

// Import the compiled TypeScript scraper
async function testScraper() {
  console.log('Loading HHS Forecast scraper...\n');

  try {
    // Dynamic import of the TypeScript file
    const { scrapeHHSForecast } = require('../src/lib/forecasts/scrapers/hhs.ts');

    console.log('Starting HHS Procurement Forecast scraper test...');
    console.log('Target: https://procurementforecast.hhs.gov');
    console.log('=' .repeat(60) + '\n');

    const startTime = Date.now();
    const result = await scrapeHHSForecast();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Agency: ${result.agency}`);
    console.log(`Records Found: ${result.records.length}`);
    console.log(`Errors: ${result.errors.length}`);
    console.log(`Duration: ${duration}s`);

    if (result.records.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('SAMPLE RECORDS (First 5)');
      console.log('='.repeat(60));

      result.records.slice(0, 5).forEach((record, index) => {
        console.log(`\n[${index + 1}] ${record.title}`);
        console.log(`    NAICS: ${record.naics_code || 'N/A'}`);
        console.log(`    PSC: ${record.psc_code || 'N/A'}`);
        console.log(`    Value: ${record.estimated_value_range || 'N/A'}`);
        console.log(`    Min: ${record.estimated_value_min ? '$' + record.estimated_value_min.toLocaleString() : 'N/A'}`);
        console.log(`    Max: ${record.estimated_value_max ? '$' + record.estimated_value_max.toLocaleString() : 'N/A'}`);
        console.log(`    FY: ${record.fiscal_year || 'N/A'}`);
        console.log(`    Quarter: ${record.anticipated_quarter || 'N/A'}`);
        console.log(`    Award Date: ${record.anticipated_award_date || 'N/A'}`);
        console.log(`    Set-Aside: ${record.set_aside_type || 'N/A'}`);
        console.log(`    Contract Type: ${record.contract_type || 'N/A'}`);
        console.log(`    Bureau: ${record.bureau || 'N/A'}`);
        console.log(`    Office: ${record.contracting_office || 'N/A'}`);
        console.log(`    Incumbent: ${record.incumbent_name || 'N/A'}`);
        console.log(`    POC: ${record.poc_name || 'N/A'}`);
        if (record.poc_email) console.log(`    Email: ${record.poc_email}`);
        if (record.poc_phone) console.log(`    Phone: ${record.poc_phone}`);
      });

      console.log('\n' + '='.repeat(60));
      console.log('DATA QUALITY STATISTICS');
      console.log('='.repeat(60));

      const stats = {
        withTitle: result.records.filter(r => r.title).length,
        withNaics: result.records.filter(r => r.naics_code).length,
        withPsc: result.records.filter(r => r.psc_code).length,
        withValue: result.records.filter(r => r.estimated_value_min).length,
        withFY: result.records.filter(r => r.fiscal_year).length,
        withQuarter: result.records.filter(r => r.anticipated_quarter).length,
        withAwardDate: result.records.filter(r => r.anticipated_award_date).length,
        withSetAside: result.records.filter(r => r.set_aside_type).length,
        withContractType: result.records.filter(r => r.contract_type).length,
        withIncumbent: result.records.filter(r => r.incumbent_name).length,
        withPOC: result.records.filter(r => r.poc_name).length,
        withEmail: result.records.filter(r => r.poc_email).length,
      };

      const total = result.records.length;
      Object.entries(stats).forEach(([key, count]) => {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`  ${key}: ${count} (${pct}%)`);
      });

      // Export sample to file
      const fs = require('fs');
      const path = require('path');
      const outputPath = path.join(__dirname, 'hhs-forecast-sample.json');
      fs.writeFileSync(outputPath, JSON.stringify(result.records.slice(0, 10), null, 2));
      console.log(`\n✅ Saved 10 sample records to: ${outputPath}`);
    }

    if (result.errors.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('ERRORS');
      console.log('='.repeat(60));
      result.errors.forEach((error, index) => {
        console.log(`  [${index + 1}] ${error}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ FATAL ERROR:');
    console.error(error);
    process.exit(1);
  }
}

testScraper();

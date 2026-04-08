/**
 * Simple test runner for GSA scraper
 * Uses .mjs to avoid TypeScript compilation
 */

import { testGSAScraper } from '../src/lib/forecasts/scrapers/gsa-acquisition-gateway.js';

console.log('Starting GSA Acquisition Gateway scraper test...\n');

testGSAScraper()
  .then(() => {
    console.log('\n✓ Test complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  });

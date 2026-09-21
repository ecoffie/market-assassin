#!/usr/bin/env node
/**
 * Simple test script for Treasury and EPA scrapers
 *
 * Usage:
 *   node scripts/test-scrapers-simple.js treasury
 *   node scripts/test-scrapers-simple.js epa
 *   node scripts/test-scrapers-simple.js both
 */

const puppeteer = require('puppeteer');

// Treasury scraper test
async function testTreasury() {
  console.log('\n=== TREASURY SCRAPER TEST ===\n');
  const startTime = Date.now();

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('Loading Treasury OSDBU site...');

    try {
      await page.goto('https://osdbu.forecast.treasury.gov/', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      console.log('✓ Page loaded successfully');
    } catch (e) {
      console.log('✗ Main URL failed, trying alternate...');
      await page.goto('https://sbecs.treas.gov/forecast', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      console.log('✓ Alternate page loaded successfully');
    }

    // Wait for Angular
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check for common elements
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        hasMatTable: !!document.querySelector('mat-table, .mat-table, table.mat-table'),
        hasTable: !!document.querySelector('table'),
        hasCards: !!document.querySelector('mat-card, .mat-card, .forecast-card'),
        tableCount: document.querySelectorAll('table').length,
        bodyText: document.body.innerText.substring(0, 500),
      };
    });

    console.log('\nPage Analysis:');
    console.log('  Title:', pageInfo.title);
    console.log('  Has Angular Material Table:', pageInfo.hasMatTable);
    console.log('  Has Standard Table:', pageInfo.hasTable);
    console.log('  Has Cards:', pageInfo.hasCards);
    console.log('  Table Count:', pageInfo.tableCount);
    console.log('\nPage Preview:');
    console.log('  ', pageInfo.bodyText.substring(0, 200).replace(/\n/g, '\n   '));

    await browser.close();

    const duration = Date.now() - startTime;
    console.log(`\n✓ Treasury test completed in ${(duration / 1000).toFixed(2)}s`);
    return true;

  } catch (error) {
    console.error('\n✗ Treasury test failed:', error.message);
    return false;
  }
}

// EPA scraper test
async function testEPA() {
  console.log('\n=== EPA SCRAPER TEST ===\n');
  const startTime = Date.now();

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('Loading EPA Forecast site...');

    await page.goto('https://ofmpub.epa.gov/apex/forecast/f?p=forecast', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    console.log('✓ Page loaded successfully');

    // Wait for APEX to render
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check for common elements
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        hasApexTable: !!document.querySelector('table.a-IRR-table, table.apexir_WORKSHEET_DATA'),
        hasTable: !!document.querySelector('table'),
        hasReport: !!document.querySelector('.a-Report-table'),
        tableCount: document.querySelectorAll('table').length,
        hasPagination: !!document.querySelector('.a-IRR-pagination, button.a-Button--next'),
        bodyText: document.body.innerText.substring(0, 500),
      };
    });

    console.log('\nPage Analysis:');
    console.log('  Title:', pageInfo.title);
    console.log('  Has APEX Table:', pageInfo.hasApexTable);
    console.log('  Has Standard Table:', pageInfo.hasTable);
    console.log('  Has Report Table:', pageInfo.hasReport);
    console.log('  Table Count:', pageInfo.tableCount);
    console.log('  Has Pagination:', pageInfo.hasPagination);
    console.log('\nPage Preview:');
    console.log('  ', pageInfo.bodyText.substring(0, 200).replace(/\n/g, '\n   '));

    await browser.close();

    const duration = Date.now() - startTime;
    console.log(`\n✓ EPA test completed in ${(duration / 1000).toFixed(2)}s`);
    return true;

  } catch (error) {
    console.error('\n✗ EPA test failed:', error.message);
    return false;
  }
}

// Main
async function main() {
  const target = process.argv[2] || 'both';

  console.log('='.repeat(60));
  console.log('FORECAST SCRAPERS TEST');
  console.log('='.repeat(60));

  let treasurySuccess = true;
  let epaSuccess = true;

  if (target === 'treasury' || target === 'both') {
    treasurySuccess = await testTreasury();
  }

  if (target === 'epa' || target === 'both') {
    epaSuccess = await testEPA();
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  if (target === 'treasury' || target === 'both') {
    console.log(`Treasury: ${treasurySuccess ? '✓ PASS' : '✗ FAIL'}`);
  }
  if (target === 'epa' || target === 'both') {
    console.log(`EPA:      ${epaSuccess ? '✓ PASS' : '✗ FAIL'}`);
  }

  const allSuccess = treasurySuccess && epaSuccess;
  console.log('\nOverall: ' + (allSuccess ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'));
  console.log('='.repeat(60));

  process.exit(allSuccess ? 0 : 1);
}

main();

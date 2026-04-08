/**
 * Test script for GSA Acquisition Gateway scraper
 * Analyzes the page structure and tests data extraction
 */

import puppeteer from 'puppeteer';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function analyzePage() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Set to true for production
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('Navigating to https://acquisitiongateway.gov/forecast...');
  await page.goto('https://acquisitiongateway.gov/forecast', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  // Wait for the page to fully load
  await sleep(5000);

  console.log('\n=== Page Analysis ===\n');

  // Check if there are any tables
  const tables = await page.$$('table');
  console.log(`Tables found: ${tables.length}`);

  // Check for common data container classes
  const containers = await page.evaluate(() => {
    const selectors = [
      'table',
      '.forecast-list',
      '.results-grid',
      '.data-table',
      '[role="grid"]',
      '.card-container',
      '.forecast-item',
      '.results',
    ];

    const found: string[] = [];
    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        found.push(`${selector}: ${elements.length} elements`);
      }
    });

    return found;
  });

  console.log('Data containers found:');
  containers.forEach(c => console.log(`  - ${c}`));

  // Extract all visible text content to understand structure
  const pageStructure = await page.evaluate(() => {
    const structure: any = {};

    // Get all headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    structure.headings = headings.map(h => ({
      tag: h.tagName,
      text: h.textContent?.trim(),
    }));

    // Check for filters
    const filters = Array.from(document.querySelectorAll('select, input[type="text"], input[type="search"]'));
    structure.filters = filters.map(f => ({
      type: f.tagName,
      name: (f as HTMLElement).getAttribute('name'),
      id: (f as HTMLElement).getAttribute('id'),
      placeholder: (f as HTMLInputElement).placeholder,
    }));

    // Check for buttons
    const buttons = Array.from(document.querySelectorAll('button'));
    structure.buttons = buttons.slice(0, 10).map(b => ({
      text: b.textContent?.trim(),
      class: b.className,
    }));

    // Look for data rows
    const rows = Array.from(document.querySelectorAll('tr, .row, .item, .card'));
    structure.rowCount = rows.length;

    return structure;
  });

  console.log('\nPage structure:');
  console.log(JSON.stringify(pageStructure, null, 2));

  // Take a screenshot
  await page.screenshot({ path: '/tmp/gsa-forecast-page.png', fullPage: true });
  console.log('\nScreenshot saved to /tmp/gsa-forecast-page.png');

  // Try to extract some sample data
  const sampleData = await page.evaluate(() => {
    const samples: any[] = [];

    // Try to find table rows
    const rows = document.querySelectorAll('tbody tr, .data-row, .forecast-item');

    Array.from(rows).slice(0, 3).forEach((row, i) => {
      const sample: any = { index: i };

      // Get all cells
      const cells = row.querySelectorAll('td, .cell, [role="cell"]');
      sample.cellCount = cells.length;
      sample.cells = Array.from(cells).map(c => c.textContent?.trim());

      // Get all text content
      sample.fullText = row.textContent?.trim();

      samples.push(sample);
    });

    return samples;
  });

  console.log('\nSample data rows:');
  console.log(JSON.stringify(sampleData, null, 2));

  // Check network requests for API calls
  console.log('\nMonitoring network requests for 10 seconds...');
  const apiCalls: string[] = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('api') || url.includes('forecast') || url.includes('json')) {
      apiCalls.push(`${response.request().method()} ${url} - ${response.status()}`);
    }
  });

  await sleep(10000);

  console.log('\nAPI calls detected:');
  apiCalls.forEach(call => console.log(`  - ${call}`));

  await browser.close();
  console.log('\nAnalysis complete!');
}

// Run the analysis
analyzePage().catch(console.error);

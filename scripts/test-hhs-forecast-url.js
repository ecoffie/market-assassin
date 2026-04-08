/**
 * Test script to analyze HHS Procurement Forecast website structure
 * URL: https://procurementforecast.hhs.gov
 */

const puppeteer = require('puppeteer');

async function analyzeHHSForecastSite() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Set to false to see what's happening
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('Navigating to https://procurementforecast.hhs.gov...');

  try {
    await page.goto('https://procurementforecast.hhs.gov', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('Page loaded successfully!');

    // Wait a bit for any JS to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Analyze page structure
    const analysis = await page.evaluate(() => {
      const results = {
        title: document.title,
        url: window.location.href,
        hasTable: false,
        tableInfo: {},
        hasPagination: false,
        paginationInfo: {},
        hasFilters: false,
        filterInfo: {},
        hasSearchInput: false,
        searchInfo: {},
        possibleSelectors: [],
        sampleText: '',
      };

      // Check for tables
      const tables = document.querySelectorAll('table');
      if (tables.length > 0) {
        results.hasTable = true;
        results.tableInfo = {
          count: tables.length,
          firstTableHeaders: [],
          firstTableRowCount: 0,
        };

        const firstTable = tables[0];
        const headers = firstTable.querySelectorAll('thead th, th');
        headers.forEach(h => results.tableInfo.firstTableHeaders.push(h.textContent.trim()));

        const rows = firstTable.querySelectorAll('tbody tr, tr');
        results.tableInfo.firstTableRowCount = rows.length;
      }

      // Check for data grids/cards
      const dataGrids = document.querySelectorAll('[role="grid"], .data-grid, .results-grid, .forecast-list, .list-group');
      if (dataGrids.length > 0) {
        results.possibleSelectors.push({
          type: 'data-grid',
          selector: '[role="grid"], .data-grid, .results-grid, .forecast-list',
          count: dataGrids.length,
        });
      }

      // Check for pagination
      const paginationElements = document.querySelectorAll('.pagination, [role="navigation"][aria-label*="pagination"], .pager, nav[class*="pag"]');
      if (paginationElements.length > 0) {
        results.hasPagination = true;
        results.paginationInfo = {
          count: paginationElements.length,
          className: paginationElements[0].className,
        };
      }

      // Check for filters
      const filterElements = document.querySelectorAll('select, input[type="checkbox"], .filter, .filters, [class*="filter"]');
      if (filterElements.length > 0) {
        results.hasFilters = true;
        results.filterInfo = {
          count: filterElements.length,
          types: [],
        };

        filterElements.forEach(el => {
          if (el.tagName === 'SELECT') {
            results.filterInfo.types.push(`select#${el.id || el.className}`);
          } else if (el.tagName === 'INPUT') {
            results.filterInfo.types.push(`input[type="${el.type}"]#${el.id || el.className}`);
          }
        });
      }

      // Check for search input
      const searchInputs = document.querySelectorAll('input[type="search"], input[placeholder*="search" i], #search, .search-input');
      if (searchInputs.length > 0) {
        results.hasSearchInput = true;
        results.searchInfo = {
          count: searchInputs.length,
          firstId: searchInputs[0].id,
          firstPlaceholder: searchInputs[0].placeholder,
        };
      }

      // Get sample text from page
      const bodyText = document.body.textContent || '';
      results.sampleText = bodyText.substring(0, 500).trim();

      return results;
    });

    console.log('\n========== PAGE ANALYSIS ==========');
    console.log(JSON.stringify(analysis, null, 2));

    // Take a screenshot
    await page.screenshot({
      path: '/Users/ericcoffie/Market Assasin/market-assassin/scripts/hhs-forecast-screenshot.png',
      fullPage: true
    });
    console.log('\nScreenshot saved to: scripts/hhs-forecast-screenshot.png');

    // Get HTML of main content area
    const mainContent = await page.evaluate(() => {
      const main = document.querySelector('main, #main, .main-content, .content, article');
      return main ? main.outerHTML.substring(0, 5000) : document.body.outerHTML.substring(0, 5000);
    });

    console.log('\n========== HTML SAMPLE ==========');
    console.log(mainContent);

  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\nKeeping browser open for 30 seconds for manual inspection...');
  await new Promise(resolve => setTimeout(resolve, 30000));

  await browser.close();
  console.log('Done!');
}

analyzeHHSForecastSite().catch(console.error);

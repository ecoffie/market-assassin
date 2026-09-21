#!/usr/bin/env node

/**
 * GSA Acquisition Gateway Scraper - Test Runner
 *
 * This script tests the GSA forecast scraper and optionally saves results to database.
 *
 * Usage:
 *   node scripts/run-gsa-scraper.js              # Test only (dry run)
 *   node scripts/run-gsa-scraper.js --save       # Save to database
 *   node scripts/run-gsa-scraper.js --verbose    # Show detailed output
 */

const puppeteer = require('puppeteer');

// Configuration
const GSA_CONFIG = {
  agency_code: 'GSA',
  agency_name: 'General Services Administration',
  source_url: 'https://acquisitiongateway.gov/forecast',
  timeout: 60000,
};

// Parse command line args
const args = process.argv.slice(2);
const saveToDb = args.includes('--save');
const verbose = args.includes('--verbose');

/**
 * Main scraper function
 */
async function scrapeGSA() {
  const startTime = Date.now();
  const records = [];
  const errors = [];

  console.log('=== GSA Acquisition Gateway Scraper ===\n');
  console.log(`URL: ${GSA_CONFIG.source_url}`);
  console.log(`Mode: ${saveToDb ? 'SAVE TO DATABASE' : 'DRY RUN'}\n`);

  let browser;

  try {
    // Step 1: Try API approach first
    console.log('[1/3] Attempting API fetch...');

    const apiEndpoints = [
      'https://acquisitiongateway.gov/api/v1/forecasts',
      'https://acquisitiongateway.gov/api/forecast/search',
      'https://api.acquisitiongateway.gov/forecasts',
    ];

    for (const endpoint of apiEndpoints) {
      try {
        if (verbose) console.log(`  Trying: ${endpoint}`);

        const response = await fetch(endpoint, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          const items = Array.isArray(data) ? data : data.results || data.forecasts || data.data || [];

          console.log(`  ✓ API returned ${items.length} items from ${endpoint}`);

          if (items.length > 0) {
            // Parse API records
            for (const item of items) {
              const record = parseAPIRecord(item);
              if (record) records.push(record);
            }
            break;
          }
        }
      } catch (e) {
        if (verbose) console.log(`  ✗ ${endpoint} failed: ${e.message}`);
      }
    }

    if (records.length === 0) {
      console.log('  ℹ API returned no usable data, falling back to Puppeteer\n');
    }

    // Step 2: Puppeteer scraping (fallback or primary if API failed)
    if (records.length === 0) {
      console.log('[2/3] Launching Puppeteer scraper...');

      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      console.log(`  Navigating to ${GSA_CONFIG.source_url}...`);

      try {
        await page.goto(GSA_CONFIG.source_url, {
          waitUntil: 'networkidle2',
          timeout: GSA_CONFIG.timeout,
        });
      } catch (e) {
        throw new Error(`Failed to load page: ${e.message}`);
      }

      // Wait for content to render
      console.log('  Waiting for JavaScript to render...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Try to expand/show all results
      console.log('  Looking for pagination controls...');
      try {
        const expandSelectors = [
          'button:has-text("Show All")',
          'button:has-text("View All")',
          'select[name="pageSize"]',
          '.page-size-select',
        ];

        for (const selector of expandSelectors) {
          try {
            await page.click(selector, { timeout: 2000 });
            console.log(`  ✓ Clicked: ${selector}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch {
            // Continue
          }
        }
      } catch {
        console.log('  No pagination controls found');
      }

      // Extract data from page
      console.log('  Extracting forecast data...');

      const tableData = await page.evaluate(() => {
        const rows = [];

        // Try multiple container types
        const containers = document.querySelectorAll(
          'table, .forecast-list, .results-grid, .data-table, [role="grid"], .card-container'
        );

        containers.forEach(container => {
          // Get headers
          const headerCells = container.querySelectorAll('thead th, .header-cell, [role="columnheader"]');
          const headers = Array.from(headerCells).map(cell =>
            (cell.textContent || '').trim().toLowerCase()
          );

          // Get data rows
          const dataRows = container.querySelectorAll(
            'tbody tr, .data-row, .forecast-item, .card, [role="row"]:not([role="columnheader"])'
          );

          dataRows.forEach(row => {
            const rowData = {};
            const cells = row.querySelectorAll('td, .cell, [role="cell"]');

            if (cells.length > 0 && headers.length > 0) {
              cells.forEach((cell, index) => {
                const header = headers[index] || `col${index}`;
                rowData[header] = (cell.textContent || '').trim();
              });
            }

            if (Object.keys(rowData).length > 2) {
              rows.push(rowData);
            }
          });
        });

        // Also check for embedded JSON data (React apps often include this)
        const scripts = document.querySelectorAll('script[type="application/json"]');
        scripts.forEach(script => {
          try {
            const data = JSON.parse(script.textContent || '');
            if (Array.isArray(data) && data.length > 0) {
              data.forEach(item => {
                if (typeof item === 'object' && item !== null) {
                  const rowData = {};
                  Object.entries(item).forEach(([key, value]) => {
                    rowData[key.toLowerCase()] = String(value);
                  });
                  if (Object.keys(rowData).length > 2) {
                    rows.push(rowData);
                  }
                }
              });
            }
          } catch {
            // Not valid JSON
          }
        });

        return rows;
      });

      console.log(`  ✓ Extracted ${tableData.length} rows\n`);

      // Parse extracted rows
      for (const row of tableData) {
        try {
          const record = parseTableRow(row);
          if (record) records.push(record);
        } catch (e) {
          errors.push(`Parse error: ${e.message}`);
        }
      }

      await browser.close();
    } else {
      console.log('[2/3] Skipping Puppeteer (API data available)\n');
    }

    // Step 3: Save to database if requested
    if (saveToDb && records.length > 0) {
      console.log('[3/3] Saving to database...');
      console.log('  ⚠ Database save not implemented in this test script');
      console.log('  To save records, use the import-forecasts.js script or API endpoint');
    } else {
      console.log('[3/3] Skipping database save (dry run mode)\n');
    }

    // Summary
    const timing = Date.now() - startTime;

    console.log('=== Results ===');
    console.log(`✓ Success: ${errors.length === 0 || records.length > 0}`);
    console.log(`  Records: ${records.length}`);
    console.log(`  Errors: ${errors.length}`);
    console.log(`  Timing: ${(timing / 1000).toFixed(2)}s`);

    if (records.length > 0) {
      console.log('\n=== Sample Record ===');
      console.log(JSON.stringify(records[0], null, 2));
    }

    if (errors.length > 0 && verbose) {
      console.log('\n=== Errors ===');
      errors.forEach(e => console.log(`  - ${e}`));
    }

    if (records.length === 0) {
      console.log('\n⚠ No records extracted. This could mean:');
      console.log('  1. The page structure has changed');
      console.log('  2. The page requires authentication');
      console.log('  3. The forecast data is not currently published');
      console.log('  4. JavaScript is blocking automated access');
    }

    return {
      success: records.length > 0,
      records,
      errors,
      timing,
    };

  } catch (error) {
    console.error('\n✗ Scraper failed:', error.message);
    if (browser) await browser.close();
    return {
      success: false,
      records: [],
      errors: [error.message],
      timing: Date.now() - startTime,
    };
  }
}

/**
 * Parse API record into ForecastRecord format
 */
function parseAPIRecord(item) {
  const getString = (keys) => {
    for (const key of keys) {
      const value = item[key] || item[key.toLowerCase()] || item[key.toUpperCase()];
      if (value != null) return String(value);
    }
    return undefined;
  };

  const title = getString(['title', 'name', 'description', 'requirementTitle']);
  const naics = getString(['naics', 'naicsCode', 'naics_code']);

  if (!title && !naics) return null;

  return {
    source_agency: getString(['agency', 'department']) || 'GSA',
    source_type: 'api',
    source_url: GSA_CONFIG.source_url,
    external_id: getString(['id', 'forecastId']) || `GSA-${Date.now()}`,
    title: title || `GSA Forecast - ${naics}`,
    description: getString(['description', 'synopsis', 'summary']),
    naics_code: normalizeNaics(naics),
    psc_code: getString(['psc', 'pscCode']),
    fiscal_year: normalizeFY(getString(['fiscalYear', 'fy'])),
    anticipated_quarter: getString(['quarter', 'anticipatedQuarter']),
    estimated_value_range: getString(['estimatedValue', 'value']),
    set_aside_type: getString(['setAside', 'setAsideType']),
    contract_type: getString(['contractType', 'type']),
  };
}

/**
 * Parse table row into ForecastRecord format
 */
function parseTableRow(row) {
  const findField = (keys) => {
    for (const key of keys) {
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase().includes(key.toLowerCase()) && v) {
          return v;
        }
      }
    }
    return undefined;
  };

  const title = findField(['title', 'name', 'requirement']);
  const naics = findField(['naics']);

  if (!title && !naics) return null;

  return {
    source_agency: findField(['agency']) || 'GSA',
    source_type: 'puppeteer',
    source_url: GSA_CONFIG.source_url,
    external_id: `GSA-${naics || 'UNK'}-${Date.now()}`,
    title: title || `GSA Forecast - ${naics}`,
    description: findField(['description', 'synopsis']),
    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc']),
    fiscal_year: normalizeFY(findField(['fiscal', 'year'])),
    anticipated_quarter: findField(['quarter']),
    estimated_value_range: findField(['value', 'estimate']),
    set_aside_type: findField(['set-aside', 'setaside']),
    contract_type: findField(['contract type', 'type']),
  };
}

/**
 * Normalize NAICS code
 */
function normalizeNaics(code) {
  if (!code) return undefined;
  const match = code.toString().match(/(\d{4,6})/);
  return match ? match[1] : undefined;
}

/**
 * Normalize fiscal year
 */
function normalizeFY(fy) {
  if (!fy) return undefined;
  const str = fy.toString();
  if (str.match(/^FY\d{2,4}$/i)) return str.toUpperCase();
  if (str.match(/^\d{4}$/)) return `FY${str}`;
  if (str.match(/^\d{2}$/)) return `FY20${str}`;
  return str;
}

// Run the scraper
scrapeGSA()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

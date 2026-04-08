/**
 * HHS Procurement Forecast Scraper
 * URL: https://procurementforecast.hhs.gov
 *
 * Scrapes HHS procurement forecast data using Puppeteer.
 * Estimated coverage: $12B in forecasted opportunities.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const HHS_FORECAST_CONFIG = {
  agency_code: 'HHS',
  agency_name: 'Department of Health and Human Services',
  source_url: 'https://procurementforecast.hhs.gov',
  timeout: 90000,
};

/**
 * Scrape HHS Procurement Forecast data using Puppeteer
 */
export async function scrapeHHSForecast(): Promise<ScraperResult> {
  const startTime = Date.now();
  const records: ForecastRecord[] = [];
  const errors: string[] = [];

  try {
    const puppeteer = await import('puppeteer');

    console.log('[HHS Forecast] Launching browser...');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`[HHS Forecast] Loading ${HHS_FORECAST_CONFIG.source_url}...`);

    try {
      await page.goto(HHS_FORECAST_CONFIG.source_url, {
        waitUntil: 'networkidle2',
        timeout: HHS_FORECAST_CONFIG.timeout,
      });

      console.log('[HHS Forecast] Page loaded, waiting for content...');
      await sleep(3000);

      // Check if there's a search or filter that needs interaction
      const hasSearch = await page.$('input[type="search"], input[placeholder*="search" i], #search');
      if (hasSearch) {
        console.log('[HHS Forecast] Found search input, attempting to show all results...');
        try {
          await page.type('input[type="search"], input[placeholder*="search" i], #search', '*', { delay: 100 });
          await page.keyboard.press('Enter');
          await sleep(3000);
        } catch (e) {
          console.log('[HHS Forecast] Search interaction failed, continuing...');
        }
      }

      // Try to click "Show All" or pagination controls
      try {
        const showAllSelectors = [
          'button:has-text("Show All")',
          'button:has-text("View All")',
          'a:has-text("Show All")',
          'select option[value="all"]',
          'select option[value="9999"]',
        ];

        for (const selector of showAllSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              await element.click();
              console.log(`[HHS Forecast] Clicked: ${selector}`);
              await sleep(2000);
              break;
            }
          } catch {
            // Try next selector
          }
        }
      } catch {
        console.log('[HHS Forecast] No "show all" option found, proceeding with visible data...');
      }

      // Handle pagination if present
      let pageNumber = 1;
      const maxPages = 50; // Safety limit

      while (pageNumber <= maxPages) {
        console.log(`[HHS Forecast] Scraping page ${pageNumber}...`);

        // Extract data from current page
        const pageData = await extractForecastData(page);
        console.log(`[HHS Forecast] Extracted ${pageData.length} records from page ${pageNumber}`);

        for (const row of pageData) {
          try {
            const record = parseHHSForecastRow(row);
            if (record) {
              records.push(record);
            }
          } catch (e) {
            errors.push(`Parse error on page ${pageNumber}: ${e}`);
          }
        }

        // Check for next page
        const hasNextPage = await page.evaluate(() => {
          // Look for next button
          const nextButtons = Array.from(
            document.querySelectorAll('button, a, .page-link, .pagination-next')
          ).filter(el => {
            const text = (el.textContent || '').toLowerCase();
            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
            return (
              text.includes('next') ||
              text.includes('›') ||
              text.includes('»') ||
              ariaLabel.includes('next')
            );
          });

          if (nextButtons.length > 0) {
            const button = nextButtons[0] as HTMLElement;
            const isDisabled =
              button.hasAttribute('disabled') ||
              button.classList.contains('disabled') ||
              button.getAttribute('aria-disabled') === 'true';

            if (!isDisabled) {
              button.click();
              return true;
            }
          }

          return false;
        });

        if (!hasNextPage) {
          console.log('[HHS Forecast] No more pages found');
          break;
        }

        // Wait for next page to load
        await sleep(2000);
        pageNumber++;
      }

    } catch (error) {
      errors.push(`Navigation error: ${error}`);
      console.error('[HHS Forecast] Navigation error:', error);
    }

    await browser.close();
    console.log(`[HHS Forecast] Browser closed. Total records: ${records.length}`);

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
    console.error('[HHS Forecast] Fatal error:', error);
  }

  return {
    success: records.length > 0,
    agency: HHS_FORECAST_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Extract forecast data from the current page
 */
async function extractForecastData(page: any): Promise<Record<string, string>[]> {
  return await page.evaluate(() => {
    const rows: Record<string, string>[] = [];

    // Strategy 1: Look for standard HTML tables
    const tables = document.querySelectorAll('table');
    if (tables.length > 0) {
      tables.forEach(table => {
        // Get headers
        const headerCells = table.querySelectorAll('thead th, thead td');
        const headers: string[] = [];
        headerCells.forEach(cell => {
          const text = (cell.textContent || '').trim();
          if (text) headers.push(text.toLowerCase());
        });

        // Get data rows
        const dataRows = table.querySelectorAll('tbody tr');
        dataRows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length === 0) return;

          const rowData: Record<string, string> = {};
          cells.forEach((cell, index) => {
            const header = headers[index] || `column_${index}`;
            const value = (cell.textContent || '').trim();
            if (value) rowData[header] = value;
          });

          if (Object.keys(rowData).length > 0) {
            rows.push(rowData);
          }
        });
      });
    }

    // Strategy 2: Look for data grids or card layouts
    const dataGrids = document.querySelectorAll(
      '[role="grid"], .data-grid, .forecast-grid, .results-list, .forecast-list, .list-group'
    );

    dataGrids.forEach(grid => {
      const items = grid.querySelectorAll('[role="row"], .grid-item, .list-item, .forecast-item, .card');

      items.forEach(item => {
        const rowData: Record<string, string> = {};

        // Try to extract key-value pairs
        const labels = item.querySelectorAll('dt, label, .label, strong, .field-label');
        const values = item.querySelectorAll('dd, .value, .field-value, span:not(.label)');

        if (labels.length > 0 && values.length > 0) {
          labels.forEach((label, index) => {
            const key = (label.textContent || '').trim().toLowerCase().replace(':', '');
            const value = values[index] ? (values[index].textContent || '').trim() : '';
            if (key && value) rowData[key] = value;
          });
        } else {
          // Fallback: try to extract all text content with data attributes
          const allText = (item.textContent || '').trim();
          if (allText) {
            rowData['raw_text'] = allText;
          }
        }

        if (Object.keys(rowData).length > 0) {
          rows.push(rowData);
        }
      });
    });

    // Strategy 3: Look for definition lists (dl/dt/dd structure)
    const definitionLists = document.querySelectorAll('dl');
    definitionLists.forEach(dl => {
      const rowData: Record<string, string> = {};
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');

      dts.forEach((dt, index) => {
        const key = (dt.textContent || '').trim().toLowerCase().replace(':', '');
        const value = dds[index] ? (dds[index].textContent || '').trim() : '';
        if (key && value) rowData[key] = value;
      });

      if (Object.keys(rowData).length > 2) {
        // Only include if we got substantial data
        rows.push(rowData);
      }
    });

    return rows;
  });
}

/**
 * Parse a single HHS forecast row into a ForecastRecord
 */
function parseHHSForecastRow(row: Record<string, string>): ForecastRecord | null {
  // Helper to find fields by multiple possible keys
  const findField = (keys: string[]): string | undefined => {
    for (const key of keys) {
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase().includes(key.toLowerCase())) {
          return v?.trim();
        }
      }
    }
    return undefined;
  };

  // Extract core fields
  const title = findField([
    'title',
    'requirement',
    'opportunity',
    'procurement',
    'acquisition',
    'name',
    'description',
  ]);

  const naics = findField(['naics', 'naics code']);
  const psc = findField(['psc', 'psc code', 'product service code']);

  // Skip if no title and no NAICS/PSC
  if (!title && !naics && !psc) {
    return null;
  }

  // Parse value/estimate
  const valueStr = findField([
    'value',
    'estimate',
    'estimated value',
    'contract value',
    'ceiling',
    'amount',
    'dollar',
    'total',
  ]);
  const { min, max } = parseValueRange(valueStr);

  // Parse dates
  const awardDate = findField([
    'award date',
    'anticipated award',
    'expected award',
    'award',
    'solicitation date',
    'expected solicitation',
  ]);

  const fiscalYear = findField(['fiscal year', 'fy', 'year']);
  const quarter = findField(['quarter', 'qtr', 'anticipated quarter']);

  // Parse organization info
  const opdiv = findField(['opdiv', 'operating division', 'division', 'bureau', 'component']);
  const office = findField([
    'contracting office',
    'office',
    'staff division',
    'acquisition office',
  ]);

  // Parse procurement details
  const setAside = findField([
    'set-aside',
    'setaside',
    'set aside type',
    'small business',
    'socio-economic',
    'preference',
  ]);

  const contractType = findField([
    'contract type',
    'type',
    'vehicle',
    'acquisition type',
  ]);

  const competition = findField([
    'competition',
    'competition type',
    'solicitation type',
    'procurement method',
  ]);

  // Parse incumbent info
  const incumbent = findField(['incumbent', 'current contractor', 'contractor', 'vendor']);
  const contractNumber = findField(['contract number', 'contract #', 'award number']);

  // Parse POC info
  const pocName = findField(['poc', 'point of contact', 'contact', 'contact name', 'co', 'contracting officer']);
  const pocEmail = findField(['email', 'contact email', 'poc email']);
  const pocPhone = findField(['phone', 'telephone', 'contact phone', 'poc phone']);

  // Parse location
  const state = findField(['state', 'pop state', 'place of performance', 'location']);

  // Generate external ID
  const externalId = buildDeterministicExternalId('HHS-FORECAST', [
    title,
    naics,
    psc,
    office,
    opdiv,
    awardDate,
    valueStr,
  ]);

  const record: ForecastRecord = {
    source_agency: 'HHS',
    source_type: 'puppeteer',
    source_url: HHS_FORECAST_CONFIG.source_url,
    external_id: externalId,

    title: title || `HHS Forecast - ${naics || psc || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary', 'requirement description']),

    department: 'Department of Health and Human Services',
    bureau: opdiv,
    contracting_office: office,

    naics_code: normalizeNaics(naics),
    psc_code: psc,

    fiscal_year: normalizeFY(fiscalYear),
    anticipated_quarter: quarter,
    anticipated_award_date: awardDate,

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(setAside),
    contract_type: contractType,
    competition_type: competition,

    incumbent_name: incumbent,
    incumbent_contract_number: contractNumber,

    poc_name: pocName,
    poc_email: pocEmail,
    poc_phone: pocPhone,

    pop_state: state,

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };

  return record;
}

/**
 * Test the HHS Forecast scraper
 */
export async function testHHSForecastScraper(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Testing HHS Procurement Forecast scraper...');
  console.log('='.repeat(60));

  const result = await scrapeHHSForecast();

  console.log('\n📊 RESULTS:');
  console.log(`  Success: ${result.success ? '✅' : '❌'}`);
  console.log(`  Records: ${result.records.length}`);
  console.log(`  Errors: ${result.errors.length}`);
  console.log(`  Timing: ${(result.timing / 1000).toFixed(2)}s`);

  if (result.records.length > 0) {
    console.log('\n📄 SAMPLE RECORDS (first 3):');
    result.records.slice(0, 3).forEach((record, index) => {
      console.log(`\n--- Record ${index + 1} ---`);
      console.log(`  Title: ${record.title}`);
      console.log(`  NAICS: ${record.naics_code || 'N/A'}`);
      console.log(`  PSC: ${record.psc_code || 'N/A'}`);
      console.log(`  Value: ${record.estimated_value_range || 'N/A'}`);
      console.log(`  FY: ${record.fiscal_year || 'N/A'}`);
      console.log(`  Award Date: ${record.anticipated_award_date || 'N/A'}`);
      console.log(`  Set-Aside: ${record.set_aside_type || 'N/A'}`);
      console.log(`  Bureau: ${record.bureau || 'N/A'}`);
    });

    console.log('\n📈 STATISTICS:');
    const withNaics = result.records.filter(r => r.naics_code).length;
    const withValue = result.records.filter(r => r.estimated_value_min).length;
    const withDate = result.records.filter(r => r.anticipated_award_date).length;
    console.log(`  Records with NAICS: ${withNaics} (${((withNaics / result.records.length) * 100).toFixed(1)}%)`);
    console.log(`  Records with Value: ${withValue} (${((withValue / result.records.length) * 100).toFixed(1)}%)`);
    console.log(`  Records with Date: ${withDate} (${((withDate / result.records.length) * 100).toFixed(1)}%)`);
  }

  if (result.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    result.errors.forEach((e, index) => console.log(`  ${index + 1}. ${e}`));
  }

  console.log('\n' + '='.repeat(60));
}

// Run test if executed directly
if (require.main === module) {
  testHHSForecastScraper()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

/**
 * HHS SBCX (Small Business Contracting Portal) Scraper
 * URL: https://procurementforecast.hhs.gov or https://mysbcx.hhs.gov
 *
 * HHS forecast data is available through their SBCX portal.
 * The portal may require authentication or have public-facing search.
 *
 * This scraper uses Puppeteer to handle the dynamic content.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const HHS_CONFIG = {
  agency_code: 'HHS',
  agency_name: 'Department of Health and Human Services',
  source_url: 'https://mysbcx.hhs.gov/search',
  alt_url: 'https://osdbu.hhs.gov/forecast',
  timeout: 60000,
};

/**
 * Scrape HHS forecast data using Puppeteer
 */
export async function scrapeHHS(): Promise<ScraperResult> {
  const startTime = Date.now();
  const records: ForecastRecord[] = [];
  const errors: string[] = [];

  try {
    const puppeteer = await import('puppeteer');

    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Try main SBCX URL first
    console.log(`[HHS] Loading ${HHS_CONFIG.source_url}...`);

    try {
      await page.goto(HHS_CONFIG.source_url, {
        waitUntil: 'networkidle2',
        timeout: HHS_CONFIG.timeout,
      });
    } catch {
      // Try alternate URL
      console.log(`[HHS] Main URL failed, trying ${HHS_CONFIG.alt_url}...`);
      await page.goto(HHS_CONFIG.alt_url, {
        waitUntil: 'networkidle2',
        timeout: HHS_CONFIG.timeout,
      });
    }

    // Wait for content to load
    await sleep(3000);

    // Check if we need to perform a search
    const searchInput = await page.$('input[type="search"], input[placeholder*="search"], #search');
    if (searchInput) {
      // Perform empty search to get all results
      await searchInput.type('*');
      await page.keyboard.press('Enter');
      await sleep(3000);
    }

    // Look for a "View All" or expand option
    try {
      const viewAllButton = await page.$('button:has-text("View All"), a:has-text("View All"), .view-all');
      if (viewAllButton) {
        await viewAllButton.click();
        await sleep(2000);
      }
    } catch {
      // Continue without clicking
    }

    // Extract table data
    const tableData = await page.evaluate(() => {
      const rows: Record<string, string>[] = [];

      // Try multiple table/list selectors
      const containers = document.querySelectorAll(
        'table, .forecast-list, .results-table, .data-table, [role="grid"], .list-group'
      );

      containers.forEach(container => {
        // Get headers from table or data attributes
        const headerCells = container.querySelectorAll('thead th, .header-cell, [role="columnheader"]');
        const headers: string[] = [];
        headerCells.forEach(cell => {
          headers.push((cell.textContent || '').trim().toLowerCase());
        });

        // If no headers, try to extract from data attributes or first row
        if (headers.length === 0) {
          const firstRow = container.querySelector('tr, .row, .list-item');
          if (firstRow) {
            const labels = firstRow.querySelectorAll('label, .label, dt, strong');
            labels.forEach(label => {
              headers.push((label.textContent || '').trim().toLowerCase().replace(':', ''));
            });
          }
        }

        // Get data rows/items
        const dataRows = container.querySelectorAll(
          'tbody tr, .data-row, .list-item, .forecast-item, [role="row"]:not([role="columnheader"])'
        );

        dataRows.forEach(row => {
          const rowData: Record<string, string> = {};

          // Try cell-based extraction
          const cells = row.querySelectorAll('td, .cell, [role="cell"]');
          if (cells.length > 0) {
            cells.forEach((cell, index) => {
              const header = headers[index] || `col${index}`;
              rowData[header] = (cell.textContent || '').trim();
            });
          } else {
            // Try label/value pair extraction
            const pairs = row.querySelectorAll('.field, .detail, dl');
            pairs.forEach(pair => {
              const label = pair.querySelector('dt, label, .label, strong');
              const value = pair.querySelector('dd, .value, span:not(.label)');
              if (label && value) {
                const key = (label.textContent || '').trim().toLowerCase().replace(':', '');
                rowData[key] = (value.textContent || '').trim();
              }
            });
          }

          if (Object.keys(rowData).length > 0) {
            rows.push(rowData);
          }
        });
      });

      return rows;
    });

    console.log(`[HHS] Extracted ${tableData.length} rows`);

    // Parse extracted data
    for (const row of tableData) {
      try {
        const record = parseHHSRow(row);
        if (record) {
          records.push(record);
        }
      } catch (e) {
        errors.push(`Parse error: ${e}`);
      }
    }

    await browser.close();

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
  }

  return {
    success: errors.length === 0 || records.length > 0,
    agency: HHS_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Parse a single HHS row into a ForecastRecord
 */
function parseHHSRow(row: Record<string, string>): ForecastRecord | null {
  const findField = (keys: string[]): string | undefined => {
    for (const key of keys) {
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase().includes(key.toLowerCase())) {
          return v;
        }
      }
    }
    return undefined;
  };

  const title = findField(['title', 'name', 'requirement', 'opportunity']);
  const naics = findField(['naics']);
  const opdiv = findField(['opdiv', 'operating division', 'agency', 'division']);

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'ceiling']);
  const { min, max } = parseValueRange(valueStr);
  const awardDate = findField(['award date', 'anticipated']);

  const record: ForecastRecord = {
    source_agency: 'HHS',
    source_type: 'puppeteer',
    source_url: HHS_CONFIG.source_url,
    external_id: buildDeterministicExternalId('HHS-SBCX', [
      title,
      naics,
      opdiv,
      valueStr,
      awardDate,
    ]),

    title: title || `HHS Forecast - ${naics || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary']),

    department: 'Department of Health and Human Services',
    bureau: opdiv,
    contracting_office: findField(['contracting', 'office', 'staff division']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service']),

    fiscal_year: normalizeFY(findField(['fiscal', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr']),
    anticipated_award_date: findField(['award date', 'anticipated']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField(['set-aside', 'setaside', 'small business', 'socio', 'preference'])),
    contract_type: findField(['contract type', 'type', 'vehicle']),
    competition_type: findField(['competition', 'solicitation type']),

    incumbent_name: findField(['incumbent', 'current contractor', 'contractor']),
    incumbent_contract_number: findField(['contract number', 'current contract']),

    poc_name: findField(['poc', 'contact', 'point of contact']),
    poc_email: findField(['email']),
    poc_phone: findField(['phone', 'telephone']),

    pop_state: findField(['state', 'location', 'place of performance']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };

  return record;
}

/**
 * Test the HHS scraper
 */
export async function testHHSScraper(): Promise<void> {
  console.log('Testing HHS SBCX scraper...');
  const result = await scrapeHHS();

  console.log(`Success: ${result.success}`);
  console.log(`Records: ${result.records.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Timing: ${result.timing}ms`);

  if (result.records.length > 0) {
    console.log('\nSample record:');
    console.log(JSON.stringify(result.records[0], null, 2));
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach(e => console.log(`  - ${e}`));
  }
}

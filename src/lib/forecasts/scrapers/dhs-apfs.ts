/**
 * DHS APFS (Acquisition Planning Forecast System) Scraper
 * URL: https://apfs-cloud.dhs.gov/forecast/
 *
 * The DHS APFS portal uses DataTables with AJAX data loading from /api/forecast/
 *
 * Strategy:
 * 1. Try to intercept the AJAX API call directly (fastest)
 * 2. Fall back to scraping the rendered DataTable
 * 3. Handle pagination and SearchPanes filters
 *
 * This scraper uses Puppeteer to handle the dynamic content.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const DHS_CONFIG = {
  agency_code: 'DHS',
  agency_name: 'Department of Homeland Security',
  source_url: 'https://apfs-cloud.dhs.gov/forecast/',
  api_url: 'https://apfs-cloud.dhs.gov/api/forecast/',
  timeout: 60000,
  waitForSelector: 'table.dataTable, .dataTables_wrapper',
};

/**
 * Scrape DHS APFS forecast data using Puppeteer
 *
 * Strategy:
 * 1. Intercept network requests to capture API data
 * 2. Wait for DataTable to load
 * 3. Change page length to max (to get all records)
 * 4. Extract data from either API response or rendered table
 */
export async function scrapeDHS(): Promise<ScraperResult> {
  const startTime = Date.now();
  const records: ForecastRecord[] = [];
  const errors: string[] = [];
  let apiData: any[] = [];

  try {
    // Dynamic import of puppeteer (may not be available in all environments)
    const puppeteer = await import('puppeteer');

    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Intercept API requests to capture data
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/forecast')) {
        try {
          const data = await response.json();
          if (Array.isArray(data)) {
            apiData = data;
            console.log(`[DHS] Intercepted API data: ${data.length} records`);
          } else if (data.data && Array.isArray(data.data)) {
            apiData = data.data;
            console.log(`[DHS] Intercepted API data: ${data.data.length} records`);
          }
        } catch (e) {
          // Not JSON or parsing failed
        }
      }
    });

    console.log(`[DHS] Loading ${DHS_CONFIG.source_url}...`);
    await page.goto(DHS_CONFIG.source_url, {
      waitUntil: 'networkidle0',
      timeout: DHS_CONFIG.timeout,
    });

    // Wait for the DataTable to initialize
    try {
      await page.waitForSelector(DHS_CONFIG.waitForSelector, { timeout: 30000 });
      console.log('[DHS] DataTable found');
    } catch (e) {
      errors.push('DataTable not found after 30s wait');
    }

    // Give extra time for data to load
    await sleep(5000);

    // Try to change page length to show all records
    try {
      await page.select('select[name$="_length"]', '-1');
      console.log('[DHS] Set page length to "All"');
      await sleep(3000);
    } catch (e) {
      console.log('[DHS] Could not change page length, will use current view');
    }

    // If we got API data, use that (most reliable)
    if (apiData.length > 0) {
      console.log(`[DHS] Using intercepted API data (${apiData.length} records)`);
      for (const row of apiData) {
        try {
          const record = parseDHSAPIRecord(row);
          if (record) {
            records.push(record);
          }
        } catch (e) {
          errors.push(`Parse error: ${e}`);
        }
      }
    } else {
      // Fall back to scraping table
      console.log('[DHS] No API data, falling back to table scraping');
      const tableData = await page.evaluate(() => {
        const rows: Record<string, string>[] = [];
        const table = document.querySelector('table.dataTable');

        if (!table) return rows;

        // Get headers
        const headerCells = table.querySelectorAll('thead th');
        const headers: string[] = [];
        headerCells.forEach(cell => {
          headers.push((cell.textContent || '').trim());
        });

        // Get data rows
        const dataRows = table.querySelectorAll('tbody tr');
        dataRows.forEach(row => {
          const cells = row.querySelectorAll('td');
          const rowData: Record<string, string> = {};

          cells.forEach((cell, index) => {
            const header = headers[index] || `col${index}`;
            rowData[header] = (cell.textContent || '').trim();
          });

          if (Object.keys(rowData).length > 0) {
            rows.push(rowData);
          }
        });

        return rows;
      });

      console.log(`[DHS] Extracted ${tableData.length} rows from table`);

      for (const row of tableData) {
        try {
          const record = parseDHSTableRow(row);
          if (record) {
            records.push(record);
          }
        } catch (e) {
          errors.push(`Parse error: ${e}`);
        }
      }
    }

    await browser.close();

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
    console.error('[DHS] Scraper error:', error);
  }

  return {
    success: records.length > 0,
    agency: DHS_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Parse a single record from the DHS API response
 *
 * Expected fields based on WebFetch analysis:
 * - APFS Number
 * - Component (bureau/office)
 * - Requirements Title
 * - Contract Status
 * - Place of Performance (City/State)
 * - Dollar Range
 * - Estimated Solicitation Release Date
 * - Forecast Published Date
 * - Contract Type
 * - NAICS (in hidden fields)
 * - Contact information (in hidden fields)
 */
function parseDHSAPIRecord(record: any): ForecastRecord | null {
  // Helper to safely get field value
  const getField = (field: string): string | undefined => {
    const value = record[field];
    return value && typeof value === 'string' ? value.trim() : undefined;
  };

  const title = getField('Requirements Title') || getField('title') || getField('requirement');
  const apfsNumber = getField('APFS Number') || getField('apfs_number') || getField('id');

  // Skip if no meaningful data
  if (!title && !apfsNumber) {
    return null;
  }

  const component = getField('Component') || getField('component') || getField('bureau');
  const naicsCode = getField('NAICS') || getField('naics') || getField('naics_code');
  const dollarRange = getField('Dollar Range') || getField('dollar_range') || getField('value');
  const { min, max } = parseValueRange(dollarRange);

  // Parse location
  const popLocation = getField('Place of Performance (City/State)') || getField('place_of_performance') || getField('location');
  let popCity: string | undefined;
  let popState: string | undefined;
  if (popLocation) {
    const parts = popLocation.split(',').map(p => p.trim());
    if (parts.length === 2) {
      popCity = parts[0];
      popState = parts[1];
    }
  }

  const result: ForecastRecord = {
    source_agency: 'DHS',
    source_type: 'api',
    source_url: DHS_CONFIG.source_url,
    external_id: apfsNumber
      ? `DHS-APFS-${apfsNumber}`
      : buildDeterministicExternalId('DHS-APFS', [
          title,
          component,
          naicsCode,
          dollarRange,
          getField('Estimated Solicitation Release Date') || getField('solicitation_date'),
        ]),

    title: title || `DHS Forecast - ${apfsNumber}`,
    description: getField('description') || getField('synopsis'),

    department: 'Department of Homeland Security',
    bureau: component,
    contracting_office: getField('Contracting Office') || getField('contracting_office'),

    naics_code: normalizeNaics(naicsCode),
    psc_code: getField('PSC') || getField('psc') || getField('psc_code'),

    anticipated_award_date: getField('Estimated Solicitation Release Date') || getField('solicitation_date'),
    solicitation_date: getField('Estimated Solicitation Release Date') || getField('solicitation_date'),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: dollarRange,

    contract_type: getField('Contract Type') || getField('contract_type'),
    set_aside_type: normalizeSetAside(getField('Set-Aside') || getField('set_aside')),

    incumbent_name: getField('Incumbent') || getField('incumbent'),

    pop_city: popCity,
    pop_state: popState,
    pop_country: 'USA',

    poc_name: getField('POC Name') || getField('contact_name'),
    poc_email: getField('POC Email') || getField('contact_email'),
    poc_phone: getField('POC Phone') || getField('contact_phone'),

    status: 'forecast',
    raw_data: JSON.stringify(record),
  };

  return result;
}

/**
 * Parse a single DHS table row into a ForecastRecord (fallback method)
 */
function parseDHSTableRow(row: Record<string, string>): ForecastRecord | null {
  // Find relevant fields by checking common header names
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

  const title = findField(['title', 'requirements title', 'requirement']);
  const apfsNumber = findField(['apfs number', 'apfs', 'number']);
  const naics = findField(['naics']);

  // Skip if no meaningful data
  if (!title && !apfsNumber) {
    return null;
  }

  const valueStr = findField(['dollar range', 'dollar', 'value', 'amount', 'estimate']);
  const { min, max } = parseValueRange(valueStr);

  // Parse location
  const popLocation = findField(['place of performance', 'location', 'city', 'state']);
  let popCity: string | undefined;
  let popState: string | undefined;
  if (popLocation && popLocation.includes(',')) {
    const parts = popLocation.split(',').map(p => p.trim());
    if (parts.length === 2) {
      popCity = parts[0];
      popState = parts[1];
    }
  }

  const record: ForecastRecord = {
    source_agency: 'DHS',
    source_type: 'puppeteer',
    source_url: DHS_CONFIG.source_url,
    external_id: apfsNumber
      ? `DHS-APFS-${apfsNumber}`
      : buildDeterministicExternalId('DHS-APFS', [
          title,
          findField(['component', 'office', 'bureau']),
          naics,
          valueStr,
          findField(['estimated solicitation', 'solicitation date', 'release date']),
        ]),

    title: title || `DHS Forecast - ${apfsNumber || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope']),

    department: 'Department of Homeland Security',
    bureau: findField(['component', 'office', 'bureau']),
    contracting_office: findField(['contracting office', 'contracting', 'procurement']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service']),

    fiscal_year: normalizeFY(findField(['fiscal', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr']),
    anticipated_award_date: findField(['estimated solicitation', 'solicitation date', 'release date']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField(['set-aside', 'setaside', 'small business'])),
    contract_type: findField(['contract type', 'type']),

    incumbent_name: findField(['incumbent', 'current contractor']),

    pop_city: popCity,
    pop_state: popState,
    pop_country: popLocation && !popLocation.includes(',') ? undefined : 'USA',

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };

  return record;
}

/**
 * Test the DHS scraper
 */
export async function testDHSScraper(): Promise<void> {
  console.log('Testing DHS APFS scraper...');
  const result = await scrapeDHS();

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

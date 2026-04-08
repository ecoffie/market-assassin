/**
 * GSA Acquisition Gateway Forecast Scraper
 * URL: https://acquisitiongateway.gov/forecast
 *
 * The GSA Acquisition Gateway is a SPA that requires JavaScript.
 * Strategy: Use API interception (like DHS scraper) to capture XHR responses.
 *
 * This scraper uses Puppeteer with request interception to capture API data.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const GSA_CONFIG = {
  agency_code: 'GSA',
  agency_name: 'General Services Administration',
  source_url: 'https://acquisitiongateway.gov/forecast',
  timeout: 90000,
  // Common API patterns to intercept
  api_patterns: [
    '/api/',
    '/forecast',
    '/webruntime/api',
    '/graphql',
    'search',
    'results',
  ],
};

/**
 * Scrape GSA Acquisition Gateway forecast data using API interception
 */
export async function scrapeGSA(): Promise<ScraperResult> {
  const startTime = Date.now();
  const records: ForecastRecord[] = [];
  const errors: string[] = [];
  let apiData: any[] = [];

  try {
    const puppeteer = await import('puppeteer');

    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

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
      const contentType = response.headers()['content-type'] || '';

      // Check if this looks like an API response with JSON
      const isApiEndpoint = GSA_CONFIG.api_patterns.some(pattern =>
        url.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isApiEndpoint && contentType.includes('application/json')) {
        try {
          const data = await response.json();

          // Look for forecast data in various response structures
          let forecasts: any[] = [];

          if (Array.isArray(data)) {
            forecasts = data;
          } else if (data.data && Array.isArray(data.data)) {
            forecasts = data.data;
          } else if (data.results && Array.isArray(data.results)) {
            forecasts = data.results;
          } else if (data.forecasts && Array.isArray(data.forecasts)) {
            forecasts = data.forecasts;
          } else if (data.items && Array.isArray(data.items)) {
            forecasts = data.items;
          } else if (data.records && Array.isArray(data.records)) {
            forecasts = data.records;
          }

          // Filter to only include items that look like forecasts
          const validForecasts = forecasts.filter(item => {
            if (!item || typeof item !== 'object') return false;
            // Must have at least a title or NAICS to be a forecast
            return item.title || item.name || item.naics || item.naicsCode ||
                   item.requirementTitle || item.opportunityTitle;
          });

          if (validForecasts.length > 0) {
            console.log(`[GSA] Intercepted API data from ${url}: ${validForecasts.length} records`);
            apiData = [...apiData, ...validForecasts];
          }
        } catch {
          // Not valid JSON or parsing failed, ignore
        }
      }
    });

    console.log(`[GSA] Loading ${GSA_CONFIG.source_url}...`);
    await page.goto(GSA_CONFIG.source_url, {
      waitUntil: 'networkidle0',
      timeout: GSA_CONFIG.timeout,
    });

    // Wait for SPA to initialize and load data
    await sleep(8000);

    // Try to trigger data load by interacting with the page
    try {
      // Look for search/filter buttons and click them
      const buttonSelectors = [
        'button[type="submit"]',
        'button:has-text("Search")',
        'button:has-text("View All")',
        'button:has-text("Show All")',
        '.search-btn',
        '.btn-search',
        '[data-action="search"]',
      ];

      for (const selector of buttonSelectors) {
        try {
          const btn = await page.$(selector);
          if (btn) {
            await btn.click();
            await sleep(3000);
            break;
          }
        } catch {
          // Selector not found, continue
        }
      }

      // Try to expand results/pagination
      const expandSelectors = [
        'select[name*="page"]',
        'select[name*="size"]',
        '.page-size select',
        '[data-testid="page-size"]',
      ];

      for (const selector of expandSelectors) {
        try {
          const select = await page.$(selector);
          if (select) {
            await page.select(selector, '100');
            await sleep(3000);
            break;
          }
        } catch {
          // Continue
        }
      }
    } catch {
      // Interaction failed, continue with what we have
    }

    // Give more time for API responses
    await sleep(5000);

    // Process intercepted API data
    if (apiData.length > 0) {
      console.log(`[GSA] Processing ${apiData.length} intercepted records`);
      for (const row of apiData) {
        try {
          const record = parseGSAAPIRecord(row);
          if (record) {
            records.push(record);
          }
        } catch (e) {
          errors.push(`Parse error: ${e}`);
        }
      }
    }

    // Fallback: try to extract from rendered DOM
    if (records.length === 0) {
      console.log('[GSA] No API data, attempting DOM extraction');
      const tableData = await page.evaluate(() => {
        const rows: Record<string, string>[] = [];

        // Try multiple container selectors
        const containers = document.querySelectorAll(
          'table, .forecast-list, .results-grid, .data-table, [role="grid"], .card-container, .results, .forecast-results'
        );

        containers.forEach(container => {
          // Get headers
          const headerCells = container.querySelectorAll('thead th, .header-cell, [role="columnheader"]');
          const headers: string[] = [];
          headerCells.forEach(cell => {
            headers.push((cell.textContent || '').trim().toLowerCase());
          });

          // Get data rows
          const dataRows = container.querySelectorAll(
            'tbody tr, .data-row, .forecast-item, .card, [role="row"]:not([role="columnheader"]), .result-item'
          );

          dataRows.forEach(row => {
            const rowData: Record<string, string> = {};

            const cells = row.querySelectorAll('td, .cell, [role="cell"]');
            if (cells.length > 0 && headers.length > 0) {
              cells.forEach((cell, index) => {
                const header = headers[index] || `col${index}`;
                rowData[header] = (cell.textContent || '').trim();
              });
            } else {
              // Try attribute-based extraction
              const dataFields = row.querySelectorAll('[data-field], [data-label], [class*="field"]');
              dataFields.forEach(field => {
                const key = field.getAttribute('data-field') ||
                           field.getAttribute('data-label') ||
                           field.className.match(/field-(\w+)/)?.[1] || '';
                const value = (field.textContent || '').trim();
                if (key) rowData[key.toLowerCase()] = value;
              });
            }

            if (Object.keys(rowData).length > 0) {
              rows.push(rowData);
            }
          });
        });

        return rows;
      });

      console.log(`[GSA] Extracted ${tableData.length} rows from DOM`);

      for (const row of tableData) {
        try {
          const record = parseGSARow(row);
          if (record) {
            records.push(record);
          }
        } catch (e) {
          errors.push(`DOM parse error: ${e}`);
        }
      }
    }

    await browser.close();

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
    console.error('[GSA] Scraper error:', error);
  }

  return {
    success: records.length > 0,
    agency: GSA_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Parse a GSA API response record
 */
function parseGSAAPIRecord(item: Record<string, unknown>): ForecastRecord | null {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = item[key] || item[key.toLowerCase()] || item[key.toUpperCase()];
      if (value !== null && value !== undefined && value !== '') {
        return String(value);
      }
    }
    return undefined;
  };

  const title = getString(['title', 'name', 'description', 'requirementTitle', 'opportunityTitle', 'requirement']);
  const naics = getString(['naics', 'naicsCode', 'naics_code', 'NAICS']);
  const id = getString(['id', 'forecastId', 'opportunityId', 'ID', 'uuid']);

  if (!title && !naics && !id) {
    return null;
  }

  const valueStr = getString(['estimatedValue', 'value', 'amount', 'dollarValue', 'ceiling', 'dollarRange']);
  const { min, max } = parseValueRange(valueStr);

  return {
    source_agency: getString(['agency', 'agencyCode', 'department']) || 'GSA',
    source_type: 'api',
    source_url: GSA_CONFIG.source_url,
    external_id: id ? `GSA-${id}` : buildDeterministicExternalId('GSA', [
      title,
      naics,
      getString(['agency', 'agencyCode', 'department']),
      valueStr,
      getString(['awardDate', 'anticipatedAwardDate', 'expectedDate', 'solicitationDate']),
    ]),

    title: title || `GSA Forecast - ${naics || 'Unknown'}`,
    description: getString(['description', 'synopsis', 'summary', 'scope']),

    department: getString(['department', 'agency', 'agencyName']),
    bureau: getString(['bureau', 'subAgency', 'office', 'component']),
    contracting_office: getString(['contractingOffice', 'office', 'buyingOffice']),

    naics_code: normalizeNaics(naics),
    psc_code: getString(['psc', 'pscCode', 'productServiceCode']),

    fiscal_year: normalizeFY(getString(['fiscalYear', 'fy', 'year'])),
    anticipated_quarter: getString(['quarter', 'anticipatedQuarter', 'awardQuarter']),
    anticipated_award_date: getString(['awardDate', 'anticipatedAwardDate', 'expectedDate', 'solicitationDate']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(getString(['setAside', 'setAsideType', 'smallBusinessSetAside'])),
    contract_type: getString(['contractType', 'type', 'acquisitionType']),
    competition_type: getString(['competition', 'competitionType', 'solicitationType']),

    incumbent_name: getString(['incumbent', 'currentContractor', 'incumbentName']),

    poc_name: getString(['poc', 'contactName', 'pointOfContact']),
    poc_email: getString(['email', 'pocEmail', 'contactEmail']),
    poc_phone: getString(['phone', 'pocPhone', 'contactPhone']),

    pop_state: getString(['state', 'popState', 'placeOfPerformance']),

    status: 'forecast',
    raw_data: JSON.stringify(item),
  };
}

/**
 * Parse a DOM-extracted row into a ForecastRecord
 */
function parseGSARow(row: Record<string, string>): ForecastRecord | null {
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

  const title = findField(['title', 'name', 'requirement', 'description', 'opportunity']);
  const naics = findField(['naics']);
  const agency = findField(['agency', 'department']);

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'ceiling']);
  const { min, max } = parseValueRange(valueStr);

  return {
    source_agency: agency || 'GSA',
    source_type: 'puppeteer',
    source_url: GSA_CONFIG.source_url,
    external_id: buildDeterministicExternalId('GSA-DOM', [
      title,
      naics,
      agency,
      valueStr,
      findField(['award date', 'anticipated']),
    ]),

    title: title || `GSA Forecast - ${naics || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary']),

    department: agency,
    bureau: findField(['bureau', 'sub-agency', 'office']),
    contracting_office: findField(['contracting office', 'procurement office']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service']),

    fiscal_year: normalizeFY(findField(['fiscal', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr']),
    anticipated_award_date: findField(['award date', 'anticipated']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField(['set-aside', 'setaside', 'small business'])),
    contract_type: findField(['contract type', 'type', 'vehicle']),
    competition_type: findField(['competition', 'solicitation type']),

    incumbent_name: findField(['incumbent', 'current contractor']),

    poc_name: findField(['poc', 'contact', 'point of contact']),
    poc_email: findField(['email']),
    poc_phone: findField(['phone']),

    pop_state: findField(['state', 'location', 'place of performance']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Test the GSA scraper
 */
export async function testGSAScraper(): Promise<void> {
  console.log('Testing GSA Acquisition Gateway scraper...');
  const result = await scrapeGSA();

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

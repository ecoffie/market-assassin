/**
 * EPA Forecast Scraper
 * URL: https://ordspub.epa.gov/ords/forecast/f?p=forecast
 *
 * Note: Old URL (ofmpub.epa.gov) redirects to ordspub.epa.gov
 *
 * EPA's procurement forecast is built on Oracle APEX/ORDS.
 * Strategy: Use API interception to capture ORDS API calls.
 *
 * This scraper uses Puppeteer with request interception.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const EPA_CONFIG = {
  agency_code: 'EPA',
  agency_name: 'Environmental Protection Agency',
  // Updated URL - old URL redirects here
  source_url: 'https://ordspub.epa.gov/ords/forecast/f?p=forecast',
  alt_url: 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast',
  timeout: 90000,
  maxPages: 20,
  // Oracle APEX/ORDS API patterns
  api_patterns: [
    '/ords/',
    '/apex/',
    '/f?p=',
    'wwv_flow',
    'apex_util',
    '/api/',
    'forecast',
  ],
};

/**
 * Scrape EPA forecast data using API interception
 */
export async function scrapeEPA(): Promise<ScraperResult> {
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

    // Intercept API requests
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      request.continue();
    });

    page.on('response', async (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Check if this looks like an ORDS/APEX API response
      const isApiEndpoint = EPA_CONFIG.api_patterns.some(pattern =>
        url.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isApiEndpoint && contentType.includes('application/json')) {
        try {
          const data = await response.json();

          let forecasts: any[] = [];

          if (Array.isArray(data)) {
            forecasts = data;
          } else if (data.items && Array.isArray(data.items)) {
            // ORDS standard format
            forecasts = data.items;
          } else if (data.data && Array.isArray(data.data)) {
            forecasts = data.data;
          } else if (data.rows && Array.isArray(data.rows)) {
            // APEX format
            forecasts = data.rows;
          } else if (data.results && Array.isArray(data.results)) {
            forecasts = data.results;
          } else if (data.records && Array.isArray(data.records)) {
            forecasts = data.records;
          }

          // Filter to items that look like forecasts
          const validForecasts = forecasts.filter(item => {
            if (!item || typeof item !== 'object') return false;
            return item.title || item.name || item.naics || item.NAICS ||
                   item.requirement || item.description || item.PROJECT ||
                   item.TITLE || item.REQUIREMENT;
          });

          if (validForecasts.length > 0) {
            console.log(`[EPA] Intercepted API data from ${url}: ${validForecasts.length} records`);
            apiData = [...apiData, ...validForecasts];
          }
        } catch {
          // Not valid JSON
        }
      }
    });

    // Try new URL first, fall back to old
    console.log(`[EPA] Loading ${EPA_CONFIG.source_url}...`);
    let loadSuccess = false;

    try {
      await page.goto(EPA_CONFIG.source_url, {
        waitUntil: 'networkidle0',
        timeout: EPA_CONFIG.timeout,
      });
      loadSuccess = true;
    } catch {
      console.log(`[EPA] Main URL failed, trying ${EPA_CONFIG.alt_url}...`);
      try {
        await page.goto(EPA_CONFIG.alt_url, {
          waitUntil: 'networkidle0',
          timeout: EPA_CONFIG.timeout,
        });
        loadSuccess = true;
      } catch (e) {
        errors.push(`Failed to load both URLs: ${e}`);
      }
    }

    if (loadSuccess) {
      // Wait for APEX to render
      await sleep(8000);

      // Try to expand "Show All" or increase rows per page
      try {
        const rowsPerPageSelectors = [
          'select[name*="ROWS"]',
          'select[name*="rows"]',
          'select.apex-item-select',
          'select[aria-label*="rows"]',
          '.a-IRR-pagination select',
          'select[id*="page"]',
        ];

        for (const selector of rowsPerPageSelectors) {
          const select = await page.$(selector);
          if (select) {
            try {
              await page.select(selector, '10000');
              await sleep(3000);
              break;
            } catch {
              try {
                await page.select(selector, '500');
                await sleep(3000);
                break;
              } catch {
                try {
                  await page.select(selector, '100');
                  await sleep(3000);
                  break;
                } catch {
                  // Continue
                }
              }
            }
          }
        }
      } catch {
        // Continue with default
      }

      // Give more time for API responses
      await sleep(5000);

      // Process intercepted API data
      if (apiData.length > 0) {
        console.log(`[EPA] Processing ${apiData.length} intercepted records`);
        for (const row of apiData) {
          try {
            const record = parseEPAAPIRecord(row);
            if (record) {
              records.push(record);
            }
          } catch (e) {
            errors.push(`Parse error: ${e}`);
          }
        }
      }

      // Fallback: DOM extraction with pagination
      if (records.length === 0) {
        console.log('[EPA] No API data, attempting DOM extraction');

        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= EPA_CONFIG.maxPages) {
          console.log(`[EPA] Scraping page ${currentPage}...`);

          const tableData = await page.evaluate(() => {
            const rows: Record<string, string>[] = [];

            // Oracle APEX table selectors
            const tables = document.querySelectorAll(
              'table.a-IRR-table, table.apexir_WORKSHEET_DATA, table[summary*="Report"], .a-Report-table, table[role="grid"], table.t-Report-report'
            );

            tables.forEach(table => {
              const headerCells = table.querySelectorAll('thead th, tr.a-IRR-tableHeader th, [role="columnheader"]');
              const headers: string[] = [];
              headerCells.forEach(cell => {
                const text = (cell.textContent || '').trim().toLowerCase();
                if (text) headers.push(text);
              });

              const dataRows = table.querySelectorAll(
                'tbody tr, tr.a-IRR-tableRow, [role="row"]:not([role="columnheader"])'
              );

              dataRows.forEach(row => {
                const cells = row.querySelectorAll('td, [role="cell"]');
                const rowData: Record<string, string> = {};

                cells.forEach((cell, index) => {
                  const header = headers[index] || `col${index}`;
                  const text = (cell.textContent || '').trim();
                  if (text && text !== '\u00A0' && text !== ' ') {
                    rowData[header] = text;
                  }
                });

                if (Object.keys(rowData).length > 0) {
                  rows.push(rowData);
                }
              });
            });

            return rows;
          });

          console.log(`[EPA] Page ${currentPage}: ${tableData.length} rows`);

          for (const row of tableData) {
            try {
              const record = parseEPADOMRow(row);
              if (record) {
                records.push(record);
              }
            } catch (e) {
              errors.push(`DOM parse error: ${e}`);
            }
          }

          // Try next page
          hasMorePages = await tryNextPage(page);
          if (hasMorePages) {
            currentPage++;
            await sleep(3000);
          }
        }

        console.log(`[EPA] Extracted ${records.length} total records from ${currentPage} pages`);
      }
    }

    await browser.close();

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
    console.error('[EPA] Scraper error:', error);
  }

  return {
    success: records.length > 0,
    agency: EPA_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Try to navigate to next page
 */
async function tryNextPage(page: any): Promise<boolean> {
  try {
    const nextSelectors = [
      'button.a-Button--next:not([disabled])',
      'button.a-IRR-button--next:not([disabled])',
      'a[aria-label*="Next"]:not([disabled])',
      'button[title*="Next"]:not([disabled])',
      '.a-IRR-pagination button:last-child:not([disabled])',
      '.t-Pagination a:last-child:not(.is-disabled)',
    ];

    for (const selector of nextSelectors) {
      const nextButton = await page.$(selector);
      if (nextButton) {
        const isDisabled = await page.evaluate((el: any) => {
          return el.disabled || el.classList.contains('disabled') ||
                 el.classList.contains('is-disabled') ||
                 el.getAttribute('aria-disabled') === 'true';
        }, nextButton);

        if (!isDisabled) {
          await nextButton.click();
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Parse an EPA API response record
 */
function parseEPAAPIRecord(item: Record<string, unknown>): ForecastRecord | null {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = item[key] || item[key.toLowerCase()] || item[key.toUpperCase()];
      if (value !== null && value !== undefined && value !== '') {
        return String(value);
      }
    }
    return undefined;
  };

  const title = getString(['title', 'TITLE', 'requirement', 'REQUIREMENT', 'name', 'NAME', 'project', 'PROJECT', 'description']);
  const naics = getString(['naics', 'NAICS', 'naics_code', 'NAICS_CODE']);
  const id = getString(['id', 'ID', 'forecast_id', 'FORECAST_ID', 'procurement_id']);

  if (!title && !naics && !id) {
    return null;
  }

  const valueStr = getString(['value', 'VALUE', 'amount', 'AMOUNT', 'estimate', 'ESTIMATE', 'cost', 'COST', 'ceiling', 'CEILING']);
  const { min, max } = parseValueRange(valueStr);

  return {
    source_agency: 'EPA',
    source_type: 'api',
    source_url: EPA_CONFIG.source_url,
    external_id: id ? `EPA-${id}` : buildDeterministicExternalId('EPA', [
      title,
      naics,
      valueStr,
      getString(['award_date', 'AWARD_DATE', 'anticipated_date', 'target_date', 'estimated_award']),
    ]),

    title: title || `EPA Forecast - ${naics || 'Unknown'}`,
    description: getString(['description', 'DESCRIPTION', 'synopsis', 'SYNOPSIS', 'scope', 'SCOPE', 'sow', 'SOW']),

    department: 'Environmental Protection Agency',
    bureau: getString(['office', 'OFFICE', 'region', 'REGION', 'division', 'DIVISION']),
    contracting_office: getString(['contracting_office', 'CONTRACTING_OFFICE', 'procurement_office']),

    naics_code: normalizeNaics(naics),
    psc_code: getString(['psc', 'PSC', 'product_service_code', 'PRODUCT_SERVICE_CODE']),

    fiscal_year: normalizeFY(getString(['fiscal_year', 'FISCAL_YEAR', 'fy', 'FY', 'year', 'YEAR'])),
    anticipated_quarter: getString(['quarter', 'QUARTER', 'qtr', 'QTR', 'anticipated_quarter']),
    anticipated_award_date: getString(['award_date', 'AWARD_DATE', 'anticipated_date', 'target_date', 'estimated_award']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(getString(['set_aside', 'SET_ASIDE', 'setaside', 'SETASIDE', 'small_business', 'preference'])),
    contract_type: getString(['contract_type', 'CONTRACT_TYPE', 'type', 'TYPE', 'procurement_type']),
    competition_type: getString(['competition', 'COMPETITION', 'competition_type']),

    incumbent_name: getString(['incumbent', 'INCUMBENT', 'current_contractor', 'contractor']),

    pop_state: getString(['state', 'STATE', 'pop_state', 'POP_STATE', 'location', 'LOCATION']),

    poc_name: getString(['poc', 'POC', 'contact', 'CONTACT', 'contracting_officer', 'co']),
    poc_email: getString(['email', 'EMAIL', 'poc_email']),
    poc_phone: getString(['phone', 'PHONE', 'poc_phone']),

    status: 'forecast',
    raw_data: JSON.stringify(item),
  };
}

/**
 * Parse a DOM-extracted row into a ForecastRecord
 */
function parseEPADOMRow(row: Record<string, string>): ForecastRecord | null {
  const findField = (keys: string[]): string | undefined => {
    for (const key of keys) {
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase().includes(key.toLowerCase()) && v) {
          return v;
        }
      }
    }
    return undefined;
  };

  const title = findField(['title', 'requirement', 'name', 'description', 'project', 'procurement']);
  const naics = findField(['naics']);

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'cost', 'ceiling', 'budget']);
  const { min, max } = parseValueRange(valueStr);

  return {
    source_agency: 'EPA',
    source_type: 'puppeteer',
    source_url: EPA_CONFIG.source_url,
    external_id: buildDeterministicExternalId('EPA-DOM', [
      title,
      naics,
      valueStr,
      findField(['award date', 'anticipated', 'estimated award']),
    ]),

    title: title || `EPA Forecast - ${naics || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary', 'statement of work', 'sow']),

    department: 'Environmental Protection Agency',
    bureau: findField(['office', 'region', 'bureau', 'division']),
    contracting_office: findField(['contracting office', 'procurement office']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service code', 'service code']),

    fiscal_year: normalizeFY(findField(['fiscal year', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr', 'anticipated quarter']),
    anticipated_award_date: findField(['award date', 'anticipated date', 'target date', 'est award', 'estimated award']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField(['set-aside', 'setaside', 'set aside', 'small business', 'socio', 'preference', 'type'])),
    contract_type: findField(['contract type', 'type', 'vehicle', 'acquisition type', 'procurement type']),
    competition_type: findField(['competition', 'solicitation type']),

    incumbent_name: findField(['incumbent', 'current contractor', 'contractor', 'existing contractor']),

    pop_state: findField(['state', 'location', 'place of performance', 'pop', 'pop state']),

    poc_name: findField(['poc', 'contact', 'point of contact', 'contracting officer', 'co']),
    poc_email: findField(['email', 'e-mail']),
    poc_phone: findField(['phone']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Test the EPA scraper
 */
export async function testEPAScraper(): Promise<void> {
  console.log('Testing EPA forecast scraper...');
  const result = await scrapeEPA();

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

/**
 * Treasury OSDBU Forecast Scraper
 * URL: https://osdbu.forecast.treasury.gov/
 *
 * Treasury uses Salesforce LWR (Lightweight Web Runtime) with Lightning Web Components.
 * Strategy: Use API interception to capture data from /webruntime/api endpoints.
 *
 * This scraper uses Puppeteer with request interception to capture API data.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const TREASURY_CONFIG = {
  agency_code: 'Treasury',
  agency_name: 'Department of the Treasury',
  source_url: 'https://osdbu.forecast.treasury.gov/',
  alt_url: 'https://sbecs.treas.gov/forecast',
  timeout: 90000,
  // Salesforce LWR API patterns
  api_patterns: [
    '/webruntime/api',
    '/api/',
    '/forecast',
    '/services/data',
    '/aura',
    'graphql',
  ],
};

/**
 * Scrape Treasury OSDBU forecast data using API interception
 */
export async function scrapeTreasury(): Promise<ScraperResult> {
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

      // Check if this looks like an API response
      const isApiEndpoint = TREASURY_CONFIG.api_patterns.some(pattern =>
        url.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isApiEndpoint && contentType.includes('application/json')) {
        try {
          const data = await response.json();

          // Look for forecast data in various Salesforce response structures
          let forecasts: any[] = [];

          if (Array.isArray(data)) {
            forecasts = data;
          } else if (data.data && Array.isArray(data.data)) {
            forecasts = data.data;
          } else if (data.results && Array.isArray(data.results)) {
            forecasts = data.results;
          } else if (data.records && Array.isArray(data.records)) {
            forecasts = data.records;
          } else if (data.items && Array.isArray(data.items)) {
            forecasts = data.items;
          } else if (data.forecasts && Array.isArray(data.forecasts)) {
            forecasts = data.forecasts;
          }
          // Salesforce Aura response format
          else if (data.actions && Array.isArray(data.actions)) {
            for (const action of data.actions) {
              if (action.returnValue && Array.isArray(action.returnValue)) {
                forecasts = [...forecasts, ...action.returnValue];
              } else if (action.returnValue?.records && Array.isArray(action.returnValue.records)) {
                forecasts = [...forecasts, ...action.returnValue.records];
              }
            }
          }

          // Filter to items that look like forecasts
          const validForecasts = forecasts.filter(item => {
            if (!item || typeof item !== 'object') return false;
            return item.title || item.name || item.naics || item.naicsCode ||
                   item.Name || item.Title || item.Description ||
                   item.requirementTitle || item.Bureau;
          });

          if (validForecasts.length > 0) {
            console.log(`[Treasury] Intercepted API data from ${url}: ${validForecasts.length} records`);
            apiData = [...apiData, ...validForecasts];
          }
        } catch {
          // Not valid JSON or parsing failed
        }
      }
    });

    // Try main URL first
    console.log(`[Treasury] Loading ${TREASURY_CONFIG.source_url}...`);
    let loadSuccess = false;

    try {
      await page.goto(TREASURY_CONFIG.source_url, {
        waitUntil: 'networkidle0',
        timeout: TREASURY_CONFIG.timeout,
      });
      loadSuccess = true;
    } catch {
      console.log(`[Treasury] Main URL failed, trying ${TREASURY_CONFIG.alt_url}...`);
      try {
        await page.goto(TREASURY_CONFIG.alt_url, {
          waitUntil: 'networkidle0',
          timeout: TREASURY_CONFIG.timeout,
        });
        loadSuccess = true;
      } catch (e) {
        errors.push(`Failed to load both URLs: ${e}`);
      }
    }

    if (loadSuccess) {
      // Wait for Salesforce LWR to initialize
      await sleep(8000);

      // Try to navigate to forecast view
      try {
        // Click on forecast link/button if present
        const forecastSelectors = [
          'a[href*="forecast"]',
          'button:has-text("Forecast")',
          'a:has-text("Forecast")',
          '[data-page="forecast"]',
          '.forecast-link',
        ];

        for (const selector of forecastSelectors) {
          try {
            const link = await page.$(selector);
            if (link) {
              await link.click();
              await sleep(5000);
              break;
            }
          } catch {
            // Continue
          }
        }

        // Try to expand/show all results
        const expandSelectors = [
          'button:has-text("View All")',
          'button:has-text("Show All")',
          'select[name*="page"]',
          '.view-all',
          '.show-all',
        ];

        for (const selector of expandSelectors) {
          try {
            const btn = await page.$(selector);
            if (btn) {
              await btn.click();
              await sleep(3000);
              break;
            }
          } catch {
            // Continue
          }
        }
      } catch {
        // Interaction failed
      }

      // Give more time for API responses
      await sleep(5000);

      // Process intercepted API data
      if (apiData.length > 0) {
        console.log(`[Treasury] Processing ${apiData.length} intercepted records`);
        for (const row of apiData) {
          try {
            const record = parseTreasuryAPIRecord(row);
            if (record) {
              records.push(record);
            }
          } catch (e) {
            errors.push(`Parse error: ${e}`);
          }
        }
      }

      // Fallback: try DOM extraction
      if (records.length === 0) {
        console.log('[Treasury] No API data, attempting DOM extraction');
        const tableData = await page.evaluate(() => {
          const rows: Record<string, string>[] = [];

          // Try Salesforce Lightning components and standard tables
          const containers = document.querySelectorAll(
            'table, lightning-datatable, .slds-table, [role="grid"], .data-table, .forecast-table'
          );

          containers.forEach(container => {
            const headerCells = container.querySelectorAll('thead th, [role="columnheader"], .slds-th');
            const headers: string[] = [];
            headerCells.forEach(cell => {
              headers.push((cell.textContent || '').trim().toLowerCase());
            });

            const dataRows = container.querySelectorAll('tbody tr, [role="row"]:not([role="columnheader"]), .slds-hint-parent');
            dataRows.forEach(row => {
              const cells = row.querySelectorAll('td, [role="cell"], .slds-cell');
              const rowData: Record<string, string> = {};

              cells.forEach((cell, index) => {
                const header = headers[index] || `col${index}`;
                rowData[header] = (cell.textContent || '').trim();
              });

              if (Object.keys(rowData).length > 0) {
                rows.push(rowData);
              }
            });
          });

          // Try card-based layouts
          if (rows.length === 0) {
            const cards = document.querySelectorAll('.forecast-card, .slds-card, [class*="card"]');
            cards.forEach(card => {
              const rowData: Record<string, string> = {};

              const fields = card.querySelectorAll('[class*="field"], .slds-form-element, dl');
              fields.forEach(field => {
                const label = field.querySelector('[class*="label"], .slds-form-element__label, dt');
                const value = field.querySelector('[class*="value"], .slds-form-element__control, dd');
                if (label && value) {
                  const key = (label.textContent || '').trim().toLowerCase().replace(':', '');
                  rowData[key] = (value.textContent || '').trim();
                }
              });

              if (Object.keys(rowData).length > 0) {
                rows.push(rowData);
              }
            });
          }

          return rows;
        });

        console.log(`[Treasury] Extracted ${tableData.length} rows from DOM`);

        for (const row of tableData) {
          try {
            const record = parseTreasuryDOMRow(row);
            if (record) {
              records.push(record);
            }
          } catch (e) {
            errors.push(`DOM parse error: ${e}`);
          }
        }
      }
    }

    await browser.close();

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
    console.error('[Treasury] Scraper error:', error);
  }

  return {
    success: records.length > 0,
    agency: TREASURY_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Parse a Treasury API response record
 */
function parseTreasuryAPIRecord(item: Record<string, unknown>): ForecastRecord | null {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = item[key] || item[key.toLowerCase()] || item[key.toUpperCase()];
      if (value !== null && value !== undefined && value !== '') {
        return String(value);
      }
    }
    return undefined;
  };

  const title = getString(['title', 'Title', 'name', 'Name', 'description', 'Description', 'requirementTitle']);
  const naics = getString(['naics', 'NAICS', 'naicsCode', 'naics_code']);
  const id = getString(['id', 'Id', 'ID', 'forecastId', 'recordId']);
  const bureau = getString(['bureau', 'Bureau', 'office', 'Office', 'component', 'organization']);

  if (!title && !naics && !id && !bureau) {
    return null;
  }

  const valueStr = getString(['estimatedValue', 'value', 'Value', 'amount', 'Amount', 'dollarRange', 'ceiling']);
  const { min, max } = parseValueRange(valueStr);

  return {
    source_agency: 'Treasury',
    source_type: 'api',
    source_url: TREASURY_CONFIG.source_url,
    external_id: id ? `Treasury-${id}` : buildDeterministicExternalId('Treasury', [
      bureau,
      title,
      naics,
      valueStr,
      getString(['awardDate', 'AwardDate', 'anticipatedAwardDate', 'targetDate']),
    ]),

    title: title || `Treasury Forecast - ${bureau || naics || 'Unknown'}`,
    description: getString(['description', 'Description', 'synopsis', 'scope', 'details']),

    department: 'Department of the Treasury',
    bureau: bureau,
    contracting_office: getString(['contractingOffice', 'ContractingOffice', 'office', 'procurementOffice']),

    naics_code: normalizeNaics(naics),
    psc_code: getString(['psc', 'PSC', 'pscCode', 'productServiceCode']),

    fiscal_year: normalizeFY(getString(['fiscalYear', 'FiscalYear', 'fy', 'year'])),
    anticipated_quarter: getString(['quarter', 'Quarter', 'anticipatedQuarter']),
    anticipated_award_date: getString(['awardDate', 'AwardDate', 'anticipatedAwardDate', 'targetDate']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(getString(['setAside', 'SetAside', 'setAsideType', 'smallBusiness', 'preference'])),
    contract_type: getString(['contractType', 'ContractType', 'type', 'acquisitionType']),
    competition_type: getString(['competition', 'Competition', 'competitionType']),

    incumbent_name: getString(['incumbent', 'Incumbent', 'currentContractor']),

    poc_name: getString(['poc', 'POC', 'contactName', 'pointOfContact']),
    poc_email: getString(['email', 'Email', 'pocEmail', 'contactEmail']),
    poc_phone: getString(['phone', 'Phone', 'pocPhone']),

    pop_state: getString(['state', 'State', 'popState', 'location']),

    status: 'forecast',
    raw_data: JSON.stringify(item),
  };
}

/**
 * Parse a DOM-extracted row into a ForecastRecord
 */
function parseTreasuryDOMRow(row: Record<string, string>): ForecastRecord | null {
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
  const bureau = findField(['bureau', 'office', 'organization', 'component']);

  if (!title && !naics && !bureau) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'ceiling', 'cost']);
  const { min, max } = parseValueRange(valueStr);

  return {
    source_agency: 'Treasury',
    source_type: 'puppeteer',
    source_url: TREASURY_CONFIG.source_url,
    external_id: buildDeterministicExternalId('Treasury-DOM', [
      title,
      bureau,
      naics,
      valueStr,
      findField(['award date', 'anticipated date', 'target date']),
    ]),

    title: title || `Treasury Forecast - ${bureau || naics || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary', 'details']),

    department: 'Department of the Treasury',
    bureau: bureau,
    contracting_office: findField(['contracting office', 'procurement office', 'buying office']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service', 'service code']),

    fiscal_year: normalizeFY(findField(['fiscal', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr']),
    anticipated_award_date: findField(['award date', 'anticipated date', 'target date']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField(['set-aside', 'setaside', 'small business', 'socio', 'preference'])),
    contract_type: findField(['contract type', 'type', 'vehicle', 'acquisition type']),
    competition_type: findField(['competition', 'solicitation type']),

    incumbent_name: findField(['incumbent', 'current contractor', 'contractor']),

    pop_state: findField(['state', 'location', 'place of performance', 'pop']),

    poc_name: findField(['poc', 'contact', 'point of contact', 'contracting officer']),
    poc_email: findField(['email']),
    poc_phone: findField(['phone']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Test the Treasury scraper
 */
export async function testTreasuryScraper(): Promise<void> {
  console.log('Testing Treasury OSDBU scraper...');
  const result = await scrapeTreasury();

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

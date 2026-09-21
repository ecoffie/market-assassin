/**
 * VA Vendor Portal Forecast Scraper
 * URL: https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx
 *
 * The VA Vendor Portal is an ASP.NET WebForms application.
 * Strategy:
 * 1. API Interception - Capture any JSON/API responses
 * 2. ASP.NET ViewState handling - Handle postbacks for pagination
 * 3. DOM extraction - Parse GridView tables
 *
 * This scraper uses Puppeteer with request interception.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const VA_CONFIG = {
  agency_code: 'VA',
  agency_name: 'Department of Veterans Affairs',
  source_url: 'https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx',
  alt_urls: [
    'https://www.va.gov/osdbu/acquisition/forecast.asp',
    'https://www.va.gov/osdbu/docs/forecastFY26.xlsx', // Direct Excel if available
  ],
  timeout: 90000,
  maxPages: 20,
  // API patterns to intercept
  api_patterns: [
    '/api/',
    '/webservice',
    '/handler',
    '.asmx',
    '.ashx',
    '/services/',
    'json',
    'forecast',
  ],
};

/**
 * Scrape VA Vendor Portal forecast data using API interception + ASP.NET handling
 */
export async function scrapeVA(): Promise<ScraperResult> {
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

      // Check if this looks like an API response
      const isApiEndpoint = VA_CONFIG.api_patterns.some(pattern =>
        url.toLowerCase().includes(pattern.toLowerCase())
      );

      if (isApiEndpoint && contentType.includes('application/json')) {
        try {
          const data = await response.json();

          // Look for forecast data in various response structures
          let forecasts: any[] = [];

          if (Array.isArray(data)) {
            forecasts = data;
          } else if (data.d && Array.isArray(data.d)) {
            // ASP.NET AJAX WebMethod format
            forecasts = data.d;
          } else if (data.d?.results && Array.isArray(data.d.results)) {
            forecasts = data.d.results;
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

          // Filter to items that look like forecasts
          const validForecasts = forecasts.filter(item => {
            if (!item || typeof item !== 'object') return false;
            return item.title || item.name || item.naics || item.NAICS ||
                   item.Title || item.Name || item.Description ||
                   item.requirementTitle || item.Requirement ||
                   item.opportunity || item.Opportunity;
          });

          if (validForecasts.length > 0) {
            console.log(`[VA] Intercepted API data from ${url}: ${validForecasts.length} records`);
            apiData = [...apiData, ...validForecasts];
          }
        } catch {
          // Not valid JSON
        }
      }
    });

    // Try main Vendor Portal URL
    console.log(`[VA] Loading ${VA_CONFIG.source_url}...`);
    let loadSuccess = false;
    let currentUrl = VA_CONFIG.source_url;

    try {
      await page.goto(VA_CONFIG.source_url, {
        waitUntil: 'networkidle0',
        timeout: VA_CONFIG.timeout,
      });
      loadSuccess = true;
    } catch {
      // Try alternate URLs
      for (const altUrl of VA_CONFIG.alt_urls) {
        if (altUrl.endsWith('.xlsx')) {
          // Skip Excel downloads for Puppeteer - handle separately
          continue;
        }
        console.log(`[VA] Trying alternate URL: ${altUrl}...`);
        try {
          await page.goto(altUrl, {
            waitUntil: 'networkidle0',
            timeout: VA_CONFIG.timeout,
          });
          loadSuccess = true;
          currentUrl = altUrl;
          break;
        } catch {
          continue;
        }
      }
    }

    if (!loadSuccess) {
      errors.push('Failed to load any VA forecast URLs');
    }

    if (loadSuccess) {
      // Wait for ASP.NET page to fully render
      await sleep(5000);

      // Check for login requirement
      const loginForm = await page.$('form[action*="login"], input[type="password"], .login-form, #loginPanel');
      if (loginForm) {
        errors.push('VA Vendor Portal requires authentication; public scraping is not reliable');
        await browser.close();
        return {
          success: false,
          agency: VA_CONFIG.agency_code,
          records: [],
          errors,
          timing: Date.now() - startTime,
        };
      }

      // Try to expand results or change page size
      try {
        // ASP.NET DropDownList for page size
        const pageSizeSelectors = [
          'select[id*="PageSize"]',
          'select[id*="ddlPageSize"]',
          'select[id*="pagesize"]',
          'select[name*="pageSize"]',
          '#ctl00_ContentPlaceHolder1_ddlPageSize',
        ];

        for (const selector of pageSizeSelectors) {
          const select = await page.$(selector);
          if (select) {
            try {
              // Try to select maximum page size
              await page.select(selector, '500');
              await sleep(3000);
              break;
            } catch {
              try {
                await page.select(selector, '100');
                await sleep(3000);
                break;
              } catch {
                try {
                  await page.select(selector, 'All');
                  await sleep(3000);
                  break;
                } catch {
                  // Continue
                }
              }
            }
          }
        }

        // View All button
        const viewAllSelectors = [
          '#btnViewAll',
          '.btn-view-all',
          'input[value="View All"]',
          'a[href*="ViewAll"]',
          'input[id*="btnShowAll"]',
        ];

        for (const selector of viewAllSelectors) {
          const btn = await page.$(selector);
          if (btn) {
            await btn.click();
            await sleep(3000);
            break;
          }
        }
      } catch {
        // Continue without expanding
      }

      // Give time for any API responses
      await sleep(5000);

      // Process intercepted API data first
      if (apiData.length > 0) {
        console.log(`[VA] Processing ${apiData.length} intercepted API records`);
        for (const row of apiData) {
          try {
            const record = parseVAAPIRecord(row);
            if (record) {
              records.push(record);
            }
          } catch (e) {
            errors.push(`API parse error: ${e}`);
          }
        }
      }

      // Fallback: DOM extraction with ASP.NET pagination
      if (records.length === 0) {
        console.log('[VA] No API data, attempting DOM extraction with pagination');

        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= VA_CONFIG.maxPages) {
          console.log(`[VA] Scraping page ${currentPage}...`);

          // Extract table data
          const tableData = await page.evaluate(() => {
            const rows: Record<string, string>[] = [];

            // ASP.NET GridView tables
            const gridViews = document.querySelectorAll(
              'table[id*="GridView"], table[id*="gvForecast"], table[id*="gv"], .gridview, table.grid, table[role="grid"]'
            );

            gridViews.forEach(table => {
              const headerRow = table.querySelector('tr:first-child, thead tr, tr.header');
              const headers: string[] = [];

              if (headerRow) {
                const headerCells = headerRow.querySelectorAll('th, td');
                headerCells.forEach(cell => {
                  const text = (cell.textContent || '').trim().toLowerCase();
                  if (text) headers.push(text);
                });
              }

              const dataRows = table.querySelectorAll('tr:not(:first-child):not(.header):not(.pager), tbody tr');

              dataRows.forEach(row => {
                // Skip header rows, pager rows, or empty rows
                if (row.classList.contains('pager') ||
                    row.classList.contains('header') ||
                    row.querySelector('th:not([scope])')) {
                  return;
                }

                const cells = row.querySelectorAll('td');
                if (cells.length === 0) return;

                const rowData: Record<string, string> = {};

                cells.forEach((cell, index) => {
                  const header = headers[index] || `col${index}`;
                  const text = (cell.textContent || '').trim();
                  if (text && text !== '\u00A0' && text !== ' ') {
                    rowData[header] = text;
                  }
                });

                if (Object.keys(rowData).length > 0 &&
                    Object.values(rowData).some(v => v.length > 0)) {
                  rows.push(rowData);
                }
              });
            });

            // Try standard tables if no GridView found
            if (rows.length === 0) {
              const tables = document.querySelectorAll('table');

              tables.forEach(table => {
                // Skip navigation and layout tables
                if (table.closest('nav') || table.closest('header') ||
                    table.closest('footer') || table.closest('#navigation') ||
                    table.closest('.menu')) {
                  return;
                }

                const headerCells = table.querySelectorAll('thead th, tr:first-child th');
                const headers: string[] = [];
                headerCells.forEach(cell => {
                  headers.push((cell.textContent || '').trim().toLowerCase());
                });

                // Check if this looks like a data table
                if (headers.length > 2 &&
                    (headers.some(h => h.includes('naics') || h.includes('title') ||
                                       h.includes('value') || h.includes('forecast')))) {
                  const dataRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');

                  dataRows.forEach(row => {
                    if (row.querySelector('th')) return; // Skip header rows

                    const cells = row.querySelectorAll('td');
                    const rowData: Record<string, string> = {};

                    cells.forEach((cell, index) => {
                      const header = headers[index] || `col${index}`;
                      const text = (cell.textContent || '').trim();
                      if (text) rowData[header] = text;
                    });

                    if (Object.keys(rowData).length > 0) {
                      rows.push(rowData);
                    }
                  });
                }
              });
            }

            // Try card/list layouts
            if (rows.length === 0) {
              const items = document.querySelectorAll(
                '.forecast-item, .opportunity-item, .list-item, article, .card, [class*="forecast"]'
              );

              items.forEach(item => {
                const rowData: Record<string, string> = {};

                // Extract from definition lists
                const definitionLists = item.querySelectorAll('dl, .field-group');
                definitionLists.forEach(dl => {
                  const dts = dl.querySelectorAll('dt, .field-label');
                  const dds = dl.querySelectorAll('dd, .field-value');
                  dts.forEach((dt, i) => {
                    const key = (dt.textContent || '').trim().toLowerCase().replace(':', '');
                    const value = dds[i] ? (dds[i].textContent || '').trim() : '';
                    if (key && value) {
                      rowData[key] = value;
                    }
                  });
                });

                // Extract from labeled spans
                const labeledFields = item.querySelectorAll('[data-label], [class*="label"]');
                labeledFields.forEach(field => {
                  const label = field.getAttribute('data-label') ||
                               (field.querySelector('.label')?.textContent || '');
                  const value = (field.textContent || '').replace(label, '').trim();
                  if (label && value) {
                    rowData[label.toLowerCase()] = value;
                  }
                });

                if (Object.keys(rowData).length > 0) {
                  rows.push(rowData);
                }
              });
            }

            return rows;
          });

          console.log(`[VA] Page ${currentPage}: ${tableData.length} rows`);

          for (const row of tableData) {
            try {
              const record = parseVADOMRow(row);
              if (record) {
                records.push(record);
              }
            } catch (e) {
              errors.push(`DOM parse error: ${e}`);
            }
          }

          // Try to navigate to next page (ASP.NET postback pagination)
          hasMorePages = await tryNextPageASPNet(page);
          if (hasMorePages) {
            currentPage++;
            await sleep(3000);
          }
        }

        console.log(`[VA] Extracted ${records.length} total records from ${currentPage} pages`);
      }
    }

    await browser.close();

  } catch (error) {
    errors.push(`Scraper error: ${error}`);
    console.error('[VA] Scraper error:', error);
  }

  return {
    success: records.length > 0,
    agency: VA_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Try to navigate to next page using ASP.NET postback
 */
async function tryNextPageASPNet(page: any): Promise<boolean> {
  try {
    // ASP.NET GridView pagination selectors
    const nextSelectors = [
      // Numeric pager - look for next number
      'table.pager a:not(.aspNetDisabled)',
      'tr.pager a:not(.aspNetDisabled)',
      '.pagination a:not(.disabled):last-child',
      // Next/Previous links
      'a[href*="Page$Next"]:not(.aspNetDisabled)',
      'a[href*="Page$"]',
      'input[name*="btnNext"]:not([disabled])',
      'a:has-text("Next"):not(.disabled)',
      'a:has-text(">")',
      // Standard pagination
      '.pager a[href*="page="]',
      'a.next-page:not(.disabled)',
    ];

    for (const selector of nextSelectors) {
      try {
        const links = await page.$$(selector);
        if (links.length > 0) {
          // Find the next active page link
          for (const link of links) {
            const isDisabled = await page.evaluate((el: any) => {
              return el.disabled ||
                     el.classList.contains('disabled') ||
                     el.classList.contains('aspNetDisabled') ||
                     el.getAttribute('disabled') === 'disabled';
            }, link);

            if (!isDisabled) {
              // Check if this is actually a "next" link
              const text = await page.evaluate((el: any) => el.textContent, link);
              const href = await page.evaluate((el: any) => el.getAttribute('href') || '', link);

              if (text?.includes('Next') || text?.includes('>') ||
                  href.includes('Page$Next') || text?.match(/^\d+$/)) {
                await link.click();
                await sleep(2000);
                return true;
              }
            }
          }
        }
      } catch {
        // Continue to next selector
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Parse a VA API response record
 */
function parseVAAPIRecord(item: Record<string, unknown>): ForecastRecord | null {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = item[key] || item[key.toLowerCase()] || item[key.toUpperCase()];
      if (value !== null && value !== undefined && value !== '') {
        return String(value);
      }
    }
    return undefined;
  };

  const title = getString(['title', 'Title', 'name', 'Name', 'description', 'Description', 'requirement', 'Requirement', 'opportunity', 'Opportunity']);
  const naics = getString(['naics', 'NAICS', 'naicsCode', 'naics_code']);
  const id = getString(['id', 'ID', 'forecastId', 'ForecastId', 'opportunityId']);
  const office = getString(['office', 'Office', 'visn', 'VISN', 'facility', 'Facility', 'station', 'Station']);

  if (!title && !naics && !id && !office) {
    return null;
  }

  const valueStr = getString(['value', 'Value', 'amount', 'Amount', 'estimate', 'Estimate', 'estimatedValue', 'ceiling', 'Ceiling']);
  const { min, max } = parseValueRange(valueStr);

  // VA-specific office mapping
  let bureau = office;
  if (office) {
    const visnMatch = office.match(/VISN\s*(\d+)/i);
    if (visnMatch) {
      bureau = `Veterans Integrated Service Network ${visnMatch[1]}`;
    }
  }

  return {
    source_agency: 'VA',
    source_type: 'api',
    source_url: VA_CONFIG.source_url,
    external_id: id ? `VA-${id}` : buildDeterministicExternalId('VA', [
      office,
      title,
      naics,
      valueStr,
      getString(['awardDate', 'AwardDate', 'anticipatedDate', 'targetDate', 'expectedDate']),
    ]),

    title: title || `VA Forecast - ${office || naics || 'Unknown'}`,
    description: getString(['description', 'Description', 'synopsis', 'Synopsis', 'scope', 'Scope', 'details', 'Details']),

    department: 'Department of Veterans Affairs',
    bureau: bureau,
    contracting_office: getString(['contractingOffice', 'ContractingOffice', 'nco', 'NCO', 'procurementOffice']),
    program_office: getString(['programOffice', 'ProgramOffice', 'program', 'Program', 'serviceLine']),

    naics_code: normalizeNaics(naics),
    psc_code: getString(['psc', 'PSC', 'pscCode', 'productServiceCode']),

    fiscal_year: normalizeFY(getString(['fiscalYear', 'FiscalYear', 'fy', 'FY', 'year', 'Year'])),
    anticipated_quarter: getString(['quarter', 'Quarter', 'anticipatedQuarter']),
    anticipated_award_date: getString(['awardDate', 'AwardDate', 'anticipatedDate', 'targetDate', 'expectedDate']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(getString(['setAside', 'SetAside', 'setAsideType', 'smallBusiness', 'sdvosb', 'vosb'])),
    contract_type: getString(['contractType', 'ContractType', 'type', 'Type', 'vehicle', 'Vehicle']),
    competition_type: getString(['competition', 'Competition', 'competitionType']),

    incumbent_name: getString(['incumbent', 'Incumbent', 'currentContractor', 'contractor']),
    incumbent_contract_number: getString(['contractNumber', 'ContractNumber', 'currentContract', 'awardNumber']),

    poc_name: getString(['poc', 'POC', 'contactName', 'pointOfContact', 'contractingOfficer']),
    poc_email: getString(['email', 'Email', 'pocEmail', 'contactEmail']),
    poc_phone: getString(['phone', 'Phone', 'pocPhone']),

    pop_state: getString(['state', 'State', 'popState', 'location', 'Location', 'facilityLocation']),
    pop_city: getString(['city', 'City']),
    pop_zip: getString(['zip', 'zipcode', 'postalCode']),

    status: 'forecast',
    raw_data: JSON.stringify(item),
  };
}

/**
 * Parse a DOM-extracted row into a ForecastRecord
 */
function parseVADOMRow(row: Record<string, string>): ForecastRecord | null {
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

  const title = findField(['title', 'name', 'requirement', 'description', 'opportunity', 'procurement']);
  const naics = findField(['naics']);
  const office = findField(['office', 'visn', 'facility', 'station', 'organization']);

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'ceiling', 'cost', 'range', 'budget']);
  const { min, max } = parseValueRange(valueStr);

  // VA-specific office mapping
  let bureau = office;
  if (office) {
    const visnMatch = office.match(/VISN\s*(\d+)/i);
    if (visnMatch) {
      bureau = `Veterans Integrated Service Network ${visnMatch[1]}`;
    }
  }

  return {
    source_agency: 'VA',
    source_type: 'puppeteer',
    source_url: VA_CONFIG.source_url,
    external_id: buildDeterministicExternalId('VA-DOM', [
      title,
      naics,
      office,
      valueStr,
      findField(['award date', 'anticipated', 'target date', 'expected']),
    ]),

    title: title || `VA Forecast - ${naics || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary', 'details', 'statement of work', 'sow']),

    department: 'Department of Veterans Affairs',
    bureau: bureau,
    contracting_office: findField(['contracting office', 'nco', 'buying office', 'acquisition center']),
    program_office: findField(['program office', 'program', 'service line']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service', 'service code', 'fsc']),

    fiscal_year: normalizeFY(findField(['fiscal', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr', 'q1', 'q2', 'q3', 'q4']),
    anticipated_award_date: findField(['award date', 'anticipated', 'target date', 'expected']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField([
      'set-aside', 'setaside', 'small business', 'socio', 'preference',
      'sdvosb', 'vosb', 'service disabled', 'veteran',
    ])),
    contract_type: findField(['contract type', 'type', 'vehicle', 'acquisition', 'idiq', 'bpa']),
    competition_type: findField(['competition', 'solicitation type', 'acquisition strategy']),

    incumbent_name: findField(['incumbent', 'current contractor', 'contractor', 'awardee']),
    incumbent_contract_number: findField(['contract number', 'current contract', 'award number', 'order number']),

    poc_name: findField(['poc', 'contact', 'point of contact', 'contracting officer', 'co', 'cs']),
    poc_email: findField(['email', 'e-mail']),
    poc_phone: findField(['phone', 'telephone', 'tel']),

    pop_state: findField(['state', 'location', 'place of performance', 'pop', 'facility location']),
    pop_city: findField(['city']),
    pop_zip: findField(['zip', 'zipcode']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Test the VA scraper
 */
export async function testVAScraper(): Promise<void> {
  console.log('Testing VA Vendor Portal scraper...');
  const result = await scrapeVA();

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

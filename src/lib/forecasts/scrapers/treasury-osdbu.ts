/**
 * Treasury OSDBU Forecast Scraper
 * URL: https://osdbu.forecast.treasury.gov/ or https://sbecs.treas.gov
 *
 * Treasury's OSDBU provides forecast data through an Angular-based SPA.
 * May also be accessible via sbecs.treas.gov (Small Business E-Contracting System).
 *
 * This scraper uses Puppeteer to handle the dynamic content.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const TREASURY_CONFIG = {
  agency_code: 'Treasury',
  agency_name: 'Department of the Treasury',
  source_url: 'https://osdbu.forecast.treasury.gov/',
  alt_url: 'https://sbecs.treas.gov/forecast',
  timeout: 60000,
};

/**
 * Scrape Treasury OSDBU forecast data using Puppeteer
 */
export async function scrapeTreasury(): Promise<ScraperResult> {
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

    // Try main OSDBU URL first
    console.log(`[Treasury] Loading ${TREASURY_CONFIG.source_url}...`);

    let loadSuccess = false;
    try {
      await page.goto(TREASURY_CONFIG.source_url, {
        waitUntil: 'networkidle2',
        timeout: TREASURY_CONFIG.timeout,
      });
      loadSuccess = true;
    } catch {
      // Try alternate URL
      console.log(`[Treasury] Main URL failed, trying ${TREASURY_CONFIG.alt_url}...`);
      try {
        await page.goto(TREASURY_CONFIG.alt_url, {
          waitUntil: 'networkidle2',
          timeout: TREASURY_CONFIG.timeout,
        });
        loadSuccess = true;
      } catch (e) {
        errors.push(`Failed to load both URLs: ${e}`);
      }
    }

    if (loadSuccess) {
      // Wait for Angular to render
      await sleep(5000);

      // Try to find and click "View All" or expand pagination
      try {
        const viewAllSelectors = [
          'button:has-text("View All")',
          'button:has-text("Show All")',
          '.view-all',
          '.show-all',
          '[data-action="expand"]',
          'mat-paginator .mat-paginator-range-actions button:last-child', // Angular Material paginator
        ];

        for (const selector of viewAllSelectors) {
          const btn = await page.$(selector);
          if (btn) {
            await btn.click();
            await sleep(2000);
            break;
          }
        }
      } catch {
        // Continue without expanding
      }

      // Extract table data from Angular Material table or standard table
      const tableData = await page.evaluate(() => {
        const rows: Record<string, string>[] = [];

        // Try Angular Material table first
        const matTables = document.querySelectorAll('mat-table, .mat-table, table.mat-table');
        matTables.forEach(table => {
          const headerCells = table.querySelectorAll('mat-header-cell, .mat-header-cell, th.mat-header-cell');
          const headers: string[] = [];
          headerCells.forEach(cell => {
            headers.push((cell.textContent || '').trim().toLowerCase());
          });

          const dataRows = table.querySelectorAll('mat-row, .mat-row, tr.mat-row');
          dataRows.forEach(row => {
            const cells = row.querySelectorAll('mat-cell, .mat-cell, td.mat-cell');
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

        // Fallback to standard tables
        if (rows.length === 0) {
          const tables = document.querySelectorAll('table, [role="grid"]');
          tables.forEach(table => {
            const headerCells = table.querySelectorAll('thead th, [role="columnheader"]');
            const headers: string[] = [];
            headerCells.forEach(cell => {
              headers.push((cell.textContent || '').trim().toLowerCase());
            });

            const dataRows = table.querySelectorAll('tbody tr, [role="row"]:not([role="columnheader"])');
            dataRows.forEach(row => {
              const cells = row.querySelectorAll('td, [role="cell"]');
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
        }

        // Try card-based layouts (common in modern SPAs)
        if (rows.length === 0) {
          const cards = document.querySelectorAll('.forecast-card, .opportunity-card, mat-card, .mat-card');
          cards.forEach(card => {
            const rowData: Record<string, string> = {};

            // Look for labeled content
            const fields = card.querySelectorAll('[class*="field"], [class*="detail"], .row, dl');
            fields.forEach(field => {
              const label = field.querySelector('[class*="label"], dt, strong, .title');
              const value = field.querySelector('[class*="value"], dd, span:not([class*="label"]), .content');
              if (label && value) {
                const key = (label.textContent || '').trim().toLowerCase().replace(':', '');
                rowData[key] = (value.textContent || '').trim();
              }
            });

            // Also try direct child text extraction
            if (Object.keys(rowData).length === 0) {
              const title = card.querySelector('h2, h3, h4, .title, mat-card-title');
              if (title) {
                rowData['title'] = (title.textContent || '').trim();
              }
              const content = card.querySelector('mat-card-content, .content, p');
              if (content) {
                rowData['description'] = (content.textContent || '').trim();
              }
            }

            if (Object.keys(rowData).length > 0) {
              rows.push(rowData);
            }
          });
        }

        return rows;
      });

      console.log(`[Treasury] Extracted ${tableData.length} rows`);

      // Parse extracted data
      for (const row of tableData) {
        try {
          const record = parseTreasuryRow(row);
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
  }

  return {
    success: errors.length === 0 || records.length > 0,
    agency: TREASURY_CONFIG.agency_code,
    records,
    errors,
    timing: Date.now() - startTime,
  };
}

/**
 * Parse a single Treasury row into a ForecastRecord
 */
function parseTreasuryRow(row: Record<string, string>): ForecastRecord | null {
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

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'ceiling', 'cost']);
  const { min, max } = parseValueRange(valueStr);

  const record: ForecastRecord = {
    source_agency: 'Treasury',
    source_type: 'puppeteer',
    source_url: TREASURY_CONFIG.source_url,
    external_id: buildDeterministicExternalId('Treasury', [
      title,
      bureau,
      naics,
      valueStr,
      findField(['award date', 'anticipated date', 'target date']),
    ]),

    title: title || `Treasury Forecast - ${naics || 'Unknown'}`,
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
    incumbent_contract_number: findField(['contract number', 'current contract', 'award number']),

    poc_name: findField(['poc', 'contact', 'point of contact', 'contracting officer']),
    poc_email: findField(['email']),
    poc_phone: findField(['phone', 'telephone']),

    pop_state: findField(['state', 'location', 'place of performance', 'pop']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };

  return record;
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

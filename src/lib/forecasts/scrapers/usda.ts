/**
 * USDA Forecast Scraper
 * URL: https://forecast.edc.usda.gov/ords/r/ias/sba-opportunities/search-opportunities
 *
 * USDA's Enterprise Data Center provides forecast data through an Oracle APEX web application.
 * This scraper uses Puppeteer to handle the dynamic content.
 *
 * Estimated Coverage: $4B in federal spending
 */

import type { ForecastRecord as DBForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

// Local interface for parsing
interface ForecastRecord {
  title: string;
  agency: string;
  description?: string;
  naics?: string;
  psc?: string;
  fiscalYear?: string;
  quarter?: string;
  awardDate?: string;
  valueMin?: number;
  valueMax?: number;
  valueRange?: string;
  setAside?: string;
  contractType?: string;
  incumbent?: string;
  state?: string;
  office?: string;
  contact?: { name?: string; email?: string };
}

const USDA_CONFIG = {
  agency_code: 'USDA',
  agency_name: 'Department of Agriculture',
  source_url: 'https://forecast.edc.usda.gov/ords/r/ias/sba-opportunities/search-opportunities',
  alt_urls: [
    'https://www.usda.gov/da/osdbu/forecast',
    'https://www.dm.usda.gov/smallbus/forecast.htm',
  ],
  timeout: 90000, // Oracle APEX can be slow
  maxPages: 20,
};

/**
 * Scrape USDA forecast data using Puppeteer
 * Returns array of ForecastRecord matching the interface expected by user
 */
export async function scrapeUSDA(): Promise<DBForecastRecord[]> {
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

    // Try primary URL first
    console.log(`[USDA] Loading ${USDA_CONFIG.source_url}...`);

    let loadSuccess = false;
    let currentUrl = USDA_CONFIG.source_url;

    try {
      await page.goto(USDA_CONFIG.source_url, {
        waitUntil: 'networkidle2',
        timeout: USDA_CONFIG.timeout,
      });
      loadSuccess = true;
    } catch {
      // Try alternate URLs
      for (const altUrl of USDA_CONFIG.alt_urls) {
        console.log(`[USDA] Primary URL failed, trying ${altUrl}...`);
        try {
          await page.goto(altUrl, {
            waitUntil: 'networkidle2',
            timeout: USDA_CONFIG.timeout,
          });
          loadSuccess = true;
          currentUrl = altUrl;
          break;
        } catch {
          continue;
        }
      }
    }

    if (loadSuccess) {
      // Wait for page to render
      await sleep(5000);

      // Try to expand results for Oracle APEX
      try {
        // Common Oracle APEX selectors for pagination controls
        const pageSizeSelectors = [
          'select.apex-item-select[name="p_max_rows"]',
          'select.a-IRR-pagination-select',
          'select[data-setting="rowsPerPage"]',
          'select[name*="length"] option[value="-1"]',
          'select[name*="length"] option[value="100"]',
        ];

        for (const selector of pageSizeSelectors) {
          try {
            const selectExists = await page.$(selector);
            if (selectExists) {
              // Try to set to maximum (usually 1000 or 10000)
              await page.select(selector, '1000').catch(() =>
                page.select(selector, '500').catch(() =>
                  page.select(selector, '100')
                )
              );
              await sleep(3000); // Wait for data to reload
              console.log('[USDA] Set page size to maximum');
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      } catch (e) {
        console.log('[USDA] Could not adjust page size, proceeding with default');
      }

      let pageNum = 1;
      let hasMorePages = true;

      while (hasMorePages && pageNum <= USDA_CONFIG.maxPages) {
        console.log(`[USDA] Scraping page ${pageNum}...`);

        const pageData = await extractUSDAData(page);
        records.push(...pageData);

        hasMorePages = await tryNextPage(page);

        if (hasMorePages) {
          pageNum++;
          await sleep(2000);
        }
      }

      console.log(`[USDA] Extracted ${records.length} total records from ${pageNum} pages`);
    } else {
      console.error('[USDA] Failed to load any URLs');
    }

    await browser.close();

  } catch (error) {
    console.error(`[USDA] Scraper error: ${error}`);
    errors.push(`Scraper error: ${error}`);
  }

  // Convert local ForecastRecord format to DBForecastRecord format
  const dbRecords: DBForecastRecord[] = records.map(r => ({
    source_agency: r.agency || 'USDA',
    source_type: 'puppeteer' as const,
    source_url: USDA_CONFIG.source_url,
    external_id: buildDeterministicExternalId('USDA', [
      r.title,
      r.naics,
      r.office,
      r.valueRange,
      r.awardDate,
    ]),

    title: r.title,
    description: r.description,

    department: 'USDA',
    contracting_office: r.office,

    naics_code: r.naics,
    psc_code: r.psc,

    fiscal_year: r.fiscalYear,
    anticipated_quarter: r.quarter,
    anticipated_award_date: r.awardDate,

    estimated_value_min: r.valueMin,
    estimated_value_max: r.valueMax,
    estimated_value_range: r.valueRange,

    contract_type: r.contractType,
    set_aside_type: r.setAside,

    incumbent_name: r.incumbent,

    poc_name: r.contact?.name,
    poc_email: r.contact?.email,

    pop_state: r.state,

    status: 'forecast' as const,
    raw_data: JSON.stringify(r),
  }));

  console.log(`[USDA] Converted ${dbRecords.length} records to database format`);
  return dbRecords;
}

/**
 * Extract forecast data from current page
 */
async function extractUSDAData(page: any): Promise<ForecastRecord[]> {
  const records: ForecastRecord[] = [];

  const tableData = await page.evaluate(() => {
    const rows: Record<string, string>[] = [];

    // Oracle APEX commonly uses these table structures
    const tableSelectors = [
      'table.a-IRR-table',
      'table.t-Report-report',
      'table.apex-report',
      'div.t-Region-body table',
      'table[summary*="report"]',
      '.a-GV table',
      'table.dataTable',
      'table.display',
      'table[role="grid"]',
      'table.table',
      '#forecast-table',
      '.forecast-list table',
    ];

    let targetTable: Element | null = null;

    for (const selector of tableSelectors) {
      const table = document.querySelector(selector);
      if (table) {
        targetTable = table;
        break;
      }
    }

    if (!targetTable) {
      // Fallback: find any table with reasonable size
      const allTables = Array.from(document.querySelectorAll('table'));
      for (const table of allTables) {
        const rowCount = table.querySelectorAll('tbody tr').length;
        if (rowCount > 5) {
          targetTable = table;
          break;
        }
      }
    }

    if (targetTable) {
      // Extract headers
      const headerCells = targetTable.querySelectorAll('thead th, thead td, tr.header th');
      const headers: string[] = [];
      headerCells.forEach(cell => {
        const text = (cell.textContent || '').trim().toLowerCase();
        if (text) {
          headers.push(text);
        }
      });

      // Extract data rows
      const dataRows = targetTable.querySelectorAll('tbody tr, tr:not(.header):not(:has(th))');

      dataRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) return;

        const rowData: Record<string, string> = {};

        cells.forEach((cell, index) => {
          const headerKey = headers[index] || `col${index}`;
          const value = (cell.textContent || '').trim();

          // Also check for links or data attributes
          const link = cell.querySelector('a');
          const dataValue = cell.getAttribute('data-value');

          if (value && value !== '\u00A0' && value !== ' ') {
            rowData[headerKey] = dataValue || (link ? link.href : value);
          }
        });

        if (Object.keys(rowData).length > 0 && Object.values(rowData).some(v => v !== '')) {
          rows.push(rowData);
        }
      });
    }

    // Try card/list layouts if no tables found
    if (rows.length === 0) {
      const items = document.querySelectorAll('.forecast-item, .opportunity-card, [data-type="forecast"]');
      items.forEach(item => {
        const rowData: Record<string, string> = {};

        const fields = item.querySelectorAll('dt, .label, [class*="label"]');
        fields.forEach(field => {
          const label = (field.textContent || '').trim().toLowerCase().replace(':', '');
          const value = field.nextElementSibling;
          if (value) {
            rowData[label] = (value.textContent || '').trim();
          }
        });

        if (Object.keys(rowData).length > 0) {
          rows.push(rowData);
        }
      });
    }

    return rows;
  });

  // Parse each row into ForecastRecord
  for (const row of tableData) {
    try {
      const record = parseUSDARow(row);
      if (record) {
        records.push(record);
      }
    } catch (e) {
      console.error(`[USDA] Parse error: ${e}`);
    }
  }

  return records;
}

/**
 * Try to navigate to next page
 */
async function tryNextPage(page: any): Promise<boolean> {
  try {
    const nextSelectors = [
      '.paginate_button.next:not(.disabled)',
      'a[aria-label*="Next"]:not([disabled])',
      'button.next:not([disabled])',
      '.pagination .next a',
      'li.next a',
    ];

    for (const selector of nextSelectors) {
      const nextButton = await page.$(selector);
      if (nextButton) {
        const isDisabled = await page.evaluate((el: any) => {
          return el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true';
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
 * Parse a single USDA row into a ForecastRecord
 */
function parseUSDARow(row: Record<string, string>): ForecastRecord | null {
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

  const title = findField(['title', 'requirement', 'name', 'description', 'project', 'procurement', 'action']);
  const naics = findField(['naics']);

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'cost', 'ceiling', 'budget', 'funding']);
  const { min, max } = parseValueRange(valueStr);

  const pocName = findField(['poc', 'contact', 'point of contact', 'contracting officer', 'co', 'buyer']);
  const pocEmail = findField(['email', 'e-mail']);

  const record: ForecastRecord = {
    title: title || `USDA Forecast - ${naics || 'Unknown'}`,
    agency: 'USDA',
    description: findField(['description', 'synopsis', 'scope', 'summary', 'statement of work', 'sow', 'requirement description']),

    naics: normalizeNaics(naics),
    psc: findField(['psc', 'product service code', 'service code']),

    fiscalYear: normalizeFY(findField(['fiscal year', 'fy', 'year'])),
    quarter: findField(['quarter', 'qtr', 'anticipated quarter']),
    awardDate: findField(['award date', 'anticipated date', 'target date', 'est award', 'estimated award', 'planned award']),

    valueMin: min,
    valueMax: max,
    valueRange: valueStr,

    setAside: normalizeSetAside(
      findField(['set-aside', 'setaside', 'set aside', 'small business', 'socio', 'preference', 'type', 'competition'])
    ),
    contractType: findField(['contract type', 'type', 'vehicle', 'acquisition type', 'procurement type', 'instrument']),

    incumbent: findField(['incumbent', 'current contractor', 'contractor', 'existing contractor']),

    state: findField(['state', 'location', 'place of performance', 'pop', 'pop state']),
    office: findField(['office', 'agency', 'bureau', 'division', 'contracting office', 'program office', 'mission area']),

    contact: (pocName || pocEmail) ? { name: pocName, email: pocEmail } : undefined,
  };

  return record;
}

/**
 * Test the USDA scraper
 */
export async function testUSDAScraper(): Promise<void> {
  console.log('\n=== Testing USDA Forecast Scraper ===\n');

  const startTime = Date.now();

  try {
    const records = await scrapeUSDA();
    const duration = Date.now() - startTime;

    console.log('\n=== Results ===');
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Records found: ${records.length}`);

    if (records.length > 0) {
      console.log('\n=== Sample Records ===');
      records.slice(0, 3).forEach((record, i) => {
        console.log(`\n${i + 1}. ${record.title}`);
        console.log(`   NAICS: ${record.naics_code || 'N/A'}`);
        console.log(`   Value: ${record.estimated_value_range || 'N/A'}`);
        console.log(`   FY: ${record.fiscal_year || 'N/A'} Q${record.anticipated_quarter || 'N/A'}`);
        console.log(`   Office: ${record.contracting_office || 'N/A'}`);
        console.log(`   Set-Aside: ${record.set_aside_type || 'N/A'}`);
      });
    } else {
      console.log('\n⚠️  No records found. The scraper may need adjustment.');
    }
  } catch (error) {
    console.log(`\n❌ Error: ${error}`);
  }
}

// Allow running as standalone script
if (require.main === module) {
  testUSDAScraper().catch(console.error);
}

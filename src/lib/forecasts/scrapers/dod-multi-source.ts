/**
 * DOD Multi-Source Forecast Scraper
 *
 * DOD forecasts are spread across multiple sources:
 * - Army: https://www.army.mil/osbp/forecast/
 * - Navy: https://www.secnav.navy.mil/smallbusiness/Pages/forecast.aspx
 * - Air Force: https://www.saffm.hq.af.mil/OSBP/
 * - Defense Logistics Agency: https://www.dla.mil/SmallBusiness/
 * - DISA: https://www.disa.mil/
 * - MDA: https://www.mda.mil/business/
 * - DARPA: Already covered by multisite scraper
 *
 * This scraper aggregates from multiple DOD component sources.
 */

import type { ForecastRecord, ScraperResult } from '../types';
import { buildDeterministicExternalId, normalizeNaics, normalizeFY, normalizeSetAside, parseValueRange, sleep } from '../types';

const DOD_SOURCES = [
  {
    name: 'Army',
    code: 'ARMY',
    url: 'https://www.army.mil/osbp/forecast/',
    alt_urls: ['https://www.amc.army.mil/Portals/9/Documents/SADBU/'],
  },
  {
    name: 'Navy',
    code: 'NAVY',
    url: 'https://www.secnav.navy.mil/smallbusiness/Pages/forecast.aspx',
    alt_urls: ['https://www.navysbp.navy.mil/'],
  },
  {
    name: 'Air Force',
    code: 'USAF',
    url: 'https://www.saffm.hq.af.mil/OSBP/',
    alt_urls: ['https://www.afsbp.af.mil/'],
  },
  {
    name: 'Defense Logistics Agency',
    code: 'DLA',
    url: 'https://www.dla.mil/SmallBusiness/Forecast/',
    alt_urls: ['https://www.dla.mil/HQ/SmallBusiness/'],
  },
  {
    name: 'DISA',
    code: 'DISA',
    url: 'https://www.disa.mil/About/Doing-Business-with-DISA/Forecast',
    alt_urls: [],
  },
  {
    name: 'Missile Defense Agency',
    code: 'MDA',
    url: 'https://www.mda.mil/business/small_business_opportunities.html',
    alt_urls: [],
  },
];

const DOD_CONFIG = {
  agency_code: 'DOD',
  agency_name: 'Department of Defense',
  timeout: 60000,
};

/**
 * Scrape all DOD component forecasts
 */
export async function scrapeDOD(): Promise<ScraperResult> {
  const startTime = Date.now();
  const allRecords: ForecastRecord[] = [];
  const allErrors: string[] = [];

  console.log('[DOD] Starting multi-source scrape...');

  // Scrape each DOD component
  for (const source of DOD_SOURCES) {
    try {
      console.log(`\n[DOD/${source.code}] Scraping ${source.name}...`);
      const result = await scrapeDODComponent(source);

      allRecords.push(...result.records);
      if (result.errors.length > 0) {
        result.errors.forEach(e => allErrors.push(`[${source.code}] ${e}`));
      }

      console.log(`[DOD/${source.code}] Found ${result.records.length} records`);
    } catch (e) {
      allErrors.push(`[${source.code}] Fatal error: ${e}`);
    }

    // Brief pause between sources
    await sleep(2000);
  }

  console.log(`\n[DOD] Total: ${allRecords.length} records from ${DOD_SOURCES.length} sources`);

  return {
    success: allErrors.length === 0 || allRecords.length > 0,
    agency: DOD_CONFIG.agency_code,
    records: allRecords,
    errors: allErrors,
    timing: Date.now() - startTime,
  };
}

/**
 * Scrape a single DOD component
 */
async function scrapeDODComponent(source: typeof DOD_SOURCES[0]): Promise<ScraperResult> {
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

    // Try main URL first, then alternates
    let loadSuccess = false;
    let currentUrl = source.url;

    const urlsToTry = [source.url, ...source.alt_urls];

    for (const url of urlsToTry) {
      try {
        console.log(`[DOD/${source.code}] Trying ${url}...`);
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: DOD_CONFIG.timeout,
        });
        loadSuccess = true;
        currentUrl = url;
        break;
      } catch {
        continue;
      }
    }

    if (!loadSuccess) {
      errors.push(`Failed to load any URL for ${source.name}`);
      await browser.close();
      return { success: false, agency: source.code, records: [], errors, timing: 0 };
    }

    // Wait for content
    await sleep(3000);

    // Look for Excel/PDF download links (common for DOD forecasts)
    const downloadLinks = await page.evaluate(() => {
      const links: { text: string; href: string }[] = [];
      const anchors = document.querySelectorAll('a[href*=".xlsx"], a[href*=".xls"], a[href*="forecast"], a[href*="Forecast"]');
      anchors.forEach(a => {
        const href = a.getAttribute('href');
        const text = (a.textContent || '').trim();
        if (href && (href.includes('.xls') || text.toLowerCase().includes('forecast'))) {
          links.push({ text, href });
        }
      });
      return links;
    });

    if (downloadLinks.length > 0) {
      console.log(`[DOD/${source.code}] Found ${downloadLinks.length} download links`);
      // Note: Actual Excel download and parsing would be handled separately
      // For now, we'll scrape any visible table data
      errors.push(`Source ${source.code} exposes downloadable forecast files, but file import is not implemented yet`);
    }

    // Extract table data from the page
    const tableData = await page.evaluate((sourceCode) => {
      const rows: Record<string, string>[] = [];

      // Try to find forecast tables
      const tables = document.querySelectorAll('table');

      tables.forEach(table => {
        // Skip navigation tables
        if (table.closest('nav') || table.closest('header') || table.closest('footer')) {
          return;
        }

        // Get headers
        const headerCells = table.querySelectorAll('thead th, tr:first-child th');
        const headers: string[] = [];
        headerCells.forEach(cell => {
          headers.push((cell.textContent || '').trim().toLowerCase());
        });

        // If headers look like forecast data, extract rows
        const forecastHeaders = ['naics', 'title', 'value', 'amount', 'award', 'contract', 'description'];
        const hasForecastHeaders = headers.some(h => forecastHeaders.some(fh => h.includes(fh)));

        if (hasForecastHeaders || headers.length >= 3) {
          const dataRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
          dataRows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const rowData: Record<string, string> = {};

            cells.forEach((cell, index) => {
              const header = headers[index] || `col${index}`;
              rowData[header] = (cell.textContent || '').trim();
            });

            // Add source identifier
            rowData['_source'] = sourceCode;

            if (Object.keys(rowData).length > 1) {
              rows.push(rowData);
            }
          });
        }
      });

      // Also try list-based layouts
      const listItems = document.querySelectorAll('.forecast-item, .opportunity-item, article.forecast');
      listItems.forEach(item => {
        const rowData: Record<string, string> = {};

        // Extract any labeled content
        const labels = item.querySelectorAll('dt, .label, strong');
        labels.forEach(label => {
          const nextSibling = label.nextElementSibling;
          if (nextSibling) {
            const key = (label.textContent || '').trim().toLowerCase().replace(':', '');
            rowData[key] = (nextSibling.textContent || '').trim();
          }
        });

        rowData['_source'] = sourceCode;

        if (Object.keys(rowData).length > 1) {
          rows.push(rowData);
        }
      });

      return rows;
    }, source.code);

    console.log(`[DOD/${source.code}] Extracted ${tableData.length} rows`);

    // Parse extracted data
    for (const row of tableData) {
      try {
        const record = parseDODRow(row, source);
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
    agency: source.code,
    records,
    errors,
    timing: 0,
  };
}

/**
 * Parse a DOD component row into a ForecastRecord
 */
function parseDODRow(row: Record<string, string>, source: typeof DOD_SOURCES[0]): ForecastRecord | null {
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

  const title = findField(['title', 'name', 'requirement', 'description', 'opportunity', 'procurement']);
  const naics = findField(['naics']);

  if (!title && !naics) {
    return null;
  }

  const valueStr = findField(['value', 'amount', 'estimate', 'dollar', 'ceiling', 'cost']);
  const { min, max } = parseValueRange(valueStr);

  const record: ForecastRecord = {
    source_agency: `DOD-${source.code}`,
    source_type: 'puppeteer',
    source_url: source.url,
    external_id: buildDeterministicExternalId(`DOD-${source.code}`, [
      title,
      naics,
      source.name,
      valueStr,
      findField(['award date', 'anticipated', 'target']),
    ]),

    title: title || `${source.name} Forecast - ${naics || 'Unknown'}`,
    description: findField(['description', 'synopsis', 'scope', 'summary', 'statement of work']),

    department: 'Department of Defense',
    bureau: source.name,
    contracting_office: findField(['contracting office', 'procurement office', 'buying activity']),
    program_office: findField(['program office', 'program', 'requiring activity']),

    naics_code: normalizeNaics(naics),
    psc_code: findField(['psc', 'product service', 'fsc']),

    fiscal_year: normalizeFY(findField(['fiscal', 'fy', 'year'])),
    anticipated_quarter: findField(['quarter', 'qtr']),
    anticipated_award_date: findField(['award date', 'anticipated', 'target']),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueStr,

    set_aside_type: normalizeSetAside(findField([
      'set-aside', 'setaside', 'small business', 'socio', 'preference',
      'sdvosb', 'wosb', 'hubzone', '8a',
    ])),
    contract_type: findField(['contract type', 'type', 'vehicle', 'idiq']),
    competition_type: findField(['competition', 'solicitation type', 'acquisition strategy']),

    incumbent_name: findField(['incumbent', 'current contractor', 'awardee']),
    incumbent_contract_number: findField(['contract number', 'current contract']),

    poc_name: findField(['poc', 'contact', 'point of contact', 'contracting officer']),
    poc_email: findField(['email']),
    poc_phone: findField(['phone', 'telephone']),

    pop_state: findField(['state', 'location', 'place of performance']),

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };

  return record;
}

/**
 * Scrape a specific DOD component
 */
export async function scrapeDODComponent_byCode(code: string): Promise<ScraperResult> {
  const source = DOD_SOURCES.find(s => s.code === code.toUpperCase());
  if (!source) {
    return {
      success: false,
      agency: code,
      records: [],
      errors: [`Unknown DOD component: ${code}. Valid: ${DOD_SOURCES.map(s => s.code).join(', ')}`],
      timing: 0,
    };
  }

  const startTime = Date.now();
  const result = await scrapeDODComponent(source);
  return {
    ...result,
    timing: Date.now() - startTime,
  };
}

/**
 * Test the DOD multi-source scraper
 */
export async function testDODScraper(): Promise<void> {
  console.log('Testing DOD Multi-Source scraper...');
  console.log(`Sources: ${DOD_SOURCES.map(s => s.code).join(', ')}`);

  const result = await scrapeDOD();

  console.log(`\nSuccess: ${result.success}`);
  console.log(`Total Records: ${result.records.length}`);
  console.log(`Total Errors: ${result.errors.length}`);
  console.log(`Timing: ${result.timing}ms`);

  // Show records by component
  const byComponent: Record<string, number> = {};
  result.records.forEach(r => {
    const comp = r.source_agency.replace('DOD-', '');
    byComponent[comp] = (byComponent[comp] || 0) + 1;
  });
  console.log('\nRecords by component:');
  Object.entries(byComponent).forEach(([comp, count]) => {
    console.log(`  ${comp}: ${count}`);
  });

  if (result.records.length > 0) {
    console.log('\nSample record:');
    console.log(JSON.stringify(result.records[0], null, 2));
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }
}

/**
 * Get list of DOD sources
 */
export function getDODSources() {
  return DOD_SOURCES.map(s => ({
    code: s.code,
    name: s.name,
    url: s.url,
  }));
}

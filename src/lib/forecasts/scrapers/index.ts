/**
 * Forecast Scrapers - Unified Index
 *
 * Phase 2: GSA Acquisition Gateway
 * Phase 3: DHS, HHS, Treasury, VA (Puppeteer-based)
 * Phase 4: DOD Multi-Source (Army, Navy, Air Force, DLA, DISA, MDA)
 *
 * Note: Phase 1 agencies (DOE, NASA, DOJ) use direct Excel downloads
 * handled by scripts/import-forecasts.js
 */

import { scrapeDHS, testDHSScraper } from './dhs-apfs';
import { scrapeHHS as scrapeHHSSBCX, testHHSScraper as testHHSSBCXScraper } from './hhs-sbcx';
import { scrapeHHSForecast, testHHSForecastScraper } from './hhs';
import { scrapeTreasury as scrapeTreasuryOld, testTreasuryScraper as testTreasuryOldScraper } from './treasury-osdbu';
import { scrapeTreasury, testTreasuryScraper } from './treasury';
import { scrapeEPA, testEPAScraper } from './epa';
import { scrapeVA, testVAScraper } from './va-vendor-portal';
import { scrapeGSA, testGSAScraper } from './gsa-acquisition-gateway';
import { scrapeDOD, testDODScraper, getDODSources } from './dod-multi-source';
import { scrapeUSDA, testUSDAScraper } from './usda';
import type { ScraperResult, ForecastRecord } from '../types';

// Export individual scrapers
export { scrapeDHS, testDHSScraper } from './dhs-apfs';
export { scrapeHHS as scrapeHHSSBCX, testHHSScraper as testHHSSBCXScraper } from './hhs-sbcx';
export { scrapeHHSForecast, testHHSForecastScraper } from './hhs';
export { scrapeTreasury, testTreasuryScraper } from './treasury';
export { scrapeEPA, testEPAScraper } from './epa';
export { scrapeVA, testVAScraper } from './va-vendor-portal';
export { scrapeGSA, testGSAScraper } from './gsa-acquisition-gateway';
export { scrapeDOD, testDODScraper, getDODSources } from './dod-multi-source';
export { scrapeUSDA, testUSDAScraper } from './usda';

// Scraper registry
export const SCRAPERS = {
  // Phase 2
  GSA: {
    name: 'General Services Administration (Acquisition Gateway)',
    scraper: scrapeGSA,
    test: testGSAScraper,
    sourceUrl: 'https://acquisitiongateway.gov/forecast',
    estimatedCoverage: 8.0, // $8B estimated
    priority: 1,
    phase: 2,
  },
  // Phase 3
  DHS: {
    name: 'Department of Homeland Security',
    scraper: scrapeDHS,
    test: testDHSScraper,
    sourceUrl: 'https://apfs-cloud.dhs.gov/forecast/',
    estimatedCoverage: 8.0, // $8B estimated
    priority: 1,
    phase: 3,
  },
  HHS: {
    name: 'Department of Health and Human Services (Procurement Forecast)',
    scraper: scrapeHHSForecast,
    test: testHHSForecastScraper,
    sourceUrl: 'https://procurementforecast.hhs.gov',
    estimatedCoverage: 12.0, // $12B estimated
    priority: 1,
    phase: 3,
  },
  HHS_SBCX: {
    name: 'Department of Health and Human Services (SBCX Portal)',
    scraper: scrapeHHSSBCX,
    test: testHHSSBCXScraper,
    sourceUrl: 'https://mysbcx.hhs.gov/search',
    estimatedCoverage: 12.0, // $12B estimated (alternative source)
    priority: 2,
    phase: 3,
  },
  Treasury: {
    name: 'Department of the Treasury',
    scraper: scrapeTreasury,
    test: testTreasuryScraper,
    sourceUrl: 'https://osdbu.forecast.treasury.gov/',
    estimatedCoverage: 2.0, // $2B estimated
    priority: 2,
    phase: 3,
  },
  EPA: {
    name: 'Environmental Protection Agency',
    scraper: scrapeEPA,
    test: testEPAScraper,
    sourceUrl: 'https://ordspub.epa.gov/ords/forecast/f?p=forecast',
    estimatedCoverage: 1.5, // $1.5B estimated
    priority: 2,
    phase: 3,
  },
  VA: {
    name: 'Department of Veterans Affairs',
    scraper: scrapeVA,
    test: testVAScraper,
    sourceUrl: 'https://www.vendorportal.ecms.va.gov/evp/fco/fco.aspx',
    estimatedCoverage: 10.0, // $10B estimated
    priority: 1,
    phase: 3,
  },
  // Phase 4
  USDA: {
    name: 'Department of Agriculture',
    scraper: scrapeUSDA,
    test: testUSDAScraper,
    sourceUrl: 'https://forecast.edc.usda.gov',
    estimatedCoverage: 4.0, // $4B estimated
    priority: 2,
    phase: 4,
  },
  DOD: {
    name: 'Department of Defense (Multi-Source)',
    scraper: scrapeDOD,
    test: testDODScraper,
    sourceUrl: 'Multiple DOD components',
    estimatedCoverage: 40.0, // $40B estimated (largest)
    priority: 1,
    phase: 4,
    components: getDODSources(),
  },
} as const;

export type ScraperKey = keyof typeof SCRAPERS;

/**
 * Normalize scraper result - handles both ScraperResult and ForecastRecord[] returns
 */
function normalizeScraperResult(rawResult: ScraperResult | ForecastRecord[], agency: string, timing: number): ScraperResult {
  if (Array.isArray(rawResult)) {
    // Legacy scrapers return ForecastRecord[]
    return {
      success: true,
      agency,
      records: rawResult as unknown as ForecastRecord[],
      errors: [],
      timing,
    };
  }
  return rawResult;
}

/**
 * Run all Phase 2-4 scrapers
 */
export async function runAllScrapers(): Promise<{
  totalRecords: number;
  results: Record<string, ScraperResult>;
  errors: string[];
  timing: number;
}> {
  const startTime = Date.now();
  const results: Record<string, ScraperResult> = {};
  const errors: string[] = [];
  let totalRecords = 0;

  console.log('Running all scrapers...\n');

  for (const [key, config] of Object.entries(SCRAPERS)) {
    console.log(`\n--- ${config.name} (${key}) ---`);
    const scraperStart = Date.now();
    try {
      const rawResult = await config.scraper();
      const result = normalizeScraperResult(rawResult as ScraperResult | ForecastRecord[], key, Date.now() - scraperStart);
      results[key] = result;
      totalRecords += result.records.length;

      console.log(`  Records: ${result.records.length}`);
      console.log(`  Errors: ${result.errors.length}`);
      console.log(`  Timing: ${result.timing}ms`);

      if (result.errors.length > 0) {
        result.errors.forEach((e: string) => errors.push(`[${key}] ${e}`));
      }
    } catch (e) {
      const errorMsg = `[${key}] Fatal error: ${e}`;
      errors.push(errorMsg);
      console.error(`  ${errorMsg}`);
      results[key] = {
        success: false,
        agency: key,
        records: [],
        errors: [errorMsg],
        timing: Date.now() - scraperStart,
      };
    }
  }

  const timing = Date.now() - startTime;

  console.log('\n=== Summary ===');
  console.log(`Total Records: ${totalRecords}`);
  console.log(`Total Errors: ${errors.length}`);
  console.log(`Total Timing: ${timing}ms`);

  return {
    totalRecords,
    results,
    errors,
    timing,
  };
}

/**
 * Run a specific scraper by agency code
 */
export async function runScraper(agencyCode: ScraperKey): Promise<ScraperResult> {
  const config = SCRAPERS[agencyCode];
  if (!config) {
    throw new Error(`Unknown agency: ${agencyCode}. Valid options: ${Object.keys(SCRAPERS).join(', ')}`);
  }

  console.log(`Running ${config.name} scraper...`);
  const startTime = Date.now();
  const rawResult = await config.scraper();
  return normalizeScraperResult(rawResult as ScraperResult | ForecastRecord[], agencyCode, Date.now() - startTime);
}

/**
 * Get all records from all scrapers
 */
export async function getAllForecastRecords(): Promise<{
  records: ForecastRecord[];
  byAgency: Record<string, number>;
  errors: string[];
}> {
  const { results, errors } = await runAllScrapers();

  const records: ForecastRecord[] = [];
  const byAgency: Record<string, number> = {};

  for (const [agency, result] of Object.entries(results)) {
    records.push(...result.records);
    byAgency[agency] = result.records.length;
  }

  return { records, byAgency, errors };
}

/**
 * Test all scrapers without saving data
 */
export async function testAllScrapers(): Promise<void> {
  console.log('Testing all Phase 3 scrapers...\n');

  for (const [key, config] of Object.entries(SCRAPERS)) {
    console.log(`\n========== ${config.name} ==========`);
    await config.test();
  }
}

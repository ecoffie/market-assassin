#!/usr/bin/env node
/**
 * Run All Forecast Scrapers
 *
 * Executes all agency scrapers and imports data to Supabase
 *
 * Usage:
 *   node scripts/run-all-forecast-scrapers.js [--dry-run] [--agency=GSA,VA,DHS]
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Supabase setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';
const supabase = createClient(supabaseUrl, supabaseKey);

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const agencyArg = args.find(a => a.startsWith('--agency='));
const selectedAgencies = agencyArg ? agencyArg.split('=')[1].split(',').map(a => a.toUpperCase()) : null;

// All available scrapers (matches actual file names in src/lib/forecasts/scrapers/)
const SCRAPERS = {
  GSA: { file: 'gsa-acquisition-gateway', fn: 'scrapeGSA', coverage: 8.0 },
  VA: { file: 'va-vendor-portal', fn: 'scrapeVA', coverage: 10.0 },
  DHS: { file: 'dhs-apfs', fn: 'scrapeDHS', coverage: 8.0 },
  HHS: { file: 'hhs', fn: 'scrapeHHSForecast', coverage: 12.0 },
  TREASURY: { file: 'treasury', fn: 'scrapeTreasury', coverage: 2.0 },
  EPA: { file: 'epa', fn: 'scrapeEPA', coverage: 1.5 },
  USDA: { file: 'usda', fn: 'scrapeUSDA', coverage: 4.0 },
  DOD: { file: 'dod-multi-source', fn: 'scrapeDOD', coverage: 40.0 },
};

async function loadScraper(agency) {
  const config = SCRAPERS[agency];
  if (!config) {
    console.log(`  Unknown agency: ${agency}`);
    return null;
  }

  try {
    // Try TypeScript compiled version first
    const scraperPath = path.join(__dirname, '..', 'src', 'lib', 'forecasts', 'scrapers', `${config.file}.js`);
    const scraper = require(scraperPath);
    return scraper[config.fn];
  } catch (e1) {
    try {
      // Try direct TypeScript with ts-node
      require('ts-node/register');
      const scraperPath = path.join(__dirname, '..', 'src', 'lib', 'forecasts', 'scrapers', `${config.file}.ts`);
      const scraper = require(scraperPath);
      return scraper[config.fn];
    } catch (e2) {
      console.log(`  Failed to load ${agency} scraper: ${e2.message}`);
      return null;
    }
  }
}

function generateForecastId(record) {
  const text = `${record.agency}-${record.title}-${record.fiscalYear || ''}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `forecast-${record.agency.toLowerCase()}-${Math.abs(hash).toString(36)}`;
}

async function importRecords(agency, records) {
  if (!records || records.length === 0) {
    console.log(`  No records to import for ${agency}`);
    return { added: 0, errors: 0 };
  }

  console.log(`  Importing ${records.length} records...`);

  let added = 0;
  let errors = 0;
  const batchSize = 100;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize).map(record => ({
      id: generateForecastId(record),
      title: record.title,
      agency: record.agency,
      description: record.description || null,
      naics_code: record.naics || null,
      naics_description: record.naicsDescription || null,
      psc_code: record.psc || null,
      fiscal_year: record.fiscalYear || null,
      quarter: record.quarter || null,
      anticipated_award_date: record.awardDate || null,
      estimated_value_min: record.valueMin || null,
      estimated_value_max: record.valueMax || null,
      estimated_value_range: record.valueRange || null,
      set_aside_type: record.setAside || null,
      contract_type: record.contractType || null,
      incumbent_contractor: record.incumbent || null,
      place_of_performance_state: record.state || null,
      contracting_office: record.office || null,
      contact_name: record.contact?.name || null,
      contact_email: record.contact?.email || null,
      source_url: record.sourceUrl || null,
      status: 'forecast',
      last_synced_at: new Date().toISOString(),
    }));

    if (dryRun) {
      added += batch.length;
      process.stdout.write(`  [DRY RUN] Would import ${i + batch.length}/${records.length}...\r`);
    } else {
      const { error } = await supabase
        .from('agency_forecasts')
        .upsert(batch, { onConflict: 'id' });

      if (error) {
        console.log(`  Batch ${i}-${i + batchSize} error: ${error.message}`);
        errors += batch.length;
      } else {
        added += batch.length;
      }
      process.stdout.write(`  Imported ${i + batch.length}/${records.length}...\r`);
    }
  }

  console.log(`  Imported ${added}/${records.length} records (${errors} errors)`);
  return { added, errors };
}

async function logSyncRun(agency, recordCount, status, errorMsg = null) {
  if (dryRun) return;

  await supabase.from('forecast_sync_runs').insert({
    source_agency: agency,
    records_found: recordCount,
    records_imported: status === 'success' ? recordCount : 0,
    status,
    error_message: errorMsg,
  });
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('FORECAST SCRAPER - ALL AGENCIES');
  console.log('============================================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
  console.log(`Agencies: ${selectedAgencies ? selectedAgencies.join(', ') : 'ALL'}`);
  console.log('');

  const agencies = selectedAgencies || Object.keys(SCRAPERS);
  const results = {};
  let totalRecords = 0;
  let totalErrors = 0;

  for (const agency of agencies) {
    console.log('------------------------------------------------------------');
    console.log(`Scraping ${agency}...`);
    console.log('------------------------------------------------------------');

    const scraperFn = await loadScraper(agency);
    if (!scraperFn) {
      results[agency] = { status: 'skipped', records: 0 };
      await logSyncRun(agency, 0, 'failed', 'Scraper not found');
      continue;
    }

    try {
      const startTime = Date.now();
      const records = await scraperFn();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`  Found ${records.length} records in ${elapsed}s`);

      const { added, errors } = await importRecords(agency, records);

      results[agency] = {
        status: 'success',
        records: records.length,
        imported: added,
        errors
      };
      totalRecords += added;
      totalErrors += errors;

      await logSyncRun(agency, records.length, 'success');

    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      results[agency] = { status: 'failed', error: error.message };
      await logSyncRun(agency, 0, 'failed', error.message);
    }
  }

  // Summary
  console.log('');
  console.log('============================================================');
  console.log('SUMMARY');
  console.log('============================================================');

  for (const [agency, result] of Object.entries(results)) {
    if (result.status === 'success') {
      console.log(`  ${agency}: ${result.imported} records imported`);
    } else if (result.status === 'skipped') {
      console.log(`  ${agency}: SKIPPED (scraper not found)`);
    } else {
      console.log(`  ${agency}: FAILED - ${result.error}`);
    }
  }

  console.log('');
  console.log(`Total records: ${totalRecords}`);
  console.log(`Total errors: ${totalErrors}`);

  // Get database total
  if (!dryRun) {
    const { count } = await supabase
      .from('agency_forecasts')
      .select('*', { count: 'exact', head: true });
    console.log(`Database total: ${count} forecasts`);
  }
}

main().catch(console.error);

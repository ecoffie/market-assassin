#!/usr/bin/env npx tsx
/**
 * Run All Forecast Scrapers using TSX
 *
 * Usage: npx tsx scripts/run-scrapers-tsx.ts [--dry-run] [--agency=GSA,VA,DHS]
 */

import { createClient } from '@supabase/supabase-js';
import { SCRAPERS, runScraper, type ScraperKey } from '../src/lib/forecasts/scrapers';

// Supabase setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';
const supabase = createClient(supabaseUrl, supabaseKey);

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const agencyArg = args.find(a => a.startsWith('--agency='));
// Map common variations to actual SCRAPERS keys
const agencyKeyMap: Record<string, ScraperKey> = {
  'GSA': 'GSA',
  'DHS': 'DHS',
  'HHS': 'HHS',
  'HHS_SBCX': 'HHS_SBCX',
  'TREASURY': 'Treasury',
  'Treasury': 'Treasury',
  'EPA': 'EPA',
  'VA': 'VA',
  'USDA': 'USDA',
  'DOD': 'DOD',
};

const selectedAgencies = agencyArg
  ? agencyArg.split('=')[1].split(',').map(a => {
      const key = agencyKeyMap[a] || agencyKeyMap[a.toUpperCase()] || a as ScraperKey;
      return key;
    })
  : null;

function generateForecastId(record: Record<string, any>): string {
  const text = `${record.agency}-${record.title}-${record.fiscalYear || ''}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `forecast-${record.agency?.toLowerCase() || 'unknown'}-${Math.abs(hash).toString(36)}`;
}

async function importRecords(agency: ScraperKey, records: Record<string, any>[]) {
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
      // Map to actual database columns
      source_agency: record.source_agency || record.agency || agency,
      source_type: record.source_type || 'puppeteer',
      source_url: record.source_url || record.sourceUrl || SCRAPERS[agency]?.sourceUrl || null,
      external_id: record.external_id || generateForecastId(record),
      title: record.title,
      description: record.description || null,
      department: record.department || null,
      bureau: record.bureau || null,
      contracting_office: record.contracting_office || record.office || null,
      program_office: record.program_office || null,
      naics_code: record.naics_code || record.naics || null,
      naics_description: record.naics_description || record.naicsDescription || null,
      psc_code: record.psc_code || record.psc || null,
      psc_description: record.psc_description || null,
      fiscal_year: record.fiscal_year || record.fiscalYear || null,
      anticipated_quarter: record.anticipated_quarter || record.quarter || null,
      anticipated_award_date: record.anticipated_award_date || record.awardDate || null,
      solicitation_date: record.solicitation_date || null,
      performance_end_date: record.performance_end_date || null,
      estimated_value_min: record.estimated_value_min || record.valueMin || null,
      estimated_value_max: record.estimated_value_max || record.valueMax || null,
      estimated_value_range: record.estimated_value_range || record.valueRange || null,
      contract_type: record.contract_type || record.contractType || null,
      set_aside_type: record.set_aside_type || record.setAside || null,
      competition_type: record.competition_type || null,
      incumbent_name: record.incumbent_name || record.incumbent || null,
      incumbent_contract_number: record.incumbent_contract_number || null,
      poc_name: record.poc_name || record.contact?.name || null,
      poc_email: record.poc_email || record.contact?.email || null,
      poc_phone: record.poc_phone || null,
      pop_state: record.pop_state || record.state || null,
      pop_city: record.pop_city || null,
      pop_zip: record.pop_zip || null,
      pop_country: record.pop_country || null,
      status: record.status || 'forecast',
      raw_data: record.raw_data || JSON.stringify(record),
      last_synced_at: new Date().toISOString(),
    }));

    if (dryRun) {
      added += batch.length;
      process.stdout.write(`  [DRY RUN] Would import ${i + batch.length}/${records.length}...\r`);
    } else {
      const { error } = await supabase
        .from('agency_forecasts')
        .upsert(batch, { onConflict: 'source_agency,external_id' });

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

async function logSyncRun(agency: string, recordCount: number, status: string, errorMsg?: string) {
  if (dryRun) return;

  await supabase.from('forecast_sync_runs').insert({
    source_agency: agency,
    records_found: recordCount,
    records_imported: status === 'success' ? recordCount : 0,
    status,
    error_message: errorMsg || null,
  });
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('FORECAST SCRAPER - ALL AGENCIES (TSX)');
  console.log('============================================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE IMPORT'}`);
  console.log(`Agencies: ${selectedAgencies ? selectedAgencies.join(', ') : 'ALL'}`);
  console.log('');

  const agencies = selectedAgencies || (Object.keys(SCRAPERS) as ScraperKey[]);
  const results: Record<string, any> = {};
  let totalRecords = 0;
  let totalErrors = 0;

  for (const agency of agencies) {
    console.log('------------------------------------------------------------');
    console.log(`Scraping ${agency}...`);
    console.log('------------------------------------------------------------');

    if (!SCRAPERS[agency]) {
      console.log(`  Unknown agency: ${agency}`);
      results[agency] = { status: 'skipped', records: 0 };
      await logSyncRun(agency, 0, 'failed', 'Unknown agency');
      continue;
    }

    try {
      const startTime = Date.now();
      const result = await runScraper(agency);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`  Found ${result.records.length} records in ${elapsed}s`);

      const { added, errors } = await importRecords(agency, result.records);

      results[agency] = {
        status: 'success',
        records: result.records.length,
        imported: added,
        errors
      };
      totalRecords += added;
      totalErrors += errors;

      await logSyncRun(agency, result.records.length, 'success');

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR: ${errorMessage}`);
      results[agency] = { status: 'failed', error: errorMessage };
      await logSyncRun(agency, 0, 'failed', errorMessage);
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
      console.log(`  ${agency}: SKIPPED`);
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

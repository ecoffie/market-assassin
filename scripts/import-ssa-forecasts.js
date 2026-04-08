#!/usr/bin/env node

/**
 * Import SSA (Social Security Administration) Forecast Excel
 *
 * Source: SSA Small Business Forecast System
 * File: ~/Market Assasin/Eric Docs/SBF_SSASy_Report_12112026.xlsm
 *
 * Contains ~94 records with columns:
 * - SITE Type, APP #, REQUIREMENT TYPE, DESCRIPTION
 * - EST COST PER FY, PLANNED AWARD DATE, EXISTING AWD #
 * - CONTRACT TYPE, INCUMBENT VENDOR, NAICS, NAICS DESCRIPTION
 * - TYPE OF COMPETITION, PLACE OF PERFORMANCE, ULTIMATE COMPLETION DATE
 *
 * Usage:
 *   node scripts/import-ssa-forecasts.js --dry-run    # Preview
 *   node scripts/import-ssa-forecasts.js              # Import
 */

const xlsx = require('xlsx');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Environment
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const EXCEL_PATH = path.join(__dirname, '..', '..', 'Eric Docs', 'SBF_SSASy_Report_12112026.xlsm');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Normalize set-aside / competition type
 */
function normalizeSetAside(competition) {
  if (!competition) return null;
  const comp = competition.toLowerCase().trim();

  if (comp.includes('8(a)') || comp.includes('8a')) return '8(a)';
  if (comp.includes('hubzone')) return 'HUBZone';
  if (comp.includes('sdvosb') || comp.includes('service-disabled')) return 'SDVOSB';
  if (comp.includes('wosb') || comp.includes('women')) return 'WOSB';
  if (comp.includes('small business') || comp.includes('sb set-aside')) return 'Small Business';
  if (comp.includes('full and open')) return 'Full & Open';
  if (comp.includes('sole source')) return 'Sole Source';

  return competition;
}

/**
 * Parse estimated cost
 */
function parseEstCost(costStr) {
  if (!costStr) return { min: null, max: null };

  // Handle numeric values
  if (typeof costStr === 'number') {
    // Round to integer for bigint column
    const rounded = Math.round(costStr);
    return { min: rounded, max: rounded };
  }

  const cleaned = String(costStr).replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);

  if (!isNaN(num)) {
    // Round to integer for bigint column
    const rounded = Math.round(num);
    return { min: rounded, max: rounded };
  }

  return { min: null, max: null };
}

/**
 * Parse date from various formats
 */
function parseDate(dateVal) {
  if (!dateVal) return null;

  // Excel serial date
  if (typeof dateVal === 'number') {
    const date = new Date((dateVal - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }

  // String date
  const str = String(dateVal).trim();
  if (str.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    // MM/DD/YYYY
    const [mm, dd, yyyy] = str.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

/**
 * Extract fiscal year from date
 */
function extractFY(dateStr) {
  if (!dateStr) return 2026; // Default to current FY

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 2026;

  // Federal FY starts Oct 1
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();

  return month >= 9 ? year + 1 : year;
}

/**
 * Transform Excel row to database format
 */
function transformRecord(row) {
  const appNum = row['APP #'] || row['APP#'] || '';
  const description = row['DESCRIPTION'] || '';
  const estCost = row['EST COST PER FY'] || row['EST COST'];
  const plannedDate = row['PLANNED AWARD DATE'];
  const existingAward = row['EXISTING AWD #'] || row['EXISTING AWD#'];
  const naics = row['NAICS'];
  const competition = row['TYPE OF COMPETITION'];
  const incumbent = row['INCUMBENT VENDOR'];
  const pop = row['PLACE OF PERFORMANCE'];
  const completionDate = row['ULTIMATE COMPLETION DATE'];
  const siteType = row['SITE Type'] || row['SITE TYPE'];
  const reqType = row['REQUIREMENT TYPE'];
  const contractType = row['CONTRACT TYPE'];

  const { min, max } = parseEstCost(estCost);
  const parsedPlannedDate = parseDate(plannedDate);
  const parsedCompletionDate = parseDate(completionDate);

  return {
    source_agency: 'SSA',
    source_type: 'excel',
    source_url: 'https://www.ssa.gov/osdbu/small_business_forecast.htm',
    external_id: `SSA-${appNum || Date.now()}`,

    title: description || `SSA ${reqType || 'Forecast'}`,
    description: `${reqType || ''} - ${description}`.trim(),

    department: 'Social Security Administration',
    bureau: siteType || null,
    contracting_office: siteType || null,

    naics_code: naics ? String(naics).substring(0, 6) : null,
    psc_code: null,

    fiscal_year: extractFY(parsedPlannedDate),
    anticipated_quarter: null,
    anticipated_award_date: parsedPlannedDate,
    performance_end_date: parsedCompletionDate,

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: estCost ? `$${Number(estCost).toLocaleString()}` : null,

    set_aside_type: normalizeSetAside(competition),
    contract_type: contractType || reqType || null,
    competition_type: competition || null,

    incumbent_name: incumbent || null,

    pop_state: pop || null,
    pop_city: null,
    pop_country: 'USA',

    poc_name: null,
    poc_email: null,
    poc_phone: null,

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Main import function
 */
async function importForecasts(dryRun = false) {
  console.log('='.repeat(60));
  console.log('SSA Small Business Forecast Import');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no database writes)' : 'LIVE IMPORT'}\n`);

  // Read Excel file
  console.log(`Reading: ${EXCEL_PATH}`);
  const wb = xlsx.readFile(EXCEL_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];

  // Get raw data
  const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  console.log(`Total rows in file: ${rawData.length}`);

  // Find header row (row 4, index 4 based on analysis)
  const headerRow = 4;
  const headers = rawData[headerRow].slice(0, 15); // Take first 15 columns (avoid duplicates)

  console.log('Headers:', headers.slice(0, 10).join(', ') + '...');

  // Parse data rows
  const records = [];
  for (let i = headerRow + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    // Skip empty rows
    const hasData = row.some(cell => cell !== null && cell !== undefined && cell !== '');
    if (!hasData) continue;

    // Create object from row
    const rowObj = {};
    headers.forEach((h, idx) => {
      if (h && row[idx] !== undefined && row[idx] !== null) {
        rowObj[h] = row[idx];
      }
    });

    // Skip if no meaningful data
    if (!rowObj['DESCRIPTION'] && !rowObj['APP #']) continue;

    records.push(rowObj);
  }

  console.log(`Parsed: ${records.length} records\n`);

  // Count by site type
  const bySite = {};
  records.forEach(r => {
    const site = r['SITE Type'] || 'Unknown';
    bySite[site] = (bySite[site] || 0) + 1;
  });

  console.log('Records by Site Type:');
  Object.entries(bySite)
    .sort((a, b) => b[1] - a[1])
    .forEach(([site, count]) => {
      console.log(`  ${site}: ${count}`);
    });
  console.log('');

  // Transform records
  const transformed = records.map(transformRecord);

  // Show sample
  console.log('Sample transformed record:');
  console.log(JSON.stringify(transformed[0], null, 2));
  console.log('');

  if (dryRun) {
    console.log('DRY RUN complete. No data written.');
    return { imported: 0, errors: 0 };
  }

  // Check for existing SSA records
  console.log('Checking for existing SSA records...');
  const { data: existing } = await supabase
    .from('agency_forecasts')
    .select('external_id')
    .eq('source_agency', 'SSA');

  const existingCount = (existing || []).length;
  console.log(`Found ${existingCount} existing SSA records`);

  // Filter out duplicates
  const existingIds = new Set((existing || []).map(r => r.external_id));
  const toImport = transformed.filter(r => !existingIds.has(r.external_id));
  console.log(`Records to import: ${toImport.length} (skipping ${transformed.length - toImport.length} duplicates)`);

  if (toImport.length === 0) {
    console.log('No new records to import.');
    return { imported: 0, errors: 0 };
  }

  // Import in batches
  const BATCH_SIZE = 50;
  let imported = 0;
  let errors = 0;

  console.log(`Importing ${toImport.length} records in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
    const batch = toImport.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from('agency_forecasts')
      .insert(batch);

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      errors += batch.length;
    } else {
      imported += batch.length;
      process.stdout.write(`\rImported: ${imported}/${toImport.length}`);
    }
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total imported: ${imported}`);
  console.log(`Total errors: ${errors}`);

  // Update sync log
  if (imported > 0) {
    await supabase.from('forecast_sync_runs').insert({
      source_id: 'SSA_EXCEL',
      status: 'success',
      records_processed: transformed.length,
      records_inserted: imported,
      records_updated: 0,
      errors: errors > 0 ? [`${errors} records failed`] : [],
    });
  }

  return { imported, errors };
}

// Run
const dryRun = process.argv.includes('--dry-run');
importForecasts(dryRun).catch(console.error);

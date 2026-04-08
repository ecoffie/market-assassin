#!/usr/bin/env node

/**
 * Import GSA Acquisition Gateway Forecast Export
 *
 * Source: https://acquisitiongateway.gov/forecast (manual CSV export)
 * File: ~/Market Assasin/Eric Docs/forecast_export.csv
 *
 * Contains 2,848 records across multiple agencies:
 * - Department of the Interior: 1,508
 * - VA: 330
 * - GSA: 117
 * - NRC: 67
 * - DOL: 26
 * - DOT: 11
 * - NSF: 8
 *
 * Usage:
 *   node scripts/import-gsa-forecasts.js --dry-run    # Preview (no DB writes)
 *   node scripts/import-gsa-forecasts.js              # Import to database
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Environment
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const CSV_PATH = path.join(__dirname, '..', '..', 'Eric Docs', 'forecast_export.csv');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Map agency names to our standard codes
const AGENCY_MAP = {
  'Department of the Interior': 'DOI',
  'Department of Veterans Affairs': 'VA',
  'General Services Administration': 'GSA',
  'Nuclear Regulatory Commission': 'NRC',
  'Department of Labor': 'DOL',
  'Department of Transportation': 'DOT',
  'National Science Foundation': 'NSF',
};

/**
 * Parse CSV file (handles quoted fields with commas)
 */
function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    if (values.length !== headers.length) {
      // Skip malformed rows
      continue;
    }

    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j];
    }
    records.push(record);
  }

  return records;
}

/**
 * Parse a single CSV line (handles quoted fields)
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse value range from text like "$150K - $249K" or "Below $150K"
 */
function parseValueRange(valueStr) {
  if (!valueStr) return { min: null, max: null };

  const cleaned = valueStr.replace(/[$,]/g, '').trim();

  // "Below $150K"
  if (cleaned.toLowerCase().includes('below')) {
    const match = cleaned.match(/(\d+)([KkMmBb])?/);
    if (match) {
      const num = parseFloat(match[1]);
      const mult = getMultiplier(match[2]);
      return { min: null, max: num * mult };
    }
  }

  // Range: "$150K - $249K"
  const rangeMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*([KkMmBb])?\s*[-–—to]+\s*(\d+(?:\.\d+)?)\s*([KkMmBb])?/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]) * getMultiplier(rangeMatch[2]);
    const max = parseFloat(rangeMatch[3]) * getMultiplier(rangeMatch[4]);
    return { min, max };
  }

  // Single value
  const singleMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*([KkMmBb])?/);
  if (singleMatch) {
    const value = parseFloat(singleMatch[1]) * getMultiplier(singleMatch[2]);
    return { min: value, max: value };
  }

  return { min: null, max: null };
}

function getMultiplier(suffix) {
  switch ((suffix || '').toUpperCase()) {
    case 'K': return 1000;
    case 'M': return 1000000;
    case 'B': return 1000000000;
    default: return 1;
  }
}

/**
 * Normalize set-aside type
 */
function normalizeSetAside(setAside) {
  if (!setAside) return null;

  const sa = setAside.toLowerCase();

  if (sa.includes('8(a)') || sa.includes('8a')) return '8(a)';
  if (sa.includes('hubzone')) return 'HUBZone';
  if (sa.includes('sdvosb') || sa.includes('service-disabled')) return 'SDVOSB';
  if (sa.includes('vosb') || sa.includes('veteran')) return 'VOSB';
  if (sa.includes('wosb') || sa.includes('women')) return 'WOSB';
  if (sa.includes('edwosb') || sa.includes('economically disadvantaged')) return 'EDWOSB';
  if (sa.includes('small business') || sa === 'sb' || sa === 'sba') return 'Small Business';
  if (sa.includes('full and open') || sa.includes('unrestricted')) return 'Full & Open';
  if (sa.includes('total small business') || sa.includes('tsb')) return 'Total Small Business';

  return setAside; // Return original if no match
}

/**
 * Extract fiscal year from various formats
 */
function normalizeFY(fyStr) {
  if (!fyStr) return null;

  // Already a number
  if (typeof fyStr === 'number') {
    return fyStr > 2000 ? fyStr : fyStr + 2000;
  }

  const str = String(fyStr).trim();

  // "2026"
  const fourDigit = str.match(/^(20\d{2})$/);
  if (fourDigit) return parseInt(fourDigit[1]);

  // "26"
  const twoDigit = str.match(/^(\d{2})$/);
  if (twoDigit) return 2000 + parseInt(twoDigit[1]);

  // "FY26" or "FY2026"
  const fyMatch = str.match(/FY\s*(\d{2,4})/i);
  if (fyMatch) {
    const num = parseInt(fyMatch[1]);
    return num > 2000 ? num : num + 2000;
  }

  return null;
}

/**
 * Convert CSV record to database format
 * Note: Maps to ForecastRecord type from src/lib/forecasts/types.ts
 */
function transformRecord(row) {
  const agency = row['Agency'] || '';
  const agencyCode = AGENCY_MAP[agency] || agency.substring(0, 10);

  const { min, max } = parseValueRange(row['Estimated Contract Value']);

  return {
    source_agency: agencyCode,
    source_type: 'api', // Using 'api' as CSV is from Acquisition Gateway API export
    source_url: 'https://acquisitiongateway.gov/forecast',
    external_id: `GSA-AG-${row['Node_ID'] || row['Listing ID'] || Date.now()}`,

    title: row['Title'] || 'Untitled',
    description: row['Description'] || row['Body'] || null,

    department: agency,
    bureau: row['Organization'] || null,
    contracting_office: null,

    naics_code: row['NAICS Code'] || null,
    psc_code: null,

    fiscal_year: normalizeFY(row['Estimated Award FY']),
    anticipated_quarter: extractQuarter(row['Estimated Award FY-QTR']),
    anticipated_award_date: row['Estimated Solicitation Date'] || null,
    solicitation_date: row['Estimated Solicitation Date'] || null,
    performance_end_date: extractDate(row['Period of Performance']) || extractDate(row['Ultimate Completion Date']) || null,

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: row['Estimated Contract Value'] || null,

    set_aside_type: normalizeSetAside(row['Set Aside Type']),
    contract_type: row['Contract Type'] || null,
    competition_type: row['Extent Competed'] || row['Procurement Method'] || null,

    incumbent_name: row['Contractor Name'] || null,

    pop_city: row['Place of Performance City'] || null,
    pop_state: row['Place of Performance State'] || null,
    pop_country: row['Place of Performance Country'] || null,

    poc_name: row['Content: Point of Contact (Name) For'] || null,
    poc_email: row['Point of Contact (Email)'] || null,
    poc_phone: null,

    status: 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Extract quarter from FY-QTR format like "2026-Q2"
 */
function extractQuarter(fyQtr) {
  if (!fyQtr) return null;
  const match = String(fyQtr).match(/Q([1-4])/i);
  return match ? `Q${match[1]}` : null;
}

/**
 * Extract a valid single date from date string or range
 * Handles formats like "09/30/2026" or "05/01/2026 - 11/04/2026"
 * For ranges, returns the END date
 */
function extractDate(dateStr) {
  if (!dateStr) return null;

  const str = String(dateStr).trim();

  // Check for date range (contains " - ")
  if (str.includes(' - ')) {
    const parts = str.split(' - ');
    // Return the end date (second part)
    return parts[1] ? parts[1].trim() : null;
  }

  // Single date - validate format
  if (str.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    return str;
  }

  return null;
}

/**
 * Main import function
 */
async function importForecasts(dryRun = false) {
  console.log('='.repeat(60));
  console.log('GSA Acquisition Gateway Forecast Import');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no database writes)' : 'LIVE IMPORT'}\n`);

  // Check file exists
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: CSV file not found at ${CSV_PATH}`);
    process.exit(1);
  }

  console.log(`Reading: ${CSV_PATH}`);
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const records = parseCSV(content);

  console.log(`Parsed: ${records.length} records\n`);

  // Count by agency
  const byAgency = {};
  records.forEach(r => {
    const agency = r['Agency'] || 'Unknown';
    byAgency[agency] = (byAgency[agency] || 0) + 1;
  });

  console.log('Records by Agency:');
  Object.entries(byAgency)
    .sort((a, b) => b[1] - a[1])
    .forEach(([agency, count]) => {
      console.log(`  ${agency}: ${count}`);
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

  // Check for existing records to avoid duplicates
  console.log('Checking for existing records...');
  const { data: existing } = await supabase
    .from('agency_forecasts')
    .select('external_id')
    .like('external_id', 'GSA-AG-%');

  const existingIds = new Set((existing || []).map(r => r.external_id));
  console.log(`Found ${existingIds.size} existing GSA-AG records`);

  // Filter out already imported records
  const toImport = transformed.filter(r => !existingIds.has(r.external_id));
  console.log(`Records to import: ${toImport.length} (skipping ${transformed.length - toImport.length} duplicates)`);

  if (toImport.length === 0) {
    console.log('No new records to import.');
    return { imported: 0, errors: 0 };
  }

  // Import in batches using simple insert (table doesn't have unique constraint on external_id)
  const BATCH_SIZE = 100;
  let imported = 0;
  let errors = 0;

  console.log(`Importing ${toImport.length} records in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
    const batch = toImport.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
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
      source_id: 'GSA_AG_CSV',
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

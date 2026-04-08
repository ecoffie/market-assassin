#!/usr/bin/env node

/**
 * Forecast Intelligence - Unified Import Script
 * Phase 1: DOE, NASA, DOJ Excel imports
 *
 * Usage:
 *   node scripts/import-forecasts.js              # Download and import all sources
 *   node scripts/import-forecasts.js --source=DOE # Import specific source
 *   node scripts/import-forecasts.js --dry-run    # Preview without writing
 *   node scripts/import-forecasts.js --skip-download # Use existing local files
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// Load env
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse command line args
const args = process.argv.slice(2);
const sourceFilter = args.find(a => a.startsWith('--source='))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const skipDownload = args.includes('--skip-download');

// ============================================================================
// SOURCE CONFIGURATIONS
// ============================================================================

const sources = {
  DOE: {
    name: 'Department of Energy',
    url: 'https://www.energy.gov/sites/default/files/2026-03/OSBP%20Acquisition%20Forecast%20Public%202026-03-11.xlsx',
    localPath: path.join(__dirname, '..', 'tmp', 'forecasts', 'doe-forecast.xlsx'),
    headerRow: 17, // 0-indexed, row 18 in Excel (actual data starts row 19)
    parser: parseDOE,
  },
  NASA: {
    name: 'NASA',
    url: 'https://www.hq.nasa.gov/office/procurement/forecast/Agencyforecast.xlsx',
    localPath: path.join(__dirname, '..', 'tmp', 'forecasts', 'nasa-agency.xlsx'),
    headerRow: 0,
    parser: parseNASA,
  },
  DOJ: {
    name: 'Department of Justice',
    url: 'https://www.justice.gov/media/1381791/dl',
    localPath: path.join(__dirname, '..', 'tmp', 'forecasts', 'doj-forecast.xlsx'),
    sheetName: 'Contracting Opportunities Curre',
    headerRow: 0,
    parser: parseDOJ,
  },
};

// ============================================================================
// PARSERS - Convert agency-specific formats to unified schema
// ============================================================================

function parseDOE(row, headers) {
  // DOE columns: Performance End Date, NAICS Code, NAICS Description, Program Office,
  // Current Incumbent, Current Contract Number, Acquisition Description,
  // Estimated Value Range, Contracting Officers Business Size Selection,
  // Type of Set Aside, Contract Type, Principal Place of Performance State,
  // Small Business Program Manager

  const getCol = (name) => {
    const idx = headers.findIndex(h => h && h.toString().toLowerCase().includes(name.toLowerCase()));
    return idx >= 0 ? row[idx] : null;
  };

  const naicsCode = getCol('NAICS Code');
  if (!naicsCode || naicsCode === 'NAICS Code') return null; // Skip header row

  const valueRange = getCol('Estimated Value') || getCol('Value Range') || '';
  const { min, max } = parseValueRange(valueRange);

  // Use contract number as unique identifier (more stable than row index)
  const contractNum = getCol('Current Contract') || getCol('Contract Number');
  const programOffice = (getCol('Program Office') || '').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');

  return {
    source_agency: 'DOE',
    source_type: 'excel',
    // external_id will be overwritten with row index by main import loop if needed
    external_id: contractNum ? `DOE-${contractNum}` : null,

    title: getCol('Acquisition Description') || `DOE ${naicsCode} Opportunity`,
    description: getCol('Acquisition Description'),

    department: 'Department of Energy',
    program_office: getCol('Program Office'),

    naics_code: normalizeNaics(naicsCode),
    naics_description: getCol('NAICS Description'),

    performance_end_date: parseDate(getCol('Performance End')),
    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: valueRange,

    contract_type: getCol('Contract Type'),
    set_aside_type: normalizeSetAside(getCol('Set Aside') || getCol('Type of Set')),

    incumbent_name: getCol('Incumbent') || getCol('Current Incumbent'),
    incumbent_contract_number: getCol('Contract Number') || getCol('Current Contract'),

    pop_state: getCol('State') || getCol('Place of Performance'),

    raw_data: JSON.stringify(row),
  };
}

function parseNASA(row, headers) {
  // NASA columns: Buying Office, Acquisition Status, ID, Title of Requirement,
  // POC Email Address, NAICS Code, Product Service Code, PSC Category,
  // Anticipated FY of Award, Anticipated Qtr of Award, Value, Socio Economic Preference,
  // Product Service Line, GrantOrCoopAgreement, Awarded or Withdrawn,
  // Quarter of Sol Release, FY of Sol Release, Period of Performance,
  // Type of Requirement, Competition, Detailed Description (synopsis),
  // Incumbent Contractor, Incumbent Contract #, Awarded Contractor Name,
  // Awarded Contract #, Award Date, POC Name, Review Status

  const getCol = (name) => {
    const idx = headers.findIndex(h => h && h.toString().toLowerCase().includes(name.toLowerCase()));
    return idx >= 0 ? row[idx] : null;
  };

  const id = getCol('ID');
  const naicsCode = getCol('NAICS');
  if (!id && !naicsCode) return null;

  const value = getCol('Value');
  const { min, max } = parseValueRange(value);

  return {
    source_agency: 'NASA',
    source_type: 'excel',
    // Use NASA's ID field as unique identifier, or let main loop assign row-based ID
    external_id: id || null,

    title: getCol('Title') || `NASA ${naicsCode} Requirement`,
    description: getCol('Description') || getCol('synopsis'),

    department: 'NASA',
    contracting_office: getCol('Buying Office'),

    naics_code: normalizeNaics(naicsCode),
    psc_code: getCol('Product Service Code') || getCol('PSC'),
    psc_description: getCol('PSC Category'),

    fiscal_year: normalizeFY(getCol('FY of Award') || getCol('Anticipated FY')),
    anticipated_quarter: getCol('Qtr') || getCol('Anticipated Qtr'),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: value,

    contract_type: getCol('Type of Requirement'),
    set_aside_type: normalizeSetAside(getCol('Socio Economic')),
    competition_type: getCol('Competition'),

    incumbent_name: getCol('Incumbent Contractor'),
    incumbent_contract_number: getCol('Incumbent Contract'),

    poc_name: getCol('POC Name'),
    poc_email: getCol('POC Email'),

    status: normalizeStatus(getCol('Acquisition Status') || getCol('Awarded or Withdrawn')),

    raw_data: JSON.stringify(row),
  };
}

function parseDOJ(row, headers) {
  // DOJ columns: Fiscal Year, Action Tracking Number, Bureau, OBD, Contracting Office,
  // DOJ Small Business POC - Name, DOJ Small Business POC - Email Address,
  // DOJ Requirement POC - Name, DOJ Requirement POC - Phone Number,
  // DOJ Requirement POC - Email Address, FBO Notice Title, FBO Description,
  // NAICS Code, Current Incumbent, Current Contract or PO Number,
  // Estimated Total Value ($), Set-Aside Type, Anticipated Quarter of Award

  const getCol = (name) => {
    const idx = headers.findIndex(h => h && h.toString().toLowerCase().includes(name.toLowerCase()));
    return idx >= 0 ? row[idx] : null;
  };

  const trackingNum = getCol('Action Tracking') || getCol('Tracking Number');
  const naicsCode = getCol('NAICS');
  if (!trackingNum && !naicsCode) return null;

  const value = getCol('Estimated Total Value') || getCol('Value');
  const { min, max } = parseValueRange(value);

  return {
    source_agency: 'DOJ',
    source_type: 'excel',
    // Use tracking number as unique ID, or let main loop assign row-based ID
    external_id: trackingNum || null,

    title: getCol('FBO Notice Title') || getCol('Title') || `DOJ ${naicsCode} Opportunity`,
    description: getCol('FBO Description') || getCol('Description'),

    department: 'Department of Justice',
    bureau: getCol('Bureau'),
    contracting_office: getCol('Contracting Office'),

    naics_code: normalizeNaics(naicsCode),

    fiscal_year: normalizeFY(getCol('Fiscal Year')),
    anticipated_quarter: getCol('Anticipated Quarter') || getCol('Quarter of Award'),

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: value ? value.toString() : null,

    set_aside_type: normalizeSetAside(getCol('Set-Aside') || getCol('Set Aside')),

    incumbent_name: getCol('Current Incumbent') || getCol('Incumbent'),
    incumbent_contract_number: getCol('Current Contract') || getCol('Contract or PO'),

    poc_name: getCol('Requirement POC - Name') || getCol('Small Business POC - Name'),
    poc_email: getCol('Requirement POC - Email') || getCol('Small Business POC - Email'),
    poc_phone: getCol('Requirement POC - Phone'),

    raw_data: JSON.stringify(row),
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizeNaics(code) {
  if (!code) return null;
  // Extract just the numeric NAICS code
  const match = code.toString().match(/(\d{4,6})/);
  return match ? match[1] : null;
}

function normalizeFY(fy) {
  if (!fy) return null;
  const str = fy.toString();
  if (str.match(/^FY\d{2,4}$/i)) return str.toUpperCase();
  if (str.match(/^\d{4}$/)) return `FY${str}`;
  if (str.match(/^\d{2}$/)) return `FY20${str}`;
  return str;
}

function normalizeSetAside(setAside) {
  if (!setAside) return null;
  const lower = setAside.toString().toLowerCase();

  if (lower.includes('8(a)') || lower.includes('8a')) return '8(a)';
  if (lower.includes('hubzone')) return 'HUBZone';
  if (lower.includes('sdvosb') || lower.includes('service-disabled')) return 'SDVOSB';
  if (lower.includes('vosb') || lower.includes('veteran')) return 'VOSB';
  if (lower.includes('wosb') || lower.includes('women')) return 'WOSB';
  if (lower.includes('small business') || lower.includes('sb set-aside') || lower.includes('total small')) return 'Small Business';
  if (lower.includes('full and open') || lower.includes('unrestricted')) return 'Full & Open';
  if (lower.includes('sole source')) return 'Sole Source';

  return setAside;
}

function normalizeStatus(status) {
  if (!status) return 'forecast';
  const lower = status.toString().toLowerCase();

  if (lower.includes('award') && !lower.includes('pre')) return 'awarded';
  if (lower.includes('cancel') || lower.includes('withdrawn')) return 'cancelled';
  if (lower.includes('solicitation') || lower.includes('rfp') || lower.includes('rfq')) return 'solicitation';
  if (lower.includes('pre-sol') || lower.includes('presol')) return 'pre-solicitation';

  return 'forecast';
}

function parseValueRange(value) {
  if (!value) return { min: null, max: null };

  const str = value.toString().replace(/,/g, '');

  // Handle DOE ranges like "R2 – $250K–$7.5M"
  const rangeMatch = str.match(/\$?([\d.]+)\s*([KMB])?\s*[-–]\s*\$?([\d.]+)\s*([KMB])?/i);
  if (rangeMatch) {
    const minNum = parseFloat(rangeMatch[1]) * getMultiplier(rangeMatch[2]);
    const maxNum = parseFloat(rangeMatch[3]) * getMultiplier(rangeMatch[4]);
    return { min: Math.round(minNum), max: Math.round(maxNum) };
  }

  // Handle single values like "$5M" or "5000000"
  const singleMatch = str.match(/\$?([\d.]+)\s*([KMB])?/i);
  if (singleMatch) {
    const num = parseFloat(singleMatch[1]) * getMultiplier(singleMatch[2]);
    return { min: Math.round(num), max: Math.round(num) };
  }

  return { min: null, max: null };
}

function getMultiplier(suffix) {
  if (!suffix) return 1;
  switch (suffix.toUpperCase()) {
    case 'K': return 1000;
    case 'M': return 1000000;
    case 'B': return 1000000000;
    default: return 1;
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    // Handle Excel serial dates
    if (typeof dateStr === 'number') {
      const date = new Date((dateStr - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {}
  return null;
}

// ============================================================================
// DOWNLOAD FUNCTION
// ============================================================================

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;

    console.log(`  Downloading from ${url}...`);

    const file = fs.createWriteStream(destPath);

    const request = client.get(url, {
      headers: {
        'User-Agent': 'GovConGiants/ForecastImporter (service@govcongiants.com)',
      },
      followRedirect: true,
    }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`  Redirecting to ${redirectUrl}...`);
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        const stats = fs.statSync(destPath);
        console.log(`  Downloaded ${(stats.size / 1024).toFixed(1)} KB`);
        resolve();
      });
    });

    request.on('error', (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });

    file.on('error', (err) => {
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

async function importSource(sourceKey, config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Importing ${config.name} (${sourceKey})`);
  console.log(`${'='.repeat(60)}`);

  // Ensure directory exists
  const dir = path.dirname(config.localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Download if needed
  if (!skipDownload) {
    try {
      await downloadFile(config.url, config.localPath);
    } catch (error) {
      console.error(`  ❌ Download failed: ${error.message}`);
      console.log(`  Please manually download from: ${config.url}`);
      return { added: 0, errors: 1 };
    }
  } else if (!fs.existsSync(config.localPath)) {
    console.log(`  ⚠️  File not found: ${config.localPath}`);
    console.log(`  Remove --skip-download flag to download automatically`);
    return { added: 0, errors: 0 };
  }

  // Start sync run
  let syncRunId = null;
  if (!dryRun) {
    const { data: syncRun } = await supabase
      .from('forecast_sync_runs')
      .insert({
        source_agency: sourceKey,
        source_type: 'excel',
        run_type: 'full',
        status: 'running',
      })
      .select()
      .single();
    syncRunId = syncRun?.id;
  }

  try {
    // Read Excel
    const workbook = XLSX.readFile(config.localPath);
    const sheetName = config.sheetName || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    console.log(`  Sheet: ${sheetName}`);
    console.log(`  Total rows: ${data.length}`);

    // Get headers
    const headers = data[config.headerRow] || [];
    console.log(`  Headers: ${headers.slice(0, 5).join(', ')}...`);

    // Parse records
    const records = [];
    let skipped = 0;

    for (let i = config.headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 3) {
        skipped++;
        continue;
      }

      const parsed = config.parser(row, headers);
      if (parsed && parsed.naics_code) {
        // Generate consistent external_id for deduplication
        parsed.external_id = parsed.external_id || `${sourceKey}-${i}-${parsed.naics_code}`;
        records.push(parsed);
      } else {
        skipped++;
      }
    }

    console.log(`  Parsed: ${records.length} records`);
    console.log(`  Skipped: ${skipped} rows`);

    // Deduplicate records by external_id (keep last occurrence - usually most recent)
    const deduped = new Map();
    for (const record of records) {
      deduped.set(record.external_id, record);
    }
    const uniqueRecords = Array.from(deduped.values());
    const dupeCount = records.length - uniqueRecords.length;
    if (dupeCount > 0) {
      console.log(`  Deduplicated: ${dupeCount} duplicate rows removed`);
    }

    if (dryRun) {
      console.log('\n  [DRY RUN] Sample records:');
      uniqueRecords.slice(0, 3).forEach((r, i) => {
        console.log(`    ${i + 1}. ${r.title?.substring(0, 50)}... (NAICS: ${r.naics_code})`);
      });
      return { added: uniqueRecords.length, errors: 0 };
    }

    // Upsert in batches
    const batchSize = 100;
    let added = 0;
    let errors = 0;

    for (let i = 0; i < uniqueRecords.length; i += batchSize) {
      const batch = uniqueRecords.slice(i, i + batchSize);

      const { error } = await supabase
        .from('agency_forecasts')
        .upsert(batch, { onConflict: 'source_agency,external_id' });

      if (error) {
        console.error(`    Batch ${i}-${i + batchSize} error:`, error.message);
        errors += batch.length;
      } else {
        added += batch.length;
      }

      process.stdout.write(`\r  Imported ${Math.min(i + batchSize, uniqueRecords.length)}/${uniqueRecords.length}...`);
    }

    console.log(`\n  ✅ Added/Updated: ${added}`);
    console.log(`  ❌ Errors: ${errors}`);

    // Update sync run
    if (syncRunId) {
      await supabase
        .from('forecast_sync_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          records_fetched: data.length,
          records_added: added,
        })
        .eq('id', syncRunId);

      // Update source stats
      await supabase.rpc('update_forecast_source_stats', { p_agency_code: sourceKey });

      // Update source last_sync
      await supabase
        .from('forecast_sources')
        .update({
          last_sync_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
        })
        .eq('agency_code', sourceKey);
    }

    return { added, errors };

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);

    if (syncRunId) {
      await supabase
        .from('forecast_sync_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message,
        })
        .eq('id', syncRunId);
    }

    return { added: 0, errors: 1 };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n🚀 FORECAST INTELLIGENCE IMPORT');
  console.log('================================');
  if (dryRun) console.log('⚠️  DRY RUN MODE - No data will be written');
  if (skipDownload) console.log('⚠️  SKIP DOWNLOAD - Using existing local files');
  console.log();

  const sourcesToImport = sourceFilter
    ? { [sourceFilter]: sources[sourceFilter] }
    : sources;

  if (sourceFilter && !sources[sourceFilter]) {
    console.error(`Unknown source: ${sourceFilter}`);
    console.log('Available sources:', Object.keys(sources).join(', '));
    process.exit(1);
  }

  let totalAdded = 0;
  let totalErrors = 0;

  for (const [key, config] of Object.entries(sourcesToImport)) {
    const result = await importSource(key, config);
    totalAdded += result.added;
    totalErrors += result.errors;
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total records: ${totalAdded}`);
  console.log(`Total errors: ${totalErrors}`);

  if (!dryRun) {
    // Get database totals
    const { count } = await supabase
      .from('agency_forecasts')
      .select('*', { count: 'exact', head: true });

    console.log(`\nDatabase total: ${count} forecasts`);

    // Coverage summary
    const { data: coverage } = await supabase
      .from('forecast_coverage_dashboard')
      .select('*')
      .eq('is_active', true);

    if (coverage && coverage.length > 0) {
      console.log('\nActive sources:');
      coverage.forEach(s => {
        console.log(`  ${s.agency_code}: ${s.total_records} records (${s.estimated_spend_coverage}% spend coverage)`);
      });

      const totalCoverage = coverage.reduce((sum, s) => sum + (s.estimated_spend_coverage || 0), 0);
      console.log(`\nTotal spend coverage: ${totalCoverage.toFixed(1)}%`);
    }
  }
}

main().catch(console.error);

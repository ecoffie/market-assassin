#!/usr/bin/env node
/**
 * Import the SBA Small Business Goaling Report slice from
 * data.sba.gov into the sba_goaling Supabase table.
 *
 * Source dataset:
 *   https://data.sba.gov/dataset/fy23-federal-contracting-data-by-race-ethnicity
 *
 * The CSV has 200 rows (8 categories × ~25 agencies) and the schema:
 *   FUNDING_DEPARTMENT_NAME, category, dollars, total, pct
 *
 * Usage:
 *   # Default: pull live from data.sba.gov, import FY23
 *   node scripts/import-sba-goaling.js
 *
 *   # Use a local CSV instead (e.g. for offline / new FY year)
 *   node scripts/import-sba-goaling.js --csv=./data/sba/fy24.csv --fy=2024
 *
 *   # Preview without writing
 *   node scripts/import-sba-goaling.js --dry-run
 *
 * Re-running is safe (idempotent upsert on PK). FY-snapshot data
 * doesn't change, so cron-scheduling this is overkill — one-shot
 * per fiscal year when SBA publishes the new file.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.join(__dirname, '..');

const DEFAULT_CSV_URL =
  'https://data.sba.gov/dataset/3302152a-9ac5-49c9-ba72-c01cab38f01e/' +
  'resource/b2f16b6c-1780-4e93-abca-1cf8a7c54e72/download/disaggregated_by_agency_fy23.csv';

const DEFAULT_FY = 2023;
const BATCH_SIZE = 200; // CSV is ~200 rows total so this is one upsert

function parseArgs() {
  const out = { csv: null, fy: DEFAULT_FY, dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run' || arg === '-n') out.dryRun = true;
    else if (arg.startsWith('--csv=')) out.csv = arg.slice('--csv='.length);
    else if (arg.startsWith('--fy=')) out.fy = Number(arg.slice('--fy='.length));
  }
  return out;
}

function loadEnv() {
  const envFiles = ['.env.local', '.env.production', '.env'];
  const env = {};
  for (const file of envFiles) {
    const absolutePath = path.join(rootDir, file);
    if (!fs.existsSync(absolutePath)) continue;
    for (const line of fs.readFileSync(absolutePath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (!(k in env)) env[k] = cleanEnvValue(v);
    }
  }
  return {
    supabaseUrl: cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''),
    serviceKey: cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''),
  };
}

/**
 * Strip the common garbage that gets stuck onto env values:
 *   - Wrapping single or double quotes
 *   - Literal "\n" (two-char backslash-n) — happens when a previous
 *     sed/edit op wrote the escape sequence verbatim into the file
 *     instead of a real newline. Eric's .env.local has this on
 *     several Supabase lines. Without cleaning it, the service key
 *     gets sent to Supabase with 2 garbage chars at the end and
 *     gets rejected as "Invalid API key".
 *   - Trailing CR (\r) from Windows line endings
 *   - Trailing whitespace
 */
function cleanEnvValue(value) {
  if (!value) return '';
  return value
    .replace(/^['"]|['"]$/g, '')   // strip surrounding quotes
    .replace(/\\n$/g, '')          // strip trailing literal "\n"
    .replace(/\\r$/g, '')          // strip trailing literal "\r"
    .replace(/[\r\n]+$/g, '')      // strip real trailing newlines
    .trim();
}

/**
 * Parse a CSV string handling the quoting style data.sba.gov uses.
 * Agency names contain commas wrapped in double quotes:
 *   AGRICULTURE, DEPARTMENT OF,Asian American Owned Small Business,215658879.48,...
 * So a naive split(',') is wrong. We implement a minimal CSV
 * tokenizer here rather than pulling in a dependency for one file.
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = splitCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

function splitCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

async function fetchCsv(args) {
  if (args.csv) {
    const localPath = path.resolve(args.csv);
    console.log(`📂 Loading local CSV: ${localPath}`);
    return fs.readFileSync(localPath, 'utf8');
  }
  console.log(`🌐 Fetching ${DEFAULT_CSV_URL}`);
  const res = await fetch(DEFAULT_CSV_URL);
  if (!res.ok) throw new Error(`SBA CKAN HTTP ${res.status}`);
  return await res.text();
}

async function main() {
  const args = parseArgs();
  const { supabaseUrl, serviceKey } = loadEnv();

  if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log(`\n🏛️  SBA Goaling Report Import — FY${args.fy}`);
  console.log('─'.repeat(60));

  const csvText = await fetchCsv(args);
  const rows = parseCSV(csvText);

  console.log(`📊 Parsed ${rows.length} rows from CSV`);

  // Validate + normalize. Drop rows missing required fields rather
  // than crashing — surface a count so anomalies are visible.
  const records = [];
  let skipped = 0;
  for (const row of rows) {
    const department = (row.FUNDING_DEPARTMENT_NAME || '').trim();
    const category = (row.category || '').trim();
    const dollars = Number(row.dollars);
    const total = Number(row.total);
    const pct = Number(row.pct);
    if (!department || !category || !Number.isFinite(dollars) || !Number.isFinite(total)) {
      skipped++;
      continue;
    }
    records.push({
      fiscal_year: args.fy,
      funding_department: department,
      category,
      dollars,
      total,
      pct: Number.isFinite(pct) ? pct : (total > 0 ? dollars / total : 0),
    });
  }

  console.log(`✅ Validated ${records.length} records (${skipped} skipped)`);

  // Quick sanity check — show top 3 agencies by total
  const byAgency = new Map();
  for (const r of records) {
    if (!byAgency.has(r.funding_department)) byAgency.set(r.funding_department, r.total);
  }
  const topAgencies = [...byAgency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log('\n📈 Top 3 agencies by total obligations:');
  for (const [name, total] of topAgencies) {
    console.log(`   ${name}: $${(total / 1e9).toFixed(2)}B`);
  }

  if (args.dryRun) {
    console.log('\n🔍 Dry run — no writes performed.');
    process.exit(0);
  }

  // Upsert in batches. CSV is small so one batch is fine in practice.
  const supabase = createClient(supabaseUrl, serviceKey);

  console.log(`\n💾 Upserting ${records.length} rows...`);
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('sba_goaling')
      .upsert(chunk, { onConflict: 'fiscal_year,funding_department,category' });
    if (error) {
      console.error(`❌ Batch ${i / BATCH_SIZE + 1} failed:`, error);
      process.exit(1);
    }
    console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} rows`);
  }

  console.log('\n✅ Import complete.');
  console.log(`   Loaded ${records.length} rows into sba_goaling for FY${args.fy}`);
  console.log(`   Source: ${args.csv || DEFAULT_CSV_URL}\n`);
}

main().catch((err) => {
  console.error('💥 Import failed:', err);
  process.exit(1);
});

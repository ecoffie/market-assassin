/**
 * Import OpenGov IQ AllSamContacts CSV export into Supabase.
 *
 * Usage:
 *   node scripts/import-opengov-iq-contacts.js data/opengov-iq/AllSamContacts.csv
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.join(__dirname, '..');
const defaultCsvPath = path.join(rootDir, 'data', 'opengov-iq', 'AllSamContacts.csv');
const csvPath = path.resolve(process.argv[2] || defaultCsvPath);
const migrationPath = path.join(rootDir, 'supabase', 'migrations', '20260512_opengov_iq_contacts.sql');

function loadEnv() {
  const envFiles = ['.env.local', '.env.codex-production', '.env.production-debug', '.env.production', '.env'];
  const env = {};

  for (const file of envFiles) {
    const absolutePath = path.join(rootDir, file);
    if (!fs.existsSync(absolutePath)) continue;

    fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...valueParts] = trimmed.split('=');
      if (!key || valueParts.length === 0) return;
      env[key] = valueParts.join('=').replace(/^["']|["']$/g, '').replace(/\\n/g, '').trim();
    });
  }

  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function getField(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim()) return String(row[name]).trim();
  }

  const entries = Object.entries(row);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && String(match[1]).trim()) return String(match[1]).trim();
  }

  return '';
}

function rowKey(row) {
  const stable = [
    getField(row, ['ContactEmail', 'Email', 'email', 'POCEmail']),
    getField(row, ['ContactFullname', 'contact_fullname', 'full_name', 'name']),
    getField(row, ['ContactTitle', 'title']),
    getField(row, ['Department_Ind_Agency', 'agency', 'department']),
    getField(row, ['Office']),
    getField(row, ['Sub_Tier']),
    getField(row, ['SolNum', 'SolicitationNumber', 'NoticeId']),
    JSON.stringify(row),
  ].join('|');

  return crypto.createHash('sha1').update(stable).digest('hex');
}

function mapRow(row) {
  return {
    source_table: 'AllSamContacts',
    source_row_key: rowKey(row),
    contact_fullname: getField(row, ['ContactFullname', 'contact_fullname', 'full_name', 'name']) || null,
    contact_title: getField(row, ['ContactTitle', 'contact_title', 'title']) || null,
    contact_email: getField(row, ['ContactEmail', 'Email', 'email', 'email_address', 'POCEmail']) || null,
    contact_phone: getField(row, ['ContactPhone', 'Phone', 'phone', 'phone_number', 'POCPhone']) || null,
    department_ind_agency: getField(row, ['Department_Ind_Agency', 'department_ind_agency', 'department', 'agency']) || null,
    office: getField(row, ['Office', 'office']) || null,
    sub_tier: getField(row, ['Sub_Tier', 'sub_tier', 'subtier']) || null,
    posted_date: getField(row, ['PostedDate', 'posted_date']) || null,
    solicitation_number: getField(row, ['SolNum', 'SolicitationNumber', 'solicitation_number', 'NoticeId', 'notice_id']) || null,
    raw_data: row,
    updated_at: new Date().toISOString(),
  };
}

async function ensureSchema(supabase) {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const rpcNames = ['exec_migration', 'exec_sql'];

  for (const rpcName of rpcNames) {
    const { error } = await supabase.rpc(rpcName, rpcName === 'exec_migration' ? { sql_query: sql } : { sql });
    if (!error) return;
    if (!String(error.message || '').includes('function')) {
      console.warn(`[schema] ${rpcName} failed: ${error.message}`);
    }
  }

  const { error } = await supabase.from('opengov_iq_contacts').select('id').limit(1);
  if (error) {
    throw new Error(`Could not create or access opengov_iq_contacts. Run ${migrationPath} in Supabase SQL Editor. ${error.message}`);
  }
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const { supabaseUrl, serviceKey } = loadEnv();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  await ensureSchema(supabase);

  const workbook = XLSX.readFile(csvPath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const deduped = new Map();

  rows.forEach(row => {
    const mapped = mapRow(row);
    deduped.set(mapped.source_row_key, mapped);
  });

  const records = [...deduped.values()];
  const batchSize = 500;
  let imported = 0;

  for (let index = 0; index < records.length; index += batchSize) {
    const batch = records.slice(index, index + batchSize);
    const { error } = await supabase
      .from('opengov_iq_contacts')
      .upsert(batch, { onConflict: 'source_row_key' });

    if (error) throw error;
    imported += batch.length;
    console.log(`Imported ${imported}/${records.length}`);
  }

  console.log(`Done. ${imported} OpenGov IQ contacts loaded from ${path.relative(rootDir, csvPath)}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

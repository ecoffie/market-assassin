/**
 * Import OpenGov IQ enrichment CSV exports into Supabase.
 *
 * Usage:
 *   node scripts/import-opengov-iq-enrichment.js sam-entities ../opn-g-iq-a31ed6b6/SAMEntities_export.csv
 *   node scripts/import-opengov-iq-enrichment.js idiq ../opn-g-iq-a31ed6b6/IDIQ_details_export.csv
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.join(__dirname, '..');
const migrationPath = path.join(rootDir, 'supabase', 'migrations', '20260512_opengov_iq_enrichment.sql');
const mode = process.argv[2];
const csvPath = process.argv[3] ? path.resolve(process.argv[3]) : '';

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

function stableKey(source, row, names) {
  const stable = [
    source,
    ...names.map(name => getField(row, [name])),
    JSON.stringify(row),
  ].join('|');

  return crypto.createHash('sha1').update(stable).digest('hex');
}

function joinName(first, middle, last) {
  return [first, middle, last].map(value => (value || '').trim()).filter(Boolean).join(' ');
}

function mapEntity(row) {
  const govtPocName = joinName(
    getField(row, ['Govt_Bus_POC_First_Name']),
    getField(row, ['Govt_Bus_POC_Middle_Initial']),
    getField(row, ['Govt_Bus_POC_Last_Name'])
  );
  const electronicPocName = joinName(
    getField(row, ['Elec_Bus_POC_First_Name']),
    getField(row, ['Elec_Bus_POC_Middle_Initial']),
    getField(row, ['Elec_Bus_POC_Last_Name'])
  );

  return {
    source_table: 'SAMEntities',
    source_row_key: stableKey('SAMEntities', row, ['UEI_SAM', 'Cage_Code', 'Legal_Business_Name']),
    uei_sam: getField(row, ['UEI_SAM']) || null,
    duns: getField(row, ['Unique_Entity_Identifier_DUNS']) || null,
    cage_code: getField(row, ['Cage_Code']) || null,
    legal_business_name: getField(row, ['Legal_Business_Name']) || null,
    dba_name: getField(row, ['DBA_Name']) || null,
    entity_url: getField(row, ['Entity_URL']) || null,
    entity_structure: getField(row, ['Entity_Structure']) || null,
    physical_city: getField(row, ['Physical_Address_City']) || null,
    physical_state: getField(row, ['Physical_Address_Province_Or_State']) || null,
    physical_zip: getField(row, ['Physical_Address_Zip_Postal_Code']) || null,
    physical_country: getField(row, ['Physical_Address_Country_Code']) || null,
    business_type_string: getField(row, ['Business_Type_String']) || null,
    sba_business_types_string: getField(row, ['Sba_Business_Types_String']) || null,
    primary_naics: getField(row, ['Primary_NAICS']) || null,
    naics_code_string: getField(row, ['NAICS_Code_String']) || null,
    psc_code_string: getField(row, ['PSC_Code_String']) || null,
    registration_expiration_date: getField(row, ['Registration_Expiration_Date']) || null,
    exclusion_status_flag: getField(row, ['Exclusion_Status_Flag']) || null,
    government_poc_name: govtPocName || null,
    government_poc_title: getField(row, ['Govt_Bus_POC_Title']) || null,
    electronic_poc_name: electronicPocName || null,
    electronic_poc_title: getField(row, ['Elec_Bus_POC_Title']) || null,
    raw_data: row,
    updated_at: new Date().toISOString(),
  };
}

function mapIdiq(row) {
  return {
    source_table: 'IDIQ_details',
    source_row_key: stableKey('IDIQ_details', row, ['AwardID', 'recipient_uei', 'recipient_name']),
    description: getField(row, ['Description']) || null,
    award_id: getField(row, ['AwardID']) || null,
    naics: getField(row, ['NAICS']) || null,
    agency: getField(row, ['Agency']) || null,
    recipient_uei: getField(row, ['recipient_uei']) || null,
    recipient_name: getField(row, ['recipient_name']) || null,
    ai_generated_text: getField(row, ['ai_generated_text']) || null,
    cleaned_vehicle: getField(row, ['CleanedVehicle']) || null,
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

  const table = mode === 'sam-entities' ? 'opengov_iq_entities' : 'opengov_iq_idiq_vehicles';
  const { error } = await supabase.from(table).select('id').limit(1);
  if (error) {
    throw new Error(`Could not create or access ${table}. Run ${migrationPath} in Supabase SQL Editor. ${error.message}`);
  }
}

async function importRows(supabase, table, records) {
  const batchSize = 500;
  let imported = 0;

  for (let index = 0; index < records.length; index += batchSize) {
    const batch = records.slice(index, index + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'source_row_key' });
    if (error) throw error;
    imported += batch.length;
    console.log(`Imported ${imported}/${records.length}`);
  }

  return imported;
}

async function main() {
  if (!['sam-entities', 'idiq'].includes(mode)) {
    throw new Error('Mode must be "sam-entities" or "idiq"');
  }

  if (!csvPath || !fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath || '(missing path)'}`);
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
  const mapper = mode === 'sam-entities' ? mapEntity : mapIdiq;
  const table = mode === 'sam-entities' ? 'opengov_iq_entities' : 'opengov_iq_idiq_vehicles';
  const deduped = new Map();

  rows.forEach(row => {
    const mapped = mapper(row);
    deduped.set(mapped.source_row_key, mapped);
  });

  const imported = await importRows(supabase, table, [...deduped.values()]);
  console.log(`Done. ${imported} ${table} rows loaded from ${path.relative(rootDir, csvPath)}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

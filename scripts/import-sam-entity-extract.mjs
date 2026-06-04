/**
 * Bulk-import SAM public entity extract → sam_entities.
 *
 * The SAM Entity API caps page size at 10, so covering even one NAICS via
 * the API needs thousands of calls against a 1,000/day shared limit
 * (~31 days for 8 NAICS). The PUBLIC monthly extract is the whole registry
 * in one 145MB ZIP, no per-record limit. This is the real coverage path
 * (docs/PRD-gov-buyer-market-research.md; the "worker, not serverless"
 * case from docs/PRD-cron-dispatcher.md).
 *
 * Run locally / on a worker (NOT serverless — 145MB ZIP, ~700K rows):
 *   node scripts/import-sam-entity-extract.mjs                 # download + import seed NAICS
 *   node scripts/import-sam-entity-extract.mjs --file /tmp/sam-extract/entities.zip
 *   NAICS=541512,541611 node scripts/import-sam-entity-extract.mjs
 *   node scripts/import-sam-entity-extract.mjs --all-naics     # import everything (big)
 *
 * The extract is a ZIP of a pipe-delimited .dat. Fields are 1-indexed; the
 * NAICS-list and SBA-types fields are variable-width (a counter followed by
 * N values), so we parse positionally up to the first counter, then consume.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';
import { createClient } from '@supabase/supabase-js';

// Load .env.local explicitly (dotenv default only reads .env).
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SAM_KEY = (process.env.SAM_API_KEY_1 || process.env.SAM_API_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Which NAICS to keep. Default = the gov-buyer seed set. --all-naics keeps all.
const ALL_NAICS = process.argv.includes('--all-naics');
const SEED_NAICS = new Set((process.env.NAICS ||
  '541512,541511,541611,541330,541990,561210,541519,518210')
  .split(',').map(s => s.trim()).filter(Boolean));

const fileArgIdx = process.argv.indexOf('--file');
const ZIP_PATH = fileArgIdx > -1 ? process.argv[fileArgIdx + 1] : '/tmp/sam-extract/entities.zip';
const EXTRACT_FILENAME = process.env.SAM_EXTRACT_FILE || 'SAM_PUBLIC_MONTHLY_V2_20260503.ZIP';

// ── SBA business-type code → normalized label (matches entity-api.ts) ──
function sbaLabel(code) {
  // ONLY the SBA-CERTIFIED program codes (field 118) are real set-asides.
  // Verified against the public-extract layout PDF + live API (2026-06-04):
  //   A6 = SBA Certified 8(a) Program Participant
  //   JT = SBA Certified 8(a) Joint Venture
  //   XX = SBA Certified HUBZone Firm
  // PREFIX-match: A6 carries a concatenated cert-expiry date in the extract
  // (e.g. "A620291223" = A6 + 20291223), so exact-match misses most 8(a)s.
  // Other field-118 codes (A9, A0, ...) are NOT among the documented
  // certified programs, so we don't map them (WOSB/EDWOSB/SDVOSB are
  // self-certified and live elsewhere — surfaced separately, not here).
  const c = (code || '').toUpperCase().trim();
  if (c.startsWith('A6') || c.startsWith('JT')) return '8(a)';
  if (c.startsWith('XX')) return 'HUBZone';
  return null;
}

/**
 * Parse one pipe-delimited record into a sam_entities row (or null to skip).
 * Positions VERIFIED against real SAM_PUBLIC_MONTHLY_V2_20260503 data
 * (0-indexed here). NAICS-list and SBA-types are SINGLE fields with
 * tilde (~) separators — not counter+N-fields as the layout PDF implied.
 *
 *   0  UEI            3  CAGE           8  expiration(YYYYMMDD)
 *   11 legal name     12 DBA            17 city  18 state  19 zip  21 country
 *   31 SBA types (tilde, e.g. "2X~8W~A2")    32 primary NAICS
 *   34 NAICS list (tilde, code+Y/N e.g. "332312Y~423310Y")
 */
function parseRecord(fields) {
  if (fields.length < 35) return null;            // header/footer guard

  const uei = (fields[0] || '').trim();
  const cage = (fields[3] || '').trim();
  const expiration = (fields[8] || '').trim();
  const legalName = (fields[11] || '').trim();
  const dba = (fields[12] || '').trim();
  const city = (fields[17] || '').trim();
  const state = (fields[18] || '').trim();
  const zip = (fields[19] || '').trim();
  const country = (fields[21] || '').trim();
  const primaryNaics = (fields[32] || '').trim();

  if (!uei || !legalName) return null;

  // NAICS list (field index 34): "332312Y~423310Y~..." — strip the trailing
  // small-business indicator letter, keep the 6-digit code.
  const naicsCodes = [];
  for (const tok of (fields[34] || '').split('~')) {
    const code = tok.trim().slice(0, 6).replace(/[^0-9]/g, '');
    if (code.length === 6) naicsCodes.push(code);
  }
  if (primaryNaics && /^\d{6}$/.test(primaryNaics) && !naicsCodes.includes(primaryNaics)) {
    naicsCodes.unshift(primaryNaics);
  }

  // SBA CERTIFIED types live in field index 117 (1-indexed 118), NOT 31.
  // Verified 2026-06-04: field 31 is GENERAL business types (2X=For-Profit
  // etc.), which wrongly inflated 8(a) to 95%. Field 118 holds the real
  // certified codes, space-padded + tilde-delimited ("A6        ~XX        ").
  const certs = new Set();
  for (const tok of (fields[117] || '').split('~')) {
    const label = sbaLabel(tok.trim());
    if (label) certs.add(label);
  }

  // Expiration → registration_expiry (and a coarse active flag). The public
  // extract holds active + recently-expired; treat future expiry as Active.
  let regExpiry = null, status = 'Unknown';
  if (/^\d{8}$/.test(expiration)) {
    regExpiry = `${expiration.slice(0, 4)}-${expiration.slice(4, 6)}-${expiration.slice(6, 8)}`;
    status = new Date(regExpiry) >= new Date() ? 'Active' : 'Expired';
  }

  return {
    uei, cage_code: cage || null, legal_business_name: legalName, dba_name: dba || null,
    physical_city: city || null, physical_state: state || null, physical_zip: zip || null,
    physical_country: country || null,
    primary_naics: primaryNaics || naicsCodes[0] || null,
    naics_codes: naicsCodes, certifications: Array.from(certs),
    registration_status: status, registration_expiry: regExpiry,
    sam_url: `https://sam.gov/entity/${uei}`,
    source: 'sam_public_extract', synced_at: new Date().toISOString(),
  };
}

async function downloadIfNeeded() {
  if (existsSync(ZIP_PATH)) { console.log('Using existing file:', ZIP_PATH); return; }
  if (!SAM_KEY) { console.error('No SAM key to download; provide --file'); process.exit(1); }
  await mkdir('/tmp/sam-extract', { recursive: true });
  const url = `https://api.sam.gov/data-services/v1/extracts?fileType=ENTITY&fileName=${EXTRACT_FILENAME}&api_key=${SAM_KEY}`;
  console.log('Downloading', EXTRACT_FILENAME, '...');
  await new Promise((res, rej) => {
    const get = (u) => https.get(u, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return get(r.headers.location);
      if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode));
      const f = createWriteStream(ZIP_PATH);
      r.pipe(f); f.on('finish', () => f.close(res));
    }).on('error', rej);
    get(url);
  });
  console.log('Downloaded to', ZIP_PATH);
}

async function main() {
  await downloadIfNeeded();
  console.log(ALL_NAICS ? 'Importing ALL NAICS' : `Filtering to NAICS: ${[...SEED_NAICS].join(',')}`);

  let parsed = 0, kept = 0, upserted = 0, lineNo = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    // de-dupe by uei within batch (extract can repeat)
    const byUei = new Map(); for (const r of batch) byUei.set(r.uei, r);
    const rows = [...byUei.values()];
    const { error } = await sb.from('sam_entities').upsert(rows, { onConflict: 'uei', ignoreDuplicates: false });
    if (error) console.error('upsert error:', error.message);
    else upserted += rows.length;
    batch = [];
  };

  // Stream the ZIP → the .dat entry → line by line (never load it all).
  const directory = await unzipper.Open.file(ZIP_PATH);
  const datEntry = directory.files.find(f => /\.dat$/i.test(f.path)) || directory.files[0];
  console.log('Reading entry:', datEntry.path);

  const rl = createInterface({ input: datEntry.stream(), crlfDelay: Infinity });
  for await (const line of rl) {
    lineNo++;
    if (!line || !line.includes('|')) continue;       // skip header/footer
    const fields = line.split('|');
    const row = parseRecord(fields);
    if (!row) continue;
    parsed++;
    if (!ALL_NAICS && !row.naics_codes.some(n => SEED_NAICS.has(n))) continue;
    kept++;
    batch.push(row);
    if (batch.length >= 500) await flush();
    if (lineNo % 100000 === 0) console.log(`  ...line ${lineNo}, parsed ${parsed}, kept ${kept}, upserted ${upserted}`);
  }
  await flush();

  console.log(`\nDone. lines=${lineNo} parsed=${parsed} kept=${kept} upserted=${upserted}`);
  const { count } = await sb.from('sam_entities').select('*', { count: 'exact', head: true });
  console.log('sam_entities total rows now:', count);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

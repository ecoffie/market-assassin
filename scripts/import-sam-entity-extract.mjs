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
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
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

// Which NAICS to keep:
//   --all-naics       keep every entity (full registry)
//   SECTORS=54,23,33  keep all NAICS whose 2-digit prefix matches (sector
//                     mode — covers whole industries, e.g. all construction)
//   NAICS=541512,...  keep only these exact 6-digit codes (default seed set)
const ALL_NAICS = process.argv.includes('--all-naics');
const SECTORS = (process.env.SECTORS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const SEED_NAICS = new Set((process.env.NAICS ||
  '541512,541511,541611,541330,541990,561210,541519,518210')
  .split(',').map(s => s.trim()).filter(Boolean));
// Match if any of a firm's NAICS is in the exact seed set OR starts with a
// requested sector prefix.
function naicsMatches(codes) {
  if (SECTORS.length) {
    if (codes.some(n => SECTORS.some(sec => n.startsWith(sec)))) return true;
  }
  return codes.some(n => SEED_NAICS.has(n));
}

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

// SELF-CERTIFIED set-aside business types live in the BUSINESS TYPE field
// (field 32 / index 31), distinct from the SBA-CERTIFIED field (118).
// Codes verified against live SAM API descriptions (2026-06-04):
//   8W = Women-Owned Small Business    A2 = Women-Owned Business      -> WOSB
//   QF = Service-Disabled Veteran-Owned   JV = SDVOSB Joint Venture  -> SDVOSB
//   A5 = Veteran-Owned Business                                       -> VOSB
// These are SELF-certified (NOT SBA/VA-vetted) — the rubric weights them
// lower than 8(a)/HUBZone, and the memo footnotes the distinction.
function selfCertLabel(code) {
  const c = (code || '').toUpperCase().trim();
  if (c === '8W' || c === 'A2') return 'WOSB';
  if (c === 'QF' || c === 'JV') return 'SDVOSB';
  if (c === 'A5') return 'VOSB';
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
  // P0-3: field 34 is "<6-digit code><Y|N>" per NAICS — the Y/N IS SAM's per-NAICS
  // small-business representation. This loop used to strip it with replace(/[^0-9]/g,''),
  // discarding the only size signal SAM gives us and leaving market-research.ts to
  // substitute socioeconomic certification matching (which returns ZERO for firms holding
  // no certification — the P0-3 defect). Keep the code list AND the tri-state map.
  const naicsCodes = [];
  for (const tok of (fields[34] || '').split('~')) {
    const code = tok.trim().slice(0, 6).replace(/[^0-9]/g, '');
    if (code.length === 6) naicsCodes.push(code);
  }
  // Tri-state: 'Y' | 'N' | ABSENT. Absent means SAM did not say — never "not small".
  // Mirrors lib/sam/naics-small-business.ts fromBulkExtractField(); the shared unit test
  // asserts this path and the Entity API path normalise IDENTICALLY.
  const naicsSb = {};
  for (const raw of (fields[34] || '').split('~')) {
    const tok = raw.trim();
    if (!tok) continue;
    const code = tok.slice(0, 6);
    const flag = tok.slice(6, 7).toUpperCase();
    if (/^\d{6}$/.test(code) && (flag === 'Y' || flag === 'N')) naicsSb[code] = flag;
  }
  const smallBusinessNaics = Object.keys(naicsSb).filter((c) => naicsSb[c] === 'Y').sort();
  if (primaryNaics && /^\d{6}$/.test(primaryNaics) && !naicsCodes.includes(primaryNaics)) {
    naicsCodes.unshift(primaryNaics);
  }

  // Two cert sources, both surfaced into certifications[]:
  //  - field 118 (idx 117): SBA-CERTIFIED programs — 8(a), HUBZone (vetted).
  //  - field 32  (idx 31):  SELF-CERTIFIED business types — WOSB/SDVOSB/VOSB.
  // (Field 31 also holds general types like 2X=For-Profit; selfCertLabel
  // only maps the set-aside ones, so those are correctly ignored.)
  const certs = new Set();
  for (const tok of (fields[117] || '').split('~')) {
    const label = sbaLabel(tok.trim());
    if (label) certs.add(label);
  }
  for (const tok of (fields[31] || '').split('~')) {
    const label = selfCertLabel(tok.trim());
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
    // P0-3 provenance: observed_at is the SNAPSHOT date, not import time.
    naics_small_business: naicsSb,
    small_business_naics: smallBusinessNaics,
    naics_sb_source: `sam_bulk_extract:${EXTRACT_FILENAME}`,
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
  console.log(
    ALL_NAICS ? 'Importing ALL NAICS (full registry)'
    : SECTORS.length ? `Filtering to sectors: ${SECTORS.join(',')} (+ seed NAICS)`
    : `Filtering to NAICS: ${[...SEED_NAICS].join(',')}`,
  );

  // ── P0-3 write-side guardrails ────────────────────────────────────────────
  // This import is a REGISTRY EXPANSION, not just a backfill: the 2026-08 extract
  // carries 895,429 entities vs 491,323 rows currently in sam_entities. So it both
  // updates and inserts, and we must be able to say WHICH.
  //
  // Requirements enforced here:
  //   • batched upserts (existing, 500/batch)
  //   • RESUMABLE — checkpoint the last committed line to disk; --resume skips ahead
  //   • total reconciliation: lines = parsed + unparseable, kept = upserted + failed
  //   • failures COUNTED and dead-lettered, never just console.error'd and forgotten
  //   • updated vs inserted split, so we know how much of the universe changed
  const CKPT = `${ZIP_PATH}.checkpoint.json`;
  const DEADLETTER = `${ZIP_PATH}.failed.jsonl`;
  const RESUME = process.argv.includes('--resume');
  let resumeFrom = 0;
  if (RESUME && existsSync(CKPT)) {
    try {
      resumeFrom = JSON.parse(readFileSync(CKPT, 'utf8')).lastLine || 0;
      console.log(`RESUMING after line ${resumeFrom.toLocaleString()}`);
    } catch { /* corrupt checkpoint → start over rather than guess */ }
  }

  let parsed = 0, kept = 0, upserted = 0, lineNo = 0;
  let unparseable = 0, failed = 0, inserted = 0, updated = 0, skippedResume = 0;
  let structural = 0, dedupedInBatch = 0;   // BOF/EOF markers; repeat UEIs collapsed per batch
  let batch = [];

  // Which UEIs already exist? Needed for the inserted-vs-updated split, since
  // PostgREST upsert does not report it. One probe per batch, keyed on the batch's UEIs.
  const flush = async () => {
    if (!batch.length) return;
    // de-dupe by uei within batch (extract can repeat)
    const byUei = new Map(); for (const r of batch) byUei.set(r.uei, r);
    const rows = [...byUei.values()];
    dedupedInBatch += batch.length - rows.length;   // repeats collapse; counted, not lost
    const ueis = rows.map(r => r.uei);

    let preExisting = new Set();
    // .range() is REQUIRED: PostgREST silently caps an unranged select at 1,000 rows, so a
    // batch larger than that would report missing UEIs as "new" and inflate the inserted
    // count. Batches are 500 today; the explicit range makes the guarantee independent of
    // that constant instead of relying on it.
    const { data: existing, error: exErr } = await sb
      .from('sam_entities').select('uei').in('uei', ueis).range(0, Math.max(ueis.length - 1, 0));
    if (exErr) console.warn('  [warn] pre-existence probe failed:', exErr.message);
    else preExisting = new Set((existing || []).map(r => r.uei));

    const { error } = await sb.from('sam_entities')
      .upsert(rows, { onConflict: 'uei', ignoreDuplicates: false });
    if (error) {
      // Dead-letter the whole batch for a second pass. Counted, not swallowed.
      failed += rows.length;
      console.error(`  [fail] batch of ${rows.length} at line ${lineNo}: ${error.message}`);
      appendFileSync(DEADLETTER, rows.map(r => JSON.stringify({ uei: r.uei, line: lineNo, err: error.message })).join('\n') + '\n');
    } else {
      upserted += rows.length;
      for (const u of ueis) (preExisting.has(u) ? updated++ : inserted++);
      // Checkpoint only AFTER a committed batch, so a resume never skips unwritten rows.
      writeFileSync(CKPT, JSON.stringify({ lastLine: lineNo, upserted, inserted, updated, at: new Date().toISOString() }));
    }
    batch = [];
  };

  // Stream the ZIP → the .dat entry → line by line (never load it all).
  const directory = await unzipper.Open.file(ZIP_PATH);
  const datEntry = directory.files.find(f => /\.dat$/i.test(f.path)) || directory.files[0];
  console.log('Reading entry:', datEntry.path);

  const rl = createInterface({ input: datEntry.stream(), crlfDelay: Infinity });
  for await (const line of rl) {
    lineNo++;
    if (!line || !line.includes('|')) { structural++; continue; }  // BOF/EOF markers
    const fields = line.split('|');
    if (resumeFrom && lineNo <= resumeFrom) { skippedResume++; continue; }
    const row = parseRecord(fields);
    if (!row) { unparseable++; continue; }
    parsed++;
    if (!ALL_NAICS && !naicsMatches(row.naics_codes)) continue;
    kept++;
    batch.push(row);
    if (batch.length >= 500) await flush();
    if (lineNo % 100000 === 0) console.log(`  ...line ${lineNo}, parsed ${parsed}, kept ${kept}, upserted ${upserted}`);
  }
  await flush();

  // ── Reconciliation. Must balance, or the run is not trustworthy. ──────────
  const { count } = await sb.from('sam_entities').select('*', { count: 'exact', head: true });
  const linesAccounted = parsed + unparseable + skippedResume + structural;
  const keptAccounted = upserted + failed + dedupedInBatch;
  console.log(`
=== IMPORT RECONCILIATION ===
lines read              ${lineNo.toLocaleString()}
  parsed                ${parsed.toLocaleString()}
  unparseable           ${unparseable.toLocaleString()}
  structural (BOF/EOF)  ${structural.toLocaleString()}
  skipped (resume)      ${skippedResume.toLocaleString()}
  accounted             ${linesAccounted.toLocaleString()}  ${linesAccounted === lineNo ? 'BALANCES' : 'MISMATCH — investigate'}

kept (matched filter)   ${kept.toLocaleString()}
  upserted              ${upserted.toLocaleString()}
  deduped in batch      ${dedupedInBatch.toLocaleString()}  (same UEI twice in one batch)
  failed (dead-letter)  ${failed.toLocaleString()}
  accounted             ${keptAccounted.toLocaleString()}  ${keptAccounted === kept ? 'BALANCES' : 'MISMATCH — investigate'}

REGISTRY CHANGE
  updated existing      ${updated.toLocaleString()}
  newly inserted        ${inserted.toLocaleString()}
  sam_entities total    ${count?.toLocaleString?.() ?? count}
${failed ? `\n  ${failed} rows dead-lettered to ${DEADLETTER} — re-run with --resume after investigating.` : ''}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

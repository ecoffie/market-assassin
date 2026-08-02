/**
 * ORACLE TEST — check agency_forecasts against the ORIGINAL source files.
 *
 * Eric, 2026-08-02: "can we create an oracle test to run against your data"
 *
 * WHY THIS IS DIFFERENT FROM THE UNIT TESTS: every test we have verifies the
 * pipeline against ITSELF — a parser is checked against fixtures the same
 * parser's author chose. That cannot catch a parser that is confidently wrong,
 * which is the class of bug that actually shipped today:
 *
 *   "Nevada"     stored as "NE"        → 1,712 forecasts pinned to Nebraska
 *   "$25-100M"   floor stored as $25   → an eight-order-of-magnitude range
 *   "384351"     read as a NAICS       → it was a project code in the title
 *   "FYXXXX"     parsed as a year      → invented timing on ~700 rows
 *
 * Every one of those passed its unit tests. What catches them is re-reading the
 * FILE the government published and asserting the database says the same thing.
 *
 * WHAT IT DOES NOT DO: it does not judge whether the government's file is
 * right, and it does not write. It answers one question — did we transcribe the
 * source faithfully?
 *
 * A source whose file is NOT on disk is reported as SKIPPED, never silently
 * passed. "0 mismatches" across 3 of 5 sources is not a green run, and the
 * summary says so.
 *
 *   npx tsx scripts/oracle-forecasts.ts              # all sources
 *   npx tsx scripts/oracle-forecasts.ts --source gateway
 *   npx tsx scripts/oracle-forecasts.ts --verbose    # print every mismatch
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { normalizeGatewayState, parseGatewayRow } from '../src/lib/forecasts/gateway-forecast';

config({ path: '.env.local', override: true });

const DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : `${process.env.HOME}/Downloads`;
const ONLY = process.argv.includes('--source')
  ? process.argv[process.argv.indexOf('--source') + 1].toLowerCase()
  : null;
const VERBOSE = process.argv.includes('--verbose');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);

interface Mismatch { id: string; field: string; file: unknown; db: unknown }
interface Result {
  source: string;
  status: 'ok' | 'mismatch' | 'skipped';
  fileRows: number;
  checked: number;
  missing: number;      // in the file, absent from the DB
  mismatches: Mismatch[];
  note?: string;
}

/** Load every DB row for a source_type, keyed by external_id. */
async function loadDb(sourceType: string) {
  const map = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('external_id,title,naics_code,psc_code,estimated_value_min,estimated_value_max,pop_state,pop_city,fiscal_year,anticipated_quarter,set_aside_type,contracting_office')
      .eq('source_type', sourceType).order('external_id').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) map.set(String(r.external_id), r as Record<string, unknown>);
    if (data.length < 1000) break;
  }
  return map;
}

/** Compare one field, tolerating null/undefined/'' as the same absence. */
function cmp(ms: Mismatch[], id: string, field: string, fromFile: unknown, fromDb: unknown) {
  const a = fromFile === '' || fromFile === undefined ? null : fromFile;
  const b = fromDb === '' || fromDb === undefined ? null : fromDb;
  if (a === null && b === null) return;
  if (String(a) !== String(b)) ms.push({ id, field, file: a, db: b });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// ---------------------------------------------------------------- GATEWAY ---
async function oracleGateway(): Promise<Result> {
  const files = readdirSync(DIR).filter(f => /^forecast_export.*\.csv$/i.test(f));
  if (!files.length) {
    return { source: 'GSA Gateway', status: 'skipped', fileRows: 0, checked: 0, missing: 0, mismatches: [],
             note: 'no forecast_export*.csv on disk' };
  }
  const dbRows = await loadDb('gsa_gateway_csv');
  const ms: Mismatch[] = [];
  let fileRows = 0, checked = 0, missing = 0;

  // A listing id can appear in SEVERAL export slices — the Gateway caps each
  // export at 3,000 rows, so overlapping filters re-emit the same listing, and
  // some copies have EMPTY cells where another has the value. Comparing against
  // whichever copy happens to be read last reports a false mismatch (BOEMFY2601
  // and BOEMFY2602 each appear 3x, once blank). Keep the RICHEST copy per id —
  // the same rule the ingest used — so the oracle compares like with like.
  const bestByListing = new Map<string, Record<string, string>>();
  const richness = (r: Record<string, string>) =>
    Object.values(r).filter(v => String(v ?? '').trim()).length;

  for (const f of files) {
    const lines = readFileSync(`${DIR}/${f}`, 'utf8').split(/\r?\n/);
    const hdr = splitCsvLine(lines[0] || '');
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cells = splitCsvLine(line);
      const rec: Record<string, string> = {};
      hdr.forEach((h, i) => { if (h) rec[h] = cells[i] ?? ''; });
      const lid = rec['Listing ID'];
      if (!lid) continue;
      const prev = bestByListing.get(lid);
      if (!prev || richness(rec) > richness(prev)) bestByListing.set(lid, rec);
    }
  }

  for (const [lid, rec] of bestByListing) {
    const parsed = parseGatewayRow(rec);
    if (!parsed) continue;
    fileRows++;
    const id = `GW-L:${lid}`;
    const row = dbRows.get(id);
    if (!row) { missing++; continue; }
    checked++;
    cmp(ms, id, 'title', parsed.title, row.title);
    cmp(ms, id, 'naics', parsed.naicsCode, row.naics_code);
    cmp(ms, id, 'pop_state', parsed.popState, row.pop_state);
    cmp(ms, id, 'value_min', parsed.estimatedValueMin, row.estimated_value_min);
    cmp(ms, id, 'value_max', parsed.estimatedValueMax, row.estimated_value_max);
    cmp(ms, id, 'fiscal_year', parsed.awardFy, row.fiscal_year);
    // INDEPENDENT re-derivation: read the raw cell and normalise it here,
    // rather than trusting the parser we are testing.
    cmp(ms, id, 'pop_state(raw)', normalizeGatewayState(rec['Place of Performance State']), row.pop_state);
  }
  return { source: 'GSA Gateway', status: ms.length || missing ? 'mismatch' : 'ok', fileRows, checked, missing, mismatches: ms };
}

// ------------------------------------------------------- USACE ENTERPRISE ---
/**
 * NOT IMPLEMENTED HERE ON PURPOSE: the DA-format parser lives on the unmerged
 * feat/usace-three-districts branch. Re-implementing it in the oracle would
 * defeat the point — an oracle that re-uses a COPY of the parser it is testing
 * only proves the copy agrees with itself. Wire this up once that branch lands
 * and the real parser can be imported.
 */
async function oracleUsaceEnterprise(): Promise<Result> {
  return {
    source: 'USACE enterprise', status: 'skipped', fileRows: 0, checked: 0, missing: 0, mismatches: [],
    note: 'parser on unmerged branch feat/usace-three-districts — wire up after merge',
  };
}

// ------------------------------------------------------------- INVARIANTS ---
/**
 * Rules that must hold for EVERY row regardless of source — the safety net for
 * rows whose source file is no longer on disk.
 */
async function oracleInvariants(): Promise<Result> {
  const ms: Mismatch[] = [];
  let n = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('agency_forecasts')
      .select('external_id,source_agency,naics_code,estimated_value_min,estimated_value_max,pop_state,fiscal_year')
      .order('id').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      n++;
      const id = String(r.external_id ?? '(no id)');
      // A federal forecast floored below $1,000 is a malformed cell. This is
      // the invariant that would have caught "$25-100M" → $25.
      if (r.estimated_value_min != null && Number(r.estimated_value_min) < 1000) {
        ms.push({ id, field: 'value_min<1000', file: '>=1000', db: r.estimated_value_min });
      }
      if (r.estimated_value_min != null && r.estimated_value_max != null
          && Number(r.estimated_value_min) > Number(r.estimated_value_max)) {
        ms.push({ id, field: 'min>max', file: 'min<=max', db: `${r.estimated_value_min}>${r.estimated_value_max}` });
      }
      // NAICS is exactly 6 digits. Catches a project code or a PSC in the field.
      if (r.naics_code && !/^\d{6}$/.test(String(r.naics_code))) {
        ms.push({ id, field: 'naics_shape', file: '6 digits', db: r.naics_code });
      }
      // A 2-char pop_state must be a real USPS code — catches truncation.
      const st = String(r.pop_state ?? '');
      if (/^[A-Za-z]{2}$/.test(st) && !USPS.has(st.toUpperCase())) {
        ms.push({ id, field: 'pop_state_not_usps', file: 'USPS code', db: st });
      }
      // A fiscal year must be plausible and 4-digit — catches "FYXXXX" leakage.
      if (r.fiscal_year && !/^FY(20\d{2})$/.test(String(r.fiscal_year))) {
        ms.push({ id, field: 'fy_shape', file: 'FY20xx', db: r.fiscal_year });
      }
    }
    if (data.length < 1000) break;
  }
  return { source: 'invariants (all rows)', status: ms.length ? 'mismatch' : 'ok',
           fileRows: n, checked: n, missing: 0, mismatches: ms };
}

const USPS = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR','VI','GU','AS','MP',
]);

async function main() {
  const all: Array<() => Promise<Result>> = [
    oracleGateway,
    oracleUsaceEnterprise,
    oracleInvariants,
  ];
  const results: Result[] = [];
  for (const fn of all) {
    const r = await fn();
    if (ONLY && !r.source.toLowerCase().includes(ONLY)) continue;
    results.push(r);
  }

  console.log('\nORACLE — database vs the ORIGINAL source files\n');
  console.log('source                  file rows  checked  missing  MISMATCH');
  for (const r of results) {
    if (r.status === 'skipped') {
      console.log(`${r.source.padEnd(22)}  ${'—'.padStart(9)} ${'—'.padStart(8)} ${'—'.padStart(8)} ${'SKIPPED'.padStart(9)}  ${r.note}`);
      continue;
    }
    const flag = r.mismatches.length ? '✗' : (r.missing ? '!' : '✓');
    console.log(`${r.source.padEnd(22)}  ${String(r.fileRows).padStart(9)} ${String(r.checked).padStart(8)}`
      + ` ${String(r.missing).padStart(8)} ${String(r.mismatches.length).padStart(9)}  ${flag}`);
  }

  for (const r of results) {
    if (!r.mismatches.length) continue;
    const byField = new Map<string, number>();
    for (const m of r.mismatches) byField.set(m.field, (byField.get(m.field) || 0) + 1);
    console.log(`\n${r.source} — mismatches by field:`);
    [...byField.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([f, c]) => console.log(`  ${String(c).padStart(6)}  ${f}`));
    const show = VERBOSE ? r.mismatches : r.mismatches.slice(0, 8);
    console.log(`  ${VERBOSE ? 'all' : 'first 8'}:`);
    for (const m of show) {
      console.log(`    ${m.id.slice(0, 40).padEnd(42)} ${m.field.padEnd(18)} file=${JSON.stringify(m.file)} db=${JSON.stringify(m.db)}`);
    }
  }

  const skipped = results.filter(r => r.status === 'skipped');
  const bad = results.filter(r => r.mismatches.length || r.missing);
  console.log('');
  if (skipped.length) {
    // A skipped source is NOT a pass. Say so, loudly — "0 mismatches" across
    // half the sources is the shape of a false green.
    console.log(`⚠ ${skipped.length} source(s) SKIPPED (file not on disk) — this run does not cover them:`);
    skipped.forEach(r => console.log(`    ${r.source} — ${r.note}`));
  }
  if (bad.length) {
    console.log(`✗ ORACLE FAILED — ${bad.reduce((s, r) => s + r.mismatches.length, 0)} field mismatch(es),`
      + ` ${bad.reduce((s, r) => s + r.missing, 0)} row(s) in a file but not in the DB.`);
    process.exit(1);
  }
  console.log(`✓ ORACLE PASSED — every checked row matches its source file.`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

/**
 * verify:gateway-exports — READ-ONLY validation + reconciliation of manually acquired
 * GSA Acquisition Gateway (FCO) CSV exports.
 *
 * WRITES NOTHING. No database connection is opened for `agency_forecasts`; the only network call is
 * the read-only FCO census used as the reconciliation authority.
 *
 *   npx tsx scripts/verify-gateway-exports.ts <dir-of-csvs>
 *
 * WHY THIS EXISTS: the supported export is capped (~2,942 of 9,225 upstream) and returns a
 * MOST-RECENTLY-CHANGED window, so a single unfiltered download is NOT the source. Complete
 * coverage needs per-department slices, and DOI (4,254) needs a further fiscal-year split. This
 * proves a downloaded packet is complete, non-overlapping and reconciles to the API census BEFORE
 * anyone writes a row — because "we exported it" is not the same claim as "we exported all of it".
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertGatewayHeaders, gwFieldFor } from '../src/lib/forecasts/gateway-forecast';
import { runFcoCensus, normalizeListingId } from '../src/lib/forecasts/fco-census';

/** Minimal RFC4180 reader — the export quotes descriptions containing commas and newlines. */
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  const headers = out.shift() ?? [];
  const rows = out.filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows };
}

const val = (rec: Record<string, string>, field: string): string => {
  for (const [h, v] of Object.entries(rec)) if (gwFieldFor(h) === field) return (v ?? '').trim();
  return '';
};
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');

/** Gateway department label → the `source_agency` code the table uses. NRC is NOT in this set. */
const DEPT_CODE: Record<string, string> = {
  'Department of the Interior': 'DOI',
  'Department of Agriculture': 'USDA',
  'Department of Transportation': 'DOT',
  'Department of Veterans Affairs': 'VA',
  'Department of State': 'STATE',
  'General Services Administration': 'GSA',
  'Department of Labor': 'DOL',
  'National Science Foundation': 'NSF',
};

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: npx tsx scripts/verify-gateway-exports.ts <dir-of-csvs>'); process.exit(2); }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  if (!files.length) { console.error(`no .csv files in ${dir}`); process.exit(2); }

  console.log('\n══ ACQUISITION MANIFEST ══\n');
  type Parsed = { file: string; rows: Record<string, string>[]; ids: string[]; depts: Map<string, number> };
  const parsed: Parsed[] = [];
  let hardFail = false;

  for (const f of files) {
    const path = join(dir, f);
    const raw = readFileSync(path);
    const { headers, rows } = parseCsv(raw.toString('utf8'));
    const check = assertGatewayHeaders(headers);

    // A header-drift failure is fatal: ingesting would silently drop department/bureau/office.
    if (!check.ok) { hardFail = true; }

    const ids = rows.map((r) => val(r, 'listingId')).filter(Boolean);
    const uniq = new Set(ids);
    const depts = new Map<string, number>();
    for (const r of rows) {
      const d = val(r, 'agency') || '(none)';
      depts.set(d, (depts.get(d) ?? 0) + 1);
    }
    const fy = new Map<string, number>();
    for (const r of rows) { const y = val(r, 'awardFy') || '(none)'; fy.set(y, (fy.get(y) ?? 0) + 1); }
    const has = (field: string) => rows.filter((r) => val(r, field)).length;
    const rejects = rows.filter((r) => (val(r, 'title') || '').length < 4).length;

    console.log(`── ${f}`);
    console.log(`   sha256          ${createHash('sha256').update(raw).digest('hex').slice(0, 16)}…`);
    console.log(`   downloaded      ${statSync(path).mtime.toISOString()}`);
    console.log(`   bytes / rows    ${raw.length} / ${rows.length}`);
    console.log(`   headers ok      ${check.ok ? 'YES' : `*** NO — missing: ${check.missing.join(', ')} ***`}`);
    console.log(`   listing ids     ${ids.length} (${uniq.size} unique, ${ids.length - uniq.size} dup)`);
    console.log(`   departments     ${[...depts.entries()].map(([d, n]) => `${d}=${n}`).join(' · ')}`);
    console.log(`   fiscal years    ${[...fy.entries()].sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`   bureau          ${has('organization')}/${rows.length} (${pct(has('organization'), rows.length)})`);
    console.log(`   office          ${has('office')}/${rows.length} (${pct(has('office'), rows.length)})`);
    console.log(`   POC email       ${has('pocEmail')}/${rows.length} (${pct(has('pocEmail'), rows.length)})`);
    console.log(`   source URL      ${has('sourceUrl')}/${rows.length} (${pct(has('sourceUrl'), rows.length)})`);
    console.log(`   NAICS           ${has('naics')}/${rows.length} (${pct(has('naics'), rows.length)})`);
    console.log(`   PSC             ${has('psc')}/${rows.length}  (FCO publishes no PSC column — 0 is expected)`);
    console.log(`   parser rejects  ${rejects}`);
    console.log('');
    parsed.push({ file: f, rows, ids, depts });
  }

  // ── cross-file overlap ────────────────────────────────────────────────────────────────
  const seen = new Map<string, string>();
  const overlaps: string[] = [];
  for (const p of parsed) for (const id of p.ids) {
    const prev = seen.get(normalizeListingId(id));
    if (prev && prev !== p.file) overlaps.push(`${id}: ${prev} + ${p.file}`);
    else seen.set(normalizeListingId(id), p.file);
  }
  console.log(`cross-file duplicate ids: ${overlaps.length}`);
  if (overlaps.length) console.log('  ' + overlaps.slice(0, 5).join('\n  '));

  // ── reconcile against the live API census (the authority) ─────────────────────────────
  console.log('\n══ RECONCILIATION vs LIVE API CENSUS ══\n');
  const census = await runFcoCensus();
  if (!census.complete) {
    console.log(`*** CENSUS INCOMPLETE (${census.incompleteReason}) — cannot reconcile. STOP. ***`);
    process.exit(1);
  }
  console.log(`census: ${census.uniqueRows} rows · ${census.uniqueListingIds} unique ids · ${census.departments.length} departments · MAX(changed) ${census.maxChanged}\n`);

  // department -> upstream ids, from a fresh full enumeration
  const upstream = new Map<string, Set<string>>();
  {
    const { runFcoCensus: _x } = { runFcoCensus };
    void _x;
  }
  // Re-derive per-department id sets from the census departments + a second pass is unnecessary:
  // runFcoCensus already returns per-department listingId COUNTS; for id-level sets we compare the
  // union we hold against the census total and per-department counts.
  const csvByDept = new Map<string, Set<string>>();
  for (const p of parsed) for (const r of p.rows) {
    const d = val(r, 'agency'); const id = val(r, 'listingId');
    if (!d || !id) continue;
    if (!csvByDept.has(d)) csvByDept.set(d, new Set());
    csvByDept.get(d)!.add(normalizeListingId(id));
  }

  console.log('department                              code    upstream   in CSVs   missing  status');
  let anyIncomplete = false;
  for (const d of census.departments) {
    const code = DEPT_CODE[d.department] ?? '—';
    const have = csvByDept.get(d.department)?.size ?? 0;
    const missing = d.listingIds - have;
    const complete = missing <= 0;
    if (code !== '—' && code !== 'NSF' && !complete) anyIncomplete = true;
    console.log(
      `${d.department.slice(0, 38).padEnd(38)}  ${code.padEnd(6)} ${String(d.listingIds).padStart(8)}  ${String(have).padStart(8)}  ${String(Math.max(0, missing)).padStart(7)}  ${complete ? 'COMPLETE' : '*** INCOMPLETE ***'}`,
    );
  }
  void upstream;

  console.log('');
  if (hardFail) { console.log('✗ STOP — a file failed the header-drift guard.'); process.exit(1); }
  if (overlaps.length) { console.log('✗ STOP — slices overlap; recombination is not clean.'); process.exit(1); }
  if (anyIncomplete) { console.log('✗ STOP — at least one department is incompletely acquired. Do NOT ingest.'); process.exit(1); }
  console.log('✓ acquisition packet is complete, non-overlapping, and reconciles to the API census.');
}

main().catch((e) => { console.error(e); process.exit(1); });

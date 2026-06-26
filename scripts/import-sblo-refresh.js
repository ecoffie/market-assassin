#!/usr/bin/env node
/**
 * import-sblo-refresh.js — merge a refreshed SBLO contact list (produced by the
 * Bootcamp scraper) into src/data/prime-contractors-database.json.
 *
 * Refreshes ONLY the human contact fields (sbloName / title / email / phone) that
 * go stale, matched by company name. Leaves the USASpending-derived data
 * (contractCount, totalContractValue, agencies, naicsCategories, portals) alone.
 * Each refreshed record is stamped `sbloVerified: "<YYYY-MM>"` — the hybrid model
 * (same as the OSBP directors): a name we actually re-checked carries a date.
 *
 * Honesty rules:
 *   - Only NON-EMPTY CSV cells overwrite (a blank cell never wipes good data).
 *   - A row whose sbloName is blank = "company checked, no current SBLO found":
 *     left unchanged by default (no stamp). Pass --clear-stale to null the old
 *     name instead (so we never show a name we couldn't re-confirm).
 *   - DRY-RUN by default. Pass --write to save. Unmatched CSV rows are reported.
 *
 * Usage:
 *   node scripts/import-sblo-refresh.js [--file=~/Bootcamp/sblo-refresh-2026-06.csv]
 *                                       [--date=2026-06] [--clear-stale] [--write]
 *
 * Expected CSV headers: company,sbloName,title,email,phone[,vendorPortal,source]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- args ----
const args = process.argv.slice(2);
const getArg = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : d;
};
const WRITE = args.includes('--write');
const CLEAR_STALE = args.includes('--clear-stale');
let CSV_PATH = getArg('file', '~/Bootcamp/sblo-refresh-2026-06.csv');
if (CSV_PATH.startsWith('~')) CSV_PATH = path.join(os.homedir(), CSV_PATH.slice(1));
const DB_PATH = path.join(__dirname, '..', 'src', 'data', 'prime-contractors-database.json');
// Default verify date = from --date, else derived from the filename, else fail.
let VERIFIED = getArg('date', '');
if (!VERIFIED) {
  const m = /(\d{4})-(\d{2})/.exec(path.basename(CSV_PATH));
  VERIFIED = m ? `${m[1]}-${m[2]}` : '';
}
if (!/^\d{4}-\d{2}$/.test(VERIFIED)) {
  console.error('✗ Need a YYYY-MM verify date. Pass --date=2026-06 (or name the CSV ...-2026-06.csv).');
  process.exit(1);
}

// ---- tiny RFC4180-ish CSV parser (handles quoted fields, commas, "" escapes) ----
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { pushField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { pushField(); pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { pushField(); pushRow(); }
  return rows.filter((r) => r.length && r.some((c) => c.trim() !== ''));
}

// ---- company-name normalizer (for matching) ----
const SUFFIXES = /\b(the|inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|lp|llp|plc|holdings|group|intl|international|usa)\b/g;
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- load ----
if (!fs.existsSync(CSV_PATH)) {
  console.error(`✗ CSV not found: ${CSV_PATH}\n  Run the Bootcamp scraper first, or pass --file=<path>.`);
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const primes = db.primes;
if (!Array.isArray(primes)) { console.error('✗ Unexpected DB shape (expected { primes: [...] })'); process.exit(1); }

const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
const header = rows.shift().map((h) => h.trim().toLowerCase());
const col = (name) => header.indexOf(name);
const ci = { company: col('company'), sbloName: col('sbloname'), title: col('title'), email: col('email'), phone: col('phone'), vendorPortal: col('vendorportal') };
if (ci.company < 0) { console.error('✗ CSV must have a "company" column.'); process.exit(1); }

// index primes by normalized name (first wins; report collisions are rare)
const byNorm = new Map();
primes.forEach((p, idx) => { const k = norm(p.name); if (k && !byNorm.has(k)) byNorm.set(k, idx); });

// ---- merge ----
let updated = 0, cleared = 0, blankSkipped = 0, unmatched = [];
// [csvColumn, dbField]. vendorPortal → supplierPortal: the supplier-registration
// URL is the most common usable contact point in the refresh (a majority of
// companies have a portal but no named SBLO), so it must come across too.
const FIELDS = [['sbloName', 'sbloName'], ['title', 'title'], ['email', 'email'], ['phone', 'phone'], ['vendorPortal', 'supplierPortal']];
const changes = [];
for (const r of rows) {
  const company = (r[ci.company] || '').trim();
  if (!company) continue;
  const idx = byNorm.get(norm(company));
  if (idx === undefined) { unmatched.push(company); continue; }
  const p = primes[idx];

  // Collect every non-empty incoming value. A row with NO name but a mailbox
  // email and/or a supplier portal is still a real, usable contact (office/
  // portal-only) — import it; don't skip on a missing name (that dropped ~70
  // mailbox/portal contacts in the first cut).
  const incoming = [];
  for (const [csvKey, dbKey] of FIELDS) {
    const c = ci[csvKey];
    if (c == null || c < 0) continue;
    const v = (r[c] || '').trim();
    if (v) incoming.push([dbKey, v]);
  }
  // "Usable" = a real contact point (name/email/phone/portal), not just a title.
  const usable = incoming.some(([k]) => k !== 'title');

  if (!usable) {
    // Nothing findable for this company. Leave as-is (no stamp — we won't claim a
    // verify we couldn't make), or --clear-stale to null a prior unconfirmed one.
    if (CLEAR_STALE && (p.sbloName || p.email)) {
      changes.push(`  CLEAR  ${p.name}: dropped unconfirmed contact (${p.sbloName || p.email})`);
      if (WRITE) { p.sbloName = null; p.email = null; p.phone = null; delete p.sbloVerified; }
      cleared++;
    } else { blankSkipped++; }
    continue;
  }

  const diffs = [];
  for (const [dbKey, v] of incoming) {
    if (v !== p[dbKey]) { diffs.push(`${dbKey}: ${p[dbKey] ?? '∅'} → ${v}`); if (WRITE) p[dbKey] = v; }
  }
  if (WRITE) p.sbloVerified = VERIFIED;
  if (diffs.length || !p.sbloVerified) {
    changes.push(`  UPDATE ${p.name}: ${diffs.join('; ') || '(stamp only)'}`);
    updated++;
  }
}

if (WRITE) fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');

// ---- report ----
console.log(`\nSBLO refresh ${WRITE ? '(WROTE)' : '(DRY-RUN — pass --write to save)'}`);
console.log(`  CSV: ${CSV_PATH}`);
console.log(`  verify date: ${VERIFIED}${CLEAR_STALE ? '   [--clear-stale ON]' : ''}`);
console.log(`  CSV rows: ${rows.length} · primes in DB: ${primes.length}`);
console.log(`  updated/stamped: ${updated}`);
console.log(`  blank rows left unchanged: ${blankSkipped}${CLEAR_STALE ? ` · cleared stale: ${cleared}` : ''}`);
console.log(`  unmatched companies: ${unmatched.length}`);
if (changes.length) { console.log('\nChanges:'); console.log(changes.slice(0, 40).join('\n')); if (changes.length > 40) console.log(`  …and ${changes.length - 40} more`); }
if (unmatched.length) { console.log('\nUnmatched (no company match in DB — first 25):'); console.log('  ' + unmatched.slice(0, 25).join('\n  ')); }
console.log('');

#!/usr/bin/env node
/**
 * Import refreshed prime SBLO contacts (Bootcamp rescrape, 2026-06) into
 * src/data/prime-contractors-database.json.
 *
 * Updates ONLY the human-contact fields on existing primes, matched by company
 * name: sbloName, title, email, phone, supplierPortal, source. Leaves the
 * USASpending-derived fields (totalContractValue, agencies, naicsCategories,
 * contractCount, hasSubcontractPlan) untouched.
 *
 *   node scripts/import-sblo-refresh.js            # dry run (default, no writes)
 *   node scripts/import-sblo-refresh.js --write    # write the JSON back
 *   node scripts/import-sblo-refresh.js --report-unmatched
 */
const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const REPORT_UNMATCHED = process.argv.includes('--report-unmatched');
const DB_PATH = path.join(__dirname, '..', 'src', 'data', 'prime-contractors-database.json');
const CSV_PATH = path.join(__dirname, '..', 'data', 'imports', 'sblo-refresh-2026-06.csv');

// --- mirrors normalizeCompanyName() in src/lib/utils/prime-contractors.ts, plus INCORPORATED ---
function norm(n) {
  return (n || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[,.'"\-()]/g, ' ')
    .replace(/\b(LLC|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|THE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Curated aliases: my CSV company -> the EXACT name as it appears in the prime DB.
// Built by looking up each in the DB; multi-entity firms point at the primary federal arm.
// Companies genuinely absent from the DB are intentionally omitted (reported as unmatched).
const ALIAS = {
  'BOOZ ALLEN HAMILTON INCORPORATED': 'BOOZ ALLEN HAMILTON INC',
  'SAIC': 'SCIENCE APPLICATIONS INTERNATIONAL CORPORATION',
  'WSP': 'WSP USA INC.',
  'RAYTHEON COMPANY (RTX)': 'RAYTHEON COMPANY',
  'CGI Federal': 'CGI INC',
  'IBM US Federal': 'INTERNATIONAL BUSINESS MACHINES CORPORATION',
  'KPMG': 'KPMG L.L.P.',
  'DELOITTE (FEDERAL)': 'DELOITTE CONSULTING LLP',
  'QINETIQ NORTH AMERICA, INC.': 'QINETIQ INC.',
  'Fluor Government Group': 'FLUOR FEDERAL SERVICES INC',
  'General Atomics Aeronautical Systems, Inc.': 'GENERAL ATOMICS',
  'Mortenson': 'M. A. MORTENSON COMPANIES  INC.',
  'NTTData Federal': 'NTT DATA FEDERAL SERVICES  INC.',
  'Accenture': 'ACCENTURE FEDERAL SERVICES LLC',
  'Amentum': 'AMENTUM SERVICES  INC.',
  'APTIM': 'APTIM FEDERAL SERVICES  LLC',
  'SIKORSKY AIRCRAFT (LOCKHEED MARTIN)': 'SIKORSKY AIRCRAFT CORPORATION',
  'Gilbane Building Company': 'GILBANE FEDERAL',
  'AAI CORPORATION': 'TEXTRON SYSTEMS CORP', // AAI acquired by Textron -> Textron Systems
};

function parseCSV(content) {
  const rows = [];
  const lines = content.split(/\r?\n/);
  const headers = splitLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitLine(lines[i]);
    const r = {};
    headers.forEach((h, j) => (r[h] = (cells[j] || '').trim()));
    rows.push(r);
  }
  return rows;
}
function splitLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const primes = db.primes;
const byNorm = new Map();          // normalized name -> prime (first wins = most canonical)
const byNormList = new Map();      // normalized name -> [primes]
for (const p of primes) {
  const k = norm(p.name);
  if (!byNorm.has(k)) byNorm.set(k, p);
  if (!byNormList.has(k)) byNormList.set(k, []);
  byNormList.get(k).push(p);
}
const exactNameIndex = new Map(primes.map((p) => [p.name, p]));

function findPrime(company) {
  if (ALIAS[company]) {
    const target = ALIAS[company];
    return exactNameIndex.get(target) || byNorm.get(norm(target)) || null;
  }
  const k = norm(company);
  if (byNorm.has(k)) return byNorm.get(k);
  // prefix: a single prime whose normalized name begins with this key
  if (k.length >= 5) {
    const hits = [...byNorm.keys()].filter((pk) => pk === k || pk.startsWith(k + ' '));
    if (hits.length) {
      hits.sort((a, b) => a.length - b.length); // shortest = most canonical
      return byNorm.get(hits[0]);
    }
  }
  // token subset
  const kt = k.split(' ').filter(Boolean);
  if (kt.length >= 2) {
    const hits = primes.filter((p) => { const s = new Set(norm(p.name).split(' ')); return kt.every((t) => s.has(t)); });
    if (hits.length) { hits.sort((a, b) => a.name.length - b.name.length); return hits[0]; }
  }
  return null;
}

const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
let matched = 0, fieldsChanged = 0;
const unmatched = [];
const FIELD_MAP = { sbloName: 'sbloName', title: 'title', email: 'email', phone: 'phone', vendorPortal: 'supplierPortal' };

for (const r of rows) {
  const p = findPrime(r.company);
  if (!p) { unmatched.push(r.company); continue; }
  matched++;
  let touched = false;
  for (const [csvKey, dbKey] of Object.entries(FIELD_MAP)) {
    const v = (r[csvKey] || '').trim();
    if (v && v !== (p[dbKey] || '')) { p[dbKey] = v; touched = true; fieldsChanged++; }
  }
  if (touched) p.source = r.source || p.source; // stamp refresh provenance only when contacts changed
}

console.log(`SBLO refresh ${WRITE ? '(WRITE)' : '(dry run)'}:`);
console.log(`  CSV rows:          ${rows.length}`);
console.log(`  matched to primes: ${matched}`);
console.log(`  contact fields changed: ${fieldsChanged}`);
console.log(`  unmatched:         ${unmatched.length}`);
if (REPORT_UNMATCHED) console.log('  unmatched companies:\n   - ' + unmatched.join('\n   - '));

if (WRITE) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log(`  ✅ wrote ${DB_PATH}`);
} else {
  console.log('  (dry run — re-run with --write to save; review the git diff after)');
}

#!/usr/bin/env node
/**
 * FIVE-ARCHETYPE DIFF — run against the CACHED SOURCE EXTRACT, not the database.
 *
 * The point (Eric, 2026-08-24): "You actually CAN diff fields you don't currently store,
 * because the 147 MB source file is sitting there. There is no need to write 7.5 GB to
 * Postgres merely to inspect five representative records."
 *
 * Archetypes, chosen because they stress DIFFERENT parts of the layout:
 *   1. ordinary small business          — the baseline shape
 *   2. socioeconomic-certified firm     — 8(a)/HUBZone cert dates, entry/exit
 *   3. joint venture                    — JV structure + parent/hierarchy identity
 *   4. grants-only registrant           — purposeOfRegistration diverges from federal-contracts
 *   5. large or foreign firm            — structurally different: incorporation, address, size
 *
 * WHAT IT REPORTS: for every one of the 142 source fields, which archetypes populate it and
 * what it looks like — so "which fields are decision-critical" is answered from evidence
 * rather than from the layout PDF's field names.
 *
 *   node scripts/sam-archetype-diff.mjs --file /tmp/sam-extract/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP
 *   node scripts/sam-archetype-diff.mjs --file <zip> --json
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';

const fileIdx = process.argv.indexOf('--file');
const ZIP = fileIdx > -1 ? process.argv[fileIdx + 1] : '/tmp/sam-extract/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP';
const JSON_OUT = process.argv.includes('--json');
/** Stop after this many lines — we need five representatives, not a full scan. */
const SCAN_LIMIT = Number(process.env.SCAN_LIMIT || 400_000);

const F = { uei: 0, cage: 3, expiration: 8, legalName: 11, dba: 12, city: 16, state: 17,
            country: 20, sbaTypes: 31, primaryNaics: 32, naicsList: 34, sbaCerts: 117 };

/** Classify a record into an archetype, using ONLY fields we can already read reliably. */
function classify(f) {
  const certs = (f[F.sbaCerts] || '');
  const types = (f[F.sbaTypes] || '');
  const name = (f[F.legalName] || '').toUpperCase();
  const country = (f[F.country] || '').trim().toUpperCase();

  // JV first — a JV that is also 8(a) must not be filed under "certified".
  if (/\bJOINT VENTURE\b|\bJV\b|\bJ\.V\./.test(name) || /JT/.test(certs)) return 'joint_venture';
  if (country && country !== 'USA' && country !== 'UNITED STATES') return 'foreign_or_large';
  if (/A6|XX/.test(certs)) return 'socioeconomic_certified';
  // A registrant with NO NAICS at all is the grants-only tell in this layout.
  if (!(f[F.primaryNaics] || '').trim() && !(f[F.naicsList] || '').trim()) return 'grants_only';
  if (types) return 'ordinary_small_business';
  return null;
}

const WANT = ['ordinary_small_business', 'socioeconomic_certified', 'joint_venture', 'grants_only', 'foreign_or_large'];
const samples = new Map();

const dir = await unzipper.Open.file(ZIP);
const entry = dir.files.find((e) => /\.dat$/i.test(e.path));
if (!entry) { console.error('  ✗ no .dat entry in', ZIP); process.exit(1); }

const rl = createInterface({ input: entry.stream(), crlfDelay: Infinity });
let n = 0, maxFields = 0;
for await (const line of rl) {
  if (++n > SCAN_LIMIT) break;
  if (!line.includes('|')) continue;
  const f = line.split('|');
  if (f.length < 35) continue;
  maxFields = Math.max(maxFields, f.length);
  const kind = classify(f);
  if (kind && !samples.has(kind)) {
    samples.set(kind, f);
    if (samples.size === WANT.length) break;
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    scanned: n, fieldCount: maxFields,
    archetypes: Object.fromEntries([...samples].map(([k, f]) => [k, f])),
  }, null, 2));
  process.exit(0);
}

console.log(`\n  scanned ${n.toLocaleString()} lines · layout width ${maxFields} fields\n`);
console.log('  archetypes found:');
for (const k of WANT) {
  const f = samples.get(k);
  console.log(`    ${samples.has(k) ? '✓' : '✗'} ${k.padEnd(26)} ${f ? `${(f[F.legalName] || '').slice(0, 42)} (${f[F.uei]})` : '— none in scan window'}`);
}

// ── THE DIFF: which fields distinguish these archetypes? ───────────────────────────────────
// A field populated for EVERY archetype is baseline. A field populated for only SOME is where
// the decision-critical information lives — that is what the audit is looking for.
console.log('\n  ── fields that DIFFER across archetypes (populated for some, empty for others) ──\n');
const found = [...samples.entries()];
const rows = [];
for (let i = 0; i < maxFields; i++) {
  const present = found.filter(([, f]) => (f[i] || '').trim().length > 0).map(([k]) => k);
  if (present.length === 0 || present.length === found.length) continue;   // never-set or always-set
  rows.push({ idx: i, present, sample: found.find(([, f]) => (f[i] || '').trim())?.[1][i]?.slice(0, 34) || '' });
}
for (const r of rows.slice(0, 40)) {
  console.log(`    field ${String(r.idx).padStart(3)}  [${r.present.map((p) => p[0]).join('')}]  ${String(r.sample).padEnd(36)}`);
}
console.log(`\n  ${rows.length} discriminating field(s). Legend: o=ordinary s=socioeconomic j=JV g=grants f=foreign`);
console.log('  Next: name the high-value ones, confirm their index, and materialize ONLY those');
console.log('  after measuring how much each changes a real Mindy decision.\n');

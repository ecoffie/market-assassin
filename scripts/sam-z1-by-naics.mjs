#!/usr/bin/env node
/**
 * WHERE DOES grants-only STATUS ACTUALLY CHANGE AN ACQUISITION CONCLUSION?
 *
 * The registry-wide figure — 28.0% of SAM registrants are Z1 (Federal Assistance ONLY, so not
 * award-eligible for CONTRACTS) — is an UPPER BOUND, not the correction for any given market
 * (Eric): "You already saw 561720 barely affected."
 *
 * So bucket every NAICS by its Z1 share and report which markets are actually distorted:
 *
 *     0-5%   negligible — the field changes nothing here
 *     5-20%  worth showing
 *     20-50% materially distorts supplier counts
 *     >50%   the market is majority grants-only; a contract-supplier count built on the
 *            registry is meaningless without this field
 *
 * Runs against the CACHED extract — no SAM key, no schema change, no product wiring.
 *
 *   node scripts/sam-z1-by-naics.mjs --file /tmp/sam-extract/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP
 *   node scripts/sam-z1-by-naics.mjs --file <zip> --min 200      # only NAICS with >=200 firms
 *   node scripts/sam-z1-by-naics.mjs --file <zip> --json
 */
import { createInterface } from 'node:readline';
import unzipper from 'unzipper';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const ZIP = arg('--file', '/tmp/sam-extract/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP');
const MIN = Number(arg('--min', 100));
const JSON_OUT = process.argv.includes('--json');
const LIMIT = Number(process.env.SCAN_LIMIT || 0);   // 0 = whole file

const PURPOSE = 6, PRIMARY_NAICS = 32, NAICS_LIST = 34;

const dir = await unzipper.Open.file(ZIP);
const entry = dir.files.find((e) => /\.dat$/i.test(e.path));
if (!entry) { console.error('  ✗ no .dat entry in', ZIP); process.exit(1); }

/** naics -> { total, z1 } */
const byNaics = new Map();
let n = 0, z1Total = 0, withPurpose = 0;

const rl = createInterface({ input: entry.stream(), crlfDelay: Infinity });
for await (const line of rl) {
  if (LIMIT && ++n > LIMIT) break; else if (!LIMIT) n++;
  if (!line.includes('|')) continue;
  const f = line.split('|');
  if (f.length < 35) continue;

  const purpose = (f[PURPOSE] || '').trim();
  if (!purpose) continue;
  withPurpose++;
  const isZ1 = purpose === 'Z1';
  if (isZ1) z1Total++;

  // A firm's NAICS set: primary plus the tilde-joined list (codes carry a trailing Y/N
  // small-business flag, which is stripped). Counting a firm once per NAICS is correct here —
  // the question is per-market, and a firm genuinely competes in each code it registered.
  const codes = new Set();
  const p = (f[PRIMARY_NAICS] || '').trim();
  if (/^\d{6}$/.test(p)) codes.add(p);
  for (const tok of (f[NAICS_LIST] || '').split('~')) {
    const c = tok.trim().slice(0, 6);
    if (/^\d{6}$/.test(c)) codes.add(c);
  }
  // ⚠️ A Z1 registrant usually has NO NAICS at all (99.86% measured). Those firms cannot be
  // attributed to any market — which is itself the point: they inflate REGISTRY-WIDE counts,
  // not per-NAICS ones. Per-market distortion only shows up where a Z1 DID declare a NAICS.
  for (const c of codes) {
    let e = byNaics.get(c);
    if (!e) { e = { total: 0, z1: 0 }; byNaics.set(c, e); }
    e.total++;
    if (isZ1) e.z1++;
  }
}

const BUCKETS = [
  { label: '0-5%   negligible', lo: 0, hi: 5 },
  { label: '5-20%  worth showing', lo: 5, hi: 20 },
  { label: '20-50% materially distorts', lo: 20, hi: 50 },
  { label: '>50%   majority grants-only', lo: 50, hi: 101 },
];

const rows = [...byNaics.entries()]
  .filter(([, v]) => v.total >= MIN)
  .map(([naics, v]) => ({ naics, total: v.total, z1: v.z1, pct: (v.z1 / v.total) * 100 }))
  .sort((a, b) => b.pct - a.pct);

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned: n, withPurpose, z1Total, minFirms: MIN, markets: rows }, null, 2));
  process.exit(0);
}

console.log(`\n  scanned ${n.toLocaleString()} lines · ${withPurpose.toLocaleString()} with a purpose code`);
console.log(`  registry-wide Z1: ${z1Total.toLocaleString()} (${((z1Total / withPurpose) * 100).toFixed(1)}%) — an UPPER BOUND, not a per-market correction\n`);
console.log(`  ${rows.length.toLocaleString()} NAICS with >= ${MIN} registrants:\n`);

for (const b of BUCKETS) {
  const inB = rows.filter((r) => r.pct >= b.lo && r.pct < b.hi);
  const firms = inB.reduce((s, r) => s + r.total, 0);
  console.log(`    ${b.label.padEnd(30)} ${String(inB.length).padStart(5)} NAICS  ${String(firms.toLocaleString()).padStart(9)} registrants`);
}

console.log('\n  most-distorted markets (where this field changes the conclusion):');
for (const r of rows.slice(0, 12)) {
  console.log(`    ${r.naics}  ${r.pct.toFixed(1).padStart(5)}% Z1   ${String(r.z1).padStart(6)} of ${String(r.total).padStart(6)}`);
}
console.log('\n  least-distorted (the field is noise here):');
for (const r of rows.slice(-6)) {
  console.log(`    ${r.naics}  ${r.pct.toFixed(1).padStart(5)}% Z1   ${String(r.z1).padStart(6)} of ${String(r.total).padStart(6)}`);
}
console.log('');

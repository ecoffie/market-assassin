#!/usr/bin/env node
/**
 * Gate: no NEW customer-facing module may import the raw strategic corpus.
 *
 * `src/data/agency-pain-points.json` holds 2,500 priorities and 3,043 pain
 * points. Measured on origin/main @297e3136: 0 priorities carry a source URL and
 * 0 carry a source tag. Read through `strategic-claims.ts` they arrive typed and
 * dollar-sanitized; imported raw they arrive as bare prose a surface will happily
 * print as fact. That is exactly how "$6.2B allocated for hypersonic weapons"
 * reached a generated proposal under the heading "Stated strategic priorities".
 *
 * NOT a ban on the file. Admin inventory, integrity reports, build scripts and
 * the boundary modules themselves legitimately read raw rows — they are counting
 * or transforming, not asserting. And a module that reads raw rows but pipes them
 * through `@/lib/strategic-intel/*` is already safe. The rule is narrower: an
 * UNSANITIZED raw read inside a customer-facing module.
 *
 * Baseline ratchet: existing debt is recorded and blocks nothing; anything NEW
 * fails the push. `--list` prints findings, `--update-baseline` accepts them.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const RAW = 'agency-pain-points.json';
const BASELINE = 'tests/fixtures/strategic-claim-bypass-baseline.json';

/** Modules allowed to read raw rows: they count/transform, they do not assert. */
const ALLOWED = [
  /^src\/lib\/strategic-intel\//,        // the boundary itself
  /^src\/lib\/utils\/pain-points\.ts$/,  // sanitized legacy accessor behind the boundary
  /^src\/lib\/agency-intelligence\//,    // unified reader (already provenance-aware)
  /^src\/app\/api\/admin\//,             // admin inventory / health / data-core counters
  /^src\/lib\/data-core\//,              // integrity reporting counts raw rows by design
  /^src\/lib\/data-sources\//,           // registry metadata only
  /^src\/data\//,                        // generated datasets
  /^scripts\//,                          // build + audit tooling
  /\.unit\.test\.ts$/,
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === '.git') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

/** Strip comments so a file DOCUMENTING the rule is not flagged by it. */
const decomment = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const findings = [];
for (const abs of walk(join(ROOT, 'src'))) {
  const rel = relative(ROOT, abs);
  if (ALLOWED.some((re) => re.test(rel))) continue;
  const src = decomment(readFileSync(abs, 'utf8'));
  if (!src.includes(RAW)) continue;
  // A module that reads raw rows but routes them through the strategic-intel
  // boundary (the typed contract, or at minimum #1577's dollar sanitizer) is NOT
  // a bypass. The defect is an UNSANITIZED read reaching a customer surface, not
  // the import itself — so the rule keys on what the module does with the rows.
  if (/@\/lib\/strategic-intel\//.test(src)) continue;
  const line = src.split('\n').findIndex((l) => l.includes(RAW)) + 1;
  findings.push(`${rel}:${line}`);
}
findings.sort();

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log(findings.length ? findings.join('\n') : '(none)');
  process.exit(0);
}
if (args.includes('--update-baseline')) {
  writeFileSync(join(ROOT, BASELINE), JSON.stringify(findings, null, 2) + '\n');
  console.log(`[strategic-claim-bypass] baseline updated (${findings.length}).`);
  process.exit(0);
}

let baseline = [];
try { baseline = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')); } catch { baseline = []; }
const novel = findings.filter((f) => !baseline.includes(f));
if (novel.length) {
  console.error('[strategic-claim-bypass] NEW customer-facing raw-corpus import(s):');
  for (const n of novel) console.error(`  ${n}`);
  console.error('\nConsume @/lib/strategic-intel/strategic-claims instead — it returns typed,');
  console.error('dollar-sanitized claims carrying their provenance. If this module genuinely');
  console.error('only counts raw rows, add it to ALLOWED with a reason.');
  process.exit(1);
}
console.log(`[strategic-claim-bypass] OK — no new bypasses (${baseline.length} baseline-known).`);

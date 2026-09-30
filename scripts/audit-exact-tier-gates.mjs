#!/usr/bin/env node
/**
 * audit-exact-tier-gates — blocks the "Team loses a Pro feature" bug class.
 *
 * THE BUG: a feature gate compared the account tier for EQUALITY
 * (`access.tier === 'pro'`) instead of asking "Pro or above?". Paying $499 Team
 * customers got 402 "Mindy Pro feature" on Mindy Analyst and market-report
 * generation, and `tier === 'pro' || tier === 'team'` shut Enterprise out of the
 * market overview. Nothing errored; the higher plan just silently lost features.
 *
 * THE RULE: a capability gate uses the hierarchy in src/lib/access/tier-rank.ts
 * (`tierAtLeast` / `hasPaidProductTier`). An exact comparison against 'pro' or
 * 'team' is only legitimate for DISPLAY (a plan label, pricing copy, an upsell card
 * shown to exactly one plan) or admin counting. Mark those with a
 * `// tier-display-ok: <why>` comment on the line or the line above, or leave them
 * in the baseline.
 *
 * Baseline-gated like its siblings: existing display-only sites are recorded by
 * path + line TEXT (not line number, so unrelated edits don't create false NEW
 * findings). Only NEW exact comparisons fail the push.
 *
 *   node scripts/audit-exact-tier-gates.mjs                  # gate
 *   node scripts/audit-exact-tier-gates.mjs --list           # every finding
 *   node scripts/audit-exact-tier-gates.mjs --update-baseline
 *   node scripts/audit-exact-tier-gates.mjs --self-test      # proves the detector
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const BASELINE_FILE = join(ROOT, 'tests/fixtures/exact-tier-gates-baseline.json');
const EXACT = /(?:\b[\w.?]*[tT]ier\b\s*(?:===|!==|==|!=)\s*['"](?:pro|team)['"])|(?:['"](?:pro|team)['"]\s*(?:===|!==|==|!=)\s*[\w.?]*[tT]ier\b)/;
const WAIVER = /tier-display-ok:\s*\S/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); continue; }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Findings in one file's source: [{ key, line, text }]. */
export function findingsIn(src, path) {
  const raw = src.split('\n');
  const out = [];
  let inBlock = false;
  raw.forEach((line, i) => {
    let code = line;
    if (inBlock) {
      const end = code.indexOf('*/');
      if (end < 0) return;
      code = code.slice(end + 2); inBlock = false;
    }
    code = code.replace(/\/\*.*?\*\//g, '');
    const open = code.indexOf('/*');
    if (open >= 0) { inBlock = true; code = code.slice(0, open); }
    code = code.replace(/(^|[^:])\/\/.*$/, '$1');
    if (!EXACT.test(code)) return;
    if (WAIVER.test(line) || WAIVER.test(raw[i - 1] || '')) return;
    const text = line.trim();
    out.push({ key: `${path}::${text}`, line: i + 1, text });
  });
  return out;
}

function selfTest() {
  const bad = "  const isPro = access.tier === 'pro' || access.isStaff === true;";
  const good = "  const isPro = hasPaidProductTier(access.tier) || access.isStaff === true;";
  const waived = "  // tier-display-ok: plan label\n  const label = tier === 'team' ? 'Team plan' : 'Pro plan';";
  const commented = "  // was: access.tier === 'pro'";
  const checks = [
    ['exact gate is caught', findingsIn(bad, 'x.ts').length === 1],
    ['hierarchy helper passes', findingsIn(good, 'x.ts').length === 0],
    ['waived display line passes', findingsIn(waived, 'x.ts').length === 0],
    ['a comment quoting the bug passes', findingsIn(commented, 'x.ts').length === 0],
    ['reversed operands are caught', findingsIn("if ('team' !== userTier) return;", 'x.ts').length === 1],
  ];
  let ok = true;
  for (const [name, pass] of checks) { console.log(`${pass ? '✓' : '✗'} ${name}`); ok &&= pass; }
  process.exit(ok ? 0 : 1);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();

const all = walk(join(ROOT, 'src')).flatMap((p) => findingsIn(readFileSync(p, 'utf8'), relative(ROOT, p)));

if (args.includes('--update-baseline')) {
  writeFileSync(BASELINE_FILE, JSON.stringify({
    note: 'Exact tier comparisons accepted as DISPLAY/admin-only. Capability gates must use src/lib/access/tier-rank.ts.',
    updated: new Date().toISOString().slice(0, 10),
    keys: [...new Set(all.map((f) => f.key))].sort(),
  }, null, 2) + '\n');
  console.log(`baseline written: ${new Set(all.map((f) => f.key)).size} known site(s)`);
  process.exit(0);
}

if (args.includes('--list')) {
  for (const f of all) console.log(`${f.key.split('::')[0]}:${f.line}  ${f.text}`);
  process.exit(0);
}

const known = new Set(existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).keys : []);
const fresh = all.filter((f) => !known.has(f.key));
if (fresh.length) {
  console.error(`✗ ${fresh.length} NEW exact tier comparison(s) — a higher plan may silently lose this feature:`);
  for (const f of fresh) console.error(`  ${f.key.split('::')[0]}:${f.line}  ${f.text}`);
  console.error("\n  Fix: gate with tierAtLeast()/hasPaidProductTier() from src/lib/access/tier-rank.ts.");
  console.error('  Display-only (a label, pricing copy)? Add  // tier-display-ok: <why>  on the line or the line above.');
  process.exit(1);
}
console.log(`✓ no new exact tier gates (${all.length} known display/admin site(s))`);

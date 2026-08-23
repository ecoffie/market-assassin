#!/usr/bin/env node
/**
 * PRE-PUSH GATE — PostgREST 1,000-row truncation in API routes.
 *
 * THE FAILURE MODE, in one line (Eric, 2026-08-22): "a query returns the first 1,000 rows,
 * the caller treats that as the population, and the UI presents a plausible-but-wrong number."
 *
 * FOUR OCCURRENCES IN ONE DAY is why this exists at the architectural boundary rather than as
 * four individual fixes:
 *
 *   1. MCP adoption      reported "24 accounts all-time, 0 new" — the truth was 59 and 23
 *                        (70% growth in real users). Caught only because "29 today vs 24 ever"
 *                        is arithmetically impossible.
 *   2. Description drain a plain .limit(50000) returned exactly 1,000; would have drained
 *                        1,000 of 17,748 rows WHILE PRINTING SUCCESS.
 *   3. Analytics gate     audit-unranged-selects.mjs deliberately skipped read-only scripts —
 *                        "a read-only script that truncates only prints a wrong number."
 *                        Defensible until the numbers started driving strategy.
 *   4. Admin dashboard    getBootcampRollout's fallback derived the REIGNITE AUDIENCE
 *                        (configuredReal / needsSetupReal) from 1,000 of 8,802 rows.
 *
 * The cap is a DATA-INTEGRITY HAZARD, not an implementation detail. Every one of these
 * produced a confident, plausible, wrong number that a human would have acted on.
 *
 * ── SCOPE: the dangerous SHAPE only ────────────────────────────────────────────────────
 * There are 935 .select() calls under src/app/api. Flagging them all would make this the
 * first gate someone disables, so a finding needs ALL of:
 *
 *   1. a list read     — not `count:'exact'` / `head:true` (those cannot truncate)
 *   2. unbounded       — no `.range()`, no `.limit()`, no pagination loop nearby
 *   3. POPULATION USE  — the result feeds .length / .filter / .reduce / a Set / grouping /
 *                        a percentage denominator. A row fetched to READ ONE FIELD is fine;
 *                        a row COUNTED is not.
 *
 * An explicit `// truncation-ok: <reason>` suppresses a finding, because a genuinely bounded
 * query should have to say WHY the cap cannot affect correctness.
 *
 * BASELINED like its sibling gates: existing debt is recorded and blocks nothing; a NEW
 * dangerous read fails the push. Shrink the baseline; never grow it.
 *
 *   node scripts/audit-api-truncation.mjs             # gate (exit 1 on NEW findings)
 *   node scripts/audit-api-truncation.mjs --list      # every finding
 *   node scripts/audit-api-truncation.mjs --update-baseline
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN = join(ROOT, 'src/app/api');
const BASELINE_FILE = join(ROOT, 'tests/fixtures/api-truncation-baseline.json');

/** How far after the .select() we look for a bound or a population use. */
const WINDOW = 700;

/** Reading these means the caller is treating the array AS A POPULATION. */
const POPULATION_USE = /\.length\b|\.filter\(|\.reduce\(|\.forEach\(|new Set\(|\.map\(|Object\.keys\(|\.sort\(/;

/** Any of these means the read is bounded and cannot silently truncate. */
const BOUNDED = /\.range\(|\.limit\(|count:\s*['"]exact['"]|head:\s*true|\.maybeSingle\(|\.single\(/;

/** An explicit, documented waiver. */
const SUPPRESSED = /truncation-ok:/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments BEFORE matching. Sibling gates learned this the hard way: a fix that QUOTES
 * `.select('a, b')` while explaining the bug is not a violation, and false positives are what
 * make people reflexively --update-baseline, which is how a ratchet stops meaning anything.
 * (Measured on audit-unranged-selects.mjs: 4 of 20 findings were its own header comment.)
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
}

function violationsIn(src) {
  const clean = stripComments(src);
  const lines = clean.split('\n');
  const raw = src.split('\n');
  const out = [];

  lines.forEach((line, i) => {
    if (!/\.select\(/.test(line)) return;

    // An explicit waiver on this line or the two above it.
    const around = [raw[i - 2], raw[i - 1], raw[i]].join('\n');
    if (SUPPRESSED.test(around)) return;

    const window = clean.slice(clean.indexOf(line), clean.indexOf(line) + WINDOW);
    if (BOUNDED.test(window)) return;            // bounded → cannot truncate
    if (!POPULATION_USE.test(window)) return;    // fetched, not counted → not a population claim

    out.push({ line: i + 1, snippet: line.trim().slice(0, 96) });
  });
  return out;
}

const files = walk(SCAN);
const offenders = [];
for (const f of files) {
  const bad = violationsIn(readFileSync(f, 'utf8'));
  if (bad.length) offenders.push({ file: relative(ROOT, f), bad });
}

const baseline = existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).violations || [])
  : new Set();

const keys = offenders.flatMap((o) => o.bad.map((b) => `${o.file}:${b.line}`));

if (process.argv.includes('--update-baseline')) {
  mkdirSync(dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify({
    note: 'Pre-existing unpaginated population reads under src/app/api. The gate blocks only NEW ones. Shrink this list; never grow it. Suppress a genuinely bounded query with `// truncation-ok: <reason>`.',
    updated: new Date().toISOString().slice(0, 10),
    violations: keys.sort(),
  }, null, 2) + '\n');
  console.log(`baseline updated — ${keys.length} accepted violation(s) recorded`);
  process.exit(0);
}

if (process.argv.includes('--list')) {
  for (const o of offenders) {
    console.log(`\n  ${o.file}`);
    for (const b of o.bad) console.log(`      ${b.line}: ${b.snippet}`);
  }
  console.log(`\n  ${keys.length} finding(s) across ${offenders.length} route(s), ${files.length} files scanned`);
  process.exit(0);
}

const fresh = offenders
  .map((o) => ({ ...o, bad: o.bad.filter((b) => !baseline.has(`${o.file}:${b.line}`)) }))
  .filter((o) => o.bad.length);

if (!fresh.length) {
  console.log(`\x1b[32m✓ no NEW unpaginated population reads (${files.length} api files, ${baseline.size} baselined)\x1b[0m`);
  process.exit(0);
}

const total = fresh.reduce((s, o) => s + o.bad.length, 0);
console.error(`\x1b[31m✗ ${total} NEW unpaginated population read(s) in ${fresh.length} API route(s)\x1b[0m`);
console.error('  Potential PostgREST 1,000-row truncation: this route derives a population metric');
console.error('  (count, cohort, percentage, or eligibility) from an unpaginated query.\n');
for (const o of fresh) {
  console.error(`  ${o.file}`);
  for (const b of o.bad) console.error(`      ${b.line}: ${b.snippet}`);
}
console.error('\n  Fix: paginate with .range(), use count:\'exact\'/head:true or an RPC,');
console.error('  or suppress with  // truncation-ok: <why the cap cannot affect correctness>');
process.exit(1);

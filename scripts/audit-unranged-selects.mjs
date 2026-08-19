#!/usr/bin/env node
/**
 * Pre-push gate: a script that WRITES must not read its population with an
 * un-ranged PostgREST select.
 *
 * WHY THIS EXISTS (2026-08-19). PostgREST silently caps an unranged `.select()`
 * at 1,000 rows. Not an error, not a warning — the query returns 1,000 rows and
 * looks complete. In ONE investigation that cap changed the verdict three times:
 *
 *   1. The throughput digest's own MCP check read four tables bare. Caught by
 *      accuracy.unit.test.ts before merge.
 *   2. A probe of that same funnel reported "3 stranded at consent". Re-run with
 *      paging: 0. A false alarm in a monitor that had just been built to be
 *      trustworthy.
 *   3. The classification backfill computed 87 stranded users against SQL's 28.
 *      customer_classifications holds 1,750 rows, so 750 ALREADY-CLASSIFIED
 *      users looked unclassified. Had it run, it would have written 59 duplicate
 *      rows into a live entitlement table.
 *
 * Only the third was caught by a human noticing two numbers disagree. That is
 * not a control. This is.
 *
 * SCOPE — deliberately narrow, so it stays credible:
 *   • only files under scripts/
 *   • only files that WRITE (.insert/.update/.upsert/.delete)
 *   • only list selects (count:/head:true reads cannot truncate)
 *   • `.range(` or `.limit(` anywhere in the following window clears it
 *
 * A read-only script that truncates prints a wrong number; a WRITING script that
 * truncates mutates the wrong rows. Only the second is gated.
 *
 * BASELINED, like the design-token gate. 46 violations exist today across 33
 * one-shot backfills, most of them long since run. Blocking all of them would
 * make the gate the first thing someone disables. So the current set is recorded
 * as accepted and the gate blocks only a NEW violation — the next script, written
 * by the next engineer or the next agent, cannot reintroduce this silently.
 * Fixing the baseline down is a separate, unhurried job:
 *     node scripts/audit-unranged-selects.mjs --update-baseline
 *
 * Escape hatch, for a script that genuinely wants a bounded read:
 *     // unranged-ok: <reason>
 * on the select line or the line above it. The reason is required — an
 * unexplained suppression is how a gate rots.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DIR = 'scripts';
const BASELINE_FILE = 'tests/fixtures/unranged-select-baseline.json';
const WRITE_RE = /\.(insert|update|upsert|delete)\(/;
const WINDOW = 420;           // chars after the select to look for .range()/.limit()

function violationsIn(src) {
  const lines = src.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    if (!line.includes(".select('") && !line.includes('.select("')) return;
    if (line.includes('count:') || line.includes('head: true')) return;   // cannot truncate
    const prev = lines[i - 1] || '';
    if (/unranged-ok:\s*\S/.test(line) || /unranged-ok:\s*\S/.test(prev)) return;
    const idx = src.indexOf(line);
    const win = src.slice(idx, idx + WINDOW);
    if (/\.range\(|\.limit\(/.test(win)) return;
    out.push({ line: i + 1, text: line.trim().slice(0, 100) });
  });
  return out;
}

if (!existsSync(DIR)) {
  console.log('audit-unranged-selects: no scripts/ dir — nothing to check');
  process.exit(0);
}

const files = readdirSync(DIR).filter((f) => /\.(ts|mts|js|mjs)$/.test(f));
const offenders = [];
let scanned = 0;

for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8');
  if (!WRITE_RE.test(src)) continue;         // read-only script → out of scope
  scanned++;
  const bad = violationsIn(src);
  if (bad.length) offenders.push({ file: f, bad });
}

// Baseline: `${file}:${line}` keys accepted as pre-existing.
const baseline = existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).violations || [])
  : new Set();

const keys = offenders.flatMap((o) => o.bad.map((b) => `${o.file}:${b.line}`));

if (process.argv.includes('--update-baseline')) {
  mkdirSync(dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify({
    note: 'Pre-existing un-ranged list selects in WRITING scripts. The gate blocks only NEW ones. Shrink this list; never grow it.',
    updated: new Date().toISOString().slice(0, 10),
    violations: keys.sort(),
  }, null, 2) + '\n');
  console.log(`baseline updated — ${keys.length} accepted violation(s) recorded`);
  process.exit(0);
}

const fresh = offenders
  .map((o) => ({ ...o, bad: o.bad.filter((b) => !baseline.has(`${o.file}:${b.line}`)) }))
  .filter((o) => o.bad.length);

if (!fresh.length) {
  console.log(`\x1b[32m✓ no NEW un-ranged list selects (${scanned} writing scripts, ${baseline.size} baselined)\x1b[0m`);
  process.exit(0);
}

const total = fresh.reduce((a, o) => a + o.bad.length, 0);
console.error(`\x1b[31m✗ ${total} NEW un-ranged list select(s) in ${fresh.length} WRITING script(s)\x1b[0m`);
console.error('  PostgREST caps an unranged select at 1,000 rows SILENTLY — a script that');
console.error('  writes based on a truncated read mutates the wrong population.\n');
for (const o of fresh) {
  console.error(`  ${o.file}`);
  for (const b of o.bad) console.error(`      ${b.line}: ${b.text}`);
}
console.error('\n  Fix: add .range(from, to) and page, or .limit(n) for a deliberately bounded read.');
console.error('  Or annotate with  // unranged-ok: <reason>  if the bound is genuinely safe.');
process.exit(1);

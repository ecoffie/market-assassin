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
 * SCOPE:
 *   • only files under scripts/
 *   • only list selects (count:/head:true reads cannot truncate)
 *   • `.range(` or `.limit(` anywhere in the following window clears it
 *
 * ⚠️ WIDENED 2026-08-22 — read-only scripts USED to be out of scope. The original
 * reasoning: "a read-only script that truncates prints a wrong number; a WRITING
 * script that truncates mutates the wrong rows. Only the second is gated." That was
 * defensible until the numbers started driving decisions.
 *
 * What it cost, same day: an MCP-adoption query reported "24 accounts all-time, 0 new"
 * after the live session. Both figures were TRUNCATION ARTIFACTS — 1,779 rows exist, the
 * default select returned 1,000. The real answer was 59 accounts and 23 first-ever
 * connections, i.e. 70% growth in real users. The wrong number was reported with total
 * confidence and was only caught because "29 today vs 24 ever" is arithmetically
 * impossible. Eric, on the strategy that rests on these figures: "you cannot build the
 * growth dashboard if you don't trust its denominator."
 *
 * So both are gated now, tracked as SEPARATE finding kinds so the write-baseline stays
 * honest:
 *   WRITE — truncation mutates the wrong rows   (baselined at 46)
 *   READ  — truncation reports the wrong number (a fabricated denominator)
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
    // STRIP COMMENTS FIRST. The sibling gates document this trap: a fix (or another
    // gate) that QUOTES `.select('a, b')` while explaining the bug is not a violation,
    // and false positives are what make people reflexively --update-baseline, which is
    // how a ratchet stops meaning anything. Measured: this exact file was flagging
    // audit-supabase-errors.mjs for a sentence in its own header comment.
    const code = line.replace(/^\s*(\*|\/\/).*$/, '').split('//')[0];
    if (!code.includes(".select('") && !code.includes('.select("')) return;
    if (code.includes('count:') || code.includes('head: true')) return;   // cannot truncate
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
  const kind = WRITE_RE.test(src) ? 'WRITE' : 'READ';
  scanned++;
  const bad = violationsIn(src);
  if (bad.length) offenders.push({ file: f, bad, kind });
}

// Baseline: `${file}:${line}` keys accepted as pre-existing.
const baseline = existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).violations || [])
  : new Set();

const keys = offenders.flatMap((o) => o.bad.map((b) => `${o.file}:${b.line}`));

if (process.argv.includes('--update-baseline')) {
  mkdirSync(dirname(BASELINE_FILE), { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify({
    note: 'Pre-existing un-ranged list selects under scripts/ (WRITE = mutates the wrong rows; READ = reports a fabricated number). The gate blocks only NEW ones. Shrink this list; never grow it.',
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
  console.log(`\x1b[32m✓ no NEW un-ranged list selects (${scanned} scripts scanned, ${baseline.size} baselined)\x1b[0m`);
  process.exit(0);
}

const total = fresh.reduce((a, o) => a + o.bad.length, 0);
const kinds = [...new Set(fresh.map((o) => o.kind))].join('+');
console.error(`\x1b[31m✗ ${total} NEW un-ranged list select(s) in ${fresh.length} script(s) [${kinds}]\x1b[0m`);
console.error('  PostgREST caps an unranged select at 1,000 rows SILENTLY — a script that');
console.error('  WRITE: mutates the wrong population.  READ: reports a fabricated number\n  (measured 2026-08-22: "24 accounts, 0 new" when the truth was 59 and 23).\n');
for (const o of fresh) {
  console.error(`  ${o.file}`);
  for (const b of o.bad) console.error(`      ${b.line}: ${b.text}`);
}
console.error('\n  Fix: add .range(from, to) and page, or .limit(n) for a deliberately bounded read.');
console.error('  Or annotate with  // unranged-ok: <reason>  if the bound is genuinely safe.');
process.exit(1);

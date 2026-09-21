#!/usr/bin/env node
/**
 * PRE-PUSH GATE — INT-011: truncation BEFORE batching leaves a permanently unreachable segment.
 *
 * THE INCIDENT (2026-08-23). `cron/weekly-alerts` read its eligible audience unpaginated:
 *
 *     const { data: allUsers } = await supabase.from('user_notification_settings')
 *       .select('*').eq('is_active', true).eq('alerts_enabled', true);
 *     ...
 *     const usersToProcess = users.filter(...).slice(0, BATCH_SIZE);
 *
 * 2,028 users matched; PostgREST returned 1,000. The other ~1,028 were dropped BEFORE the
 * dedup+batch step, so the batch cursor never saw them and they were **never queued on any
 * cycle** — not delayed, never sent.
 *
 * WHY THIS IS ITS OWN CLASS, not just INT-001: ordinary truncation is self-correcting once you
 * run again. This is not. The cursor advances through a list the tail never entered, so more
 * runs never help. Same shape found in send-alert-invite, grant-briefings-all and
 * align-treatment-types (~1,185 and ~786 users permanently ungrantable).
 *
 * THE RULE. A finding needs ALL of:
 *   1. an UNBOUNDED list read (no .range/.limit/.single, and not a head-count)
 *   2. bound to an AUDIENCE-shaped variable (users / recipients / members / audience / …)
 *   3. a downstream BATCH/CURSOR step — .slice(0, N) / BATCH_SIZE / batch/chunk/cursor
 *
 * That third condition is what separates this from a plain unpaginated read: the batching is
 * the proof that the author intended to process the list ACROSS RUNS.
 *
 * APPROVED FIXES: page the audience read (fetchAllPaged) so the cursor sees everyone, or move
 * the bound INTO the query (.range on a stable .order) so the cursor IS the pagination.
 *
 *   node scripts/audit-audience-reachability.mjs [--list|--update-baseline]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN = [join(ROOT, 'src/app/api'), join(ROOT, 'scripts')];
const BASELINE_FILE = join(ROOT, 'tests/fixtures/audience-reachability-baseline.json');

const WINDOW = 2600;                    // batching often sits well below the read
const AUDIENCE = /\b(users|recipients|members|audience|subscribers|profiles|alertSettings|allUsers|eligible)\b/i;
const BOUNDED = /\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|count:\s*['"]exact['"]|head:\s*true/;
const PAGED = /fetchAllPaged|fetchAllByKeys|readAllRows/;
const BATCHED = /\.slice\(\s*0\s*,|BATCH_SIZE|batchSize|\bchunk\b|cursor/i;
const SAFE = /truncation-ok:|reachability-ok:/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(full);
  }
  return out;
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^([^\n]*?)\/\/.*$/gm, '$1');

function violationsIn(src) {
  const clean = stripComments(src);
  const lines = clean.split('\n');
  const raw = src.split('\n');
  const out = [];

  lines.forEach((line, i) => {
    if (!/\.select\s*\(/.test(line)) return;
    // The bound variable (or the two lines above) must look like an audience.
    const decl = [lines[i - 2], lines[i - 1], line].join('\n');
    if (!AUDIENCE.test(decl)) return;

    const start = clean.indexOf(line);
    const window = clean.slice(start, start + WINDOW);
    const stmtEnd = window.search(/;\s*\n/);
    const stmt = stmtEnd > 0 ? window.slice(0, stmtEnd) : window;

    // Already bounded IN the query, or paged by a helper → the cursor sees everyone.
    if (BOUNDED.test(stmt)) return;
    const above = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
    if (PAGED.test(above) || PAGED.test(stmt)) return;

    const around = [raw[i - 2], raw[i - 1], raw[i]].join('\n');
    if (SAFE.test(around)) return;

    // The tell: a batch/cursor step downstream means this list is processed ACROSS RUNS.
    const after = window.slice(stmtEnd > 0 ? stmtEnd : 0);
    if (!BATCHED.test(after)) return;

    out.push({ line: i + 1, snippet: line.trim().slice(0, 96) });
  });
  return out;
}

const files = SCAN.flatMap((d) => walk(d));
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
    note: 'INT-011: audience read unbounded, then batched — the tail past the cap never reaches the cursor. Shrink this list; never grow it.',
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
  console.log(`\n  ${keys.length} finding(s) across ${offenders.length} file(s), ${files.length} scanned`);
  process.exit(0);
}
const fresh = offenders
  .map((o) => ({ ...o, bad: o.bad.filter((b) => !baseline.has(`${o.file}:${b.line}`)) }))
  .filter((o) => o.bad.length);

if (!fresh.length) {
  console.log(`\x1b[32m✓ INT-011: no NEW unreachable-audience reads (${files.length} files, ${baseline.size} baselined)\x1b[0m`);
  process.exit(0);
}
const total = fresh.reduce((s, o) => s + o.bad.length, 0);
console.error(`\x1b[31m✗ INT-011: ${total} audience read(s) truncated BEFORE batching\x1b[0m`);
console.error('  The rows past the 1,000-row cap never reach the batch cursor, so they are');
console.error('  PERMANENTLY unreachable — unlike ordinary truncation, re-running does not help.\n');
for (const o of fresh) {
  console.error(`  ${o.file}`);
  for (const b of o.bad) console.error(`      ${b.line}: ${b.snippet}`);
}
console.error('\n  Fix: page the audience read (fetchAllPaged) so the cursor sees everyone,');
console.error('  or move the bound INTO the query (.range over a stable .order).');
process.exit(1);

#!/usr/bin/env node
/**
 * audit-supabase-errors — catches the SWALLOWED-ERROR bug class at its SOURCE.
 *
 * The bug: a Supabase query destructures `{ data }` (or `{ data: alias }`) and
 * IGNORES `error`. PostgREST returns `{ data: null, error }` (it does NOT throw)
 * when a `.select('col_a, col_b')` names a column that doesn't exist, or the table
 * is missing → the WHOLE query nulls → code treats it as "no rows" and silently
 * degrades (generic defaults, empty personalization). This exact class caused
 * loadBidderProfile returning {} for every user + the whole user_briefing_profile
 * dead-table cascade (tasks/smart-profile-dead-table-findings.md).
 *
 * A finding = ALL of:
 *   1. destructures `{ data }` / `{ data: X }` WITHOUT also binding `error`, AND
 *   2. the SAME statement has a hardcoded multi-column `.select('a, b, ...')`
 *      (>=2 columns; NOT `.select('*')`, NOT a single column) — the shape that
 *      silently breaks when one column drifts, AND
 *   3. is on a user-facing read path (src/app/api/app, src/lib/briefings,
 *      src/lib/proposal, src/lib/smart-profile, src/lib/rag, or a non-admin
 *      /api route). Admin/cron/scripts are excluded — they degrade loudly enough
 *      and aren't user-visible.
 *
 * Baseline: the 15 pre-existing sites the hunt found are recorded as "known" so
 * they don't block a push; only NEW ones fail the gate. Fix a known one → it drops
 * out; add a new bad pattern → gate blocks. Drive the baseline toward zero.
 *
 * Exit codes:
 *   0 = no NEW findings (baseline-known allowed)
 *   1 = a new swallowed-error site → BLOCKS the push
 *
 * Run:  node scripts/audit-supabase-errors.mjs            (gate mode)
 *       node scripts/audit-supabase-errors.mjs --list      (print every finding)
 *       node scripts/audit-supabase-errors.mjs --update-baseline  (accept current set)
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const SCAN_ROOTS = ['src'];
const BASELINE_FILE = 'tests/fixtures/supabase-errors-baseline.json';

// A path is user-facing if it's under one of these AND is not admin/cron/script.
const USER_FACING = [
  'src/app/api/app/',
  'src/app/api/', // non-admin api routes (admin filtered below)
  'src/lib/briefings/',
  'src/lib/proposal/',
  'src/lib/smart-profile/',
  'src/lib/rag/',
];
const EXCLUDE = /\/(admin|cron)\/|\.test\.|\.spec\.|scripts\//;

function isUserFacing(p) {
  const norm = p.replace(/\\/g, '/');
  if (EXCLUDE.test(norm)) return false;
  return USER_FACING.some((r) => norm.includes(r));
}

function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

// Extract the column list from a .select('...') on/near a line. Returns the number
// of comma-separated columns, or -1 if it's `*` / dynamic / not a plain string.
function selectColumnCount(block) {
  const m = block.match(/\.select\(\s*[`'"]([^`'"]+)[`'"]/);
  if (!m) return 0;
  const cols = m[1];
  if (cols.includes('*')) return -1; // star select never drifts on a bad column
  // count top-level comma-separated columns (ignore nested parens like count(*))
  const parts = cols.split(',').map((c) => c.trim()).filter(Boolean);
  return parts.length;
}

const findings = [];

for (const root of SCAN_ROOTS) {
  for (const p of walk(root, (f) => /\.(ts|tsx)$/.test(f))) {
    if (!isUserFacing(p)) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // (1) a data-only destructure (no `error` on the same destructure line)
      const isDataOnly = /const\s*\{\s*data(\s*:\s*[a-zA-Z0-9_]+)?\s*\}\s*=\s*await/.test(line);
      if (!isDataOnly) continue;
      if (/\berror\b/.test(line)) continue; // already binds error
      // (2) look at the statement block (this line + next ~8) for a hardcoded
      // multi-column select. Supabase calls chain across lines.
      const block = lines.slice(Math.max(0, i - 1), i + 9).join('\n');
      if (!/\.from\(/.test(block) && !/supabase|getSupabase|sb\./.test(block)) continue;
      const nCols = selectColumnCount(block);
      if (nCols >= 2) {
        // capture the table name for the report if present
        const t = block.match(/\.from\(\s*[`'"]([a-zA-Z0-9_]+)[`'"]/);
        findings.push(`${p}:${i + 1}${t ? ` (${t[1]})` : ''}`);
      }
    }
  }
}

const args = process.argv.slice(2);
const baseline = existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).allowed || [])
  : new Set();

if (args.includes('--update-baseline')) {
  writeFileSync(BASELINE_FILE, JSON.stringify({ allowed: findings.sort() }, null, 2) + '\n');
  console.log(`[supabase-errors] baseline updated: ${findings.length} known finding(s) recorded.`);
  process.exit(0);
}

const newViolations = findings.filter((f) => !baseline.has(f));

if (args.includes('--list')) {
  console.log(`[supabase-errors] ${findings.length} total finding(s):`);
  findings.forEach((f) => console.log('  ' + (baseline.has(f) ? '(known) ' : 'NEW ') + f));
}

if (newViolations.length === 0) {
  console.log(`[supabase-errors] OK — no new swallowed-error reads (${findings.length} baseline-known).`);
  process.exit(0);
}

console.error(`\n[supabase-errors] ✗ ${newViolations.length} NEW swallowed-error read(s) — a hardcoded multi-column .select() whose { error } is ignored:\n`);
newViolations.forEach((f) => console.error('  ' + f));
console.error(`\nWhy it matters: a bad/renamed column makes PostgREST fail the WHOLE query → data=null → silent generic/empty result for the user.`);
console.error(`Fix: destructure { data, error } and surface the error (console.error / return 500). See tasks/smart-profile-dead-table-findings.md.`);
console.error(`(If intentional, run: node scripts/audit-supabase-errors.mjs --update-baseline)\n`);
process.exit(1);

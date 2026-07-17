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
 * TWO rules, two different bugs:
 *
 * RULE A — swallowed-error read. ALL of:
 *   1. destructures `{ data }` / `{ data: X }` WITHOUT also binding `error`, AND
 *   2. the SAME statement has a hardcoded multi-column `.select('a, b, ...')`
 *      (>=2 columns; NOT `.select('*')`, NOT a single column) — the shape that
 *      silently breaks when one column drifts.
 *
 * RULE B — a null count coalesced to zero (`count ?? 0`) with no `error` bound.
 *   A table that does NOT exist returns count=null, error=null, HTTP 204 — no error
 *   at all. `?? 0` turns "I don't know" into "zero" and destroys the only signal
 *   separating missing from empty. Rule A is blind to this: a count query has no
 *   multi-column select, and the error can be bound correctly 150 lines earlier and
 *   still not consulted at the coalesce. Comment lines are skipped — several fixes
 *   now quote the pattern while explaining it.
 *
 * Scope: src/ + scripts/, minus tests. Admin/cron/scripts are INCLUDED — they were
 * excluded until 2026-07-16 on the theory that they "degrade loudly enough and
 * aren't user-visible". That was backwards, and it is why every scar came from
 * there: nobody reads a cron's stdout, so a silent read is worse, not better.
 * scripts/reset-mindy-user-activity.ts reported a clean "0 rows" for five tables
 * that never existed, for months (#307); cron/snapshot-metrics recorded a
 * fabricated 0 for NINE DAYS (190 emails erased).
 *
 * Baseline: pre-existing sites are recorded as "known" so they don't block a push;
 * only NEW ones fail the gate. Fix a known one → it drops out; add a new bad pattern
 * → gate blocks. Drive the baseline toward zero. NOTE: the baseline keys on
 * `path:line`, so an edit that shifts lines in a known file surfaces a false NEW
 * finding — re-baseline deliberately, never reflexively.
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

// `scripts` added 2026-07-16: this audit was blind to admin/, cron/ AND scripts/ —
// which is precisely where the unattended, destructive code lives, and precisely
// where every scar came from:
//   - scripts/reset-mindy-user-activity.ts deleted nothing for 5 phantom tables and
//     reported a clean "0 rows" for months (#307).
//   - src/app/api/cron/snapshot-metrics recorded a fabricated 0 for NINE DAYS
//     (07-07 → 07-15, 190 emails erased) — a swallowed 400 + `count ?? 0`.
// Nobody watches a cron's stdout, so a silent read there is worse than one on a page
// a user would complain about. scripts/ was blind TWICE over: the EXCLUDE below AND
// SCAN_ROOTS, which never walked the directory at all — so dropping the EXCLUDE alone
// would have changed nothing.
const SCAN_ROOTS = ['src', 'scripts'];
const BASELINE_FILE = 'tests/fixtures/supabase-errors-baseline.json';

// Paths worth auditing. NOT "user-facing" any more — a cron has no user and that is
// the reason to audit it, not a reason to skip it.
const AUDITED_PATHS = [
  'src/app/api/',
  'src/lib/briefings/',
  'src/lib/proposal/',
  'src/lib/smart-profile/',
  'src/lib/rag/',
  'scripts/',
];
// Tests only. Do NOT re-add admin|cron|scripts — the baseline ratchet below is what
// keeps this honest: existing debt is accepted, anything NEW blocks.
const EXCLUDE = /\.test\.|\.spec\./;

function isAudited(p) {
  const norm = p.replace(/\\/g, '/');
  if (EXCLUDE.test(norm)) return false;
  return AUDITED_PATHS.some((r) => norm.includes(r));
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
  // `.mjs` added 2026-07-17 — the third blind spot. #311 widened the DIRECTORIES
  // (admin/, cron/, scripts/) and #312 added the count-null rule, but this walk
  // still matched only .ts/.tsx — so every scripts/*.mjs stayed invisible to BOTH
  // rules regardless. Same lesson #311 wrote down ("blind TWICE over: the EXCLUDE
  // AND SCAN_ROOTS"), true once more: widening one axis proves nothing about the
  // others. Verify the gate SEES a file before trusting that it passed.
  for (const p of walk(root, (f) => /\.(ts|tsx|mjs)$/.test(f))) {
    if (!isAudited(p)) continue;
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

    // ── RULE B: a null count coalesced to zero (`count ?? 0`) ────────────────
    // Rule A cannot see this: a count query has no multi-column select, and the
    // error may be bound correctly 150 lines away and still not consulted here.
    //
    // A table that does NOT exist returns count=null, error=null, HTTP 204 — no
    // error at all. `?? 0` turns "I don't know" into "zero", and the zero is
    // usually load-bearing (`if (n === 0) continue` cancelled a delete in #307;
    // a swallowed 400 + `?? 0` recorded nine days of fake metrics in
    // snapshot-metrics). null is the ONLY signal separating missing from empty.
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      // Comments quote this pattern while EXPLAINING the bug (several fixes now
      // do). Flagging those is a false positive, and false positives are what
      // make people reflexively --update-baseline and erode the ratchet.
      const code = raw.replace(/\/\/.*$/, '');
      const t = code.trim();
      if (t.startsWith('*') || t.startsWith('/*')) continue;

      if (!/(^|[^.\w])count\s*(\?\?|\|\|)\s*0|\.\s*count\s*(\?\?|\|\|)\s*0/.test(code)) continue;

      // Where did this count come from? Skip only if `error` is genuinely BOUND from
      // the query — `{ count, error } = await …` or a `res.error` read.
      //
      // Matching the bare token /\berror\b/ is not good enough: it let
      // cron/pursuit-changes through, because an auth guard 5 lines up returns
      // `NextResponse.json({ error: 'Unauthorized' })`. An unrelated error KEY is not
      // error HANDLING — proximity to the word proves nothing, which is the same
      // mistake in miniature as the bug this rule exists to catch.
      const back = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      const bindsError = /\{[^}]*\berror\b[^}]*\}\s*=\s*await/.test(back) || /\b\w+\.error\b/.test(back);
      if (bindsError) continue;
      if (!/\.from\(|supabase|getSupabase|sb\./.test(back)) continue; // not a supabase count

      const tbl = back.match(/\.from\(\s*[`'"]([a-zA-Z0-9_]+)[`'"]/);
      findings.push(`${p}:${i + 1}${tbl ? ` (${tbl[1]})` : ''} [count-null]`);
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

// Two rules, two different fixes — say which one fired, or the message sends the
// reader to the wrong repair.
const newCountNull = newViolations.filter((f) => f.endsWith('[count-null]'));
const newSwallowed = newViolations.filter((f) => !f.endsWith('[count-null]'));

console.error(`\n[supabase-errors] ✗ ${newViolations.length} NEW finding(s):\n`);

if (newSwallowed.length) {
  console.error(`  ${newSwallowed.length} swallowed-error read(s) — a hardcoded multi-column .select() whose { error } is ignored:`);
  newSwallowed.forEach((f) => console.error('    ' + f));
  console.error(`\n  Why: a bad/renamed column makes PostgREST fail the WHOLE query → data=null → a silent generic/empty result for the user.`);
  console.error(`  Fix: destructure { data, error } and surface the error (console.error / return 500). See tasks/smart-profile-dead-table-findings.md.\n`);
}

if (newCountNull.length) {
  console.error(`  ${newCountNull.length} null count coalesced to zero (\`count ?? 0\`) with no { error } bound:`);
  newCountNull.forEach((f) => console.error('    ' + f));
  console.error(`\n  Why: a table that does not exist returns count=null, error=null, HTTP 204 — NO error.`);
  console.error(`  \`?? 0\` turns "I don't know" into "zero" and destroys the only signal separating missing from empty.`);
  console.error(`  It reads as defensive null-handling; it is data fabrication. #307: the fabricated 0 hit \`if (n === 0) continue\``);
  console.error(`  and cancelled the delete for five tables that never existed. cron/snapshot-metrics: nine days of fake metrics.`);
  console.error(`  Fix: bind { count, error }, surface the error, and return/render null as UNKNOWN — never 0.\n`);
}

console.error(`(If intentional, run: node scripts/audit-supabase-errors.mjs --update-baseline)\n`);
process.exit(1);

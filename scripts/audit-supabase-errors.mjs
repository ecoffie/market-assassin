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

/**
 * RULE 2 — SILENT ZERO.
 *
 * A `{ count }` bound from a Supabase call that does NOT bind `error`. The
 * `count ?? 0` that follows renders "the query failed / I don't know" as the
 * number 0 — a real figure, indistinguishable from a true zero.
 *
 * Same root as rule 1: a PostgREST failure rendered as a legitimate-looking
 * value. Deliberately reuses SCAN_ROOTS/isAudited above rather than defining a
 * second scope — the scope widened in #311 is exactly the right one here too,
 * and for the same reason: nobody watches a cron's stdout.
 *
 * Matches:   const { count } = await sb.from('t').select('*', { count: 'exact' })
 *            const { count: n } = await q
 *            .then(({ count }) => count ?? 0)
 * Ignores:   const { count, error } = ...     (error bound — the caller can check)
 *            row.foo_count ?? 0                (a column value, not a query count)
 *            const n = (count ?? 0) + 1        (usage site, not a destructure)
 */
function bindsCountWithoutError(line) {
  // A comment can't have a bug. Without this the audit flags its OWN examples
  // three lines up — they are, by design, exactly the shape it hunts for.
  const t = line.trim();
  if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return false;

  const destructure = /(?:const\s*)?\{\s*count(\s*:\s*[a-zA-Z0-9_]+)?\s*\}\s*(?:=\s*await|\)\s*=>)/.test(line);
  if (!destructure) return false;
  return !/\berror\b/.test(line);
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
const countFindings = [];

for (const root of SCAN_ROOTS) {
  for (const p of walk(root, (f) => /\.(ts|tsx|mjs)$/.test(f))) {
    if (!isAudited(p)) continue;
    const lines = readFileSync(p, 'utf8').split('\n');

    // --- RULE 2 pass: count bound without error ---
    for (let i = 0; i < lines.length; i++) {
      if (!bindsCountWithoutError(lines[i])) continue;
      // Confirm it's really a Supabase call, not some unrelated { count }.
      const block = lines.slice(Math.max(0, i - 6), i + 6).join('\n');
      if (!/\.from\(|supabase|getSupabase|\bsb\b|getCountClient/.test(block)) continue;
      const t = block.match(/\.from\(\s*[`'"]([a-zA-Z0-9_]+)[`'"]/);
      countFindings.push(`${p}:${i + 1}${t ? ` (${t[1]})` : ''}`);
    }

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
const baselineRaw = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const baseline = new Set(baselineRaw.allowed || []);
// Separate key so rule 1's existing entries keep matching untouched.
const countBaseline = new Set(baselineRaw.allowedSilentZero || []);

if (args.includes('--update-baseline')) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ allowed: findings.sort(), allowedSilentZero: countFindings.sort() }, null, 2) + '\n',
  );
  console.log(
    `[supabase-errors] baseline updated: ${findings.length} swallowed-error + ${countFindings.length} silent-zero known.`,
  );
  process.exit(0);
}

const newViolations = findings.filter((f) => !baseline.has(f));
const newCountViolations = countFindings.filter((f) => !countBaseline.has(f));

if (args.includes('--list')) {
  console.log(`[supabase-errors] ${findings.length} swallowed-error finding(s):`);
  findings.forEach((f) => console.log('  ' + (baseline.has(f) ? '(known) ' : 'NEW ') + f));
  console.log(`[supabase-errors] ${countFindings.length} silent-zero finding(s):`);
  countFindings.forEach((f) => console.log('  ' + (countBaseline.has(f) ? '(known) ' : 'NEW ') + f));
}

if (newViolations.length === 0 && newCountViolations.length === 0) {
  console.log(
    `[supabase-errors] OK — no new swallowed-error reads (${findings.length} known), ` +
      `no new silent-zero counts (${countFindings.length} known).`,
  );
  process.exit(0);
}

if (newViolations.length) {
  console.error(`\n[supabase-errors] ✗ ${newViolations.length} NEW swallowed-error read(s) — a hardcoded multi-column .select() whose { error } is ignored:\n`);
  newViolations.forEach((f) => console.error('  ' + f));
  console.error(`\nWhy it matters: a bad/renamed column makes PostgREST fail the WHOLE query → data=null → silent generic/empty result for the user.`);
  console.error(`Fix: destructure { data, error } and surface the error (console.error / return 500). See tasks/smart-profile-dead-table-findings.md.`);
}

if (newCountViolations.length) {
  console.error(`\n[supabase-errors] ✗ ${newCountViolations.length} NEW silent-zero count(s) — { count } bound without { error }:\n`);
  newCountViolations.forEach((f) => console.error('  ' + f));
  console.error(`\nWhy it matters: without \`error\`, a failed query returns count=null and the`);
  console.error(`\`count ?? 0\` that follows renders "I don't know" as the number 0 — a real`);
  console.error(`figure, indistinguishable from a true zero. It has already erased an admin`);
  console.error(`dashboard (all 8 tiles showed 0), reported 0 email sends, fabricated a 0 for`);
  console.error(`NINE DAYS in snapshot-metrics, and made a reset script skip 8 of 23 tables`);
  console.error(`while reporting success (#307, #308, #309).`);
  console.error(`Fix: destructure { count, error }, check error, and treat count===null as`);
  console.error(`UNKNOWN — never as 0. For head-count reads see getCountClient().`);
}

console.error(`\n(If intentional, run: node scripts/audit-supabase-errors.mjs --update-baseline)\n`);
process.exit(1);

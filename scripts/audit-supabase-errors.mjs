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
 * → gate blocks. Drive the baseline toward zero.
 *
 * FINDING IDENTITY (fixed 2026-09-21 — was the documented "known wart"). The baseline
 * used to key on `path:line`. A line number is a property of everything ABOVE a finding,
 * not of the finding, so inserting a line anywhere earlier renamed every finding below it
 * and the gate reported them all as NEW — while the code got no worse. That did not merely
 * annoy: a false NEW trains the operator to reach for `--update-baseline`, which accepts
 * EVERY current finding including a genuinely new one in the same push. Keys are now
 * content-addressed (`scripts/lib/finding-identity.mjs`): `file#rule(table):sha1-10[@n]`
 * over the rule's own normalized trigger statement. Move the line, reformat around it, edit
 * its neighbours — same finding. Change the trigger — a different finding.
 *
 * Exit codes:
 *   0 = no NEW findings (baseline-known allowed)
 *   1 = a new swallowed-error site → BLOCKS the push
 *   1 = the baseline still holds legacy `path:line` keys → run --migrate-baseline
 *
 * Run:  node scripts/audit-supabase-errors.mjs            (gate mode)
 *       node scripts/audit-supabase-errors.mjs --list      (finding + its key, and what is stale)
 *       node scripts/audit-supabase-errors.mjs --migrate-baseline [--prune-stale]
 *       node scripts/audit-supabase-errors.mjs --prune-baseline   (TIGHTEN: drop gone findings)
 *       node scripts/audit-supabase-errors.mjs --update-baseline  (accept current set)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import {
  assignFindingKeys,
  partitionFindings,
  readBaseline,
  writeBaseline,
  isLegacyBaselineKey,
  planMigration,
} from './lib/finding-identity.mjs';

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
const BASELINE_NOTE =
  'Swallowed-error + count-null findings accepted as pre-existing debt. Keys are CONTENT-ADDRESSED '
  + '(see keyFormat) so line movement cannot manufacture a false NEW finding. Shrink this list; never grow it.';

// Paths worth auditing. NOT "user-facing" any more — a cron has no user and that is
// the reason to audit it, not a reason to skip it.
// ALL of src/, not a hand-picked subset.
//
// This list used to name 4 of the 73 directories under src/lib, which meant the gate printed
// "OK — no new swallowed-error reads" while it could not see src/lib/bigquery (whose
// queryCached returns [] on a QueryUsagePerDay quota failure and fed a "Rule of Two NOT met"
// determination), src/lib/seo, src/lib/gov-buyer, or src/lib/send-email (whose suppression
// lookup failed OPEN and mailed unsubscribed recipients).
//
// A gate whose green light means "the four places I happen to look are clean" is worse than
// no gate: it is a false all-clear. Widened 2026-08-23; the baseline ratchet below is what
// keeps it usable — existing debt is accepted once, anything NEW blocks.
// How far back to look for the query this count came from. Generous on purpose: a false
// POSITIVE costs one baseline entry, a false negative ships a fabricated zero.
const LOOKBACK = 30;

const AUDITED_PATHS = ['src/', 'scripts/'];
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

/**
 * Where does the FUNCTION containing line `i` begin?
 *
 * Rule B suppresses a finding when the error was handled — but "handled" has a semantic
 * boundary, and the rule used to approximate it with a flat 30-line budget. That let a
 * legitimate fix in one function silence an unrelated unsafe count in the NEXT function
 * (measured in src/lib/seo/facets.ts). Handling never crosses a function boundary, so the
 * suppression window must not either.
 *
 * Walks up from `i` tracking brace depth: going backwards a `}` means we are entering a
 * nested block and a `{` means we are leaving one, so depth < 0 marks the line that OPENS
 * the block we are in. If that opener looks like a function/method/arrow, that is our
 * boundary. Otherwise it is an ordinary `if`/`try`/loop block, so we step out and keep
 * climbing — the enclosing FUNCTION is what matters, not the innermost brace.
 *
 * Deliberately a brace walk, not a parser: same tool choice as the detectors themselves.
 * Failure mode is to return a WIDER window (file top), which can only suppress as much as
 * the old behaviour — never less. Braces inside strings/regexes can skew the count, which
 * is why MAX_CLIMB bounds the walk instead of letting it run away.
 */
const MAX_CLIMB = 400;

/**
 * Control-flow keywords that LOOK exactly like a method signature to a regex:
 * `if (deleteError) {` has the same shape as `handler(req) {`.
 *
 * Getting this wrong is not cosmetic — it was wrong in the first draft of this fix and the
 * proof caught it. Treating `if (…) {` as a function boundary cut the window down to a single
 * `else` branch and manufactured a FALSE POSITIVE on admin/send-all-now, code that consults
 * `deleteError` and only then reads `count || 0` inside the else. A gate that flags correct
 * error handling is precisely what trains people to re-baseline reflexively.
 */
const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'with',
  'return', 'typeof', 'await', 'new', 'try', 'finally',
]);
const METHOD_SHAPE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]*)?\{\s*$/;

function isFunctionOpener(line) {
  if (/\bfunction\b|=>|\bconstructor\b/.test(line)) return true;
  const m = line.match(METHOD_SHAPE);
  return !!m && !CONTROL_KEYWORDS.has(m[1]);
}

function enclosingScopeStart(lines, i) {
  let depth = 0;
  const floor = Math.max(0, i - MAX_CLIMB);
  for (let k = i - 1; k >= floor; k--) {
    const l = lines[k].replace(/\/\/[^\n]*$/, '');
    const opens = (l.match(/\{/g) || []).length;
    const closes = (l.match(/\}/g) || []).length;
    depth += closes - opens;
    if (depth < 0) {
      // `k` opens the block we sit in. A function boundary stops the walk.
      if (isFunctionOpener(l)) return k;
      depth = 0; // ordinary block — step out and keep climbing
    }
  }
  return floor;
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
        findings.push({
          file: p,
          line: i + 1,
          rule: 'swallowed-select',
          tag: t ? t[1] : '',
          // Evidence = the destructure statement itself, which is what the rule asserts
          // about. NOT the 10-line block: an unrelated `.eq()` added inside the block
          // must not rename the finding, or content addressing reinvents line drift.
          evidence: line,
        });
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
      // 8 lines was too short. When a query is built into a variable and awaited later --
      // `let q = db.from(...); ... ; const { count } = await q;` -- the .from() and the
      // binding fall outside the window, so the rule skipped it entirely. Measured
      // 2026-08-23: all five counts in briefings/profile-stats returned flagged=false for
      // exactly this reason, and every one of them rendered "0 opportunities match your
      // profile" on a query failure.
      const back = lines.slice(Math.max(0, i - LOOKBACK), i + 1).join('\n');

      // ⚠️ TWO WINDOWS, ON PURPOSE — they answer two different questions.
      //
      // `back` (raw LOOKBACK lines, above) answers "is this even a Supabase count?" Being
      // generous there can only make the gate flag MORE, so a line budget is fine.
      //
      // `scope` answers "was the error HANDLED for this operation?" — and a line budget is
      // exactly wrong for that, because handling has a SEMANTIC boundary. A valid fix in one
      // function was silencing an unrelated unsafe count in the NEXT function whenever the two
      // sat within 30 lines. Measured live in src/lib/seo/facets.ts: binding + consulting the
      // error in `getPscOpps` made the independent `count || 0` in `getSetAsideNaicsOpps`
      // disappear from the gate — a false NEGATIVE inside the gate built to stop exactly this
      // class of silent zero. Suppression must never cross a function boundary.
      //
      // The window is the INTERSECTION of the line budget and the function boundary, never
      // the union. Taking the function alone would WIDEN it inside a long function and start
      // hiding findings that are flagged today — measured while writing this: a bare function
      // scope made 4 real findings (podcast-highlights ×2, forecasts ×2) vanish. A strict
      // subset of the old window can only reveal findings, never conceal one, which is the
      // property a gate fix has to have.
      const scope = lines
        .slice(Math.max(enclosingScopeStart(lines, i), i - LOOKBACK, 0), i + 1)
        .join('\n');
      const bindsError = /\{[^}]*\berror\b[^}]*\}\s*=\s*await/.test(scope) || /\b\w+\.error\b/.test(scope);

      // BINDING THE ERROR IS NOT THE SAME AS HANDLING IT.
      //
      // This rule used to `continue` on any binding, which exempted the worst shape by
      // construction: destructure { count, error }, ignore the error, and coalesce to 0
      // anyway. That is strictly more dangerous than the unbound version, because the code
      // LOOKS careful — a reviewer sees `error` in the destructure and moves on.
      //
      // So a binding only earns the skip if the error is actually CONSULTED nearby: tested,
      // thrown, logged, returned, or assigned to something. A bare mention does not count.
      const errName = (scope.match(/\{[^}]*\berror\s*:\s*(\w+)/) || [])[1];
      const consulted = new RegExp(
        `(if\\s*\\(\\s*!?\\s*(${errName || 'error'})\\b)`          // if (error) / if (!error)
        + `|((${errName || 'error'})\\s*(\\?\\.|&&|\\|\\||\\?))`  // error?. / error && / error ||
        + `|(throw\\b[^\\n]*\\b(${errName || 'error'})\\b)`           // throw ... error
        + `|(console\\.(error|warn)\\([^\\n]*\\b(${errName || 'error'})\\b)`
        + `|(return[^\\n]*\\b(${errName || 'error'})\\b)`
        + `|(\\b\\w+\\s*=\\s*(${errName || 'error'})\\b)`,          // degraded = error
      ).test(scope);
      if (bindsError && consulted) continue;
      // Is this actually a Supabase count? `sb.` alone is too loose now that the audit covers
      // all of src/ -- it matches CSS class names in browser JS (`sb.inner` in the map's inline
      // script produced a false positive on a `p.count||0` reading an API response). Require a
      // real client call shape.
      if (!/\.from\(|supabase|getSupabase|\bsb\(\)|\bsb\.from\b/.test(back)) continue;

      const tbl = back.match(/\.from\(\s*[`'"]([a-zA-Z0-9_]+)[`'"]/);
      findings.push({
        file: p,
        line: i + 1,
        rule: 'count-null',
        tag: tbl ? tbl[1] : '',
        evidence: code,
      });
    }
  }
}

const args = process.argv.slice(2);
const keyed = assignFindingKeys(findings);
const label = (f) => `${f.file}:${f.line}${f.tag ? ` (${f.tag})` : ''}${f.rule === 'count-null' ? ' [count-null]' : ''}`;
const byKey = new Map(keyed.map((f) => [f.key, f]));
const { keys: baselineKeys } = readBaseline(BASELINE_FILE, 'allowed');
const legacyCount = baselineKeys.filter(isLegacyBaselineKey).length;

// ── migrate: path:line → content-addressed, proving nothing is silently dropped ──
if (args.includes('--migrate-baseline')) {
  if (!legacyCount) {
    console.log('[supabase-errors] baseline is already content-addressed — nothing to migrate.');
    process.exit(0);
  }
  const plan = planMigration(keyed, baselineKeys);
  console.log(`[supabase-errors] migration plan`);
  console.log(`  current findings          : ${plan.findings}`);
  console.log(`  legacy baseline entries   : ${plan.legacyEntries}`);
  console.log(`  carried (stay accepted)   : ${plan.carried.length}`);
  console.log(`  findings NOT in baseline  : ${plan.unmatchedFindings.length}`);
  console.log(`  matched after a line shift: ${plan.shifted.length}`);
  plan.shifted.forEach((s) => console.log(`      ${s.from}  →  ${s.to}  (same file, 1:1, line moved)`));
  console.log(`  stale legacy entries      : ${plan.staleLegacy.length}`);
  if (plan.unmatchedFindings.length) {
    console.error(`\n✗ REFUSING: ${plan.unmatchedFindings.length} current finding(s) are not in the legacy baseline.`);
    console.error(`  A migration must preserve acceptance EXACTLY — it is not a re-baseline. Fix or accept these first:`);
    plan.unmatchedFindings.forEach((f) => console.error('    ' + label(f)));
    process.exit(1);
  }
  if (plan.staleLegacy.length && !args.includes('--prune-stale')) {
    console.error(`\n✗ REFUSING: ${plan.staleLegacy.length} legacy entr(ies) match NO current finding.`);
    console.error(`  They are gone from the code — dropping them TIGHTENS the ratchet, which is a deliberate act:`);
    plan.staleLegacy.forEach((k) => console.error('    ' + k));
    console.error(`\n  Re-run with --prune-stale to drop exactly these and keep the ${plan.carried.length} live ones.`);
    process.exit(1);
  }
  writeBaseline(BASELINE_FILE, 'allowed', plan.carried.map((f) => f.key), { note: BASELINE_NOTE });
  console.log(`\n✓ migrated: ${plan.carried.length} finding(s) now keyed by content`
    + (plan.staleLegacy.length ? `; ${plan.staleLegacy.length} stale legacy entr(ies) pruned` : ''));
  process.exit(0);
}

if (args.includes('--update-baseline')) {
  writeBaseline(BASELINE_FILE, 'allowed', keyed.map((f) => f.key), { note: BASELINE_NOTE });
  console.log(`[supabase-errors] baseline updated: ${keyed.length} known finding(s) recorded.`);
  process.exit(0);
}

const { fresh, stale } = partitionFindings(keyed, baselineKeys);

// --list is read-only and is exactly what you want while a baseline is still legacy,
// so it runs BEFORE the legacy refusal.
if (args.includes('--list')) {
  console.log(`[supabase-errors] ${keyed.length} total finding(s):`);
  keyed.forEach((f) => console.log(
    '  ' + (baselineKeys.includes(f.key) ? '(known) ' : legacyCount ? '(legacy baseline) ' : 'NEW ') + label(f) + '  ' + f.key,
  ));
  if (stale.length && !legacyCount) {
    console.log(`\n  ${stale.length} baseline entr(ies) match no finding — the baseline can TIGHTEN:`);
    stale.forEach((k) => console.log('    (gone) ' + k));
  }
  process.exit(0);
}

// A legacy baseline is itself a defect: those keys move whenever a line above them moves,
// which manufactures a false NEW finding and trains the reflex to --update-baseline (which
// accepts EVERYTHING, new bugs included). Fail loudly rather than pretend to ratchet.
if (legacyCount) {
  console.error(`\n[supabase-errors] ✗ baseline holds ${legacyCount} legacy \`path:line\` entr(ies).`);
  console.error(`  A line number is a property of everything ABOVE a finding, not of the finding.`);
  console.error(`  Run: node scripts/audit-supabase-errors.mjs --migrate-baseline\n`);
  process.exit(1);
}

// A stale entry is the third state content addressing makes visible: the finding is GONE.
// Reported, never auto-applied and never blocking — shrinking the accepted set is deliberate.
function reportStale() {
  if (!stale.length) return;
  console.log(`\n[supabase-errors] ℹ ${stale.length} baseline entr(ies) no longer match any finding — fixed or removed.`);
  stale.forEach((k) => console.log('    (gone) ' + k));
  console.log(`  The baseline can TIGHTEN from ${baselineKeys.length} to ${baselineKeys.length - stale.length}:`);
  console.log(`  node scripts/audit-supabase-errors.mjs --prune-baseline\n`);
}

if (args.includes('--prune-baseline')) {
  if (!stale.length) {
    console.log('[supabase-errors] nothing to prune — every baseline entry still matches a finding.');
    process.exit(0);
  }
  if (fresh.length) {
    console.error(`[supabase-errors] ✗ refusing to prune while ${fresh.length} NEW finding(s) are unresolved — fix those first.`);
    process.exit(1);
  }
  writeBaseline(BASELINE_FILE, 'allowed', baselineKeys.filter((k) => byKey.has(k)), { note: BASELINE_NOTE });
  console.log(`[supabase-errors] pruned ${stale.length} stale entr(ies): ${baselineKeys.length} → ${baselineKeys.length - stale.length}.`);
  process.exit(0);
}

if (fresh.length === 0) {
  console.log(`[supabase-errors] OK — no new swallowed-error reads (${keyed.length} baseline-known).`);
  reportStale();
  process.exit(0);
}

// Two rules, two different fixes — say which one fired, or the message sends the
// reader to the wrong repair.
const newCountNull = fresh.filter((f) => f.rule === 'count-null');
const newSwallowed = fresh.filter((f) => f.rule !== 'count-null');

console.error(`\n[supabase-errors] ✗ ${fresh.length} NEW finding(s):\n`);

if (newSwallowed.length) {
  console.error(`  ${newSwallowed.length} swallowed-error read(s) — a hardcoded multi-column .select() whose { error } is ignored:`);
  newSwallowed.forEach((f) => console.error('    ' + label(f)));
  console.error(`\n  Why: a bad/renamed column makes PostgREST fail the WHOLE query → data=null → a silent generic/empty result for the user.`);
  console.error(`  Fix: destructure { data, error } and surface the error (console.error / return 500). See tasks/smart-profile-dead-table-findings.md.\n`);
}

if (newCountNull.length) {
  console.error(`  ${newCountNull.length} null count coalesced to zero (\`count ?? 0\`) with no { error } bound:`);
  newCountNull.forEach((f) => console.error('    ' + label(f)));
  console.error(`\n  Why: a table that does not exist returns count=null, error=null, HTTP 204 — NO error.`);
  console.error(`  \`?? 0\` turns "I don't know" into "zero" and destroys the only signal separating missing from empty.`);
  console.error(`  It reads as defensive null-handling; it is data fabrication. #307: the fabricated 0 hit \`if (n === 0) continue\``);
  console.error(`  and cancelled the delete for five tables that never existed. cron/snapshot-metrics: nine days of fake metrics.`);
  console.error(`  Fix: bind { count, error }, surface the error, and return/render null as UNKNOWN — never 0.\n`);
}

if (stale.length) {
  console.error(`  (Separately: ${stale.length} baseline entr(ies) now match nothing — see --prune-baseline. That is NOT what blocked this push.)\n`);
}

console.error(`(If intentional, run: node scripts/audit-supabase-errors.mjs --update-baseline)\n`);
process.exit(1);

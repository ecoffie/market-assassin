#!/usr/bin/env node
/**
 * audit-rank-then-filter — catches the "RANK GLOBALLY, then FILTER to a user's
 * scope" bug class at its SOURCE. (Memory: rank_then_filter_starves_local.)
 *
 * The bug: a query RANKS by dollars (`sortBy: 'total_obligated'` / an award/recipient
 * fetch ordered by amount) with a `limit`, and its result is shown on a SCOPED view
 * (a map viewport / a state / a NAICS / an agency segment) — but the scope filter is
 * applied AFTER the rank+limit instead of INSIDE the same fetch. So the top-N globally
 * is all national whales (MIT / Raytheon / L3Harris) and the actual local/segment firms
 * never survive the limit to reach the post-filter. Root cause, one line:
 *
 *     THE SCOPE FILTER MUST COME BEFORE THE LIMIT, NEVER AFTER.
 *
 * This exact class hit the Opportunity Map THREE times — companies map, value-range,
 * and initial zoom — each a `searchRecipients({ sortBy:'total_obligated', limit:N })`
 * that ranked over the whole 317K-row corpus and only then narrowed to the viewport,
 * so a state with no top-100-national firm rendered an empty map. #457 fixed the
 * companies map by threading `state` INTO the `searchRecipients` call (before the
 * limit). This gate stops the next `companiesPins`-style regression from shipping.
 *
 * THE DETECTION RULE (conservative by design — a false positive erodes the ratchet,
 * which is the #1 failure mode of these gates). This is a tuned line-scan over the
 * known ranked-fetch HELPERS, not a full SQL/AST parser — the same tool choice the
 * sibling audits made. The helpers encapsulate the ranked fetch and take flat scope
 * params, so a call site is reliably classifiable; a raw `spending_by_award` fetch
 * hides its scope inside a POST body and is NOT reliably classifiable, so it is out
 * of scope on purpose (the companiesPins class always goes through a helper).
 *
 * A call is FLAGGED when ALL of:
 *   1. It calls a RANKED-FETCH HELPER — searchRecipients / findCapableSmallBusinesses /
 *      searchAwardsByLocation (RANKED_HELPERS below).
 *   2. It is RANKED BY DOLLARS + LIMITED — the call passes `sortBy: 'total_obligated'`
 *      (or the award helper, which always orders by amount desc) AND a `limit`. A call
 *      with no dollar ranking, or with an explicit `sortBy: 'recipient_name'`, is a
 *      deterministic/name lookup, not a "top-N by money" — not this bug.
 *   3. It passes NO SCOPE FILTER in the SAME call — none of state / naics / psc / agency
 *      / recipient / bbox. Ranking over the whole corpus is the "rank globally" half.
 *   4. The surrounding code SCOPES the result afterward (the "then filter" tell) —
 *      the function body / nearby lines contain bbox / inBbox / viewport / Pins /
 *      `.filter(` / a `state`/`naics` narrowing. Without this signal a global ranking
 *      is legitimate (a genuine national "top contractors" listicle), so we do NOT flag.
 *
 * Baseline ratchet: pre-existing findings are recorded in
 * tests/fixtures/rank-then-filter-baseline.json so they block nothing today — only a NEW
 * finding fails the push. `--list` prints every finding; `--update-baseline` accepts the
 * current set. Drive it toward zero.
 *
 * FINDING IDENTITY (fixed 2026-09-21). This gate keyed on `path:line` PLUS an 80-char
 * snippet, which was a partial mitigation and is worth understanding before trusting it:
 * the snippet made the key *look* content-addressed, but `path:line` was still IN the key,
 * so line drift still renamed the entry — the snippet only made the resulting false-NEW
 * easier to recognise by eye, never prevented it. Keys are now content-addressed only
 * (`scripts/lib/finding-identity.mjs`): `file#rank-then-filter(helper):sha1-10[@n]` over
 * the normalized call line. Line movement is invisible; a changed call is a new finding.
 *
 * Scope: src/ only. The ranked-fetch helpers are library functions consumed by routes /
 * components / mcp tools under src/; scripts/ hold no `companiesPins`-style scoped view
 * (they are bulk drains / one-shot syncs), and the two bulk callers in scripts pass a
 * scope. Comment lines are stripped before matching — a fix that QUOTES the bad pattern
 * while explaining it must not be flagged (a lesson the sibling audits learned the hard
 * way).
 *
 * Exit codes:
 *   0 = no NEW findings (baseline-known allowed)
 *   1 = a new rank-then-filter site → BLOCKS the push
 *
 * Run:  node scripts/audit-rank-then-filter.mjs                 (gate mode)
 *       node scripts/audit-rank-then-filter.mjs --list           (finding + key + what is stale)
 *       node scripts/audit-rank-then-filter.mjs --migrate-baseline [--prune-stale]
 *       node scripts/audit-rank-then-filter.mjs --prune-baseline  (TIGHTEN: drop gone findings)
 *       node scripts/audit-rank-then-filter.mjs --update-baseline (accept current set)
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

const SCAN_ROOTS = ['src'];
const BASELINE_FILE = 'tests/fixtures/rank-then-filter-baseline.json';
const BASELINE_NOTE =
  'Rank-globally-then-filter sites accepted as pre-existing (or genuinely global). Keys are '
  + 'CONTENT-ADDRESSED (see keyFormat) so line movement cannot manufacture a false NEW finding.';
const EXCLUDE = /\.test\.|\.spec\./;

// The ranked-fetch helpers. Each takes flat scope params (state/naics/psc/agency/
// recipient) and ranks by dollars with a limit — the shape the companiesPins bug lives
// in. searchAwardsByLocation always orders by award amount desc (no sortBy arg), so a
// call to it is dollar-ranked by construction.
const RANKED_HELPERS = ['searchRecipients', 'findCapableSmallBusinesses', 'searchAwardsByLocation'];
const ALWAYS_DOLLAR_RANKED = new Set(['searchAwardsByLocation']);

// Scope params that, present in the SAME call, mean the fetch is already scoped
// (filter-before-limit) → not this bug.
const SCOPE_PARAM = /\b(state|naics|psc|agency|recipient|bbox)\s*:/;

// The "then filter" tell — the result is narrowed to a scoped view after the fetch.
const POST_FILTER_TELL = /\bbbox\b|\binBbox\b|\bviewport\b|Pins\b|\.filter\(|\bstate\b|\bnaics\b/;

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

// Strip a line's trailing `// comment` and skip block-comment / jsdoc lines. Several
// fixes QUOTE `sortBy: 'total_obligated'` while explaining the bug — flagging those is a
// false positive, and false positives are what make people reflexively --update-baseline.
function stripComment(raw) {
  const t = raw.trim();
  if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return '';
  return raw.replace(/\/\/.*$/, '');
}

const findings = [];

for (const root of SCAN_ROOTS) {
  for (const p of walk(root, (f) => /\.(ts|tsx|mjs)$/.test(f))) {
    if (EXCLUDE.test(p.replace(/\\/g, '/'))) continue;
    const lines = readFileSync(p, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      // Find the line that OPENS the helper call.
      const code = stripComment(lines[i]);
      const helper = RANKED_HELPERS.find((h) => code.includes(h + '('));
      if (!helper) continue;
      // Skip the helper's OWN definition — `export async function searchRecipients(` or
      // `export function findCapableSmallBusinesses(` / `const foo = (` — that line names
      // the helper but is not a call to it (a false positive on the lib file itself).
      if (new RegExp(`\\b(function|const|let|var)\\s+${helper}\\b|\\bfunction\\s+${helper}\\s*\\(`).test(code)) continue;
      if (/\bexport\b/.test(code) && new RegExp(`\\bfunction\\s+${helper}\\b`).test(code)) continue;

      // Gather the call's argument block: this line + the next ~10 (these calls chain /
      // pass a multi-line options object), stripped of comments so a quoted param inside
      // a comment doesn't count as scope or ranking.
      const block = lines
        .slice(i, i + 11)
        .map(stripComment)
        .join('\n');

      // (2) ranked by dollars + limited?
      const dollarRanked =
        ALWAYS_DOLLAR_RANKED.has(helper) ||
        /sortBy\s*:\s*['"`]total_obligated['"`]/.test(block);
      const limited = /\blimit\s*:/.test(block) || /\blimit\b/.test(block);
      if (!dollarRanked || !limited) continue;

      // (3) does the SAME call already pass a scope filter? If so it's filter-before-limit
      // — the correct shape — never a finding. (This is what #457 added to companiesPins.)
      if (SCOPE_PARAM.test(block)) continue;

      // (4) the "then filter" tell — is the result shown on a scoped view? Look at the
      // enclosing ~40-line neighborhood for a post-fetch scope narrowing.
      const neigh = lines
        .slice(Math.max(0, i - 20), i + 20)
        .map(stripComment)
        .join('\n');
      if (!POST_FILTER_TELL.test(neigh)) continue;

      // Evidence = the normalized call line. NOT the 11-line argument block: reformatting
      // the options object must not rename the finding.
      findings.push({ file: p, line: i + 1, rule: 'rank-then-filter', tag: helper, evidence: lines[i] });
    }
  }
}

const args = process.argv.slice(2);
const keyed = assignFindingKeys(findings);
const label = (f) => `${f.file}:${f.line} (${f.tag})`;
const byKey = new Map(keyed.map((f) => [f.key, f]));
const { keys: baselineKeys } = readBaseline(BASELINE_FILE, 'allowed');
const legacyCount = baselineKeys.filter(isLegacyBaselineKey).length;

if (args.includes('--migrate-baseline')) {
  if (!legacyCount) {
    console.log('[rank-then-filter] baseline is already content-addressed — nothing to migrate.');
    process.exit(0);
  }
  const plan = planMigration(keyed, baselineKeys);
  console.log(`[rank-then-filter] migration plan`);
  console.log(`  current findings          : ${plan.findings}`);
  console.log(`  legacy baseline entries   : ${plan.legacyEntries}`);
  console.log(`  carried (stay accepted)   : ${plan.carried.length}`);
  console.log(`  findings NOT in baseline  : ${plan.unmatchedFindings.length}`);
  console.log(`  matched after a line shift: ${plan.shifted.length}`);
  plan.shifted.forEach((s) => console.log(`      ${s.from}  →  ${s.to}  (same file, 1:1, line moved)`));
  console.log(`  stale legacy entries      : ${plan.staleLegacy.length}`);
  if (plan.unmatchedFindings.length) {
    console.error(`\n✗ REFUSING: ${plan.unmatchedFindings.length} current finding(s) are not in the legacy baseline.`);
    plan.unmatchedFindings.forEach((f) => console.error('    ' + label(f)));
    process.exit(1);
  }
  if (plan.staleLegacy.length && !args.includes('--prune-stale')) {
    console.error(`\n✗ REFUSING: ${plan.staleLegacy.length} legacy entr(ies) match NO current finding.`);
    plan.staleLegacy.forEach((k) => console.error('    ' + k));
    console.error(`\n  Re-run with --prune-stale to drop exactly these.`);
    process.exit(1);
  }
  writeBaseline(BASELINE_FILE, 'allowed', plan.carried.map((f) => f.key), { note: BASELINE_NOTE });
  console.log(`\n✓ migrated: ${plan.carried.length} finding(s) now keyed by content`
    + (plan.staleLegacy.length ? `; ${plan.staleLegacy.length} stale legacy entr(ies) pruned` : ''));
  process.exit(0);
}

if (args.includes('--update-baseline')) {
  writeBaseline(BASELINE_FILE, 'allowed', keyed.map((f) => f.key), { note: BASELINE_NOTE });
  console.log(`[rank-then-filter] baseline updated: ${keyed.length} known finding(s) recorded.`);
  process.exit(0);
}

const { fresh, stale } = partitionFindings(keyed, baselineKeys);

// --list is read-only inspection and exits 0; it runs BEFORE the legacy refusal so it
// still works on an unmigrated baseline. (All five sibling gates behave the same way.)
if (args.includes('--list')) {
  console.log(`[rank-then-filter] ${keyed.length} total finding(s):`);
  keyed.forEach((f) => console.log(
    '  ' + (baselineKeys.includes(f.key) ? '(known) ' : legacyCount ? '(legacy baseline) ' : 'NEW ') + label(f) + '  ' + f.key,
  ));
  if (stale.length && !legacyCount) {
    console.log(`\n  ${stale.length} baseline entr(ies) match no finding — the baseline can TIGHTEN:`);
    stale.forEach((k) => console.log('    (gone) ' + k));
  }
  process.exit(0);
}

if (legacyCount) {
  console.error(`\n[rank-then-filter] ✗ baseline holds ${legacyCount} legacy \`path:line\` entr(ies).`);
  console.error(`  Run: node scripts/audit-rank-then-filter.mjs --migrate-baseline\n`);
  process.exit(1);
}

if (args.includes('--prune-baseline')) {
  if (!stale.length) {
    console.log('[rank-then-filter] nothing to prune — every baseline entry still matches a finding.');
    process.exit(0);
  }
  if (fresh.length) {
    console.error(`[rank-then-filter] ✗ refusing to prune while ${fresh.length} NEW finding(s) are unresolved.`);
    process.exit(1);
  }
  writeBaseline(BASELINE_FILE, 'allowed', baselineKeys.filter((k) => byKey.has(k)), { note: BASELINE_NOTE });
  console.log(`[rank-then-filter] pruned ${stale.length} stale entr(ies): ${baselineKeys.length} → ${baselineKeys.length - stale.length}.`);
  process.exit(0);
}

if (fresh.length === 0) {
  console.log(`[rank-then-filter] OK — no new rank-then-filter sites (${keyed.length} baseline-known).`);
  if (stale.length) {
    console.log(`\n[rank-then-filter] ℹ ${stale.length} baseline entr(ies) no longer match any finding — the baseline can TIGHTEN from ${baselineKeys.length} to ${baselineKeys.length - stale.length}:`);
    stale.forEach((k) => console.log('    (gone) ' + k));
    console.log(`  node scripts/audit-rank-then-filter.mjs --prune-baseline\n`);
  }
  process.exit(0);
}

console.error(`\n[rank-then-filter] ✗ ${fresh.length} NEW rank-globally-then-filter site(s):\n`);
fresh.forEach((f) => console.error('  ' + label(f)));
console.error(`\n  Why: a ranked+limited award/recipient fetch with NO scope (state/naics/psc/agency/bbox)`);
console.error(`  ranks over the WHOLE corpus, then the surrounding code narrows it to a viewport/state/`);
console.error(`  segment — so the top-N is all national whales and the local/segment firms never survive`);
console.error(`  the limit. This is the Opportunity Map companiesPins class (hit 3×).`);
console.error(`  Fix: pass the scope INTO the same call (filter BEFORE the limit), like #457 did:`);
console.error(`       searchRecipients({ state, sortBy:'total_obligated', limit })  — state before limit.`);
console.error(`  (If genuinely a global listicle, run: node scripts/audit-rank-then-filter.mjs --update-baseline)\n`);
process.exit(1);

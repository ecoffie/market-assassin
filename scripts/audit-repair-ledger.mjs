#!/usr/bin/env node
/**
 * Repair-ledger auditor — catches REVERTS.
 *
 * Eric, 2026-07-27: "a ledger of repairs… we can audit to make sure nothing reverted."
 * Every row in docs/REPAIR-LEDGER.md carries a PROOF ANCHOR: an exact string that must be
 * present in a named file (`` `anchor` `` → `path`). This script re-greps every anchor against
 * the working tree (or a named git ref) and reports any that VANISHED — those are real reverts.
 *
 * A green audit = every recorded fix is still present in the code. A stale PREVIEW that looks
 * reverted is NOT flagged (we check the code, not a screenshot) — which is the whole point.
 *
 * Usage:
 *   node scripts/audit-repair-ledger.mjs            # audit the working tree
 *   node scripts/audit-repair-ledger.mjs --ref main # audit a git ref (what actually ships)
 *   node scripts/audit-repair-ledger.mjs --list     # print every parsed anchor
 * Exit 0 = all anchors present. Exit 1 = at least one vanished (a revert) or a parse problem.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'docs/REPAIR-LEDGER.md');

const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const REF = refIdx >= 0 ? args[refIdx + 1] : null; // null = working tree
const LIST = args.includes('--list');

/**
 * A ledger row's proof cell looks like:  `<anchor string>` → `path/to/file`
 * We pull EVERY (anchor, file) pair out of the markdown table rows. A row may reference the
 * anchor and the file in separate backtick/inline spans; we take the LAST backtick span before
 * the ✅/🟡 arrow as the anchor and the `… → path` as the file. To stay robust to prose, we
 * match the explicit `<code> → <code>` shape and also the `anchor → src/…` arrow shape.
 */
function parseAnchors(md) {
  const out = [];
  const lines = md.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;                 // table rows only
    if (/^\|\s*Date\s*\|/.test(line) || /^\|[-\s|]+\|$/.test(line)) continue; // header/sep
    // Find "`anchor`" ... "→" ... "`path`"  (path ends in a file extension we care about)
    const arrow = line.indexOf('→');
    if (arrow < 0) continue;
    const before = line.slice(0, arrow);
    const after = line.slice(arrow + 1);
    const anchorMatch = [...before.matchAll(/`([^`]+)`/g)].pop();
    const fileMatch = after.match(/`?([\w./-]+\.(?:ts|tsx|mjs|js|json|md|css))`?/);
    if (!anchorMatch || !fileMatch) continue;
    // A row not yet merged to main (IN REVIEW, or VERIFIED on a branch that says "ready to merge"/
    // "branch;") legitimately won't be in `main` yet — mark it so a `--ref main` audit doesn't
    // false-alarm. Rows SUPERSEDED by a later fix are skipped too. Once merged, drop the branch
    // marker (Status → "LIVE (main)") so the anchor is enforced against main again.
    const inReview = /IN REVIEW/i.test(line) || /ready to merge/i.test(line) || /\(branch;/i.test(line);
    const superseded = /SUPERSEDED/i.test(line);
    out.push({ anchor: anchorMatch[1], file: fileMatch[1], row: line.trim(), inReview, superseded });
  }
  return out;
}

function fileContents(path) {
  try {
    if (REF) return execSync(`git show ${REF}:${path}`, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return null; // missing file
  }
}

const md = readFileSync(LEDGER, 'utf8');
const anchors = parseAnchors(md);

if (anchors.length === 0) {
  console.error('✗ No proof anchors parsed from the ledger. Each fix row needs `<anchor>` → `<file>`.');
  process.exit(1);
}

if (LIST) {
  for (const a of anchors) console.log(`  ${a.file}  ⟵  ${JSON.stringify(a.anchor)}`);
  console.log(`\n${anchors.length} anchor(s).`);
}

const where = REF ? `ref '${REF}'` : 'working tree';
const vanished = [];   // file EXISTS but the anchor is gone → a real revert
const unresolved = []; // the ledger's path doesn't resolve → a LEDGER bug (fix the row), not a revert
let skipped = 0;
for (const a of anchors) {
  // On a `--ref main` audit, IN-REVIEW rows aren't merged yet — skip (not a revert). Always skip
  // SUPERSEDED rows. On the working tree we still check IN-REVIEW rows (the branch has them).
  if (a.superseded || (REF && a.inReview)) { skipped++; continue; }
  const src = fileContents(a.file);
  if (src == null) { unresolved.push({ ...a, why: `path '${a.file}' does not resolve in ${where} (use the FULL repo-relative path in the ledger)` }); continue; }
  if (!src.includes(a.anchor)) vanished.push({ ...a, why: `anchor not found in ${a.file}` });
}

if (vanished.length === 0 && unresolved.length === 0) {
  const note = skipped ? ` (${skipped} in-review/superseded skipped)` : '';
  console.log(`✓ Repair ledger clean — all ${anchors.length - skipped} checked fixes still present in ${where}${note}.`);
  process.exit(0);
}

if (vanished.length) {
  console.error(`\n✗ ${vanished.length} recorded fix(es) VANISHED in ${where} — possible revert:\n`);
  for (const v of vanished) {
    console.error(`  • ${v.why}`);
    console.error(`      anchor: ${JSON.stringify(v.anchor)}`);
    console.error(`      row:    ${v.row}\n`);
  }
  console.error('If a preview merely looks old, that is NOT this — the code itself lost the fix. Investigate the commit that dropped it.');
}
if (unresolved.length) {
  console.error(`\n⚠ ${unresolved.length} ledger row(s) have an unresolvable path — FIX THE LEDGER (not a revert):\n`);
  for (const u of unresolved) console.error(`  • ${u.why}\n      row: ${u.row}\n`);
}
// A revert fails the audit; an unresolvable path also fails (so the ledger stays honest/greppable).
process.exit(1);

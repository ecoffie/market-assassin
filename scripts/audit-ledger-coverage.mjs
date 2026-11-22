#!/usr/bin/env node
/**
 * Pre-push ledger-coverage gate — keeps the repair ledger complete so its revert-audit actually
 * covers everything (Eric 2026-07-27: "is the ledger being updated? it should be").
 *
 * The ledger is the frozen archive docs/REPAIR-LEDGER.md plus one file per entry in
 * docs/repair-ledger/ (scripts/lib/ledger-sources.mjs). New entries go in that directory, so two PRs
 * never conflict on the same lines.
 *
 * Two checks:
 *   HARD  — every ledger row's proof anchor still resolves in the working tree (delegates to
 *           audit-repair-ledger.mjs). A vanished anchor = a revert or a broken row → block.
 *   WARN  — the commits being pushed include a SUBSTANTIVE src/ change (a feat/ or fix/ commit
 *           touching src/**, excluding test/doc-only) but add no ledger entry. That's a
 *           likely missing ledger row → warn (never block: refactors/reverts/merges legitimately
 *           add no row, and blocking every unrelated push would be worse than the gap).
 *
 * Usage: node scripts/audit-ledger-coverage.mjs [<range>]
 *   <range> defaults to origin/main..HEAD (the commits a push would send). Falls back to HEAD~5..HEAD
 *   when origin/main is unknown (fresh clone / detached).
 * Exit 0 always UNLESS the hard anchor-integrity check fails (that part re-exits non-zero).
 */
import { execSync } from 'node:child_process';
import { ARCHIVE, ENTRY_DIR, isLedgerPath } from './lib/ledger-sources.mjs';

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); } catch { return ''; } }

// ── HARD: anchor integrity (a revert of a recorded fix must block) ──
let hardFail = false;
try { execSync('node scripts/audit-repair-ledger.mjs', { stdio: 'inherit' }); }
catch { hardFail = true; }

// ── WARN: a substantive src/ feat|fix in the push range with no ledger touch ──
const range = process.argv[2]
  || (sh('git rev-parse --verify -q origin/main') ? 'origin/main..HEAD' : 'HEAD~5..HEAD');
const commits = sh(`git log --format=%H%x09%s ${range}`).split('\n').filter(Boolean);
const changed = sh(`git diff --name-only ${range}`).split('\n').filter(Boolean);
const ledgerTouched = changed.some(isLedgerPath);
// Rows appended to the frozen archive still count (in-flight PRs), but new entries belong in the directory.
const archiveAdds = Number((sh(`git diff --numstat ${range} -- ${ARCHIVE}`).split('\t')[0]) || 0);

const substantive = commits.filter(([_, ...r]) => true) // placeholder to keep map simple below
  .map((line) => { const [h, ...s] = line.split('\t'); return { h, subject: s.join('\t') }; })
  .filter((c) => /^(feat|fix)(\(|:|!)/i.test(c.subject))
  .filter((c) => {
    const files = sh(`git show --name-only --format= ${c.h}`).split('\n').filter(Boolean);
    const src = files.filter((f) => f.startsWith('src/') && !/\.test\.|\.spec\.|\.unit\./.test(f));
    return src.length > 0; // touches real src (not test-only)
  });

if (substantive.length && !ledgerTouched) {
  console.error('\n⚠ ledger-coverage: this push has substantive src/ feat|fix commits but adds NO');
  console.error(`  ledger entry. Add ${ENTRY_DIR}/<YYYY-MM-DD>-<pr-or-slug>.md (with a proof anchor) so the revert-audit`);
  console.error('  covers this fix — the ledger only catches what it records:');
  for (const c of substantive) console.error(`    • ${c.subject}`);
  console.error('  (Warn only — not blocking. A refactor/revert/merge legitimately adds no row.)\n');
}

if (archiveAdds > 0) {
  console.error(`\nℹ ledger-coverage: this push adds ${archiveAdds} line(s) to the frozen archive ${ARCHIVE}.`);
  console.error(`ℹ   New entries go in ${ENTRY_DIR}/<YYYY-MM-DD>-<pr-or-slug>.md (one file each, so PRs never conflict).`);
  console.error('  (Warn only — rows already added by in-flight PRs are still audited.)\n');
}

process.exit(hardFail ? 1 : 0);

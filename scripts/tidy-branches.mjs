#!/usr/bin/env node
/**
 * Prune LOCAL branches that are fully merged into origin/main.
 *
 * WHY THIS EXISTS (2026-08-17): the local branch list had grown to 516 while the REMOTE was
 * already clean. GitHub's `delete_branch_on_merge` was — and had been — ON, and it works:
 * zero merged branches remained on origin. But GitHub deleting its copy never deletes YOUR
 * local ref, and no repo setting can. That residue is a purely local bookkeeping problem, so
 * it gets a purely local fix.
 *
 * WHAT IT DELETES: a local branch ONLY when `git rev-list --count origin/main..<branch>` is 0
 * — i.e. it holds no commit that isn't already in origin/main. Deleting such a ref loses
 * nothing; the work is in main.
 *
 * WHAT IT REFUSES TO TOUCH, and why each guard is here rather than assumed:
 *   - main / the CURRENT branch.
 *   - Any branch checked out in a WORKTREE. This repo runs ~25 of them (the standing
 *     parallel-session convention). Deleting a pinned branch breaks that worktree.
 *   - Anything with ≥1 unmerged commit. Measured during the manual cleanup: 39 of 44 branches
 *     whose remote was already gone STILL showed unmerged commits, because a SQUASH merge
 *     rewrites the commit so the original ref never looks merged. "Remote is gone" is
 *     therefore NOT evidence the work landed — only the commit count is.
 *   - Never `git branch -D`. The safe `-d` refuses a branch whose UPSTREAM has commits the
 *     local ref lacks (two branches hit exactly that), and that refusal is information, not
 *     an obstacle to force past.
 *
 * DEFAULT IS DRY-RUN. Pass --go to actually delete (the same dry-by-default shape as the
 * other write-capable scripts in this repo).
 */
import { execFileSync } from 'node:child_process';

const GO = process.argv.includes('--go');
const QUIET = process.argv.includes('--quiet');

function git(args, allowFail = false) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}

function main() {
  // A missing origin/main means we can't judge "merged" at all — bail rather than guess.
  if (!git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'], true)) {
    if (!QUIET) console.log('tidy-branches: no origin/main ref — skipping (run `git fetch origin` first).');
    return 0;
  }

  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], true);

  // Branches pinned by a worktree. `--porcelain` is parsed rather than the human `list`
  // output: the human format carries an ahead/behind marker column that a naive awk grabs
  // instead of the name (that mis-parse produced a delete list of five "+" characters during
  // the manual pass — it deleted nothing, but a subtler mis-parse would not have been caught).
  const pinned = new Set(
    git(['worktree', 'list', '--porcelain'], true)
      .split('\n')
      .filter((l) => l.startsWith('branch '))
      .map((l) => l.replace('branch refs/heads/', '').trim())
      .filter(Boolean),
  );

  const all = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], true)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const safe = [];
  for (const b of all) {
    if (b === 'main' || b === current || pinned.has(b)) continue;
    const n = git(['rev-list', '--count', `origin/main..${b}`], true);
    // An unreadable count is UNKNOWN, not zero — skip rather than delete on a blank.
    if (n === '0') safe.push(b);
  }

  if (!safe.length) {
    if (!QUIET) console.log(`tidy-branches: nothing to prune (${all.length} local branches, all still hold work or are pinned).`);
    return 0;
  }

  if (!GO) {
    console.log(`tidy-branches: ${safe.length} local branch(es) fully merged into origin/main and prunable:`);
    for (const b of safe.slice(0, 20)) console.log(`  ${b}`);
    if (safe.length > 20) console.log(`  … and ${safe.length - 20} more`);
    console.log('\nRun `npm run tidy:branches -- --go` to delete them (safe: their commits are all in main).');
    return 0;
  }

  let deleted = 0;
  const kept = [];
  for (const b of safe) {
    // -d, never -D. If git refuses, that refusal is a real signal (upstream has commits this
    // ref lacks) and the branch stays.
    try {
      execFileSync('git', ['branch', '-d', b], { stdio: 'pipe' });
      deleted++;
    } catch {
      kept.push(b);
    }
  }
  console.log(`tidy-branches: deleted ${deleted} merged local branch(es).`);
  if (kept.length) {
    console.log(`  kept ${kept.length} that git refused (upstream has commits the local ref lacks):`);
    for (const b of kept) console.log(`    ${b}`);
  }
  return 0;
}

process.exit(main());

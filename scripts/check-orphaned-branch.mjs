#!/usr/bin/env node
/**
 * ORPHANED-BRANCH GUARD.
 *
 * > **Work is not complete because it is committed or pushed. It is complete only when its
 * > commit is reachable from `origin/main`, or an open PR explicitly owns it.**
 *
 * WHY THIS EXISTS — it has already cost real work twice in one session:
 *
 *   1. `feat/sam-purpose-of-registration` — the migration adding
 *      `sam_entities.purpose_of_registration` was written, committed, pushed, and reported as
 *      "approved, awaiting the apply command". **No PR was ever opened.** It never reached
 *      main, so every later branch cut from main silently lacked it, and `db:check` found the
 *      column did not exist. The work looked finished from the branch and was invisible from
 *      main.
 *   2. `chore/final-journeys` and the item-5/6 branches hit the same shape earlier — pushed,
 *      then only noticed when a later branch could not see the files. (Those since merged;
 *      run with `--all` and the ONLY genuine orphan from that session is
 *      `feat/sam-purpose-of-registration` — the branch that stranded the migration. That is
 *      the guard finding the real case and nothing else.)
 *
 * A push is not a landing. `git push` succeeding says nothing about whether anyone will ever
 * merge it, and a branch that is "done" in one session is invisible to the next.
 *
 * VERDICTS
 *   MERGED   — HEAD is an ancestor of origin/main. Nothing to do.
 *   IN REVIEW — not merged, but an OPEN PR owns this branch.
 *   ORPHANED — neither. STOP: open a PR or merge it, or the work does not exist.
 *
 *   node scripts/check-orphaned-branch.mjs            # check the current branch
 *   node scripts/check-orphaned-branch.mjs --all      # every local branch with commits
 *   node scripts/check-orphaned-branch.mjs --json
 */
import { execSync } from 'node:child_process';

const JSON_OUT = process.argv.includes('--json');
const ALL = process.argv.includes('--all');

const sh = (cmd, fallback = '') => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return fallback; }
};

/** Is `ref` reachable from origin/main? */
function isMerged(ref) {
  try {
    execSync(`git merge-base --is-ancestor ${ref} origin/main`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/** Does an OPEN PR own this branch? `gh` may be absent — that is reported, never assumed away. */
function openPrFor(branch) {
  const out = sh(`gh pr list --head ${branch} --state open --json number --jq '.[0].number' 2>/dev/null`);
  return out ? Number(out) : null;
}

/**
 * Was this branch SQUASH-merged?
 *
 * ⚠️ THE TRAP THIS EXISTS FOR — it made the first version of this script useless. A squash
 * merge REWRITES the commit: `feat/sam-cert-date-preservation` HEAD d2d67c32 landed on main as
 * ededa644 (PR #1328). The content is merged; the SHA is not an ancestor. So
 * `merge-base --is-ancestor` correctly answers "no" while the work is genuinely on main.
 *
 * Measured: the naive check reported **490 of 537** local branches as ORPHANED, including ones
 * merged minutes earlier. A guard with that false-positive rate is worse than none — it would
 * be disabled immediately. `scripts/tidy-branches.mjs` documents the same hazard.
 *
 * A MERGED PR for this branch is authoritative evidence the work landed.
 */
function mergedPrFor(branch) {
  const out = sh(`gh pr list --head ${branch} --state merged --json number --jq '.[0].number' 2>/dev/null`);
  return out ? Number(out) : null;
}

function verdictFor(branch) {
  const head = sh(`git rev-parse ${branch}`);
  if (!head) return { branch, verdict: 'UNKNOWN', detail: 'cannot resolve ref' };
  if (isMerged(branch)) return { branch, verdict: 'MERGED', detail: 'reachable from origin/main' };
  const merged = mergedPrFor(branch);
  if (merged) return { branch, verdict: 'MERGED', detail: `squash-merged as PR #${merged}` };
  const pr = openPrFor(branch);
  if (pr) return { branch, verdict: 'IN REVIEW', detail: `open PR #${pr}` };

  // How much work is actually stranded? A number makes the cost concrete.
  const ahead = sh(`git rev-list --count origin/main..${branch}`, '?');
  const files = sh(`git diff --name-only origin/main...${branch} | wc -l`, '?').trim();
  return { branch, verdict: 'ORPHANED', detail: `${ahead} commit(s), ${files} file(s) not on main and no open PR` };
}

sh('git fetch -q origin');   // a stale origin/main would produce a false ORPHANED

const branches = ALL
  ? sh("git for-each-ref --format='%(refname:short)' refs/heads/")
      .split('\n').filter(Boolean).filter((b) => b !== 'main')
  : [sh('git rev-parse --abbrev-ref HEAD')];

const results = branches.map(verdictFor);

if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

const orphans = results.filter((r) => r.verdict === 'ORPHANED');
for (const r of results) {
  const mark = r.verdict === 'MERGED' ? '✓' : r.verdict === 'IN REVIEW' ? '◐' : '✗';
  console.log(`  ${mark} ${r.branch.padEnd(42)} ${r.verdict.padEnd(10)} ${r.detail}`);
}

if (orphans.length) {
  console.error(`\n  ✗ ${orphans.length} ORPHANED branch(es) — the work is NOT complete.`);
  console.error('    A push is not a landing. Open a PR, or merge it, or the work does not exist');
  console.error('    from main\'s point of view — which is what every later branch is cut from.');
  process.exit(1);
}
console.log(`\n  ✓ no orphaned work (${results.length} branch(es) checked)`);

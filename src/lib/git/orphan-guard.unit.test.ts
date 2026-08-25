/**
 * ORPHANED-BRANCH GUARD — the rule, and the trap that nearly made it useless.
 *
 * THE RULE (Eric, 2026-08-24):
 *   "Work is not complete because it is committed or pushed. It is complete only when its
 *    commit is reachable from origin/main, or an open PR explicitly owns it."
 *
 * It has cost real work: the `purpose_of_registration` migration was written, committed,
 * pushed and reported as done — but no PR was ever opened, so it never reached main, and
 * `db:check` later found the column did not exist.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = () => {
  const s = readFileSync(join(process.cwd(), 'scripts/check-orphaned-branch.mjs'), 'utf8');
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
          .replace(/^([^\n]*?)\/\/.*$/gm, '$1');
};

describe('the three verdicts', () => {
  it('MERGED when reachable from origin/main', () => {
    expect(src()).toContain('merge-base --is-ancestor');
  });

  it('IN REVIEW when an open PR owns the branch', () => {
    const c = src();
    expect(c).toContain('--state open');
    expect(c).toContain('IN REVIEW');
  });

  it('ORPHANED otherwise, and it EXITS NON-ZERO', () => {
    const c = src();
    expect(c).toContain('ORPHANED');
    expect(c).toContain('process.exit(1)');
  });
});

describe('squash-merge awareness — the trap that made v1 useless', () => {
  it('a MERGED PR also counts as merged', () => {
    // A squash merge REWRITES the commit, so `is-ancestor` says "no" for work that IS on main.
    // Measured: without this, the guard called 490 of 537 branches ORPHANED — including ones
    // merged minutes earlier. A guard with that false-positive rate gets disabled.
    const c = src();
    expect(c).toContain('--state merged');
    expect(c).toContain('squash-merged as PR');
  });

  it('checks is-ancestor FIRST, so a cheap local check precedes any network call', () => {
    const c = src();
    expect(c.indexOf('merge-base --is-ancestor')).toBeLessThan(c.indexOf('--state merged'));
  });
});

describe('it cannot produce a false ORPHANED from stale refs', () => {
  it('fetches origin before judging', () => {
    expect(src()).toContain('git fetch -q origin');
  });

  it('reports the SIZE of the stranded work, not just a verdict', () => {
    // "3 commits, 7 files" makes the cost concrete; a bare label invites ignoring it.
    expect(src()).toContain('rev-list --count');
  });
});

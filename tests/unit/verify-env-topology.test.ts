import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error — plain .mjs helper, no type declarations by design
import { checkEnvTopology } from '../../scripts/env-local-topology.mjs';

/**
 * `.env.local` topology rules — readability is NOT sufficient.
 *
 * The case that forces this file to exist is TEST 5: a link to ANOTHER repo's
 * env that is readable, populated, and carries every required variable family.
 * Family validation passes it happily; only topology catches it. So the wrong-repo
 * fixture below is deliberately COMPLETE — a failure there proves the topology
 * check fired, not that variables were missing.
 *
 * Assertions compare booleans and short reason codes, never file contents: a
 * failing `toContain` prints the whole file, and on exactly the failure these
 * tests catch, that would be secrets in the CI log. It happened once already.
 */

/** git, with the ambient environment stripped — GIT_DIR/GIT_WORK_TREE override `-C`. */
const CLEAN_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
                   'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
                   'GIT_PREFIX']) delete env[k];
  return env;
})();

/** A fully-populated env — every family the checker requires. */
const FULL_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co"',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY="anon-key-value"',
  'SUPABASE_SERVICE_ROLE_KEY="service-role-key-value"',
  'SAM_API_KEY="sam-key-value"',
  'ADMIN_PASSWORD="admin-value"',
  '',
].join('\n');

/** A REAL git repo with a REAL linked worktree. */
function makeRepo(root: string, name: string, envBody: string) {
  const main = path.join(root, name);
  fs.mkdirSync(main, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-C', main, ...a], { stdio: 'ignore', env: CLEAN_ENV });
  git('init', '-q');
  fs.writeFileSync(path.join(main, 'f'), 'x\n');
  git('add', 'f');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(main, '.env.local'), envBody);
  const wt = path.join(main, 'wt');
  git('worktree', 'add', '-q', wt, '-b', `wt-${name}`);
  return { main, wt };
}

let root: string, A: { main: string; wt: string };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'envtopo-'));
  A = makeRepo(root, 'repoA', FULL_ENV);
});
afterEach(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

const envOf = (dir: string) => path.join(dir, '.env.local');

describe('verify:env — .env.local topology', () => {
  it('TEST 1: main repo with a REGULAR .env.local passes', () => {
    expect(checkEnvTopology(envOf(A.main)).ok).toBe(true);
  });

  it('TEST 2: registered worktree linked to its OWN main env passes', () => {
    fs.symlinkSync(envOf(A.main), envOf(A.wt));
    const r = checkEnvTopology(envOf(A.wt));
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/supported worktree setup/);
  });

  it('TEST 3: main .env.local as a SELF-LINK fails, named as the 2026-09-05 breakage', () => {
    fs.rmSync(envOf(A.main));
    fs.symlinkSync(envOf(A.main), envOf(A.main));
    const r = checkEnvTopology(envOf(A.main));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/SELF-REFERENCING/);
  });

  it('TEST 4: main .env.local linked to ANOTHER file fails — main must hold the real file', () => {
    const other = path.join(root, 'elsewhere.env');
    fs.writeFileSync(other, FULL_ENV);
    fs.rmSync(envOf(A.main));
    fs.symlinkSync(other, envOf(A.main));
    const r = checkEnvTopology(envOf(A.main));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/MAIN worktree is a SYMLINK/);
  });

  it('TEST 5: worktree linked to ANOTHER REPO\'s fully-populated env fails', () => {
    // The whole point: this target is readable AND carries every required family.
    const B = makeRepo(root, 'repoB', FULL_ENV);
    expect(fs.readFileSync(envOf(B.main), 'utf8').length).toBeGreaterThan(0);
    fs.symlinkSync(envOf(B.main), envOf(A.wt));
    const r = checkEnvTopology(envOf(A.wt));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OUTSIDE this repository/);
  });

  it('TEST 6: worktree linked to an old readable BACKUP fails', () => {
    const backup = path.join(root, 'env.local.backup-2026-05-23');
    fs.writeFileSync(backup, FULL_ENV);
    fs.symlinkSync(backup, envOf(A.wt));
    const r = checkEnvTopology(envOf(A.wt));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OUTSIDE this repository/);
  });

  it('TEST 7: a correct-target link whose target is UNREADABLE is caught', () => {
    // Topology is right, so the structural check passes and the READ must fail.
    fs.symlinkSync(envOf(A.main), envOf(A.wt));
    expect(checkEnvTopology(envOf(A.wt)).ok).toBe(true);
    fs.rmSync(envOf(A.main));              // dangling → unreadable
    expect(() => fs.readFileSync(envOf(A.wt), 'utf8')).toThrow();
  });

  it('TEST 8: a REGULAR .env.local copy inside a worktree remains licit', () => {
    fs.writeFileSync(envOf(A.wt), FULL_ENV);
    expect(checkEnvTopology(envOf(A.wt)).ok).toBe(true);
  });

  it('a relative symlink resolving outside the repo still fails', () => {
    const outside = path.join(root, 'outside.env');
    fs.writeFileSync(outside, FULL_ENV);
    fs.symlinkSync(path.relative(A.wt, outside), envOf(A.wt));   // relative form
    expect(checkEnvTopology(envOf(A.wt)).ok).toBe(false);
  });

  it('a missing .env.local is reported as missing, not as bad topology', () => {
    const r = checkEnvTopology(envOf(A.wt));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/DOES NOT EXIST/);
  });
});

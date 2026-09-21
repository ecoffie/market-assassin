import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error — plain .mjs helper, no type declarations by design
import { planLink } from '../../scripts/link-env-local.mjs';

const SCRIPT = path.resolve(__dirname, '../../scripts/link-env-local.mjs');
const SECRET = 'sk_live_SUPERSECRET_VALUE';

/**
 * The ambient git environment, removed.
 *
 * git EXPORTS GIT_DIR/GIT_WORK_TREE to every hook, and they OVERRIDE `-C <dir>`.
 * Under the pre-push gate these tests inherited the real repo's GIT_DIR, so every
 * temp repo built here answered as market-assassin: setup commits landed in the
 * wrong repo and the links resolved to the REAL `.env.local`. Scrub it in the
 * fixtures too, or the tests only pass when run outside a hook.
 */
const CLEAN_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
                   'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
                   'GIT_PREFIX']) delete env[k];
  return env;
})();

/** A REAL git repo with a REAL linked worktree — membership must be genuine. */
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

const run = (args: string[], cwd: string) => {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: CLEAN_ENV });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
};

let root: string, A: { main: string; wt: string };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'envlink-'));
  A = makeRepo(root, 'repoA', `SUPABASE_SERVICE_ROLE_KEY=${SECRET}\nREPO=A\n`);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

/**
 * Assert on link CONTENT without ever putting that content in an assertion.
 *
 * A failing `expect(body).toContain(x)` prints the whole file. These tests exist
 * precisely because a link can resolve to the WRONG `.env.local` — so on the exact
 * failure they are designed to catch, that diff would dump real secrets into the
 * gate log. It already did once. Assert booleans; report only a redacted shape.
 */
function envMarker(file: string): string {
  const body = fs.readFileSync(file, 'utf8');
  const m = /^REPO=([A-Za-z0-9_]+)$/m.exec(body);
  if (m) return m[1];
  return `<no REPO marker: ${body.length} bytes, ${body.split('\n').length} lines>`;
}

describe('link-env-local — cwd independence', () => {
  it('TEST 1: worktree -> main link succeeds and is readable', () => {
    expect(run([A.wt], A.wt).code).toBe(0);
    const t = path.join(A.wt, '.env.local');
    expect(fs.lstatSync(t).isSymbolicLink()).toBe(true);
    expect(envMarker(t)).toBe('A');
  });

  it('TEST 2 / 16: main repo as explicit target HARD FAILS, main stays a regular file', () => {
    const r = run([A.main], A.main);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/main worktree/);
    const st = fs.lstatSync(path.join(A.main, '.env.local'));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
  });

  it('TEST 3: no mutation occurs on a refusal', () => {
    const before = fs.lstatSync(path.join(A.main, '.env.local')).ino;
    expect(planLink(A.main).action).toBe('refuse');
    expect(fs.lstatSync(path.join(A.main, '.env.local')).ino).toBe(before);
  });

  it('TEST 4: an existing REGULAR file at the target is never replaced', () => {
    const t = path.join(A.wt, '.env.local');
    fs.writeFileSync(t, 'LOCAL_OVERRIDE=1\n');
    expect(run([A.wt], A.wt).code).toBe(1);
    expect(fs.lstatSync(t).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(t, 'utf8')).toBe('LOCAL_OVERRIDE=1\n');
  });

  it('TEST 5: an already-correct symlink is a safe no-op', () => {
    expect(run([A.wt], A.wt).code).toBe(0);
    const ino = fs.lstatSync(path.join(A.wt, '.env.local')).ino;
    const again = run([A.wt], A.wt);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already correctly linked/);
    expect(fs.lstatSync(path.join(A.wt, '.env.local')).ino).toBe(ino);
  });

  it('TEST 6: a pre-existing SELF-referencing symlink is detected and refused', () => {
    const t = path.join(A.wt, '.env.local');
    fs.symlinkSync(t, t);
    const r = run([A.wt], A.wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SELF-REFERENCING/);
  });

  it('TEST 7: a missing main .env.local fails safely', () => {
    fs.rmSync(path.join(A.main, '.env.local'));
    const r = run([A.wt], A.wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not found/);
    expect(fs.existsSync(path.join(A.wt, '.env.local'))).toBe(false);
  });

  it('TEST 8: no secret value is ever printed', () => {
    const ok = run([A.wt], A.wt);
    const refused = run([A.main], A.main);
    for (const r of [ok, refused]) {
      expect(r.out).not.toContain(SECRET);
      expect(r.out).not.toContain('SUPABASE_SERVICE_ROLE_KEY=');
    }
  });

  it('TEST 9: cwd = MAIN but explicit target = worktree still links the WORKTREE', () => {
    expect(run([A.wt], A.main).code).toBe(0);
    expect(fs.lstatSync(path.join(A.wt, '.env.local')).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(A.main, '.env.local')).isSymbolicLink()).toBe(false);
  });

  // ── the load-bearing cwd-independence test ────────────────────────────────
  it('TEST 13: cwd in a DIFFERENT repo never leaks that repo\'s secrets', () => {
    const B = makeRepo(root, 'repoB', 'SUPABASE_SERVICE_ROLE_KEY=sk_live_WRONG_REPO\nREPO=B\n');
    const r = run([A.wt], B.main);            // cwd = repo B, target = repo A worktree
    expect(r.code).toBe(0);
    const t = path.join(A.wt, '.env.local');
    // Source came from A's OWN main repo, not from cwd's repo B.
    expect(envMarker(t)).toBe('A');
    expect(fs.realpathSync(t)).toBe(fs.realpathSync(path.join(A.main, '.env.local')));
  });

  it('TEST 14: a target that exists but is NOT a git worktree is refused', () => {
    const plain = path.join(root, 'just-a-dir');
    fs.mkdirSync(plain);
    const r = run([plain], A.wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not inside a git repository|not a registered worktree/);
    expect(fs.existsSync(path.join(plain, '.env.local'))).toBe(false);
  });

  it('TEST 15: a directory INSIDE the repo that is not a registered worktree is refused', () => {
    const fake = path.join(A.main, '.claude', 'worktrees', 'pretend');
    fs.mkdirSync(fake, { recursive: true });
    const r = run([fake], A.main);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not a registered worktree/);
    expect(fs.existsSync(path.join(fake, '.env.local'))).toBe(false);
  });

  it('a missing worktree path is refused (destination must be explicit)', () => {
    expect(planLink('').action).toBe('refuse');
    expect(run([], A.main).code).toBe(1);
  });

  it('a symlink pointing somewhere else is never silently repointed', () => {
    const other = path.join(root, 'other.env');
    fs.writeFileSync(other, 'X=1\n');
    fs.symlinkSync(other, path.join(A.wt, '.env.local'));
    const r = run([A.wt], A.wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/points elsewhere/);
    expect(fs.readlinkSync(path.join(A.wt, '.env.local'))).toBe(other);
  });

  it('a main .env.local that is itself a symlink is refused as a source', () => {
    const real = path.join(root, 'real.env');
    fs.writeFileSync(real, 'Y=1\n');
    fs.rmSync(path.join(A.main, '.env.local'));
    fs.symlinkSync(real, path.join(A.main, '.env.local'));
    const r = run([A.wt], A.wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/itself a SYMLINK/);
  });
});

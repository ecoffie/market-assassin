import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error — plain .mjs helper, no type declarations by design
import { planLink } from '../../scripts/link-env-local.mjs';

const SCRIPT = path.resolve(__dirname, '../../scripts/link-env-local.mjs');
let root: string, main: string, wt: string;

const run = (args: string[], cwd: string) => {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MAIN_REPO_ROOT: main } });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'envlink-'));
  main = path.join(root, 'main');
  wt = path.join(main, '.claude', 'worktrees', 'wt');
  fs.mkdirSync(wt, { recursive: true });
  // A real secret-shaped value, so the no-leak test is meaningful.
  fs.writeFileSync(path.join(main, '.env.local'), 'SUPABASE_SERVICE_ROLE_KEY=sk_live_SUPERSECRET_VALUE\n');
  execFileSync('git', ['init', '-q'], { cwd: main });
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('link-env-local — the proven failure mode', () => {
  it('TEST 1: worktree -> main link succeeds and is readable', () => {
    const r = run([wt], wt);
    expect(r.code).toBe(0);
    const target = path.join(wt, '.env.local');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('TEST 2: main -> main HARD FAILS and leaves main a regular file', () => {
    const r = run([main], main);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/REFUSED/);
    const st = fs.lstatSync(path.join(main, '.env.local'));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isFile()).toBe(true);
  });

  it('TEST 3: source == destination hard-fails with no mutation', () => {
    const before = fs.lstatSync(path.join(main, '.env.local')).ino;
    const plan = planLink(main, main);
    expect(plan.action).toBe('refuse');
    expect(fs.lstatSync(path.join(main, '.env.local')).ino).toBe(before);
  });

  it('TEST 4: an existing REGULAR file at the target is never replaced', () => {
    const target = path.join(wt, '.env.local');
    fs.writeFileSync(target, 'LOCAL_OVERRIDE=1\n');
    const r = run([wt], wt);
    expect(r.code).toBe(1);
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('LOCAL_OVERRIDE=1\n');
  });

  it('TEST 5: an already-correct symlink is a safe no-op', () => {
    expect(run([wt], wt).code).toBe(0);
    const first = fs.lstatSync(path.join(wt, '.env.local')).ino;
    const again = run([wt], wt);
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already correctly linked/);
    expect(fs.lstatSync(path.join(wt, '.env.local')).ino).toBe(first);
  });

  it('TEST 6: a pre-existing SELF-referencing symlink is detected and refused', () => {
    const target = path.join(wt, '.env.local');
    fs.symlinkSync(target, target);              // the exact incident shape
    const r = run([wt], wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/SELF-REFERENCING/);
  });

  it('TEST 7: a missing main .env.local fails safely', () => {
    fs.rmSync(path.join(main, '.env.local'));
    const r = run([wt], wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not found/);
    expect(fs.existsSync(path.join(wt, '.env.local'))).toBe(false);
  });

  it('TEST 8: no secret value is ever printed', () => {
    const ok = run([wt], wt);
    const refused = run([main], main);
    for (const r of [ok, refused]) {
      expect(r.out).not.toContain('sk_live_SUPERSECRET_VALUE');
      expect(r.out).not.toContain('SUPABASE_SERVICE_ROLE_KEY=');
    }
  });

  // The load-bearing test: this is EXACTLY the harness condition that caused both
  // incidents — cwd silently back in the main repo while the intent is a worktree.
  it('TEST 9: cwd = MAIN but explicit target = worktree still links the WORKTREE', () => {
    const r = run([wt], main);                   // note: cwd is the MAIN repo
    expect(r.code).toBe(0);
    expect(fs.lstatSync(path.join(wt, '.env.local')).isSymbolicLink()).toBe(true);
    // and main is untouched
    expect(fs.lstatSync(path.join(main, '.env.local')).isSymbolicLink()).toBe(false);
  });

  it('a missing worktree path is refused (destination must be explicit)', () => {
    expect(planLink(main, '').action).toBe('refuse');
    expect(run([], main).code).toBe(1);
  });

  it('a symlink pointing somewhere else is never silently repointed', () => {
    const other = path.join(root, 'other.env');
    fs.writeFileSync(other, 'X=1\n');
    fs.symlinkSync(other, path.join(wt, '.env.local'));
    const r = run([wt], wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/points elsewhere/);
    expect(fs.readlinkSync(path.join(wt, '.env.local'))).toBe(other);
  });

  it('a main .env.local that is itself a symlink is refused as a source', () => {
    const real = path.join(root, 'real.env');
    fs.writeFileSync(real, 'Y=1\n');
    fs.rmSync(path.join(main, '.env.local'));
    fs.symlinkSync(real, path.join(main, '.env.local'));
    const r = run([wt], wt);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/itself a SYMLINK/);
  });
});

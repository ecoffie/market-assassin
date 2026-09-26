/**
 * Real-checkout regressions for the guard's upload-file enumeration.
 *
 * These build ACTUAL git repositories (with a real `origin/main`) and invoke the
 * guard CLI against them, because both bugs here live in the seam between what git
 * reports and what the guard concludes — a hand-written fixture would have agreed
 * with the buggy code.
 *
 * 1. GITIGNORED FILES SHIP TOO. `git status --porcelain` lists only ordinary
 *    untracked files; it hides everything `.gitignore` covers. `.vercelignore`
 *    records that the CLI "uploads the working directory and does NOT honour
 *    .gitignore" — so the hidden half is uploaded as well. On this repo that half
 *    contained `.env.local` and two `.env.local.*-backup` files.
 *
 * 2. A NEGATION IS AN EXCEPTION, NOT AN EXCLUSION. `!path` RE-INCLUDES. Matching
 *    only the broader exclusion above it reports "excluded" for a path that ships —
 *    and since git collapses an untracked directory into ONE entry, a single
 *    re-included child is enough to make the whole directory uploadable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
// @ts-expect-error — plain .mjs guard script, no type declarations by design
import { EXPECTED_PROJECT, EXPECTED_PROJECT_ID, EXPECTED_ORG_ID } from '../../../scripts/guard-prod-deploy.mjs';

const GUARD = join(process.cwd(), 'scripts', 'guard-prod-deploy.mjs');
const made: string[] = [];

afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/**
 * git exports GIT_DIR (and friends) into hook processes, so under a real `git push`
 * these fixtures inherited a pointer to the REAL repository: `git remote add origin`
 * then tried to add a second `origin` to this repo and failed. Scrub them, or the
 * tests pass on a manual hook run and fail on an actual push — which is exactly what
 * happened.
 */
const CLEAN_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_NAMESPACE',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) delete env[k];
  return env;
})();

const git = (args: string[], cwd: string) =>
  execFileSync('git', args, {
    cwd,
    env: CLEAN_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

function write(root: string, rel: string, body: string) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** A real repo on `main`, exactly level with a real `origin/main`. */
function makeCheckout(opts: {
  vercelignore?: string;
  gitignore?: string;
  /** created AFTER the commit, so they are untracked or gitignored */
  extraFiles?: Record<string, string>;
}) {
  const tmp = mkdtempSync(join(tmpdir(), 'guard-real-'));
  made.push(tmp);
  const origin = join(tmp, 'origin.git');
  const work = join(tmp, 'work');

  git(['init', '--bare', '-b', 'main', origin], tmp);
  mkdirSync(work);
  git(['init', '-b', 'main'], work);
  git(['config', 'user.email', 'guard-test@example.com'], work);
  git(['config', 'user.name', 'Guard Test'], work);

  write(work, 'README.md', '# fixture\n');
  if (opts.vercelignore !== undefined) write(work, '.vercelignore', opts.vercelignore);
  // `.vercel/` is written after the commit; ignore it so the fixture's own link
  // metadata never shows up as the thing under test.
  write(work, '.gitignore', `${opts.gitignore ?? ''}\n.vercel/\n`);

  git(['add', '-A'], work);
  git(['commit', '-m', 'base'], work);
  git(['remote', 'add', 'origin', origin], work);
  git(['push', '-u', 'origin', 'main'], work);

  // Linked to the right project, so only the upload-file rules can fire.
  write(
    work,
    '.vercel/project.json',
    JSON.stringify({
      projectId: EXPECTED_PROJECT_ID,
      orgId: EXPECTED_ORG_ID,
      projectName: EXPECTED_PROJECT,
    }),
  );

  for (const [rel, body] of Object.entries(opts.extraFiles ?? {})) write(work, rel, body);
  return work;
}

type GuardResult = {
  ok: boolean;
  blocking: { code: string; message: string }[];
  warnings: string[];
};

function runGuard(cwd: string): GuardResult {
  try {
    const out = execFileSync('node', [GUARD, '--json'], { cwd, env: CLEAN_ENV, encoding: 'utf8' });
    return JSON.parse(out) as GuardResult;
  } catch (e) {
    // Exit 1 is the normal "refused" path; the JSON is still on stdout.
    const out = (e as { stdout?: string }).stdout;
    if (!out) throw e;
    return JSON.parse(out) as GuardResult;
  }
}

const codes = (r: GuardResult) => r.blocking.map((f) => f.code);

// Each test runs ~6 real `git` invocations plus a node subprocess. Vitest's 5s
// default is comfortable in isolation and NOT comfortable when the full 597-file
// suite is saturating the machine — which made these pass standalone and fail under
// the pre-push gate. An explicit budget is the fix; a retry would have hidden it.
const REAL_GIT_TIMEOUT = 60_000;

describe('real checkout — gitignored files are uploaded too', () => {
  it('blocks a GITIGNORED file that .vercelignore does not exclude', () => {
    const work = makeCheckout({
      gitignore: 'secret.env\n',
      vercelignore: '.vercel/\n',
      extraFiles: { 'secret.env': 'TOKEN=live-value\n' },
    });

    // The bug in one assertion: plain porcelain cannot see this file at all, so the
    // original enumeration was inspecting the smaller half of what ships.
    expect(git(['status', '--porcelain'], work)).not.toContain('secret.env');
    expect(git(['status', '--porcelain', '--ignored'], work)).toContain('secret.env');

    const r = runGuard(work);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('gitignored_deployable');
    expect(r.blocking.find((f) => f.code === 'gitignored_deployable')!.message).toContain(
      'secret.env',
    );
  }, REAL_GIT_TIMEOUT);

  it('does NOT block a gitignored file that .vercelignore genuinely excludes', () => {
    const work = makeCheckout({
      gitignore: 'secret.env\n',
      vercelignore: '.vercel/\nsecret.env\n',
      extraFiles: { 'secret.env': 'TOKEN=live-value\n' },
    });
    const r = runGuard(work);
    expect(codes(r)).not.toContain('gitignored_deployable');
    expect(r.ok).toBe(true);
  }, REAL_GIT_TIMEOUT);

  it('covers the real shape: .env.* reaches timestamped backup files', () => {
    // `.env.local.broken-development-backup-20260914-125908` is the actual filename
    // class found in this repo — a literal allow-list would have missed it.
    const work = makeCheckout({
      gitignore: '.env*\n',
      vercelignore: '.vercel/\n.env\n.env.*\n',
      extraFiles: {
        '.env.local': 'A=1\n',
        '.env.local.broken-development-backup-20260914-125908': 'A=1\n',
      },
    });
    const r = runGuard(work);
    expect(codes(r)).not.toContain('gitignored_deployable');
    expect(r.ok).toBe(true);
  }, REAL_GIT_TIMEOUT);
});

describe('real checkout — a .vercelignore negation is an EXCEPTION, not an exclusion', () => {
  it('blocks a directory whose child is re-included by "!"', () => {
    // git collapses the untracked directory to ONE entry, so matching only
    // `bundle/` would report "excluded" while `bundle/keep.txt` actually ships.
    const work = makeCheckout({
      vercelignore: '.vercel/\nbundle/\n!bundle/keep.txt\n',
      extraFiles: { 'bundle/keep.txt': 'ships\n', 'bundle/other.txt': 'excluded\n' },
    });
    const r = runGuard(work);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('untracked_deployable');
  }, REAL_GIT_TIMEOUT);

  it('blocks a gitignored path re-included by "!"', () => {
    const work = makeCheckout({
      gitignore: 'artifacts/\n',
      vercelignore: '.vercel/\nartifacts/\n!artifacts/report.json\n',
      extraFiles: { 'artifacts/report.json': '{}\n' },
    });
    const r = runGuard(work);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('gitignored_deployable');
  }, REAL_GIT_TIMEOUT);

  it('refuses to claim exclusion when a negation cannot be evaluated', () => {
    // An un-evaluatable re-include could resurrect anything beneath any exclusion.
    const work = makeCheckout({
      vercelignore: '.vercel/\nbundle/\n!bundle/**/*.keep\n',
      extraFiles: { 'bundle/thing.txt': 'x\n' },
    });
    const r = runGuard(work);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('untracked_deployable');
  }, REAL_GIT_TIMEOUT);

  it('keeps intentional exclusions excluded — no negation, nothing blocks', () => {
    // The control: the guard must stay quiet on a normal, correctly-ignored tree.
    const work = makeCheckout({
      gitignore: 'node_modules/\n',
      vercelignore: '.vercel/\nnode_modules\nbundle/\n',
      extraFiles: { 'bundle/a.txt': 'x\n', 'node_modules/pkg/index.js': 'x\n' },
    });
    const r = runGuard(work);
    expect(r.blocking).toEqual([]);
    expect(r.ok).toBe(true);
  }, REAL_GIT_TIMEOUT);
});

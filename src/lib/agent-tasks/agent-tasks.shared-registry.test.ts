import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveRuntimeRegistryPath,
  resolveSeedRegistryPath,
  readRegistryFile,
  mutateRegistry,
  resolveExplicitRegistryPath,
} from './registry';
import { acquireRegistryLock, lockDirForRegistry } from './lock';
import { diagnoseRegistry } from './doctor';
import { upsertTask } from './operations';
import { createEmptyRegistry } from './types';
import type { TaskRecord } from './types';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BOOTSTRAP_PROBE = join(REPO_ROOT, 'scripts/fixtures/agent-tasks/bootstrap-probe.mts');

/** Strip inherited GIT_* vars so temp-repo git ops work inside push hooks. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim();
}

function seedTrackedRegistry(repoDir: string): void {
  const seedDir = join(repoDir, '.claude/agent-tasks');
  mkdirSync(seedDir, { recursive: true });
  const seed = createEmptyRegistry('2026-08-30T20:30:00.000Z');
  writeFileSync(join(seedDir, 'registry.json'), `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  git(['add', '.claude/agent-tasks/registry.json'], repoDir);
  git(['commit', '-m', 'track seed registry'], repoDir);
}

function testTask(id: string): TaskRecord {
  const now = new Date().toISOString();
  return {
    id,
    title: 'SECRET-TITLE-DO-NOT-LEAK',
    priority: 'low',
    state: 'proposed',
    authorizedScope: 'shared-registry test only',
    allowedPaths: ['src/lib/agent-tasks/**'],
    forbiddenPaths: ['.env*'],
    dependencies: [],
    assignedRole: null,
    branch: null,
    worktree: null,
    baseSha: '13c30b762da10e19e3897079f5e1059dee1fb475',
    lease: null,
    verificationProfile: ['ma-skills'],
    allowSameAgentVerification: false,
    checkpoints: [],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['read_only'],
    approvalRequired: 'human_review',
    createdAt: now,
    updatedAt: now,
  };
}

describe('shared runtime registry (real git worktrees)', () => {
  let repoDir: string;
  let mainWt: string;
  let linkedWt: string;
  let runtimePath: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'agent-task-shared-repo-'));
    git(['init'], repoDir);
    git(['config', 'user.email', 'test@example.com'], repoDir);
    git(['config', 'user.name', 'test'], repoDir);
    seedTrackedRegistry(repoDir);
    mainWt = repoDir;
    linkedWt = join(repoDir, 'linked wt');
    git(['worktree', 'add', '-b', 'linked-branch', linkedWt], repoDir);
    const resolved = resolveRuntimeRegistryPath(mainWt);
    if (!resolved.ok) throw new Error(resolved.message);
    runtimePath = resolved.value;
    rmSync(runtimePath, { force: true });
    rmSync(lockDirForRegistry(runtimePath), { recursive: true, force: true });
  }, 120_000);

  afterAll(() => {
    if (runtimePath) {
      rmSync(lockDirForRegistry(runtimePath), { recursive: true, force: true });
      rmSync(runtimePath, { force: true });
    }
    if (repoDir && linkedWt) {
      try {
        git(['worktree', 'remove', linkedWt, '--force'], repoDir);
      } catch {
        /* best effort */
      }
    }
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  }, 120_000);

  it('main + linked worktree resolve identical runtime and lock paths', () => {
    const a = resolveRuntimeRegistryPath(mainWt);
    const b = resolveRuntimeRegistryPath(linkedWt);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.value).toBe(b.value);
    expect(lockDirForRegistry(a.value!)).toBe(lockDirForRegistry(b.value!));
  });

  it('runtime path differs from both tracked seed paths', () => {
    const runtime = resolveRuntimeRegistryPath(mainWt);
    const seedMain = resolveSeedRegistryPath(mainWt);
    const seedLinked = resolveSeedRegistryPath(linkedWt);
    expect(runtime.ok && seedMain.ok && seedLinked.ok).toBe(true);
    expect(runtime.value).not.toBe(seedMain.value);
    expect(runtime.value).not.toBe(seedLinked.value);
    expect(seedMain.value).not.toBe(seedLinked.value);
  });

  it('mutation from worktree A is visible read-only from worktree B', () => {
    const r = upsertTask(runtimePath, testTask('TASK-SHARED-REG-TEST'), 'test-admin');
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    expect(r.ok).toBe(true);
    const fromLinked = readRegistryFile(runtimePath);
    expect(fromLinked.ok).toBe(true);
    expect(fromLinked.value.tasks['TASK-SHARED-REG-TEST']).toBeDefined();
  });

  it('seed content, mtime, and git status remain unchanged after runtime mutation', () => {
    for (const wt of [mainWt, linkedWt]) {
      const seed = resolveSeedRegistryPath(wt);
      expect(seed.ok).toBe(true);
      const before = readFileSync(seed.value!, 'utf8');
      const mtimeBefore = statSync(seed.value!).mtimeMs;
      const statusBefore = git(['status', '--porcelain', '--', '.claude/agent-tasks/registry.json'], wt);
      expect(readRegistryFile(runtimePath).ok).toBe(true);
      const after = readFileSync(seed.value!, 'utf8');
      const mtimeAfter = statSync(seed.value!).mtimeMs;
      const statusAfter = git(['status', '--porcelain', '--', '.claude/agent-tasks/registry.json'], wt);
      expect(after).toBe(before);
      expect(mtimeAfter).toBe(mtimeBefore);
      expect(statusAfter).toBe(statusBefore);
    }
  });

  it('lock acquired from main blocks mutation from linked worktree', () => {
    const held = acquireRegistryLock({ registryPath: runtimePath, owner: 'holder-a', waitMs: 100 });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    try {
      const blocked = mutateRegistry(
        runtimePath,
        null,
        (reg) => ({ ok: true, value: reg.revision }),
        { lockOwner: 'holder-b', waitMs: 200 },
      );
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe('lock_timeout');
    } finally {
      held.value.release();
    }
  });

  it('two concurrent first-use bootstraps produce one valid revision-0 registry', async () => {
    rmSync(runtimePath, { force: true });
    rmSync(lockDirForRegistry(runtimePath), { recursive: true, force: true });

    const env = { ...gitEnv(), RUNTIME_PATH: runtimePath };
    const tsxBin = join(REPO_ROOT, 'node_modules/.bin/tsx');
    // A missing dependency tree (a FRESH worktree where `npm ci` has not run) makes this
    // spawn fail with ENOENT. `spawn` reports that on the 'error' event, NOT 'close' — so
    // without this handler the promise never settles and the failure surfaces only as an
    // opaque 10s Vitest timeout with no cause. Measured 2026-08-30: that cost a full
    // misdiagnosis as a concurrency/lock regression. Fail FAST and SAY WHY.
    expect(existsSync(tsxBin), `tsx missing at ${tsxBin} — run \`npm ci\` in this worktree`).toBe(true);

    const runProbe = (owner: string) =>
      new Promise<number>((resolve) => {
        const p = spawn(tsxBin, [BOOTSTRAP_PROBE], {
          cwd: REPO_ROOT,
          env: { ...env, LOCK_OWNER: owner },
          stdio: 'pipe',
        });
        let err = '';
        p.stderr?.on('data', (d) => { err += String(d); });
        p.on('error', (e) => {
          // Never leave the promise pending — an unsettled spawn is invisible to the runner.
          console.error(`probe ${owner} failed to spawn:`, e.message);
          resolve(-1);
        });
        p.on('close', (code, signal) => {
          if (code !== 0) console.error(`probe ${owner}: code=${code} signal=${signal} stderr=${err.trim() || '(none)'}`);
          resolve(code ?? 1);
        });
      });

    const [a, b] = await Promise.all([runProbe('a'), runProbe('b')]);
    expect(a).toBe(0);
    expect(b).toBe(0);
    expect(existsSync(runtimePath)).toBe(true);
    const read = readRegistryFile(runtimePath);
    expect(read.ok).toBe(true);
    expect(read.value.revision).toBe(0);
    expect(Object.keys(read.value.tasks)).toHaveLength(0);
  });

  it('supports relative and absolute registry overrides', () => {
    const relDir = mkdtempSync(join(tmpdir(), 'agent-override-rel-'));
    const absDir = mkdtempSync(join(tmpdir(), 'agent-override-abs-'));
    try {
      const rel = resolveRuntimeRegistryPath(mainWt, 'custom/registry.json');
      expect(rel.ok).toBe(true);
      expect(rel.value).toBe(resolveExplicitRegistryPath(mainWt, 'custom/registry.json'));

      const absFile = join(absDir, 'registry.json');
      const abs = resolveRuntimeRegistryPath(mainWt, absFile);
      expect(abs.ok).toBe(true);
      expect(abs.value).toBe(absFile);
    } finally {
      rmSync(relDir, { recursive: true, force: true });
      rmSync(absDir, { recursive: true, force: true });
    }
  });

  it('fails closed outside a git repository without writing runtime files', () => {
    const outside = mkdtempSync(join(tmpdir(), 'agent-not-git-'));
    try {
      const r = resolveRuntimeRegistryPath(outside);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('not_git_repository');
      const commonGuess = join(outside, '.git', 'agent-tasks', 'registry.json');
      expect(existsSync(commonGuess)).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('doctor is read-only and omits task payloads', () => {
    const beforeExists = existsSync(runtimePath);
    const report = diagnoseRegistry(linkedWt);
    expect(report.lockPresent).toBe(false);
    expect(existsSync(lockDirForRegistry(runtimePath))).toBe(false);
    expect(existsSync(runtimePath)).toBe(beforeExists);
    expect(JSON.stringify(report)).not.toContain('SECRET-TITLE-DO-NOT-LEAK');
    expect(report.runtimeTaskCount ?? 0).toBeGreaterThanOrEqual(0);
    expect(report.runtimeIsShared).toBe(true);
    expect(report.runtimeEqualsSeed).toBe(false);
  });
});

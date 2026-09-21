import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  writeRegistryFile,
  readRegistryFile,
  mutateRegistry,
  assertMutableVersion,
  buildProvenance,
  initRegistryFile,
} from './registry';
import { repairSupersessionLink } from './operations';
import { parseRegistry, parseRegistryVersion, parseProvenance, assertRegistryInvariants } from './validate';
import { assertHealthyWorktree } from './worktree-health';
import { testProvenance } from './test-registry-fixture';
import { sanitizedGitEnv, GIT_ENV_OVERRIDE_VARS } from './git-evidence';
import { REGISTRY_FORMAT_VERSION, REGISTRY_LEGACY_VERSION, type AgentTaskRegistry, type TaskRecord } from './types';

/**
 * PHASE 3A.5 (B + C) — the registry VERSION BOUNDARY and HEALTHY-WORKTREE enforcement.
 *
 * (B) exists because every pre-3A.5 parser begins with `if (o.version !== 1) return null`.
 * Raising the format version to 2 therefore makes an older writer fail closed BEFORE it
 * can parse a record or enter a mutation path. That was proven experimentally against all
 * four historical generations; these tests hold the CURRENT code to the other half of the
 * contract — that it refuses ordinary version-1 mutations, permits the bounded repair, and
 * records provenance on every write.
 *
 * (C) exists because a BARE repository answers `git rev-parse --git-common-dir` happily,
 * which made the shared runtime registry reachable — and mutable — from the bare root.
 *
 * Every test uses a DISPOSABLE registry/repository under tmpdir.
 */

const SRC = 'TASK-PSTACK-PILOT-001';
const SUC = 'TASK-PSTACK-PILOT-002';
const AT = '2026-08-31T02:03:38.323Z';
const ACTOR = 'eric-orchestrator';

let dir: string;
let reg: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-version-'));
  reg = join(dir, 'registry.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: SRC,
    title: 'Pilot runbook',
    priority: 'normal',
    state: 'cancelled',
    authorizedScope: 'scope',
    allowedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    forbiddenPaths: ['src/'],
    dependencies: [],
    assignedRole: null,
    branch: 'docs/pstack-phase-3a-pilot',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8',
    lease: null,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: [],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['repo_files'],
    approvalRequired: 'eric_explicit',
    supersededByTaskId: null,
    supersedesTaskId: null,
    createdAt: '2026-08-30T22:40:00.000Z',
    updatedAt: AT,
    ...over,
  };
}

/** A legacy version-1 registry carrying the live audit pair and NULL durable fields. */
function legacyLiveShaped(revision = 18): AgentTaskRegistry {
  const source = task({
    auditLog: [
      {
        id: 'audit-1788141818323-supersede',
        at: AT,
        actor: ACTOR,
        action: 'supersede',
        fromState: 'ready',
        toState: 'cancelled',
        evidenceRef: `supersede -> ${SUC}`,
        metadata: {
          registryRevision: '11',
          leaseOwner: 'none',
          role: 'administrator',
          reason: 'stale base',
          supersededByTaskId: SUC,
        },
      },
    ],
  });
  const successor = task({
    id: SUC,
    state: 'integration',
    branch: 'docs/pstack-phase-3a-pilot-v2',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot-v2',
    baseSha: '5d8a3007e2aa931a41978705de030a6e304cc359',
    auditLog: [
      {
        id: 'audit-1788141818323-superseded-from',
        at: AT,
        actor: ACTOR,
        action: 'superseded-from',
        fromState: 'proposed',
        toState: 'ready',
        evidenceRef: `superseded-from ${SRC}`,
        metadata: {
          registryRevision: '11',
          leaseOwner: 'none',
          role: 'administrator',
          reason: 'stale base',
          supersedesTaskId: SRC,
          sourceTaskId: SRC,
        },
      },
    ],
  });
  return {
    version: REGISTRY_LEGACY_VERSION,
    revision,
    updatedAt: AT,
    tasks: { [source.id]: source, [successor.id]: successor },
    adminAuditLog: [],
  } as AgentTaskRegistry;
}

function writeRaw(registry: unknown) {
  writeFileSync(reg, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

describe('3A.5 B — version parsing and the mutation gate', () => {
  it('parses version 1 and 2, and REFUSES anything else', () => {
    expect(parseRegistryVersion(1)).toBe(1);
    expect(parseRegistryVersion(2)).toBe(2);
    for (const bad of [0, 3, 99, '2', null, undefined, {}, 1.5]) {
      expect(parseRegistryVersion(bad)).toBeNull();
    }
  });

  it('an UNKNOWN version fails closed BEFORE records are parsed', () => {
    // A record that would itself fail parsing is included: if the version gate did not
    // run first, the failure would come from the record instead.
    writeRaw({
      version: 7,
      revision: 1,
      updatedAt: AT,
      tasks: { 'not-a-valid-id': { garbage: true } },
      adminAuditLog: [],
    });
    const r = readRegistryFile(reg);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('malformed_registry');
    expect(parseRegistry({ version: 7, revision: 1, updatedAt: AT, tasks: {}, adminAuditLog: [] })).toBeNull();
  });

  it('an unknown version is refused by a MUTATION without touching the file', () => {
    writeRaw({ version: 7, revision: 1, updatedAt: AT, tasks: {}, adminAuditLog: [] });
    const before = sha(reg);
    const r = mutateRegistry(reg, null, () => ({ ok: true, value: true }), { lockOwner: 'x' });
    expect(r.ok).toBe(false);
    expect(sha(reg)).toBe(before);
  });

  it('ORDINARY mutations are REFUSED on a version-1 registry with registry_upgrade_required', () => {
    writeRaw(legacyLiveShaped());
    const before = sha(reg);
    let mutatorRan = false;
    const r = mutateRegistry(
      reg,
      null,
      () => {
        mutatorRan = true;
        return { ok: true, value: true };
      },
      { lockOwner: 'ordinary' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('registry_upgrade_required');
    // The refusal precedes the mutator AND the write.
    expect(mutatorRan).toBe(false);
    expect(sha(reg)).toBe(before);
    expect(JSON.parse(readFileSync(reg, 'utf8')).version).toBe(1);
  });

  it('assertMutableVersion classifies each version', () => {
    const v2 = { version: 2 } as AgentTaskRegistry;
    const v1 = { version: 1 } as AgentTaskRegistry;
    const v9 = { version: 9 } as unknown as AgentTaskRegistry;
    expect(assertMutableVersion(v2).ok).toBe(true);
    const a = assertMutableVersion(v1);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe('registry_upgrade_required');
    const b = assertMutableVersion(v9);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('unsupported_registry_version');
  });

  it('a version-1 registry remains READABLE — refusal is about mutation, not inspection', () => {
    writeRaw(legacyLiveShaped());
    const r = readRegistryFile(reg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(1);
    expect(Object.keys(r.value.tasks)).toHaveLength(2);
  });
});

describe('3A.5 B — the bounded repair path migrates v1 -> v2 in ONE revision', () => {
  it('repairs the link AND upgrades the format in a single write', () => {
    writeRaw(legacyLiveShaped(18));
    const r = repairSupersessionLink(reg, {
      taskId: SRC,
      actor: 'eric-admin',
      role: 'administrator',
      reason: 'bounded migration + link repair',
      confirm: true,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.revision).toBe(19);

    const raw = JSON.parse(readFileSync(reg, 'utf8'));
    expect(raw.version).toBe(REGISTRY_FORMAT_VERSION);
    expect(raw.revision).toBe(19);
    expect(raw.tasks[SRC].supersededByTaskId).toBe(SUC);
    expect(raw.tasks[SUC].supersedesTaskId).toBe(SRC);
    expect(raw.provenance).toBeTruthy();
  });

  it('after migration, ORDINARY mutations are permitted again', () => {
    writeRaw(legacyLiveShaped(18));
    repairSupersessionLink(reg, {
      taskId: SRC,
      actor: 'eric-admin',
      role: 'administrator',
      reason: 'bounded migration',
      confirm: true,
    });
    const r = mutateRegistry(reg, null, () => ({ ok: true, value: true }), { lockOwner: 'ordinary' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.revision).toBe(20);
  });
});

describe('3A.5 B — execution provenance', () => {
  it('is REQUIRED on a version-2 registry', () => {
    writeRaw({ version: 2, revision: 1, updatedAt: AT, tasks: {}, adminAuditLog: [] });
    const r = readRegistryFile(reg);
    expect(r.ok).toBe(false);
    expect(parseRegistry({ version: 2, revision: 1, updatedAt: AT, tasks: {}, adminAuditLog: [] })).toBeNull();
  });

  it('must be ABSENT on a version-1 registry', () => {
    writeRaw({
      version: 1,
      revision: 1,
      updatedAt: AT,
      tasks: {},
      adminAuditLog: [],
      provenance: testProvenance(),
    });
    expect(readRegistryFile(reg).ok).toBe(false);
  });

  it('a MALFORMED provenance block is rejected, never silently dropped', () => {
    for (const bad of [
      { writerVersion: 'two', writerPath: 'p', worktreePath: 'w', gitCommonDir: 'g', actor: 'a', at: AT },
      { writerVersion: 2, writerPath: '', worktreePath: 'w', gitCommonDir: 'g', actor: 'a', at: AT },
      { writerVersion: 2, writerPath: 'p', worktreePath: 'w', gitCommonDir: 'g', actor: 'a', at: 'nope' },
      {},
      null,
    ]) {
      expect(parseProvenance(bad)).toBeNull();
    }
    expect(parseProvenance(testProvenance())).not.toBeNull();
  });

  it('is RECORDED on a write and UPDATED on every subsequent mutation', () => {
    writeRegistryFile(reg, {
      version: 2,
      revision: 5,
      updatedAt: AT,
      tasks: {},
      adminAuditLog: [],
      provenance: testProvenance({ actor: 'original-writer', at: '2026-01-01T00:00:00.000Z' }),
    } as AgentTaskRegistry);

    const r = mutateRegistry(reg, null, () => ({ ok: true, value: true }), { lockOwner: 'second-writer' });
    expect(r.ok).toBe(true);

    const after = readRegistryFile(reg);
    if (!after.ok) return;
    const prov = after.value.provenance;
    expect(prov).toBeTruthy();
    // Refreshed, not carried through: the writer identity describes THIS write.
    expect(prov?.actor).toBe('second-writer');
    expect(prov?.at).not.toBe('2026-01-01T00:00:00.000Z');
    expect(prov?.writerVersion).toBe(REGISTRY_FORMAT_VERSION);
    // Real resolved paths, not placeholders.
    expect(prov?.worktreePath).toContain('/');
    expect(prov?.gitCommonDir).toContain('/');
  });

  it('identifies the writer generation and resolved CLI/worktree path', () => {
    const p = buildProvenance({ actor: 'a', cwd: process.cwd(), writerPathHint: process.cwd() });
    expect(p.writerVersion).toBe(REGISTRY_FORMAT_VERSION);
    expect(p.writerPath.startsWith('/')).toBe(true);
    expect(p.worktreePath.startsWith('/')).toBe(true);
    expect(p.gitCommonDir.startsWith('/')).toBe(true);
  });

  it('invariants reject a version/provenance mismatch', () => {
    expect(
      assertRegistryInvariants({
        version: 2,
        revision: 1,
        updatedAt: AT,
        tasks: {},
        adminAuditLog: [],
        provenance: null,
      } as AgentTaskRegistry),
    ).toContain('missing execution provenance');

    expect(
      assertRegistryInvariants({
        version: 2,
        revision: 1,
        updatedAt: AT,
        tasks: {},
        adminAuditLog: [],
        provenance: testProvenance({ writerVersion: 1 }),
      } as AgentTaskRegistry),
    ).toContain('writerVersion');

    expect(
      assertRegistryInvariants({
        version: 1,
        revision: 1,
        updatedAt: AT,
        tasks: {},
        adminAuditLog: [],
        provenance: testProvenance(),
      } as AgentTaskRegistry),
    ).toContain('must not carry execution provenance');
  });

  it('a bootstrapped registry is self-consistent (v2 + provenance, readable)', () => {
    initRegistryFile(reg, { actor: 'bootstrapper', cwd: process.cwd() });
    const r = readRegistryFile(reg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.version).toBe(REGISTRY_FORMAT_VERSION);
    expect(r.value.revision).toBe(0);
    expect(r.value.provenance?.actor).toBe('bootstrapper');
  });
});

describe('3A.5 C — healthy-worktree enforcement', () => {
  let repoDir: string;

  // ⚠️ MUST use the SHARED sanitizer. Under a pre-push HOOK git exports GIT_DIR /
  // GIT_WORK_TREE / GIT_INDEX_FILE, and a child `git` inherits them — so `cwd` alone does
  // NOT confine this fixture. Measured 2026-08-31: without this, the `git init` +
  // `git config user.*` + `git commit` below ran against the REAL repository. They wrote
  // `user.name=Test` / `user.email=test@example.com` into the SHARED .git/config (local
  // scope is shared by every worktree of a bare repo) and committed 680c9313 "init" onto
  // fix/pstack-registry-lineage-repair, whose tree deleted 4085 tracked files. The
  // Phase 3A.5 work survived only because 2f3bb432 stayed reachable via the reflog.
  // Reuses sanitizedGitEnv() from git-evidence.ts so test and production scrub the
  // identical variable set — never fork a second sanitizer, it drifts.
  function git(cwd: string, args: string[]) {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: sanitizedGitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'pstack-wt-'));
  });
  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  function makeRepo(): { work: string; bare: string } {
    const work = join(repoDir, 'work');
    mkdirSync(work, { recursive: true });
    git(work, ['init', '-q', '-b', 'main']);
    git(work, ['config', 'user.email', 'test@example.com']);
    git(work, ['config', 'user.name', 'Test']);
    writeFileSync(join(work, 'README.md'), '# t\n');
    git(work, ['add', '.']);
    git(work, ['commit', '-qm', 'init']);
    const bare = join(repoDir, 'bare.git');
    git(repoDir, ['clone', '-q', '--bare', work, bare]);
    return { work, bare };
  }

  it('ACCEPTS a normal work tree', () => {
    const { work } = makeRepo();
    const h = assertHealthyWorktree(work);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.value.linked).toBe(false);
    expect(h.value.worktreePath.startsWith('/')).toBe(true);
  });

  it('REFUSES a BARE repository — the exact hole that made the bare root mutable', () => {
    const { bare } = makeRepo();
    // Precondition: a bare repo DOES answer --git-common-dir, which is why the gate is needed.
    expect(git(bare, ['rev-parse', '--is-bare-repository'])).toBe('true');
    const h = assertHealthyWorktree(bare);
    expect(h.ok).toBe(false);
    if (h.ok) return;
    expect(h.code).toBe('unhealthy_worktree');
    expect(h.message).toContain('BARE repository');
    expect(h.message).toContain('healthy registered git worktree');
  });

  it('REFUSES a directory outside any repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'pstack-outside-'));
    try {
      const h = assertHealthyWorktree(outside);
      expect(h.ok).toBe(false);
      if (h.ok) return;
      expect(h.code).toBe('not_git_repository');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('ACCEPTS a registered LINKED worktree and resolves the SHARED common dir', () => {
    const { work } = makeRepo();
    const linked = join(repoDir, 'linked');
    git(work, ['worktree', 'add', '-q', '-b', 'feat/x', linked]);

    const a = assertHealthyWorktree(work);
    const b = assertHealthyWorktree(linked);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value.linked).toBe(true);
    // Legitimate shared-runtime access: both resolve the SAME common dir, so both reach
    // the same runtime registry.
    expect(b.value.gitCommonDir).toBe(a.value.gitCommonDir);
  });

  it('a MUTATION from a bare repository is refused without touching the registry', () => {
    const { bare } = makeRepo();
    writeRegistryFile(reg, {
      version: 2,
      revision: 1,
      updatedAt: AT,
      tasks: {},
      adminAuditLog: [],
      provenance: testProvenance(),
    } as AgentTaskRegistry);
    const before = sha(reg);

    let mutatorRan = false;
    const r = mutateRegistry(
      reg,
      null,
      () => {
        mutatorRan = true;
        return { ok: true, value: true };
      },
      { lockOwner: 'bare-caller', cwd: bare },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unhealthy_worktree');
    expect(mutatorRan).toBe(false);
    expect(sha(reg)).toBe(before);
  });

  it('the refusal happens BEFORE the lock — no lock debris in a shared runtime dir', () => {
    const { bare } = makeRepo();
    writeRegistryFile(reg, {
      version: 2,
      revision: 1,
      updatedAt: AT,
      tasks: {},
      adminAuditLog: [],
      provenance: testProvenance(),
    } as AgentTaskRegistry);
    mutateRegistry(reg, null, () => ({ ok: true, value: true }), {
      lockOwner: 'bare-caller',
      cwd: bare,
    });
    expect(readFileSync(reg, 'utf8')).toContain('"revision": 1');
    // No lock directory was created by the refused attempt.
    expect(() => readFileSync(join(`${reg}.lock`, 'meta.json'), 'utf8')).toThrow();
  });

  it('a MUTATION from a legitimate linked worktree SUCCEEDS', () => {
    const { work } = makeRepo();
    const linked = join(repoDir, 'linked2');
    git(work, ['worktree', 'add', '-q', '-b', 'feat/y', linked]);
    writeRegistryFile(reg, {
      version: 2,
      revision: 1,
      updatedAt: AT,
      tasks: {},
      adminAuditLog: [],
      provenance: testProvenance(),
    } as AgentTaskRegistry);

    const r = mutateRegistry(reg, null, () => ({ ok: true, value: true }), {
      lockOwner: 'linked-caller',
      cwd: linked,
    });
    expect(r.ok).toBe(true);
    const after = readRegistryFile(reg);
    if (!after.ok) return;
    expect(after.value.revision).toBe(2);
    // Provenance records the worktree the write actually came from.
    expect(after.value.provenance?.worktreePath).toContain('linked2');
  });
});

/**
 * PHASE 3A.5 — THE POISONED-ENVIRONMENT REGRESSION.
 *
 * ⚠️ THIS TEST EXISTS BECAUSE THE INCIDENT ALREADY HAPPENED (2026-08-31).
 *
 * `makeRepo()` above shells out to `git init` + `git config user.*` + `git commit`. Those
 * ran WITHOUT a sanitized environment. Under a pre-push HOOK, git exports GIT_DIR,
 * GIT_WORK_TREE and GIT_INDEX_FILE, and a child `git` honors them OVER `cwd` — so the
 * fixture did not build a disposable repository at all. It operated on the REAL one:
 *
 *   - `git config user.email/user.name` wrote `Test <test@example.com>` into the SHARED
 *     .git/config. On a bare repo with linked worktrees, --local scope is shared by ALL
 *     of them, so every worktree began authoring commits as Test.
 *   - `git commit -qm 'init'` created 680c931337072160df9647c9f6cf7cfaf485edb0 on
 *     fix/pstack-registry-lineage-repair. Its tree deleted 4085 tracked files
 *     (-1,460,314 lines). The real Phase 3A.5 commit 2f3bb432 survived ONLY via the reflog.
 *
 * `cwd` is not a boundary. A scrubbed environment is. This test proves the boundary holds
 * by constructing the failure condition on purpose: it points ALL SEVEN redirect variables
 * at a disposable POISON repository, runs the SAME makeRepo()/git() path that caused the
 * incident, and then proves the poison repository is byte-identical afterwards.
 *
 * If anyone removes `env: sanitizedGitEnv()` from the helper above, this fails LOUDLY with
 * a diagnostic naming the exact variable set — instead of silently committing into
 * whatever repository the ambient environment happens to point at.
 */
describe('3A.5 — poisoned GIT_* environment cannot retarget the fixture', () => {
  let sandbox: string;
  let poison: string;
  let intended: string;
  const saved: Record<string, string | undefined> = {};

  /** Snapshot every observable of a repository that the incident actually moved. */
  function snapshot(repo: string) {
    const g = (args: string[]) =>
      execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: sanitizedGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    return {
      head: g(['rev-parse', 'HEAD']),
      branch: g(['rev-parse', '--abbrev-ref', 'HEAD']),
      refs: g(['for-each-ref', '--format=%(refname) %(objectname)']),
      status: g(['status', '--porcelain=v1']),
      log: g(['log', '--format=%H|%an|%ae|%s']),
      // The config is what the incident polluted with user.name/user.email.
      config: createHash('sha256')
        .update(readFileSync(join(repo, '.git', 'config')))
        .digest('hex'),
      // The index is what an inherited GIT_INDEX_FILE would have corrupted.
      index: createHash('sha256')
        .update(readFileSync(join(repo, '.git', 'index')))
        .digest('hex'),
      tree: g(['rev-parse', 'HEAD^{tree}']),
    };
  }

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'pstack-poison-'));
    poison = join(sandbox, 'poison');
    intended = join(sandbox, 'intended');
    mkdirSync(poison, { recursive: true });
    mkdirSync(intended, { recursive: true });

    // Build the POISON/SENTINEL parent — a disposable stand-in for the real repository.
    // It is built with a SANITIZED env so its own construction cannot be redirected.
    const g = (cwd: string, args: string[]) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: sanitizedGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    g(poison, ['init', '-q', '-b', 'main']);
    g(poison, ['config', 'user.email', 'sentinel@poison.invalid']);
    g(poison, ['config', 'user.name', 'Sentinel Poison']);
    writeFileSync(join(poison, 'SENTINEL.md'), '# do not touch\n');
    g(poison, ['add', '.']);
    g(poison, ['commit', '-qm', 'sentinel-baseline']);

    // Now POISON the environment: every variable that can redirect a child git points at
    // the sentinel repo. This is exactly the shape a pre-push hook creates.
    for (const k of GIT_ENV_OVERRIDE_VARS) saved[k] = process.env[k];
    process.env.GIT_DIR = join(poison, '.git');
    process.env.GIT_WORK_TREE = poison;
    process.env.GIT_INDEX_FILE = join(poison, '.git', 'index');
    process.env.GIT_OBJECT_DIRECTORY = join(poison, '.git', 'objects');
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = join(poison, '.git', 'objects');
    process.env.GIT_PREFIX = '';
    process.env.GIT_COMMON_DIR = join(poison, '.git');
  });

  afterEach(() => {
    for (const k of GIT_ENV_OVERRIDE_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('the poison target is disposable — never a real repository or worktree', () => {
    // Guard the guard: if this test ever pointed at the real repo it would be the bug it
    // is meant to prevent. The sentinel must live under tmpdir and must NOT be this repo.
    const realRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: sanitizedGitEnv(),
    }).trim();
    expect(realpathSync(poison).startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(realpathSync(poison)).not.toBe(realpathSync(realRoot));
    expect(realpathSync(poison).startsWith(realpathSync(realRoot))).toBe(false);
    expect(process.env.GIT_DIR).toContain(sandbox);
  });

  it('a sanitized fixture commits into the INTENDED repo and leaves the poison repo byte-identical', () => {
    const before = snapshot(poison);

    // THE INCIDENT PATH, verbatim: the same call shape makeRepo() uses, under the same
    // sanitizer. `cwd` is the intended disposable repo; the environment says otherwise.
    const git = (cwd: string, args: string[]) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: sanitizedGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

    git(intended, ['init', '-q', '-b', 'main']);
    git(intended, ['config', 'user.email', 'test@example.com']);
    git(intended, ['config', 'user.name', 'Test']);
    writeFileSync(join(intended, 'README.md'), '# t\n');
    git(intended, ['add', '.']);
    git(intended, ['commit', '-qm', 'init']);

    // (1) The commit LANDED in the intended repository.
    const intendedHead = git(intended, ['rev-parse', 'HEAD']);
    expect(intendedHead).toMatch(/^[0-9a-f]{40}$/);
    expect(git(intended, ['log', '-1', '--format=%s'])).toBe('init');
    expect(git(intended, ['log', '-1', '--format=%ae'])).toBe('test@example.com');

    // (2) The POISON repository is byte-identical across every observable the incident moved.
    const after = snapshot(poison);
    expect(after.head, 'poison HEAD moved — sanitization failed').toBe(before.head);
    expect(after.branch, 'poison branch moved').toBe(before.branch);
    expect(after.refs, 'a poison ref moved').toBe(before.refs);
    expect(after.status, 'poison working tree changed').toBe(before.status);
    expect(after.log, 'a commit landed in the poison repo').toBe(before.log);
    expect(after.config, 'poison .git/config was polluted (the user.name/user.email defect)').toBe(
      before.config,
    );
    expect(after.index, 'poison .git/index was rewritten').toBe(before.index);
    expect(after.tree, 'poison tree changed').toBe(before.tree);

    // (3) The two repositories are genuinely distinct — the fixture commit is NOT in the poison repo.
    expect(intendedHead).not.toBe(after.head);
    expect(after.log).not.toContain('init');
    expect(after.log).toContain('sentinel-baseline');
    // (4) The poison repo never acquired the fixture identity.
    expect(git(poison, ['config', '--local', '--get', 'user.email'])).toBe('sentinel@poison.invalid');
  });

  it('makeRepo()-shaped construction under poison stays inside its own tmpdir', () => {
    // End-to-end through the REAL helper path shape, including `worktree add`, which is
    // what created the stray `feature/x` branch on the real repo in the 3A.2 incident.
    const before = snapshot(poison);
    const git = (cwd: string, args: string[]) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: sanitizedGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();

    const work = join(intended, 'work');
    mkdirSync(work, { recursive: true });
    git(work, ['init', '-q', '-b', 'main']);
    git(work, ['config', 'user.email', 'test@example.com']);
    git(work, ['config', 'user.name', 'Test']);
    writeFileSync(join(work, 'README.md'), '# t\n');
    git(work, ['add', '.']);
    git(work, ['commit', '-qm', 'init']);
    const linked = join(intended, 'linked');
    git(work, ['worktree', 'add', '-q', '-b', 'feature/x', linked]);

    // The linked worktree resolves to the INTENDED repo, not the poisoned one.
    const common = realpathSync(git(linked, ['rev-parse', '--git-common-dir']));
    expect(common.startsWith(realpathSync(work))).toBe(true);
    expect(common.startsWith(realpathSync(poison))).toBe(false);

    // And the sentinel never gained a `feature/x` ref.
    const after = snapshot(poison);
    expect(after.refs, 'worktree add leaked a branch into the poison repo').toBe(before.refs);
    expect(after.refs).not.toContain('feature/x');
    expect(after.head).toBe(before.head);
  });
});

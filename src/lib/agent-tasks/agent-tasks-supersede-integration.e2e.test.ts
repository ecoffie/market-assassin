import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { spawnTsxSync } from './test-cli-spawn';
import { sanitizedGitEnv } from './git-evidence';
import { testProvenance } from './test-registry-fixture';
import { lockDirForRegistry } from './lock';
import { createLease } from './lease';
import type { AgentTaskRegistry, TaskRecord } from './types';

/**
 * PHASE 3A.6 — CLI supersession from a lease-free `integration` phase.
 *
 * The live blocker this closes: TASK-PSTACK-PILOT-002 in `integration`, lease null,
 * base two commits behind main, rejected with
 * `invalid_transition: cannot cancel from integration`.
 *
 * `supersede` has NO --no-git and NO --current-main override, so this e2e runs against
 * the real repo and asserts the successor lands on the REAL current origin/main —
 * proving the base is derived from git metadata, never from caller input.
 *
 * Registry is disposable (tmpdir). The real pilot registry is never touched.
 */

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/agent-task.mts');
const STALE_BASE = '5d8a3007e2aa931a41978705de030a6e304cc359';
const RUNBOOK = 'docs/engineering/pstack-phase-3a-pilot-runbook.md';

let dir: string;
let reg: string;

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function realMainSha(): string {
  return execFileSync('git', ['rev-parse', 'origin/main'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: sanitizedGitEnv(),
  })
    .trim()
    .toLowerCase();
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'TASK-E2E-INT-002',
    title: 'Document the Phase 3A three-role pilot runbook',
    priority: 'high',
    state: 'integration',
    authorizedScope: 'docs-only pilot',
    allowedPaths: [RUNBOOK],
    forbiddenPaths: ['src/**'],
    dependencies: [],
    assignedRole: 'integrator',
    branch: 'docs/e2e-int-v2',
    worktree: '.claude/worktrees/e2e-int-v2',
    baseSha: STALE_BASE,
    lease: null,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: [],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['repo_files', 'git_commit'],
    approvalRequired: 'eric_explicit',
    supersededByTaskId: null,
    supersedesTaskId: null,
    createdAt: '2026-08-31T02:03:38.323Z',
    updatedAt: '2026-08-31T02:33:16.303Z',
    ...over,
  };
}

function seed(tasks: TaskRecord[], revision = 19) {
  const r: AgentTaskRegistry = {
    version: 2,
    revision,
    updatedAt: '2026-08-31T05:41:30.532Z',
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    adminAuditLog: [],
    provenance: testProvenance(),
  };
  writeFileSync(reg, JSON.stringify(r, null, 2));
}

function run(args: string[]) {
  return spawnTsxSync(SCRIPT, [...args, '--registry', reg], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
}

const OK_ARGS = [
  'supersede',
  'TASK-E2E-INT-002',
  '--new-task',
  'TASK-E2E-INT-003',
  '--branch',
  'docs/e2e-int-v3',
  '--worktree',
  '.claude/worktrees/e2e-int-v3',
  '--actor',
  'eric-orchestrator',
  '--role',
  'administrator',
  '--reason',
  'Supersede stale integration task after Phase 3A.5 landed',
  '--confirm',
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-3a6-e2e-'));
  reg = join(dir, 'registry.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('3A.6 CLI — lease-free integration supersession', () => {
  it('supersedes a lease-free integration source onto REAL current main', () => {
    seed([task()]);
    const r = run(OK_ARGS);
    expect(r.status, r.stderr).toBe(0);

    const out = JSON.parse(r.stdout);
    expect(out.revision).toBe(20);
    expect(out.source.state).toBe('cancelled');
    expect(out.source.baseSha).toBe(STALE_BASE);
    expect(out.source.supersededByTaskId).toBe('TASK-E2E-INT-003');
    expect(out.successor.state).toBe('ready');
    expect(out.successor.checkpoints).toBe(0);
    expect(out.successor.supersedesTaskId).toBe('TASK-E2E-INT-002');
    // Derived from git, not from any flag.
    expect(out.successor.baseSha).toBe(realMainSha());
    expect(out.successor.baseSha).not.toBe(STALE_BASE);
  });

  it('rejects the same case BEFORE 3A.6 semantics: an ACTIVE lease still blocks', () => {
    // Built with the real helper, not a hand-shaped literal: a lease whose field names
    // drift from the schema fails as malformed_registry and would silently stop testing
    // the lease gate at all.
    seed([task({ lease: createLease('pstack-pilot-integrator-v2', 'integrator', Date.now()) })]);
    const before = sha256(reg);
    const r = run(OK_ARGS);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('lease_conflict');
    expect(sha256(reg)).toBe(before);
  });

  it('rejects a terminal (merged) source and leaves the registry byte-identical', () => {
    seed([task({ state: 'merged' })]);
    const before = sha256(reg);
    const r = run(OK_ARGS);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('invalid_transition');
    expect(sha256(reg)).toBe(before);
  });

  it('rejects a non-administrator role', () => {
    seed([task()]);
    const before = sha256(reg);
    const args = OK_ARGS.map((a) => (a === 'administrator' ? 'integrator' : a));
    const r = run(args);
    expect(r.status).not.toBe(0);
    expect(sha256(reg)).toBe(before);
  });

  it('rejects a missing --confirm', () => {
    seed([task()]);
    const before = sha256(reg);
    const r = run(OK_ARGS.filter((a) => a !== '--confirm'));
    expect(r.status).not.toBe(0);
    expect(sha256(reg)).toBe(before);
  });

  it('offers NO base/state override flags on supersede', () => {
    const help = run(['--help']);
    const line = help.stdout
      .split('\n')
      .find((l) => l.trim().startsWith('supersede TASK-OLD'));
    expect(line).toBeTruthy();
    expect(line).not.toContain('--no-git');
    expect(line).not.toContain('--base');
    expect(line).not.toContain('--current-main');
    expect(line).not.toContain('--state');
  });

  it('ignores a caller-supplied --current-main and still uses real git', () => {
    seed([task()]);
    const bogus = '0000000000000000000000000000000000000000';
    const r = run([...OK_ARGS, '--current-main', bogus]);
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.successor.baseSha).toBe(realMainSha());
    expect(out.successor.baseSha).not.toBe(bogus);
  });

  it('leaves no lock directory behind after a successful run', () => {
    seed([task()]);
    expect(run(OK_ARGS).status).toBe(0);
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
  });

  it('read-only diagnostics agree: chain, deps and collisions after supersession', () => {
    seed([task()]);
    expect(run(OK_ARGS).status).toBe(0);

    const deps = run(['deps', 'TASK-E2E-INT-003']);
    expect(deps.status).toBe(0);
    expect(JSON.parse(deps.stdout).ok).toBe(true);

    const col = run(['collisions']);
    expect(col.status).toBe(0);
    expect(JSON.parse(col.stdout).collisionCount).toBe(0);

    const after = JSON.parse(readFileSync(reg, 'utf8'));
    expect(after.tasks['TASK-E2E-INT-002'].supersededByTaskId).toBe('TASK-E2E-INT-003');
    expect(after.tasks['TASK-E2E-INT-003'].supersedesTaskId).toBe('TASK-E2E-INT-002');
    expect(after.version).toBe(2);
    expect(after.provenance.writerVersion).toBe(2);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testProvenance } from './test-registry-fixture';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { spawnTsxSync } from './test-cli-spawn';
import { sanitizedGitEnv } from './git-evidence';
import type { AgentTaskRegistry, TaskRecord } from './types';

/**
 * PHASE 3A.3 — CLI lifecycle for `supersede`.
 *
 * The CLI deliberately has NO --no-git path and NO --current-main override for
 * supersede: the successor's base must come from real origin/main, so this e2e runs
 * against the real repo and asserts the successor lands on the REAL current main.
 *
 * Registry is disposable (tmpdir). The real pilot registry is never touched.
 */

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/agent-task.mts');
const OLD_BASE = '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8';

let dir: string;
let reg: string;

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
    id: 'TASK-E2E-SRC-001',
    title: 'Superseded source',
    priority: 'normal',
    state: 'ready',
    authorizedScope: 'docs only',
    allowedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    forbiddenPaths: ['src/**'],
    dependencies: [],
    assignedRole: null,
    branch: 'docs/e2e-src',
    worktree: '.claude/worktrees/e2e-src',
    baseSha: OLD_BASE,
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
    createdAt: '2026-08-30T22:40:00.000Z',
    updatedAt: '2026-08-30T22:50:00.000Z',
    ...over,
  };
}

function seed(tasks: TaskRecord[], revision = 10) {
  const r: AgentTaskRegistry = {
    version: 2,
    revision,
    updatedAt: '2026-08-30T22:52:31.327Z',
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
  'TASK-E2E-SRC-001',
  '--new-task',
  'TASK-E2E-SRC-002',
  '--branch',
  'docs/e2e-successor',
  '--worktree',
  '.claude/worktrees/e2e-successor',
  '--actor',
  'eric-orchestrator',
  '--role',
  'administrator',
  '--reason',
  'Refresh base to current main',
  '--confirm',
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-supersede-e2e-'));
  reg = join(dir, 'registry.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI supersede lifecycle', () => {
  it('closes the source and creates a successor anchored on REAL origin/main', () => {
    seed([task()]);
    const r = run(OK_ARGS);
    expect(r.status, r.stderr).toBe(0);

    const out = JSON.parse(r.stdout);
    expect(out.revision).toBe(11);
    expect(out.source.state).toBe('cancelled');
    expect(out.source.baseSha).toBe(OLD_BASE);
    expect(out.source.supersededByTaskId).toBe('TASK-E2E-SRC-002');
    expect(out.successor.state).toBe('ready');
    expect(out.successor.checkpoints).toBe(0);
    expect(out.successor.supersedesTaskId).toBe('TASK-E2E-SRC-001');
    // The base came from git, not from any flag.
    expect(out.successor.baseSha).toBe(realMainSha());
    expect(out.successor.baseSha).not.toBe(OLD_BASE);
  });

  it('the superseded source disappears from `list --ready` and the successor appears', () => {
    seed([task()]);
    expect(run(OK_ARGS).status).toBe(0);
    const listed = run(['list', '--ready']);
    expect(listed.status).toBe(0);
    // Assert on the QUEUED IDS, not raw text: the successor legitimately REFERENCES the
    // source via supersedesTaskId, so a substring check would always find it.
    const ids = JSON.parse(listed.stdout).tasks.map((t: { id: string }) => t.id);
    expect(ids).toContain('TASK-E2E-SRC-002');
    expect(ids).not.toContain('TASK-E2E-SRC-001');
  });

  it('rejects a non-administrator at the CLI boundary', () => {
    seed([task()]);
    const r = run(OK_ARGS.map((a) => (a === 'administrator' ? 'builder' : a)));
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}${r.stdout}`).toContain('administrator');
    expect(JSON.parse(readFileSync(reg, 'utf8')).tasks['TASK-E2E-SRC-002']).toBeUndefined();
  });

  it('rejects a missing --confirm at the CLI boundary', () => {
    seed([task()]);
    const r = run(OK_ARGS.filter((a) => a !== '--confirm'));
    expect(r.status).not.toBe(0);
    expect(JSON.parse(readFileSync(reg, 'utf8')).tasks['TASK-E2E-SRC-002']).toBeUndefined();
  });

  it('rejects missing required arguments with the usage line', () => {
    seed([task()]);
    const r = run(['supersede', 'TASK-E2E-SRC-001', '--actor', 'eric', '--role', 'administrator']);
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}${r.stdout}`).toContain('usage: supersede');
  });

  it('offers no --current-main override — the base cannot be fabricated from the CLI', () => {
    seed([task()]);
    const r = run([...OK_ARGS, '--current-main', '0000000000000000000000000000000000000000']);
    expect(r.status).toBe(0);
    // The bogus flag is ignored; the real main still wins.
    expect(JSON.parse(r.stdout).successor.baseSha).toBe(realMainSha());
  });

  it('leaves the registry untouched when the successor id already exists', () => {
    seed([task(), task({ id: 'TASK-E2E-SRC-002', branch: 'other', worktree: 'other-wt' })]);
    const before = readFileSync(reg, 'utf8');
    const r = run(OK_ARGS);
    expect(r.status).not.toBe(0);
    expect(readFileSync(reg, 'utf8')).toBe(before);
  });
});

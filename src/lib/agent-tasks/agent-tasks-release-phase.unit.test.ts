import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testProvenance } from './test-registry-fixture';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLease } from './lease';
import { lockDirForRegistry } from './lock';
import { writeRegistryFile, readRegistryFile } from './registry';
import { releaseTask, reconcileTaskState } from './operations';
import { resolveReleaseState, deriveStateFromCheckpoints } from './release-phase';
import { DEFAULT_LEASE_MS } from './types';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

/**
 * DEFECT B — phase-aware release + checkpoint-derived reconciliation.
 *
 * The real pilot exposed this: a task in `integration` with a valid verified checkpoint
 * chain was released and fell back to `ready`, discarding the builder and verifier phases
 * that had already been paid for and proven.
 */

const BASE_A = '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8';
const CANDIDATE_B = 'db3efa4d9357cc357c70897175ed7c7e514b8c4d';
const TREE_B = '8d8b5c4744939e8ed4a33b8a7e6d6f8e453b79a4';

function results(headSha: string, ranAt = '2026-08-30T22:50:30.000Z') {
  return [
    { command: 'npm run verify:ma-skills', status: 'passed' as const, ranAt, headSha, exitCode: 0 },
    { command: 'git diff --check', status: 'passed' as const, ranAt, headSha, exitCode: 0 },
  ];
}

function builderCp(headSha = CANDIDATE_B, treeSha = TREE_B, actor = 'builder-a'): TaskCheckpoint {
  return {
    id: 'cp-pilot-001-ready-for-verification',
    at: '2026-08-30T22:48:00.000Z',
    actor,
    role: 'builder',
    outcome: 'ready_for_verification',
    changedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    diffStat: { files: 1, insertions: 298, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills', 'git diff --check'],
      commandResults: results(headSha),
      candidateHeadSha: headSha,
      candidateTreeSha: treeSha,
      notes: '',
    },
    blockers: [],
    mutationsPerformed: ['repo_files', 'git_commit'],
    authorizationConsumed: [],
    nextRequestedAction: 'verify',
  };
}

function verifierCp(headSha = CANDIDATE_B, treeSha = TREE_B, actor = 'verifier-a'): TaskCheckpoint {
  return {
    id: 'cp-pilot-001-verified',
    at: '2026-08-30T22:50:00.000Z',
    actor,
    role: 'verifier',
    outcome: 'verified',
    changedPaths: [],
    diffStat: { files: 0, insertions: 0, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills', 'git diff --check'],
      commandResults: results(headSha),
      candidateHeadSha: headSha,
      candidateTreeSha: treeSha,
      notes: '',
    },
    blockers: [],
    mutationsPerformed: [],
    authorizationConsumed: [],
    nextRequestedAction: 'integrate',
  };
}

function task(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    title: 'Release phase test',
    priority: 'normal',
    state: overrides.state ?? 'integration',
    authorizedScope: 'test',
    allowedPaths: ['docs/engineering/**'],
    forbiddenPaths: ['.env*'],
    dependencies: [],
    assignedRole: overrides.assignedRole ?? 'integrator',
    branch: 'docs/pstack-phase-3a-pilot',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: BASE_A,
    lease: overrides.lease === undefined ? createLease('integrator-a', 'integrator', Date.now()) : overrides.lease,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: overrides.checkpoints ?? [builderCp(), verifierCp()],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['read_only', 'repo_files', 'git_commit'],
    approvalRequired: 'human_review',
    createdAt: now,
    updatedAt: now,
  };
}

function seed(tasks: TaskRecord[]): AgentTaskRegistry {
  const map: Record<string, TaskRecord> = {};
  for (const t of tasks) map[t.id] = t;
  return { version: 2, revision: 10, updatedAt: new Date().toISOString(), tasks: map, adminAuditLog: [], provenance: testProvenance() };
}

describe('Phase 3A.2 — phase-aware release', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-release-phase-'));
    regPath = join(dir, 'registry.json');
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('builder release from in_progress → ready', () => {
    const t = task({
      id: 'TASK-B-REL',
      state: 'in_progress',
      assignedRole: 'builder',
      lease: createLease('builder-a', 'builder', Date.now()),
      checkpoints: [],
    });
    writeRegistryFile(regPath, seed([t]));

    const r = releaseTask(regPath, { taskId: t.id, actor: 'builder-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('ready');
    expect(r.value.lease).toBeNull();
    expect(r.value.assignedRole).toBeNull();
  });

  it('builder release from claimed → ready', () => {
    const t = task({
      id: 'TASK-B-CLAIMED',
      state: 'claimed',
      assignedRole: 'builder',
      lease: createLease('builder-a', 'builder', Date.now()),
      checkpoints: [],
    });
    writeRegistryFile(regPath, seed([t]));

    const r = releaseTask(regPath, { taskId: t.id, actor: 'builder-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('ready');
  });

  it('verifier release from verification → verification (phase preserved)', () => {
    const t = task({
      id: 'TASK-V-REL',
      state: 'verification',
      assignedRole: 'verifier',
      lease: createLease('verifier-a', 'verifier', Date.now()),
      checkpoints: [builderCp()],
    });
    writeRegistryFile(regPath, seed([t]));

    const r = releaseTask(regPath, { taskId: t.id, actor: 'verifier-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('verification');
    expect(r.value.lease).toBeNull();
    // The next verifier must still know which role the task awaits.
    expect(r.value.assignedRole).toBe('verifier');
  });

  it('integrator release from integration → integration (THE PILOT DEFECT)', () => {
    const t = task({ id: 'TASK-I-REL' });
    writeRegistryFile(regPath, seed([t]));

    const r = releaseTask(regPath, { taskId: t.id, actor: 'integrator-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Before the fix this was 'ready' and the verified chain was thrown away.
    expect(r.value.state).toBe('integration');
    expect(r.value.state).not.toBe('ready');
    expect(r.value.lease).toBeNull();
  });

  it('expired-lease recovery preserves phase, not just the happy path', () => {
    const expired = createLease('integrator-a', 'integrator', Date.now() - DEFAULT_LEASE_MS * 2);
    const t = task({ id: 'TASK-EXPIRED', lease: expired });
    writeRegistryFile(regPath, seed([t]));

    // A DIFFERENT actor recovers the expired lease — must still land in integration.
    const r = releaseTask(regPath, { taskId: t.id, actor: 'other-operator' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('integration');
  });

  it('records the correct prior/next state and role in the audit entry', () => {
    const t = task({ id: 'TASK-AUDIT' });
    writeRegistryFile(regPath, seed([t]));

    const r = releaseTask(regPath, { taskId: t.id, actor: 'integrator-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const last = r.value.auditLog[r.value.auditLog.length - 1];
    expect(last.action).toBe('release');
    expect(last.fromState).toBe('integration');
    expect(last.toState).toBe('integration');
    expect(last.metadata?.role).toBe('integrator');
  });

  it('checkpoints are never mutated by a release', () => {
    const t = task({ id: 'TASK-CP-INTACT' });
    writeRegistryFile(regPath, seed([t]));
    const before = JSON.stringify(t.checkpoints);

    const r = releaseTask(regPath, { taskId: t.id, actor: 'integrator-a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value.checkpoints)).toBe(before);
  });

  describe('invalid combinations fail closed', () => {
    it('verifier cannot release from integration', () => {
      const r = resolveReleaseState('integration', 'verifier');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('invalid_transition');
    });

    it('integrator cannot release from verification', () => {
      const r = resolveReleaseState('verification', 'integrator');
      expect(r.ok).toBe(false);
    });

    it('builder cannot release from integration', () => {
      const r = resolveReleaseState('integration', 'builder');
      expect(r.ok).toBe(false);
    });

    it('administrator holds no work lease', () => {
      const r = resolveReleaseState('integration', 'administrator');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('role_forbidden');
    });

    it('no role at all cannot resolve a phase', () => {
      const r = resolveReleaseState('integration', null);
      expect(r.ok).toBe(false);
    });
  });
});

describe('Phase 3A.2 — checkpoint-derived reconciliation', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-reconcile-'));
    regPath = join(dir, 'registry.json');
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  const admin = { actor: 'eric-orchestrator', role: 'administrator' as const, reason: 'Restore phase', confirm: true };

  it('restores the REAL-PILOT-SHAPED fixture from ready → integration without rewriting evidence', () => {
    // Mirrors TASK-PSTACK-PILOT-001 exactly: revision 10, state ready (the defect),
    // lease null, latest checkpoint cp-pilot-001-verified, candidate db3efa4d, base 3c827cdc.
    const pilot = task({
      id: 'TASK-PSTACK-PILOT-FIXTURE',
      state: 'ready',
      assignedRole: null,
      lease: null,
    });
    writeRegistryFile(regPath, seed([pilot]));
    const cpBefore = JSON.stringify(pilot.checkpoints);

    const r = reconcileTaskState(regPath, { ...admin, taskId: pilot.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.state).toBe('integration');
    // Evidence is READ, never rewritten.
    expect(JSON.stringify(r.value.checkpoints)).toBe(cpBefore);
    expect(r.value.checkpoints).toHaveLength(2);

    const last = r.value.auditLog[r.value.auditLog.length - 1];
    expect(last.action).toBe('reconcile-state');
    expect(last.fromState).toBe('ready');
    expect(last.toState).toBe('integration');
    expect(last.metadata?.derivedFrom).toBe('cp-pilot-001-verified');

    // Revision advanced exactly once.
    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.revision).toBe(11);
  });

  it('derives verification when only ready_for_verification exists', () => {
    const t = task({ id: 'TASK-RFV', state: 'ready', lease: null, checkpoints: [builderCp()] });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('verification');
  });

  it('derives ready when there is no builder/verifier evidence', () => {
    const t = task({ id: 'TASK-NOCP', state: 'verification', lease: null, checkpoints: [] });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('ready');
  });

  it('refuses while a lease is active', () => {
    // A lease-holding state is used deliberately: the registry validator rejects
    // `ready` + an active lease as malformed, so that combination could never reach
    // the lease guard and would test nothing.
    const t = task({ id: 'TASK-LEASED', state: 'integration', lease: createLease('someone', 'integrator', Date.now()) });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('lease_conflict');
  });

  it('requires the administrator role', () => {
    const t = task({ id: 'TASK-NOTADMIN', state: 'ready', lease: null });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, {
      taskId: t.id,
      actor: 'integrator-a',
      role: 'integrator',
      reason: 'x',
      confirm: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthorized_actor');
  });

  it('requires --confirm and --reason', () => {
    const t = task({ id: 'TASK-NOCONFIRM', state: 'ready', lease: null });
    writeRegistryFile(regPath, seed([t]));

    expect(reconcileTaskState(regPath, { ...admin, taskId: t.id, confirm: false }).ok).toBe(false);
    expect(reconcileTaskState(regPath, { ...admin, taskId: t.id, reason: '  ' }).ok).toBe(false);
  });

  it('never accepts an arbitrary target state — derivation is the only input', () => {
    // A caller cannot launder a task into integration: with no verified checkpoint the
    // derivation yields `ready` no matter what the operator wants.
    const t = task({ id: 'TASK-NO-LAUNDER', state: 'blocked', lease: null, checkpoints: [] });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('ready');
  });

  it('rejects a verified checkpoint that precedes its ready_for_verification', () => {
    const t = task({
      id: 'TASK-ORDER',
      state: 'ready',
      lease: null,
      checkpoints: [verifierCp(), builderCp()],
    });
    const d = deriveStateFromCheckpoints(t);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.code).toBe('malformed_checkpoint');
  });

  it('rejects self-verification when deriving integration', () => {
    const t = task({
      id: 'TASK-SELFVERIFY',
      state: 'ready',
      lease: null,
      checkpoints: [builderCp(CANDIDATE_B, TREE_B, 'same-agent'), verifierCp(CANDIDATE_B, TREE_B, 'same-agent')],
    });
    const d = deriveStateFromCheckpoints(t);
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.code).toBe('self_verification_forbidden');
  });

  it('rejects a candidate identity mismatch between builder and verifier', () => {
    const OTHER = 'cccccccccccccccccccccccccccccccccccccccc';
    const t = task({
      id: 'TASK-MISMATCH',
      state: 'ready',
      lease: null,
      checkpoints: [builderCp(CANDIDATE_B, TREE_B), verifierCp(OTHER, TREE_B)],
    });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('verification_incomplete');
  });

  it('refuses to reconcile a task already in its derived state', () => {
    const t = task({ id: 'TASK-NOOP', state: 'integration', lease: null });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid_transition');
  });

  it('refuses terminal states', () => {
    const t = task({ id: 'TASK-TERMINAL', state: 'merged', lease: null });
    writeRegistryFile(regPath, seed([t]));

    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid_transition');
  });
});

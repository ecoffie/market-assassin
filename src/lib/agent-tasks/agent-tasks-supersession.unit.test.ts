import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLease } from './lease';
import { lockDirForRegistry } from './lock';
import { writeRegistryFile, readRegistryFile } from './registry';
import { supersedeTask } from './operations';
import {
  assertScopeNotWidened,
  buildSuccessor,
  copyScope,
  findAssignmentConflicts,
  findSuccessorCollisions,
  supersessionChain,
  validateSupersedeInput,
} from './supersession';
import { assertRegistryInvariants, parseTaskRecord } from './validate';
import { listReadyTasks } from './dependencies';
import { findPathCollisions } from './collisions';
import { DEFAULT_LEASE_MS } from './types';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

/**
 * PHASE 3A.3 — atomic task supersession.
 *
 * baseSha is immutable; when main advances past a task's base the lifecycle-correct
 * move is to CLOSE the task and open a current-main successor in one write. These
 * tests hold that write to the fail-closed contract.
 *
 * Every test uses a DISPOSABLE registry under tmpdir. The real pilot registry is
 * never opened, let alone written.
 */

const OLD_BASE = '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8';
const NEW_MAIN = '4b6c511c91642c5b73c9d91d7525331dd466ce25';
const CANDIDATE = 'db3efa4d9357cc357c70897175ed7c7e514b8c4d';
const RUNBOOK = 'docs/engineering/pstack-phase-3a-pilot-runbook.md';

let dir: string;
let reg: string;

function verifiedCp(): TaskCheckpoint {
  return {
    id: 'cp-pilot-001-verified',
    at: '2026-08-30T22:50:00.000Z',
    actor: 'pilot-verifier',
    role: 'verifier',
    outcome: 'verified',
    changedPaths: [],
    diffStat: { files: 0, insertions: 0, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills'],
      commandResults: [
        {
          command: 'npm run verify:ma-skills',
          status: 'passed',
          ranAt: '2026-08-30T22:49:10.000Z',
          headSha: CANDIDATE,
          exitCode: 0,
        },
      ],
      notes: 'independent verification',
    },
    blockers: [],
    mutationsPerformed: ['read_only'],
    authorizationConsumed: ['claim:verifier'],
    nextRequestedAction: 'integrator claim',
  };
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'TASK-SRC-001',
    title: 'Pilot runbook',
    priority: 'normal',
    state: 'ready',
    authorizedScope: 'Author the Phase 3A pilot runbook',
    allowedPaths: [RUNBOOK],
    forbiddenPaths: ['src/**'],
    dependencies: [],
    assignedRole: null,
    branch: 'docs/pstack-phase-3a-pilot',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: OLD_BASE,
    lease: null,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: [verifiedCp()],
    auditLog: [
      {
        id: 'audit-1-promote',
        at: '2026-08-30T22:44:47.849Z',
        actor: 'eric-orchestrator',
        action: 'promote',
        fromState: 'proposed',
        toState: 'ready',
        evidenceRef: 'seed',
        metadata: { registryRevision: '2', leaseOwner: 'none', role: 'administrator' },
      },
    ],
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

function registry(tasks: TaskRecord[], revision = 10): AgentTaskRegistry {
  return {
    version: 1,
    revision,
    updatedAt: '2026-08-30T22:52:31.327Z',
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    adminAuditLog: [],
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    taskId: 'TASK-SRC-001',
    newTaskId: 'TASK-SRC-002',
    branch: 'docs/pstack-phase-3a-pilot-v2',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot-v2',
    actor: 'eric-orchestrator',
    role: 'administrator',
    reason: 'Refresh pilot base to Production main after Phase 3A.2',
    confirm: true,
    currentMainSha: NEW_MAIN,
    nowMs: Date.parse('2026-08-31T02:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-supersede-'));
  reg = join(dir, 'registry.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('supersede — happy path', () => {
  it('cancels a stale ready source and creates a ready current-main successor', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.source.state).toBe('cancelled');
    expect(r.value.source.supersededByTaskId).toBe('TASK-SRC-002');
    expect(r.value.successor.state).toBe('ready');
    expect(r.value.successor.supersedesTaskId).toBe('TASK-SRC-001');
    expect(r.value.successor.baseSha).toBe(NEW_MAIN);
    expect(r.value.successor.lease).toBeNull();
    expect(r.value.successor.assignedRole).toBeNull();
  });

  it('advances the registry revision exactly once', () => {
    writeRegistryFile(reg, registry([task()], 10));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    expect(r.revision).toBe(11);
    const after = readRegistryFile(reg);
    expect(after.ok && after.value.revision).toBe(11);
  });

  it('leaves source baseSha, checkpoints, and prior audit entries byte-identical', () => {
    const before = task();
    const beforeCps = JSON.stringify(before.checkpoints);
    const beforeAudit = JSON.stringify(before.auditLog);
    writeRegistryFile(reg, registry([before]));

    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.source.baseSha).toBe(OLD_BASE);
    expect(JSON.stringify(r.value.source.checkpoints)).toBe(beforeCps);
    // Prior entries untouched; exactly one supersede entry appended.
    expect(JSON.stringify(r.value.source.auditLog.slice(0, 1))).toBe(beforeAudit);
    expect(r.value.source.auditLog).toHaveLength(2);
  });

  it('gives the successor zero checkpoints and its own audit history', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.successor.checkpoints).toHaveLength(0);
    expect(r.value.successor.auditLog).toHaveLength(1);
    expect(r.value.successor.auditLog[0].action).toBe('superseded-from');
    // No inherited entries from the source.
    expect(r.value.successor.auditLog.some((e) => e.action === 'promote')).toBe(false);
  });

  it('writes the required audit fields on BOTH halves', () => {
    writeRegistryFile(reg, registry([task()], 10));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const src = r.value.source.auditLog.at(-1)!;
    expect(src.action).toBe('supersede');
    expect(src.fromState).toBe('ready');
    expect(src.toState).toBe('cancelled');
    expect(src.actor).toBe('eric-orchestrator');
    expect(src.metadata.reason).toContain('Refresh pilot base');
    expect(src.metadata.supersededByTaskId).toBe('TASK-SRC-002');
    expect(src.metadata.oldBaseSha).toBe(OLD_BASE);
    expect(src.metadata.newBaseSha).toBe(NEW_MAIN);
    expect(src.metadata.registryRevision).toBe('11');

    const suc = r.value.successor.auditLog[0];
    expect(suc.action).toBe('superseded-from');
    expect(suc.metadata.sourceTaskId).toBe('TASK-SRC-001');
    expect(suc.metadata.role).toBe('administrator');
    expect(suc.metadata.reason).toContain('Refresh pilot base');
    expect(suc.metadata.newBaseSha).toBe(NEW_MAIN);
    expect(suc.metadata.registryRevision).toBe('11');
  });

  it('drops merge/deploy evidence and candidate identity from the successor', () => {
    writeRegistryFile(
      reg,
      registry([task({ prRef: 'PR-1', mergeSha: 'abc1234', deploymentRef: 'dep-1', deploySha: 'def5678' })]),
    );
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.successor.prRef).toBeNull();
    expect(r.value.successor.mergeSha).toBeNull();
    expect(r.value.successor.deploymentRef).toBeNull();
    expect(r.value.successor.deploySha).toBeNull();
  });

  it('copies scope verbatim without aliasing arrays', () => {
    const src = task();
    writeRegistryFile(reg, registry([src]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.successor.allowedPaths).toEqual(src.allowedPaths);
    expect(r.value.successor.allowedPaths).not.toBe(src.allowedPaths);
    expect(r.value.successor.forbiddenPaths).toEqual(src.forbiddenPaths);
    expect(r.value.successor.verificationProfile).toEqual(src.verificationProfile);
    expect(r.value.successor.allowedMutations).toEqual(src.allowedMutations);
    expect(r.value.successor.approvalRequired).toBe(src.approvalRequired);
    expect(r.value.successor.priority).toBe(src.priority);
    expect(r.value.successor.title).toBe(src.title);
    expect(r.value.successor.authorizedScope).toBe(src.authorizedScope);
  });
});

describe('supersede — authorization fail-closed', () => {
  it('rejects a non-administrator', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ role: 'builder' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthorized_actor');
  });

  it('rejects a missing role entirely', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ role: undefined }));
    expect(r.ok).toBe(false);
  });

  it('rejects missing --confirm', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ confirm: false }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('--confirm');
  });

  it('rejects an empty reason', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ reason: '   ' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('--reason');
  });

  it('rejects an active lease on the source', () => {
    const now = Date.parse('2026-08-31T02:00:00.000Z');
    const leased = task({
      state: 'in_progress',
      lease: createLease('builder-x', 'builder', now, DEFAULT_LEASE_MS),
    });
    writeRegistryFile(reg, registry([leased]));
    const r = supersedeTask(reg, input({ nowMs: now }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('lease_conflict');
  });

  it('allows supersession when the lease has EXPIRED', () => {
    const leaseAt = Date.parse('2026-08-30T00:00:00.000Z');
    const now = Date.parse('2026-08-31T02:00:00.000Z');
    const stale = task({
      state: 'in_progress',
      lease: createLease('builder-x', 'builder', leaseAt, DEFAULT_LEASE_MS),
    });
    writeRegistryFile(reg, registry([stale]));
    const r = supersedeTask(reg, input({ nowMs: now }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source.state).toBe('cancelled');
    expect(r.value.source.lease).toBeNull();
  });

  it('rejects a terminal source', () => {
    for (const state of ['merged', 'deployed', 'cancelled'] as const) {
      writeRegistryFile(reg, registry([task({ state, lease: null })]));
      const r = supersedeTask(reg, input());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('invalid_transition');
    }
  });

  it('rejects a duplicate successor id', () => {
    writeRegistryFile(reg, registry([task(), task({ id: 'TASK-SRC-002' })]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('already exists');
  });

  it('rejects a successor id equal to the source', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ newTaskId: 'TASK-SRC-001' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed successor id', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ newTaskId: 'not-a-task-id' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('malformed_task');
  });

  it('rejects an unknown source task', () => {
    writeRegistryFile(reg, registry([task()]));
    const r = supersedeTask(reg, input({ taskId: 'TASK-NOPE-001' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('task_not_found');
  });

  it('rejects a fabricated / absent current main sha', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input({ currentMainSha: '' })).ok).toBe(false);
    expect(supersedeTask(reg, input({ currentMainSha: 'not-a-sha' })).ok).toBe(false);
  });
});

describe('supersede — collision handling', () => {
  it('rejects overlap with a THIRD active task', () => {
    const third = task({
      id: 'TASK-OTHER-001',
      state: 'in_progress',
      branch: 'feat/other',
      worktree: '.claude/worktrees/other',
      lease: createLease('builder-y', 'builder', Date.parse('2026-08-31T01:59:00.000Z'), DEFAULT_LEASE_MS),
      allowedPaths: ['docs/engineering'],
      checkpoints: [],
    });
    writeRegistryFile(reg, registry([task(), third]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('path_collision');
    expect(r.message).toContain('TASK-OTHER-001');
  });

  it('ALLOWS overlap with the source being superseded in the same atomic write', () => {
    // The successor inherits the source's exact allowedPaths. That must not self-collide.
    writeRegistryFile(reg, registry([task({ state: 'ready' })]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.successor.allowedPaths).toEqual([RUNBOOK]);
  });

  it('ignores a non-lease-holding third task (ready tasks hold no path lease)', () => {
    const idle = task({
      id: 'TASK-IDLE-001',
      state: 'ready',
      branch: 'feat/idle',
      worktree: '.claude/worktrees/idle',
      checkpoints: [],
      lease: null,
    });
    writeRegistryFile(reg, registry([task(), idle]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
  });

  it('ignores a third task whose lease has expired', () => {
    const expired = task({
      id: 'TASK-EXP-001',
      state: 'in_progress',
      branch: 'feat/exp',
      worktree: '.claude/worktrees/exp',
      checkpoints: [],
      lease: createLease('b', 'builder', Date.parse('2026-08-29T00:00:00.000Z'), DEFAULT_LEASE_MS),
    });
    writeRegistryFile(reg, registry([task(), expired]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
  });

  it('rejects a branch already assigned to another live task', () => {
    const other = task({
      id: 'TASK-BR-001',
      state: 'ready',
      branch: 'docs/pstack-phase-3a-pilot-v2',
      worktree: '.claude/worktrees/somewhere-else',
      allowedPaths: ['docs/other.md'],
      checkpoints: [],
    });
    writeRegistryFile(reg, registry([task(), other]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('branch');
  });

  it('rejects a worktree already assigned to another live task', () => {
    const other = task({
      id: 'TASK-WT-001',
      state: 'ready',
      branch: 'feat/unrelated',
      worktree: '.claude/worktrees/pstack-phase-3a-pilot-v2',
      allowedPaths: ['docs/other.md'],
      checkpoints: [],
    });
    writeRegistryFile(reg, registry([task(), other]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('worktree');
  });

  it('permits reusing a branch/worktree held only by a TERMINAL task', () => {
    const done = task({
      id: 'TASK-DONE-001',
      state: 'merged',
      branch: 'docs/pstack-phase-3a-pilot-v2',
      worktree: '.claude/worktrees/pstack-phase-3a-pilot-v2',
      allowedPaths: ['docs/other.md'],
      checkpoints: [],
    });
    writeRegistryFile(reg, registry([task(), done]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
  });
});

describe('supersede — scope cannot be widened', () => {
  it('assertScopeNotWidened rejects broader allowedPaths', () => {
    const src = task();
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), allowedPaths: ['docs/**'] };
    const r = assertScopeNotWidened(src, wide);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('forbidden_mutation');
  });

  it('rejects added allowedMutations', () => {
    const src = task();
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), allowedMutations: [...src.allowedMutations, 'git_push' as never] };
    expect(assertScopeNotWidened(src, wide).ok).toBe(false);
  });

  it('rejects dropped forbiddenPaths', () => {
    const src = task();
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), forbiddenPaths: [] };
    expect(assertScopeNotWidened(src, wide).ok).toBe(false);
  });

  it('rejects dropped verificationProfile', () => {
    const src = task();
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), verificationProfile: [] };
    expect(assertScopeNotWidened(src, wide).ok).toBe(false);
  });

  it('rejects a weakened approvalRequired', () => {
    const src = task();
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), approvalRequired: 'none' as never };
    expect(assertScopeNotWidened(src, wide).ok).toBe(false);
  });

  it('rejects enabling allowSameAgentVerification', () => {
    const src = task();
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), allowSameAgentVerification: true };
    expect(assertScopeNotWidened(src, wide).ok).toBe(false);
  });

  it('rejects silently dropped dependencies', () => {
    const src = task({ dependencies: ['TASK-DEP-001'] });
    const wide = { ...buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' }), dependencies: [] };
    const r = assertScopeNotWidened(src, wide);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('dependency_unmet');
  });

  it('the real buildSuccessor never widens', () => {
    const src = task();
    const built = buildSuccessor({ source: src, newTaskId: 'TASK-X-002', branch: 'b', worktree: 'w', baseSha: NEW_MAIN, nowIso: '2026-08-31T02:00:00.000Z' });
    expect(assertScopeNotWidened(src, built).ok).toBe(true);
  });
});

describe('supersede — atomicity', () => {
  it('a rejected supersession writes NEITHER half', () => {
    const third = task({
      id: 'TASK-OTHER-001',
      state: 'in_progress',
      branch: 'feat/other',
      worktree: '.claude/worktrees/other',
      lease: createLease('builder-y', 'builder', Date.parse('2026-08-31T01:59:00.000Z'), DEFAULT_LEASE_MS),
      allowedPaths: ['docs/engineering'],
      checkpoints: [],
    });
    writeRegistryFile(reg, registry([task(), third], 10));
    const before = readFileSync(reg, 'utf8');

    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);

    // Byte-identical: no source cancellation, no orphan successor, no revision bump.
    expect(readFileSync(reg, 'utf8')).toBe(before);
    const after = readRegistryFile(reg);
    expect(after.ok && after.value.revision).toBe(10);
    expect(after.ok && after.value.tasks['TASK-SRC-001'].state).toBe('ready');
    expect(after.ok && after.value.tasks['TASK-SRC-002']).toBeUndefined();
  });

  it('a registry WRITE failure leaves neither half', () => {
    writeRegistryFile(reg, registry([task()], 10));
    const before = readFileSync(reg, 'utf8');
    // Make the containing directory read-only so the atomic write cannot land.
    chmodSync(dir, 0o500);
    try {
      const r = supersedeTask(reg, input());
      expect(r.ok).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readFileSync(reg, 'utf8')).toBe(before);
    const after = readRegistryFile(reg);
    expect(after.ok && after.value.revision).toBe(10);
    expect(after.ok && after.value.tasks['TASK-SRC-002']).toBeUndefined();
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
  });

  it('releases the registry lock after both success and failure', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
    expect(supersedeTask(reg, input({ newTaskId: 'TASK-SRC-003' })).ok).toBe(false); // source now cancelled
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
  });
});

describe('supersede — queue, collision and dependency behavior after success', () => {
  it('the cancelled source leaves the ready queue and the successor enters it', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    const ready = listReadyTasks(after.value).map((t) => t.id);
    expect(ready).toContain('TASK-SRC-002');
    expect(ready).not.toContain('TASK-SRC-001');
  });

  it('the cancelled source no longer holds a path collision', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const after = readRegistryFile(reg);
    if (!after.ok) return;

    const src = after.value.tasks['TASK-SRC-001'];
    const suc = after.value.tasks['TASK-SRC-002'];
    // A newcomer claiming the same paths must not be blocked by the cancelled source.
    expect(findPathCollisions(suc, [src], Date.parse('2026-08-31T02:05:00.000Z'))).toHaveLength(0);
  });

  it('does not broaden or discard dependencies, and holds the successor out of the queue while unmet', () => {
    const dep = task({ id: 'TASK-DEP-001', state: 'in_progress', branch: 'feat/dep', worktree: '.claude/worktrees/dep', allowedPaths: ['docs/dep.md'], checkpoints: [], lease: createLease('d', 'builder', Date.parse('2026-08-31T01:59:00.000Z'), DEFAULT_LEASE_MS) });
    writeRegistryFile(reg, registry([task({ dependencies: ['TASK-DEP-001'] }), dep]));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.successor.dependencies).toEqual(['TASK-DEP-001']);

    const after = readRegistryFile(reg);
    if (!after.ok) return;
    // Dependency is in_progress (not complete) → successor must NOT be ready-queued.
    expect(listReadyTasks(after.value).map((t) => t.id)).not.toContain('TASK-SRC-002');
  });

  it('rejects a successor carrying a dangling dependency', () => {
    // A dangling dep cannot be written through the normal path — assertRegistryInvariants
    // rejects it — so the corrupt state is injected directly on disk, which is exactly the
    // hand-edited/partial-write case this guard exists to catch.
    const raw = registry([task({ dependencies: ['TASK-GHOST-001'] })]);
    writeFileSync(reg, JSON.stringify(raw, null, 2));
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Either the read-side schema or the supersede dependency guard must stop it;
    // what must NEVER happen is a successor created against a dependency that is absent.
    expect(['dependency_unmet', 'malformed_registry']).toContain(r.code);
    // Read the raw file — a corrupt registry does not parse, so assert on disk directly.
    expect(JSON.parse(readFileSync(reg, 'utf8')).tasks['TASK-SRC-002']).toBeUndefined();
  });

  it('supersede itself refuses a dangling dependency when the registry parses', () => {
    // Legal on-disk state: dep exists, so the source is writable...
    const dep = task({ id: 'TASK-DEP-001', state: 'ready', branch: 'feat/dep', worktree: '.claude/worktrees/dep', allowedPaths: ['docs/dep.md'], checkpoints: [], lease: null });
    writeRegistryFile(reg, registry([task({ dependencies: ['TASK-DEP-001'] }), dep]));
    // ...then the dependency is removed out from under it on disk.
    const onDisk = JSON.parse(readFileSync(reg, 'utf8'));
    delete onDisk.tasks['TASK-DEP-001'];
    writeFileSync(reg, JSON.stringify(onDisk, null, 2));

    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    expect(JSON.parse(readFileSync(reg, 'utf8')).tasks['TASK-SRC-002']).toBeUndefined();
  });

  it('keeps the supersession chain traceable across two hops', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const r2 = supersedeTask(
      reg,
      input({
        taskId: 'TASK-SRC-002',
        newTaskId: 'TASK-SRC-003',
        branch: 'docs/pilot-v3',
        worktree: '.claude/worktrees/pilot-v3',
      }),
    );
    expect(r2.ok).toBe(true);
    const after = readRegistryFile(reg);
    if (!after.ok) return;
    expect(supersessionChain(after.value, 'TASK-SRC-001')).toEqual([
      'TASK-SRC-001',
      'TASK-SRC-002',
      'TASK-SRC-003',
    ]);
  });
});

describe('supersede — registry invariants reject malformed linkage', () => {
  it('rejects a dangling supersededByTaskId', () => {
    const bad = registry([task({ state: 'cancelled', supersededByTaskId: 'TASK-GONE-001' })]);
    expect(assertRegistryInvariants(bad)).toContain('does not exist');
  });

  it('rejects a one-sided (non-mutual) link', () => {
    const src = task({ state: 'cancelled', supersededByTaskId: 'TASK-SRC-002' });
    const suc = task({ id: 'TASK-SRC-002', state: 'ready', checkpoints: [], branch: 'b2', worktree: 'w2', supersedesTaskId: null });
    expect(assertRegistryInvariants(registry([src, suc]))).toContain('not mutual');
  });

  it('rejects a superseded source that is not cancelled', () => {
    const src = task({ state: 'ready', supersededByTaskId: 'TASK-SRC-002' });
    const suc = task({ id: 'TASK-SRC-002', state: 'ready', checkpoints: [], branch: 'b2', worktree: 'w2', supersedesTaskId: 'TASK-SRC-001' });
    expect(assertRegistryInvariants(registry([src, suc]))).toContain('must be cancelled');
  });

  it('rejects a self-referential supersession', () => {
    const self = task({ state: 'cancelled', supersededByTaskId: 'TASK-SRC-001', supersedesTaskId: 'TASK-SRC-001' });
    expect(assertRegistryInvariants(registry([self]))).not.toBeNull();
  });

  it('accepts a well-formed supersession pair', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(assertRegistryInvariants(after.value)).toBeNull();
  });

  it('parseTaskRecord round-trips the linkage fields and rejects malformed ones', () => {
    writeRegistryFile(reg, registry([task()]));
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const raw = JSON.parse(readFileSync(reg, 'utf8'));
    expect(parseTaskRecord(raw.tasks['TASK-SRC-001'])?.supersededByTaskId).toBe('TASK-SRC-002');
    expect(parseTaskRecord(raw.tasks['TASK-SRC-002'])?.supersedesTaskId).toBe('TASK-SRC-001');
    expect(parseTaskRecord({ ...raw.tasks['TASK-SRC-001'], supersededByTaskId: 'nope' })).toBeNull();
    expect(parseTaskRecord({ ...raw.tasks['TASK-SRC-002'], supersedesTaskId: 42 })).toBeNull();
  });
});

describe('supersede — pure helpers', () => {
  it('validateSupersedeInput enforces every administrator precondition', () => {
    expect(validateSupersedeInput(input() as never).ok).toBe(true);
    expect(validateSupersedeInput(input({ branch: '' }) as never).ok).toBe(false);
    expect(validateSupersedeInput(input({ worktree: '' }) as never).ok).toBe(false);
    expect(validateSupersedeInput(input({ actor: '' }) as never).ok).toBe(false);
  });

  it('copyScope carries exactly the permitted fields', () => {
    const scope = copyScope(task());
    expect(Object.keys(scope).sort()).toEqual(
      [
        'allowSameAgentVerification',
        'allowedMutations',
        'allowedPaths',
        'approvalRequired',
        'authorizedScope',
        'dependencies',
        'forbiddenPaths',
        'priority',
        'title',
        'verificationProfile',
      ].sort(),
    );
  });

  it('findSuccessorCollisions excludes the source and the successor itself', () => {
    const src = task();
    const r = registry([src]);
    expect(findSuccessorCollisions(r, [RUNBOOK], 'TASK-SRC-001', 'TASK-SRC-002', Date.now())).toHaveLength(0);
  });

  it('findAssignmentConflicts detects both branch and worktree reuse', () => {
    const other = task({ id: 'TASK-B-001', branch: 'shared-branch', worktree: 'shared/wt' });
    const r = registry([other]);
    expect(findAssignmentConflicts(r, 'shared-branch', 'other/wt', 'TASK-SRC-001')).toHaveLength(1);
    expect(findAssignmentConflicts(r, 'other-branch', 'shared/wt', 'TASK-SRC-001')).toHaveLength(1);
    expect(findAssignmentConflicts(r, 'free-branch', 'free/wt', 'TASK-SRC-001')).toHaveLength(0);
  });
});

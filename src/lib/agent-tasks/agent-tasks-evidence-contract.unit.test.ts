import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendCheckpoint, detectAllPathCollisions } from './operations';
import { validateVerificationEvidence } from './verification';
import { writeRegistryFile } from './registry';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

/**
 * PHASE 3A.4 (A) + (D) — checkpoint evidence contract and collision-report correction.
 *
 * The A cases are anchored on the EXACT shape of the real TASK-PSTACK-PILOT-002 defect:
 * candidate identity present only as prose inside `evidence.notes`, structured fields
 * absent, commandResults carrying the head. That submission was ACCEPTED and survived three
 * state transitions before failing at integration-handoff.
 */

const CANDIDATE = '4a02c91527d452cebba6da67ca91e81f49ee14fc';
const CANDIDATE_TREE = '2ec36230122e6ecfd0ebdbe27cae2e2d4b309857';
const OTHER_HEAD = '1111111111111111111111111111111111111111';
const BASE = '5d8a3007e2aa931a41978705de030a6e304cc359';

// The verbatim prose from the real pilot checkpoint — the thing that LOOKED like evidence.
const TASK_002_NOTES =
  `candidateHeadSha=${CANDIDATE} candidateTreeSha=${CANDIDATE_TREE} baseSha=${BASE} ` +
  'branch=docs/pstack-phase-3a-pilot-v2 worktree=.claude/worktrees/pstack-phase-3a-pilot-v2.';

let dir: string;
let regPath: string;

function results(head: string | undefined, at = '2026-08-31T02:11:22.000Z') {
  return [
    { command: 'npm run verify:ma-skills', status: 'passed' as const, ranAt: at, headSha: head, exitCode: 0 },
    { command: 'git diff --check', status: 'passed' as const, ranAt: at, headSha: head, exitCode: 0 },
  ];
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'TASK-EC-001',
    title: 'Evidence contract fixture',
    priority: 'normal',
    state: 'in_progress',
    authorizedScope: 'docs only',
    allowedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    forbiddenPaths: ['src/**'],
    dependencies: [],
    assignedRole: 'builder',
    branch: 'docs/ec',
    worktree: '.claude/worktrees/ec',
    baseSha: BASE,
    lease: {
      owner: 'builder-a',
      role: 'builder',
      acquiredAt: '2026-08-31T02:00:00.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
      lastHeartbeatAt: '2026-08-31T02:00:00.000Z',
    },
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: [],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['read_only', 'repo_files', 'git_commit'],
    approvalRequired: 'eric_explicit',
    supersededByTaskId: null,
    supersedesTaskId: null,
    createdAt: '2026-08-31T02:00:00.000Z',
    updatedAt: '2026-08-31T02:00:00.000Z',
    ...over,
  };
}

function cp(over: Partial<TaskCheckpoint> & { evidence?: Partial<TaskCheckpoint['evidence']> } = {}): unknown {
  const { evidence, ...rest } = over;
  return {
    id: 'cp-1',
    at: '2026-08-31T02:11:22.000Z',
    actor: 'builder-a',
    role: 'builder',
    outcome: 'ready_for_verification',
    changedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    diffStat: { files: 1, insertions: 10, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills', 'git diff --check'],
      commandResults: results(CANDIDATE),
      notes: '',
      ...evidence,
    },
    blockers: [],
    mutationsPerformed: ['repo_files', 'git_commit'],
    authorizationConsumed: [],
    nextRequestedAction: 'verify',
    ...rest,
  };
}

function seed(tasks: TaskRecord[], revision = 5): AgentTaskRegistry {
  const r: AgentTaskRegistry = {
    version: 1,
    revision,
    updatedAt: '2026-08-31T02:00:00.000Z',
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    adminAuditLog: [],
  };
  writeRegistryFile(regPath, r);
  return r;
}

function readRaw() {
  return JSON.parse(readFileSync(regPath, 'utf8'));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-evidence-contract-'));
  regPath = join(dir, 'registry.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('A — the exact TASK-002 defect is rejected AT CHECKPOINT TIME', () => {
  it('rejects a ready_for_verification whose candidate lives ONLY in notes prose', () => {
    seed([task()]);
    const before = readRaw();

    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({ evidence: { notes: TASK_002_NOTES } }),
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('verification_incomplete');
    // The message must name the REAL mistake, not just a missing field.
    expect(r.message).toMatch(/only in evidence\.notes prose/i);
    expect(r.message).toMatch(/candidateHeadSha/);

    // FAIL BEFORE WRITING: registry byte-identical — no revision, state, checkpoint,
    // audit or lease change. The builder still holds its lease and can resubmit.
    expect(readRaw()).toEqual(before);
    const after = readRaw();
    expect(after.revision).toBe(5);
    expect(after.tasks['TASK-EC-001'].state).toBe('in_progress');
    expect(after.tasks['TASK-EC-001'].checkpoints).toHaveLength(0);
    expect(after.tasks['TASK-EC-001'].auditLog).toHaveLength(0);
    expect(after.tasks['TASK-EC-001'].lease?.owner).toBe('builder-a');
  });

  it('rejects a missing candidateHeadSha', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({ evidence: { candidateTreeSha: CANDIDATE_TREE } }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/evidence\.candidateHeadSha/);
    expect(readRaw().revision).toBe(5);
  });

  it('rejects a missing candidateTreeSha (a half-filled pair is not a candidate)', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({ evidence: { candidateHeadSha: CANDIDATE } }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/evidence\.candidateTreeSha/);
  });

  it('rejects a MALFORMED sha at schema level (parseCheckpoint), still before any write', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({ evidence: { candidateHeadSha: 'not-a-sha', candidateTreeSha: CANDIDATE_TREE } }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('malformed_checkpoint');
    expect(readRaw().revision).toBe(5);
  });

  it('rejects a blocking commandResult whose headSha != candidateHeadSha', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({
        evidence: {
          candidateHeadSha: CANDIDATE,
          candidateTreeSha: CANDIDATE_TREE,
          commandResults: results(OTHER_HEAD),
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/ran at head .* but candidateHeadSha is/);
  });

  it('rejects a blocking commandResult with NO headSha', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({
        evidence: {
          candidateHeadSha: CANDIDATE,
          candidateTreeSha: CANDIDATE_TREE,
          commandResults: results(undefined),
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/no headSha/);
  });

  it('rejects MIXED structured/unstructured evidence across commandResults', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({
        evidence: {
          candidateHeadSha: CANDIDATE,
          candidateTreeSha: CANDIDATE_TREE,
          commandResults: [
            ...results(CANDIDATE),
            { command: 'extra', status: 'passed' as const, ranAt: '2026-08-31T02:11:22.000Z', headSha: OTHER_HEAD },
          ],
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/mixed candidate evidence/i);
  });

  it('ACCEPTS a complete structured ready_for_verification', () => {
    seed([task()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({ evidence: { candidateHeadSha: CANDIDATE, candidateTreeSha: CANDIDATE_TREE } }),
    });
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    const after = readRaw();
    expect(after.revision).toBe(6);
    expect(after.tasks['TASK-EC-001'].state).toBe('verification');
    expect(after.tasks['TASK-EC-001'].checkpoints[0].evidence.candidateHeadSha).toBe(CANDIDATE);
  });

  it('leaves PROGRESS checkpoints unaffected — no candidate identity required', () => {
    seed([task({ state: 'claimed' })]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: cp({ id: 'cp-progress', outcome: 'progress', evidence: { commandResults: [], notes: 'wip' } }),
    });
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    expect(readRaw().tasks['TASK-EC-001'].state).toBe('in_progress');
  });
});

describe('A — verifier must match the builder candidate and be a distinct actor', () => {
  function withBuilder(over: Partial<TaskRecord> = {}) {
    const builderCp: TaskCheckpoint = {
      id: 'cp-b',
      at: '2026-08-31T02:11:22.000Z',
      actor: 'builder-a',
      role: 'builder',
      outcome: 'ready_for_verification',
      changedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
      diffStat: { files: 1, insertions: 10, deletions: 0 },
      evidence: {
        tests: [],
        commands: ['npm run verify:ma-skills', 'git diff --check'],
        commandResults: results(CANDIDATE),
        candidateHeadSha: CANDIDATE,
        candidateTreeSha: CANDIDATE_TREE,
        notes: '',
      },
      blockers: [],
      mutationsPerformed: ['repo_files', 'git_commit'],
      authorizationConsumed: [],
      nextRequestedAction: 'verify',
    };
    return task({
      state: 'verification',
      assignedRole: 'verifier',
      checkpoints: [builderCp],
      lease: {
        owner: 'verifier-b',
        role: 'verifier',
        acquiredAt: '2026-08-31T02:12:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
        lastHeartbeatAt: '2026-08-31T02:12:00.000Z',
      },
      ...over,
    });
  }

  function verifierCp(over: Record<string, unknown> = {}) {
    return cp({
      id: 'cp-v',
      at: '2026-08-31T02:15:30.000Z',
      actor: 'verifier-b',
      role: 'verifier',
      outcome: 'verified',
      nextRequestedAction: 'integrate',
      evidence: {
        candidateHeadSha: CANDIDATE,
        candidateTreeSha: CANDIDATE_TREE,
        commandResults: results(CANDIDATE, '2026-08-31T02:15:19.000Z'),
      },
      ...over,
    });
  }

  it('rejects a verifier candidate head that differs from the builder', () => {
    seed([withBuilder()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'verifier-b',
      checkpoint: verifierCp({
        evidence: {
          candidateHeadSha: OTHER_HEAD,
          candidateTreeSha: CANDIDATE_TREE,
          commandResults: results(OTHER_HEAD, '2026-08-31T02:15:19.000Z'),
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/verifier candidateHeadSha .* !== builder/);
    expect(readRaw().revision).toBe(5);
  });

  it('rejects a verifier candidate TREE that differs from the builder', () => {
    seed([withBuilder()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'verifier-b',
      checkpoint: verifierCp({
        evidence: {
          candidateHeadSha: CANDIDATE,
          candidateTreeSha: OTHER_HEAD,
          commandResults: results(CANDIDATE, '2026-08-31T02:15:19.000Z'),
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/candidateTreeSha .* !== builder/);
  });

  it('rejects SELF-verification (builder and verifier the same actor)', () => {
    const t = withBuilder();
    t.lease = { ...t.lease!, owner: 'builder-a' };
    seed([t]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: verifierCp({ actor: 'builder-a' }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('self_verification_forbidden');
    expect(readRaw().revision).toBe(5);
  });

  it('PERMITS same-actor verification when the task explicitly allows it', () => {
    const t = withBuilder({ allowSameAgentVerification: true });
    t.lease = { ...t.lease!, owner: 'builder-a' };
    seed([t]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'builder-a',
      checkpoint: verifierCp({ actor: 'builder-a' }),
    });
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
  });

  it('ACCEPTS a matching verified checkpoint from a distinct actor', () => {
    seed([withBuilder()]);
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-EC-001',
      actor: 'verifier-b',
      checkpoint: verifierCp(),
    });
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    expect(readRaw().tasks['TASK-EC-001'].state).toBe('integration');
  });
});

describe('D — global collision report counts only ACTIVE candidates', () => {
  function pathTask(id: string, state: TaskRecord['state'], leased: boolean): TaskRecord {
    return task({
      id,
      state,
      assignedRole: leased ? 'builder' : null,
      lease: leased
        ? {
            owner: `${id}-owner`,
            role: 'builder',
            acquiredAt: '2026-08-31T02:00:00.000Z',
            expiresAt: '2030-01-01T00:00:00.000Z',
            lastHeartbeatAt: '2026-08-31T02:00:00.000Z',
          }
        : null,
      checkpoints: [],
      auditLog: [],
      allowedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    });
  }

  it('cancelled predecessor + active successor => ZERO collisions (the supersession shape)', () => {
    // This is exactly TASK-PSTACK-PILOT-001 (cancelled) vs -002 (active): they share the
    // runbook path BY DESIGN, and the old report flagged it as a problem.
    const cancelled = pathTask('TASK-PSTACK-PILOT-001', 'cancelled', false);
    cancelled.supersededByTaskId = 'TASK-PSTACK-PILOT-002';
    const active = pathTask('TASK-PSTACK-PILOT-002', 'in_progress', true);
    active.supersedesTaskId = 'TASK-PSTACK-PILOT-001';
    seed([cancelled, active]);

    const r = detectAllPathCollisions(regPath);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('a terminal task never appears as the OUTER candidate', () => {
    const merged = pathTask('TASK-EC-MERGED', 'merged', false);
    const active = pathTask('TASK-EC-ACTIVE', 'in_progress', true);
    seed([merged, active]);
    const r = detectAllPathCollisions(regPath);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((c) => c.taskId)).not.toContain('TASK-EC-MERGED');
    expect(r.value).toEqual([]);
  });

  it('a non-lease-holding (ready) task never appears as the OUTER candidate', () => {
    const ready = pathTask('TASK-EC-READY', 'ready', false);
    const active = pathTask('TASK-EC-ACTIVE', 'in_progress', true);
    seed([ready, active]);
    const r = detectAllPathCollisions(regPath);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it('two genuinely active overlapping tasks => ONE canonical row, not two mirrored', () => {
    const a = pathTask('TASK-EC-AAA', 'in_progress', true);
    const b = pathTask('TASK-EC-BBB', 'verification', true);
    b.assignedRole = 'verifier';
    b.lease = { ...b.lease!, role: 'verifier' };
    seed([a, b]);

    const r = detectAllPathCollisions(regPath);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    expect(r.value[0].taskId).toBe('TASK-EC-AAA');
    expect(r.value[0].otherTaskId).toBe('TASK-EC-BBB');
  });
});

describe('evidence FRESHNESS is measured against the builder handoff, not the reporting checkpoint', () => {
  /**
   * REGRESSION GUARD for a rule that was inverted and therefore UNSATISFIABLE: it required
   * each command result to run at or AFTER the checkpoint reporting it. Honest work runs the
   * commands FIRST, so every truthful verifier failed and only a fabricated future timestamp
   * could pass. Measured on the real TASK-PSTACK-PILOT-002 (ranAt 02:15:19 vs cp.at
   * 02:15:30) — it was masked only because candidate identity failed earlier.
   */
  const builderCp: TaskCheckpoint = {
    id: 'cp-b',
    at: '2026-08-31T02:11:22.000Z',
    actor: 'builder-a',
    role: 'builder',
    outcome: 'ready_for_verification',
    changedPaths: [],
    diffStat: { files: 1, insertions: 1, deletions: 0 },
    evidence: {
      tests: [],
      commands: [],
      commandResults: results(CANDIDATE, '2026-08-31T02:11:22.000Z'),
      candidateHeadSha: CANDIDATE,
      candidateTreeSha: CANDIDATE_TREE,
      notes: '',
    },
    blockers: [],
    mutationsPerformed: [],
    authorizationConsumed: [],
    nextRequestedAction: 'verify',
  };

  function verifierWith(ranAt: string): TaskCheckpoint {
    return {
      ...builderCp,
      id: 'cp-v',
      at: '2026-08-31T02:15:30.000Z',
      actor: 'verifier-b',
      role: 'verifier',
      outcome: 'verified',
      evidence: { ...builderCp.evidence, commandResults: results(CANDIDATE, ranAt) },
      nextRequestedAction: 'integrate',
    };
  }

  it('ACCEPTS the real-world order: commands run BEFORE the checkpoint that reports them', () => {
    const t = task({ state: 'integration', checkpoints: [builderCp, verifierWith('2026-08-31T02:15:19.000Z')] });
    const r = validateVerificationEvidence({ task: t, candidateHeadSha: CANDIDATE });
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
  });

  it('REJECTS evidence gathered BEFORE the builder handoff (it describes an earlier artifact)', () => {
    const t = task({ state: 'integration', checkpoints: [builderCp, verifierWith('2026-08-31T02:00:00.000Z')] });
    const r = validateVerificationEvidence({ task: t, candidateHeadSha: CANDIDATE });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/ran before the builder handoff/);
  });
});

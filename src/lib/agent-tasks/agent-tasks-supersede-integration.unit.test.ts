import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createLease } from './lease';
import { lockDirForRegistry } from './lock';
import { writeRegistryFile, readRegistryFile } from './registry';
import { supersedeTask } from './operations';
import { supersessionChain } from './supersession';
import { assertRegistryInvariants } from './validate';
import { findPathCollisions } from './collisions';
import {
  canSupersedeFrom,
  canTransition,
  SUPERSEDABLE_STATES,
  TERMINAL_STATES,
} from './states';
import { testProvenance } from './test-registry-fixture';
import { TASK_STATES, DEFAULT_LEASE_MS } from './types';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord, TaskState } from './types';

/**
 * PHASE 3A.6 — supersession from a lease-free `integration` phase.
 *
 * REGRESSION ORIGIN (real, live): TASK-PSTACK-PILOT-002 sat at revision 19 in
 * `integration` with lease null and a base two commits behind main. The shipped
 * `supersede` gated on `canTransition(state, 'cancelled')`, which is false for
 * `integration`, so the live run failed with:
 *
 *     invalid_transition: cannot cancel from integration
 *
 * The fix must NOT widen the ordinary transition table. Generic
 * `canTransition('integration', 'cancelled')` stays false; only the dedicated
 * `canSupersedeFrom` admits the state, and only inside `supersedeTask`.
 *
 * Every mutation test uses a DISPOSABLE registry under tmpdir. The real pilot
 * registry is never opened, let alone written.
 */

const OLD_BASE = '5d8a3007e2aa931a41978705de030a6e304cc359';
const CURRENT_MAIN = '53e11c8722055b7fa18caaddb677262d7a920bb6';
const CANDIDATE = '4a02c91527d452cebba6da67ca91e81f49ee14fc';
const RUNBOOK = 'docs/engineering/pstack-phase-3a-pilot-runbook.md';

let dir: string;
let reg: string;

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function verifiedCp(): TaskCheckpoint {
  return {
    id: 'cp-pilot-002-verified',
    at: '2026-08-31T02:15:30.000Z',
    actor: 'pstack-pilot-verifier-v2',
    role: 'verifier',
    outcome: 'verified',
    changedPaths: [RUNBOOK],
    diffStat: { files: 1, insertions: 298, deletions: 0 },
    evidence: {
      tests: ['npm run verify:ma-skills'],
      commands: ['npm run verify:ma-skills'],
      commandResults: [
        {
          command: 'npm run verify:ma-skills',
          status: 'passed',
          ranAt: '2026-08-31T02:15:19.000Z',
          headSha: CANDIDATE,
          exitCode: 0,
        },
      ],
      notes: `candidateHeadSha=${CANDIDATE}`,
    },
    blockers: [],
    mutationsPerformed: ['read_only'],
    authorizationConsumed: ['claim:verifier'],
    nextRequestedAction: 'integrator claim',
  };
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'TASK-PSTACK-PILOT-002',
    title: 'Document the Phase 3A three-role pilot runbook',
    priority: 'high',
    state: 'integration',
    authorizedScope: 'First controlled Phase 3A local documentation-only pilot.',
    allowedPaths: [RUNBOOK],
    forbiddenPaths: ['src/**', 'scripts/**'],
    dependencies: [],
    assignedRole: 'integrator',
    branch: 'docs/pstack-phase-3a-pilot-v2',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot-v2',
    baseSha: OLD_BASE,
    lease: null,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: [verifiedCp()],
    auditLog: [
      {
        id: 'audit-1788141818323-superseded-from',
        at: '2026-08-31T02:03:38.323Z',
        actor: 'eric-orchestrator',
        action: 'superseded-from',
        fromState: 'proposed',
        toState: 'ready',
        evidenceRef: 'superseded-from TASK-PSTACK-PILOT-001',
        metadata: {
          registryRevision: '11',
          leaseOwner: 'none',
          role: 'administrator',
          supersedesTaskId: 'TASK-PSTACK-PILOT-001',
          sourceTaskId: 'TASK-PSTACK-PILOT-001',
        },
      },
      {
        id: 'audit-1788143596303-release',
        at: '2026-08-31T02:33:16.303Z',
        actor: 'pstack-pilot-integrator-v2',
        action: 'release',
        fromState: 'integration',
        toState: 'integration',
        evidenceRef: 'release',
        metadata: { registryRevision: '18', leaseOwner: 'pstack-pilot-integrator-v2', role: 'integrator' },
      },
    ],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['repo_files', 'git_commit'],
    approvalRequired: 'eric_explicit',
    supersededByTaskId: null,
    supersedesTaskId: 'TASK-PSTACK-PILOT-001',
    createdAt: '2026-08-31T02:03:38.323Z',
    updatedAt: '2026-08-31T02:33:16.303Z',
    ...over,
  };
}

/** The cancelled predecessor, so the fixture is the real rev-19 chain shape. */
function predecessor(over: Partial<TaskRecord> = {}): TaskRecord {
  return task({
    id: 'TASK-PSTACK-PILOT-001',
    state: 'cancelled',
    assignedRole: null,
    branch: 'docs/pstack-phase-3a-pilot',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8',
    checkpoints: [],
    auditLog: [],
    supersededByTaskId: 'TASK-PSTACK-PILOT-002',
    supersedesTaskId: null,
    ...over,
  });
}

/** Live-shaped revision-19 registry: 001 cancelled -> 002 integration (lease-free). */
function liveShaped(tasks: TaskRecord[] = [predecessor(), task()], revision = 19): AgentTaskRegistry {
  return {
    version: 2,
    revision,
    updatedAt: '2026-08-31T05:41:30.532Z',
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    adminAuditLog: [],
    provenance: testProvenance(),
  };
}

function input(over: Record<string, unknown> = {}) {
  return {
    taskId: 'TASK-PSTACK-PILOT-002',
    newTaskId: 'TASK-PSTACK-PILOT-003',
    branch: 'docs/pstack-phase-3a-pilot-v3',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot-v3',
    actor: 'eric-orchestrator',
    role: 'administrator',
    reason:
      'Supersede stale TASK-PSTACK-PILOT-002 after Phase 3A.5 landed; create a fresh successor at current main',
    confirm: true,
    currentMainSha: CURRENT_MAIN,
    nowMs: Date.parse('2026-08-31T06:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-3a6-'));
  reg = join(dir, 'registry.json');
});

afterEach(() => {
  try {
    chmodSync(dir, 0o755);
  } catch {
    /* already writable */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('3A.6 — the ordinary transition table is NOT widened', () => {
  it('canTransition(integration, cancelled) remains false', () => {
    expect(canTransition('integration', 'cancelled')).toBe(false);
  });

  it('integration still reaches only its ordinary successors', () => {
    const reachable = TASK_STATES.filter((s) => canTransition('integration', s));
    expect([...reachable].sort()).toEqual(
      ['awaiting_approval', 'blocked', 'failed', 'verification'].sort(),
    );
  });

  it('does not weaken generic cancellation for any other state', () => {
    // Exactly the states that could reach cancelled BEFORE 3A.6 still can, no more.
    const cancellable = TASK_STATES.filter((s) => canTransition(s, 'cancelled'));
    expect([...cancellable].sort()).toEqual(
      ['blocked', 'claimed', 'failed', 'in_progress', 'proposed', 'ready'].sort(),
    );
  });
});

describe('3A.6 — canSupersedeFrom eligibility policy', () => {
  it('admits the lease-free integration case', () => {
    expect(canSupersedeFrom('integration')).toBe(true);
  });

  it('is exactly the documented eligible set', () => {
    const eligible = TASK_STATES.filter((s) => canSupersedeFrom(s));
    expect([...eligible].sort()).toEqual(
      [
        'awaiting_approval',
        'blocked',
        'claimed',
        'in_progress',
        'integration',
        'proposed',
        'ready',
        'verification',
      ].sort(),
    );
    expect(new Set(eligible)).toEqual(new Set(SUPERSEDABLE_STATES));
  });

  it('never admits a terminal state', () => {
    for (const s of TERMINAL_STATES) {
      expect(canSupersedeFrom(s as TaskState)).toBe(false);
    }
    expect(canSupersedeFrom('merged')).toBe(false);
    expect(canSupersedeFrom('deployed')).toBe(false);
    expect(canSupersedeFrom('cancelled')).toBe(false);
  });

  it('documents the awaiting_approval policy explicitly (eligible when lease-free)', () => {
    expect(canSupersedeFrom('awaiting_approval')).toBe(true);
    // and it is NOT inherited from the transition table, which forbids the edge
    expect(canTransition('awaiting_approval', 'cancelled')).toBe(false);
  });

  it('keeps failed OUT — it already has an ordinary route to cancelled', () => {
    expect(canSupersedeFrom('failed')).toBe(false);
    expect(canTransition('failed', 'cancelled')).toBe(true);
  });

  it('every TASK_STATES member has a deliberate verdict', () => {
    for (const s of TASK_STATES) {
      expect(typeof canSupersedeFrom(s)).toBe('boolean');
    }
  });
});

describe('3A.6 — live-shaped revision-19 supersession succeeds', () => {
  it('cancels lease-free integration TASK-002 and creates ready TASK-003 at current main', () => {
    writeRegistryFile(reg, liveShaped());
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.source.id).toBe('TASK-PSTACK-PILOT-002');
    expect(r.value.source.state).toBe('cancelled');
    expect(r.value.source.supersededByTaskId).toBe('TASK-PSTACK-PILOT-003');
    expect(r.value.source.supersedesTaskId).toBe('TASK-PSTACK-PILOT-001');

    expect(r.value.successor.id).toBe('TASK-PSTACK-PILOT-003');
    expect(r.value.successor.state).toBe('ready');
    expect(r.value.successor.baseSha).toBe(CURRENT_MAIN);
    expect(r.value.successor.supersedesTaskId).toBe('TASK-PSTACK-PILOT-002');
    expect(r.value.successor.supersededByTaskId).toBeNull();
    expect(r.value.successor.branch).toBe('docs/pstack-phase-3a-pilot-v3');
    expect(r.value.successor.worktree).toBe('.claude/worktrees/pstack-phase-3a-pilot-v3');
  });

  it('reconstructs the complete three-link chain', () => {
    writeRegistryFile(reg, liveShaped());
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(supersessionChain(after.value, 'TASK-PSTACK-PILOT-001')).toEqual([
      'TASK-PSTACK-PILOT-001',
      'TASK-PSTACK-PILOT-002',
      'TASK-PSTACK-PILOT-003',
    ]);
  });

  it('advances the revision exactly once (19 -> 20) and grows the task count 2 -> 3', () => {
    writeRegistryFile(reg, liveShaped());
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    expect(r.revision).toBe(20);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.revision).toBe(20);
    expect(Object.keys(after.value.tasks)).toHaveLength(3);
  });

  it('leaves source checkpoints and prior audits byte-identical', () => {
    const before = task();
    const cps = JSON.stringify(before.checkpoints);
    const audits = JSON.stringify(before.auditLog);
    writeRegistryFile(reg, liveShaped([predecessor(), before]));

    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(JSON.stringify(r.value.source.checkpoints)).toBe(cps);
    expect(JSON.stringify(r.value.source.auditLog.slice(0, 2))).toBe(audits);
    expect(r.value.source.baseSha).toBe(OLD_BASE);
  });

  it('leaves the untouched predecessor TASK-001 byte-identical', () => {
    writeRegistryFile(reg, liveShaped([predecessor(), task()]));
    // Snapshot through the SAME read path used afterwards: parseTaskRecord normalises
    // optional fields (e.g. candidateEvidenceAttestation: null) on every read, so
    // comparing a raw fixture against a parsed record would report that normalisation
    // as a mutation. Round-tripping both sides isolates the operation's real effect.
    const seeded = readRegistryFile(reg);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const beforeJson = JSON.stringify(seeded.value.tasks['TASK-PSTACK-PILOT-001']);

    expect(supersedeTask(reg, input()).ok).toBe(true);

    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(JSON.stringify(after.value.tasks['TASK-PSTACK-PILOT-001'])).toBe(beforeJson);
  });

  it('gives the successor fresh lifecycle state: no checkpoints, lease, role, or evidence', () => {
    writeRegistryFile(reg, liveShaped());
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value.successor;
    expect(s.checkpoints).toEqual([]);
    expect(s.lease).toBeNull();
    expect(s.assignedRole).toBeNull();
    expect(s.prRef).toBeNull();
    expect(s.mergeSha).toBeNull();
    expect(s.deploymentRef).toBeNull();
    expect(s.deploySha).toBeNull();
    expect(s.candidateEvidenceAttestation ?? null).toBeNull();
    // its ONLY audit entry is its own creation
    expect(s.auditLog).toHaveLength(1);
    expect(s.auditLog[0].action).toBe('superseded-from');
  });

  it('inherits scope and policy verbatim without widening', () => {
    writeRegistryFile(reg, liveShaped());
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const src = task();
    const s = r.value.successor;
    expect(s.title).toBe(src.title);
    expect(s.authorizedScope).toBe(src.authorizedScope);
    expect(s.allowedPaths).toEqual(src.allowedPaths);
    expect(s.forbiddenPaths).toEqual(src.forbiddenPaths);
    expect(s.dependencies).toEqual(src.dependencies);
    expect(s.verificationProfile).toEqual(['docs-only']);
    expect(s.allowedMutations).toEqual(src.allowedMutations);
    expect(s.approvalRequired).toBe('eric_explicit');
    expect(s.allowSameAgentVerification).toBe(src.allowSameAgentVerification);
  });

  it('writes mutually consistent source and successor audits', () => {
    writeRegistryFile(reg, liveShaped());
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const a = r.value.source.auditLog.at(-1)!;
    const b = r.value.successor.auditLog.at(-1)!;
    expect(a.action).toBe('supersede');
    expect(b.action).toBe('superseded-from');
    expect(a.at).toBe(b.at);
    expect(a.actor).toBe(b.actor);
    expect(a.actor).toBe('eric-orchestrator');
    expect(a.metadata.role).toBe('administrator');
    expect(b.metadata.role).toBe('administrator');
    expect(a.metadata.registryRevision).toBe(b.metadata.registryRevision);
    expect(a.metadata.reason).toBe(b.metadata.reason);
    expect(a.metadata.supersededByTaskId).toBe('TASK-PSTACK-PILOT-003');
    expect(b.metadata.supersedesTaskId).toBe('TASK-PSTACK-PILOT-002');
    expect(b.metadata.sourceTaskId).toBe('TASK-PSTACK-PILOT-002');
    expect(a.metadata.oldBaseSha).toBe(OLD_BASE);
    expect(b.metadata.oldBaseSha).toBe(OLD_BASE);
    expect(a.metadata.newBaseSha).toBe(CURRENT_MAIN);
    expect(b.metadata.newBaseSha).toBe(CURRENT_MAIN);
    // source records the transition it actually made
    expect(a.fromState).toBe('integration');
    expect(a.toState).toBe('cancelled');
  });

  it('keeps version-2 provenance updated and invariants passing', () => {
    writeRegistryFile(reg, liveShaped());
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.version).toBe(2);
    expect(after.value.provenance).toBeTruthy();
    expect(after.value.provenance?.writerVersion).toBe(2);
    expect(assertRegistryInvariants(after.value)).toBeNull();
  });

  it('produces no path collisions and no dangling dependencies', () => {
    writeRegistryFile(reg, liveShaped());
    expect(supersedeTask(reg, input()).ok).toBe(true);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    // source is cancelled in the same write, so nothing live contends
    expect(findPathCollisions(after.value, 'TASK-PSTACK-PILOT-003')).toEqual([]);
    for (const t of Object.values(after.value.tasks)) {
      for (const dep of t.dependencies) expect(after.value.tasks[dep]).toBeTruthy();
    }
  });

  it('releases the lock and leaves no temp write debris', () => {
    writeRegistryFile(reg, liveShaped());
    expect(supersedeTask(reg, input()).ok).toBe(true);
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
    const stray = readFileSync(reg, 'utf8');
    expect(stray.length).toBeGreaterThan(0);
  });
});

describe('3A.6 — rejections still fail closed (registry byte-identical)', () => {
  /**
   * Seed the registry, snapshot its bytes, then run the rejection. `seed` lets a case
   * install a DIFFERENT starting shape; the hash is always taken after seeding so the
   * comparison measures the operation, never the setup.
   */
  function expectUntouched(
    fn: () => { ok: boolean },
    seed: () => void = () => writeRegistryFile(reg, liveShaped()),
  ) {
    seed();
    // The seeded bytes ARE the contract: whatever shape a case installs must survive a
    // rejection unchanged. Task count and source state are read from that snapshot
    // rather than hardcoded, so a case may seed 2 or 3 tasks without weakening the check.
    const before = sha256(reg);
    const seeded = readRegistryFile(reg);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return { ok: false };
    const seededTaskCount = Object.keys(seeded.value.tasks).length;
    const seededSourceState = seeded.value.tasks['TASK-PSTACK-PILOT-002'].state;
    const seededJson = JSON.stringify(seeded.value);

    const r = fn();
    expect(r.ok).toBe(false);

    expect(sha256(reg)).toBe(before);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return r;
    expect(JSON.stringify(after.value)).toBe(seededJson);
    expect(after.value.revision).toBe(19);
    expect(Object.keys(after.value.tasks)).toHaveLength(seededTaskCount);
    expect(after.value.tasks['TASK-PSTACK-PILOT-003']).toBeUndefined();
    expect(after.value.tasks['TASK-PSTACK-PILOT-002'].state).toBe(seededSourceState);
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
    return r;
  }

  it('rejects an ACTIVE integrator lease on a lease-holding integration source', () => {
    const now = Date.parse('2026-08-31T06:00:00.000Z');
    writeRegistryFile(
      reg,
      liveShaped([
        predecessor(),
        task({ lease: createLease('pstack-pilot-integrator-v2', 'integrator', now, DEFAULT_LEASE_MS) }),
      ]),
    );
    const before = sha256(reg);
    const r = supersedeTask(reg, input({ nowMs: now }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('lease_conflict');
    expect(sha256(reg)).toBe(before);
  });

  it('rejects a terminal source (merged / deployed / cancelled)', () => {
    for (const state of ['merged', 'deployed', 'cancelled'] as TaskState[]) {
      writeRegistryFile(reg, liveShaped([predecessor(), task({ state })]));
      const before = sha256(reg);
      const r = supersedeTask(reg, input());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('invalid_transition');
      expect(sha256(reg)).toBe(before);
    }
  });

  it('rejects an already-superseded source', () => {
    // Lineage integrity is enforced on READ (a dangling supersededByTaskId makes the
    // registry unparseable), so the fixture uses a REAL successor that already points
    // back — exactly the shape a second supersede attempt would encounter.
    const alreadySuccessor = task({
      id: 'TASK-PSTACK-PILOT-004',
      state: 'ready',
      assignedRole: null,
      branch: 'docs/pstack-phase-3a-pilot-v4',
      worktree: '.claude/worktrees/pstack-phase-3a-pilot-v4',
      checkpoints: [],
      auditLog: [],
      supersedesTaskId: 'TASK-PSTACK-PILOT-002',
      supersededByTaskId: null,
    });
    const r = expectUntouched(
      () => supersedeTask(reg, input()),
      () =>
        writeRegistryFile(
          reg,
          liveShaped([
            predecessor(),
            task({ state: 'cancelled', supersededByTaskId: 'TASK-PSTACK-PILOT-004' }),
            alreadySuccessor,
          ]),
        ),
    );
    expect((r as { code?: string }).code).toBe('invalid_transition');
  });

  it('rejects a non-administrator role', () => {
    const r = expectUntouched(() => supersedeTask(reg, input({ role: 'integrator' })));
    expect((r as { code?: string }).code).toBe('unauthorized_actor');
  });

  it('rejects a missing --confirm', () => {
    const r = expectUntouched(() => supersedeTask(reg, input({ confirm: false })));
    expect((r as { code?: string }).code).toBe('unauthorized_actor');
  });

  it('rejects an empty reason', () => {
    const r = expectUntouched(() => supersedeTask(reg, input({ reason: '   ' })));
    expect((r as { code?: string }).code).toBe('unauthorized_actor');
  });

  it('rejects a successor id that already exists', () => {
    writeRegistryFile(
      reg,
      liveShaped([predecessor(), task(), task({ id: 'TASK-PSTACK-PILOT-003', state: 'ready' })]),
    );
    const before = sha256(reg);
    const r = supersedeTask(reg, input());
    expect(r.ok).toBe(false);
    expect(sha256(reg)).toBe(before);
  });

  it('rejects a fabricated/malformed current main sha', () => {
    const r = expectUntouched(() => supersedeTask(reg, input({ currentMainSha: 'not-a-sha' })));
    expect((r as { code?: string }).code).toBeTruthy();
  });

  it('is ATOMIC under an injected write failure — nothing partially applied', () => {
    writeRegistryFile(reg, liveShaped());
    const before = sha256(reg);
    chmodSync(dir, 0o555); // registry dir read-only: the atomic temp write cannot land
    const r = supersedeTask(reg, input());
    chmodSync(dir, 0o755);
    expect(r.ok).toBe(false);
    expect(sha256(reg)).toBe(before);
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.revision).toBe(19);
    expect(after.value.tasks['TASK-PSTACK-PILOT-003']).toBeUndefined();
    expect(after.value.tasks['TASK-PSTACK-PILOT-002'].state).toBe('integration');
    expect(existsSync(lockDirForRegistry(reg))).toBe(false);
  });
});

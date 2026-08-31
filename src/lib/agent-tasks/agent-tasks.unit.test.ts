import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testProvenance } from './test-registry-fixture';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLease,
  isLeaseExpired,
  renewLease,
  canClaimLease,
} from './lease';
import { DEFAULT_LEASE_MS } from './types';
import { pathsCollide, findPathCollisions, touchesForbiddenPath } from './collisions';
import { detectStaleMain, parseMainAheadCount } from './stale-main';
import { parseCheckpoint, parseRegistry } from './validate';
import { assertRegisteredVerificationProfiles } from './verification-profiles';
import { applyCheckpointMutations, stateForCheckpointOutcome, validateCheckpointPayload } from './checkpoint';
import {
  claimTask,
  heartbeatTask,
  releaseTask,
  appendCheckpoint,
  detectAllPathCollisions,
  listReadyTasks,
  promoteTask,
} from './operations';
import { readRegistryFile, writeRegistryFile } from './registry';
import { lockDirForRegistry } from './lock';
import type { AgentTaskRegistry, TaskRecord } from './types';

const BASE_SHA = '13c30b762da10e19e3897079f5e1059dee1fb475';
const ORIGIN_MAIN = '13c30b762da10e19e3897079f5e1059dee1fb475';

function seedTask(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    title: overrides.title ?? 'Test task',
    priority: overrides.priority ?? 'normal',
    state: overrides.state ?? 'ready',
    authorizedScope: overrides.authorizedScope ?? 'prototype',
    allowedPaths: overrides.allowedPaths ?? ['src/lib/agent-tasks/**'],
    forbiddenPaths: overrides.forbiddenPaths ?? ['.env*', '**/credentials*'],
    dependencies: overrides.dependencies ?? [],
    assignedRole: overrides.assignedRole ?? null,
    branch: overrides.branch ?? null,
    worktree: overrides.worktree ?? null,
    baseSha: overrides.baseSha ?? BASE_SHA,
    lease: overrides.lease ?? null,
    verificationProfile: overrides.verificationProfile ?? ['ma-skills'],
    allowSameAgentVerification: overrides.allowSameAgentVerification ?? false,
    checkpoints: overrides.checkpoints ?? [],
    auditLog: overrides.auditLog ?? [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: overrides.allowedMutations ?? ['read_only', 'repo_files'],
    approvalRequired: overrides.approvalRequired ?? 'human_review',
    createdAt: now,
    updatedAt: now,
  };
}

function seedRegistry(tasks: TaskRecord[]): AgentTaskRegistry {
  const map: Record<string, TaskRecord> = {};
  for (const t of tasks) map[t.id] = t;
  return {
    version: 2,
    revision: 1,
    updatedAt: new Date().toISOString(),
    tasks: map,
    adminAuditLog: [],
    provenance: testProvenance(),
  };
}

describe('lease expiry and recovery', () => {
  it('expires after TTL', () => {
    const t0 = 1_700_000_000_000;
    const lease = createLease('agent-a', 'builder', t0);
    expect(isLeaseExpired(lease, t0 + DEFAULT_LEASE_MS - 1)).toBe(false);
    expect(isLeaseExpired(lease, t0 + DEFAULT_LEASE_MS)).toBe(true);
  });

  it('renews expiry from heartbeat time', () => {
    const t0 = 1_700_000_000_000;
    const lease = createLease('agent-a', 'builder', t0);
    const renewed = renewLease(lease, t0 + 60_000);
    expect(Date.parse(renewed.expiresAt)).toBe(t0 + 60_000 + DEFAULT_LEASE_MS);
  });

  it('blocks destructive takeover while lease is active', () => {
    const t0 = Date.now();
    const lease = createLease('agent-a', 'builder', t0);
    expect(canClaimLease(lease, 'agent-b', t0).allowed).toBe(false);
    expect(canClaimLease(lease, 'agent-a', t0).allowed).toBe(true);
    expect(canClaimLease(lease, 'agent-b', t0 + DEFAULT_LEASE_MS + 1).allowed).toBe(true);
  });
});

describe('path collisions', () => {
  it('detects prefix overlap', () => {
    expect(pathsCollide('src/lib/foo', 'src/lib/foo/bar.ts')).toBe(true);
    expect(pathsCollide('src/lib/foo/**', 'src/lib/foo/x.ts')).toBe(true);
    expect(pathsCollide('src/lib/bar/**', 'src/lib/foo/**')).toBe(false);
  });

  it('finds collision between two leased tasks', () => {
    const t0 = Date.now();
    const a = seedTask({
      id: 'TASK-A',
      state: 'in_progress',
      allowedPaths: ['src/lib/agent-tasks/**'],
      lease: createLease('a', 'builder', t0),
    });
    const b = seedTask({
      id: 'TASK-B',
      state: 'ready',
      allowedPaths: ['src/lib/agent-tasks/registry.ts'],
    });
    const hits = findPathCollisions(b, [a], t0);
    expect(hits.length).toBe(1);
    expect(hits[0].otherTaskId).toBe('TASK-A');
  });

  it('ignores expired leases for collision detection', () => {
    const t0 = 1_700_000_000_000;
    const a = seedTask({
      id: 'TASK-A',
      state: 'in_progress',
      allowedPaths: ['src/**'],
      lease: createLease('a', 'builder', t0),
    });
    const b = seedTask({ id: 'TASK-B', allowedPaths: ['src/lib/**'] });
    expect(findPathCollisions(b, [a], t0 + DEFAULT_LEASE_MS + 1)).toHaveLength(0);
  });
});

describe('stale main detection', () => {
  it('passes when base equals origin/main', () => {
    expect(
      detectStaleMain({ taskBaseSha: BASE_SHA, originMainSha: ORIGIN_MAIN, mainAheadCount: 0 }).stale,
    ).toBe(false);
  });

  it('fail-closed when main moved forward', () => {
    const r = detectStaleMain({
      taskBaseSha: 'aaa1111',
      originMainSha: 'bbb2222',
      mainAheadCount: 3,
    });
    expect(r.stale).toBe(true);
    if (r.stale) expect(r.mainAheadCount).toBe(3);
  });

  it('parseMainAheadCount rejects garbage', () => {
    expect(parseMainAheadCount('12')).toBe(12);
    expect(parseMainAheadCount('')).toBeNull();
    expect(parseMainAheadCount('-1')).toBeNull();
  });
});

describe('malformed checkpoints', () => {
  it('rejects checkpoint missing required fields', () => {
    expect(validateCheckpointPayload({ id: 'x' }).ok).toBe(false);
  });

  it('accepts valid checkpoint', () => {
    const r = validateCheckpointPayload({
      id: 'cp-1',
      at: '2026-08-30T12:00:00.000Z',
      actor: 'builder-1',
      role: 'builder',
      outcome: 'ready_for_verification',
      changedPaths: ['src/foo.ts'],
      diffStat: { files: 1, insertions: 2, deletions: 0 },
      evidence: { tests: ['vitest'], commands: [], notes: '' },
      blockers: [],
      mutationsPerformed: ['repo_files'],
      authorizationConsumed: ['repo_files'],
      nextRequestedAction: 'verifier review',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects merge/deploy mutations in checkpoint', () => {
    const task = seedTask({ id: 'TASK-X', allowedMutations: ['merge'] });
    const cp = parseCheckpoint({
      id: 'cp-1',
      at: '2026-08-30T12:00:00.000Z',
      actor: 'integrator-1',
      role: 'integrator',
      outcome: 'awaiting_approval',
      changedPaths: [],
      diffStat: { files: 0, insertions: 0, deletions: 0 },
      evidence: { tests: [], commands: [], notes: '' },
      blockers: [],
      mutationsPerformed: ['merge'],
      authorizationConsumed: [],
      nextRequestedAction: 'human merge',
    })!;
    expect(applyCheckpointMutations(task, cp).ok).toBe(false);
  });

  it('maps outcomes to target states', () => {
    expect(stateForCheckpointOutcome('in_progress', 'ready_for_verification')).toBe('verification');
    expect(stateForCheckpointOutcome('verification', 'verified')).toBe('integration');
  });
});

describe('registry file operations', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-tasks-'));
    regPath = join(dir, 'registry.json');
    writeRegistryFile(regPath, seedRegistry([seedTask({ id: 'TASK-001' })]));
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('claim succeeds for ready task', () => {
    const r = claimTask(regPath, {
      taskId: 'TASK-001',
      actor: 'builder-1',
      role: 'builder',
      nowMs: Date.now(),
      originMainSha: ORIGIN_MAIN,
      mainAheadCount: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe('claimed');
      expect(r.value.lease?.owner).toBe('builder-1');
    }
  });

  it('claim fails on stale main', () => {
    const r = claimTask(regPath, {
      taskId: 'TASK-001',
      actor: 'builder-1',
      role: 'builder',
      originMainSha: 'ffffffffffffffffffffffffffffffffffffffff',
      mainAheadCount: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('stale_main');
  });

  it('claim fails on path collision', () => {
    writeRegistryFile(
      regPath,
      seedRegistry([
        seedTask({ id: 'TASK-001', allowedPaths: ['src/lib/**'] }),
        seedTask({
          id: 'TASK-002',
          state: 'in_progress',
          allowedPaths: ['src/lib/agent-tasks/**'],
          lease: createLease('other', 'builder', Date.now()),
        }),
      ]),
    );
    const r = claimTask(regPath, {
      taskId: 'TASK-001',
      actor: 'b',
      role: 'builder',
      originMainSha: ORIGIN_MAIN,
      mainAheadCount: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('path_collision');
  });

  it('heartbeat renews lease for owner only', () => {
    claimTask(regPath, {
      taskId: 'TASK-001',
      actor: 'builder-1',
      role: 'builder',
      originMainSha: ORIGIN_MAIN,
      mainAheadCount: 0,
    });
    const bad = heartbeatTask(regPath, { taskId: 'TASK-001', actor: 'other' });
    expect(bad.ok).toBe(false);
    const good = heartbeatTask(regPath, { taskId: 'TASK-001', actor: 'builder-1' });
    expect(good.ok).toBe(true);
  });

  it('release returns task to ready', () => {
    claimTask(regPath, {
      taskId: 'TASK-001',
      actor: 'builder-1',
      role: 'builder',
      originMainSha: ORIGIN_MAIN,
      mainAheadCount: 0,
    });
    const r = releaseTask(regPath, { taskId: 'TASK-001', actor: 'builder-1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state).toBe('ready');
  });

  it('appendCheckpoint rejects forbidden path touches', () => {
    claimTask(regPath, {
      taskId: 'TASK-001',
      actor: 'builder-1',
      role: 'builder',
      originMainSha: ORIGIN_MAIN,
      mainAheadCount: 0,
    });
    const r = appendCheckpoint(regPath, {
      taskId: 'TASK-001',
      actor: 'builder-1',
      checkpoint: {
        id: 'cp-1',
        at: new Date().toISOString(),
        actor: 'builder-1',
        role: 'builder',
        outcome: 'progress',
        changedPaths: ['.env.local'],
        diffStat: { files: 1, insertions: 1, deletions: 0 },
        evidence: { tests: [], commands: [], notes: '' },
        blockers: [],
        mutationsPerformed: ['repo_files'],
        authorizationConsumed: [],
        nextRequestedAction: 'continue',
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden_mutation');
  });

  it('fail-closed on malformed registry', () => {
    writeFileSync(regPath, '{ "version": 1, "revision": "bad" }');
    expect(readRegistryFile(regPath).ok).toBe(false);
  });

  it('listReadyTasks respects dependencies', () => {
    writeRegistryFile(
      regPath,
      seedRegistry([
        seedTask({ id: 'TASK-001', state: 'ready', dependencies: ['TASK-DEP'] }),
        seedTask({ id: 'TASK-DEP', state: 'proposed' }),
        seedTask({ id: 'TASK-FREE', state: 'ready' }),
      ]),
    );
    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (read.ok) {
      const ready = listReadyTasks(read.value);
      expect(ready.map((t) => t.id)).toEqual(['TASK-FREE']);
    }
  });
});

describe('verification profile registry', () => {
  it('rejects unknown and empty profile sets', () => {
    expect(assertRegisteredVerificationProfiles([]).ok).toBe(false);
    expect(assertRegisteredVerificationProfiles(['unknown-profile' as never]).ok).toBe(false);
  });

  it('docs-only requires sole profile and promote evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-docs-only-'));
    const regPath = join(dir, 'registry.json');
    try {
      writeRegistryFile(
        regPath,
        seedRegistry([
          seedTask({
            id: 'TASK-DOCS',
            state: 'proposed',
            verificationProfile: ['docs-only'],
            allowedPaths: ['docs/engineering/**'],
          }),
        ]),
      );
      const short = promoteTask(regPath, {
        taskId: 'TASK-DOCS',
        actor: 'admin',
        role: 'administrator',
        toState: 'ready',
        evidenceRef: 'too short',
      });
      expect(short.ok).toBe(false);
      const ok = promoteTask(regPath, {
        taskId: 'TASK-DOCS',
        actor: 'admin',
        role: 'administrator',
        toState: 'ready',
        evidenceRef: 'documentation-only: skills registry update',
      });
      expect(ok.ok).toBe(true);
    } finally {
      rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects docs-only combined with other profiles on promote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-docs-mix-'));
    const regPath = join(dir, 'registry.json');
    try {
      writeRegistryFile(
        regPath,
        seedRegistry([
          seedTask({
            id: 'TASK-MIX',
            state: 'proposed',
            verificationProfile: ['docs-only', 'ma-skills'],
            allowedPaths: ['docs/**'],
          }),
        ]),
      );
      const r = promoteTask(regPath, {
        taskId: 'TASK-MIX',
        actor: 'admin',
        role: 'administrator',
        toState: 'ready',
        evidenceRef: 'documentation-only change with adequate evidence',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('verification_incomplete');
    } finally {
      rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('forbidden path helper', () => {
  it('flags .env touches', () => {
    const task = seedTask({ id: 'T', forbiddenPaths: ['.env*'] });
    expect(touchesForbiddenPath(task, ['.env.local'])).toContain('.env.local');
  });
});

describe('parseRegistry malformed task', () => {
  it('rejects invalid task id', () => {
    expect(
      parseRegistry({
        version: 2,
        revision: 0,
        updatedAt: '2026-08-30T12:00:00.000Z',
        tasks: { bad: seedTask({ id: 'not-valid' }) },
      }),
    ).toBeNull();
  });
});

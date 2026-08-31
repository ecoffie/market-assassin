import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testProvenance } from './test-registry-fixture';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnTsxAsync } from './test-cli-spawn';
import { createLease } from './lease';
import { lockDirForRegistry, acquireRegistryLock, recoverStaleLockDirAtomic } from './lock';
import { writeRegistryFile, readRegistryFile, initRegistryFile } from './registry';
import { approveTask, prepareIntegrationHandoff } from './operations';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

const BASE_SHA = '13c30b762da10e19e3897079f5e1059dee1fb475';
/** Must match the injected worktreeArtifact tree below — the gate compares them. */
const TREE_SHA = '1111111111111111111111111111111111111111';
const ORIGIN_MAIN = BASE_SHA;

function maSkillsEvidence(headSha = BASE_SHA) {
  return [
    {
      command: 'npm run verify:ma-skills',
      status: 'passed' as const,
      ranAt: new Date().toISOString(),
      headSha,
      exitCode: 0,
    },
  ];
}

function integrationTask(id: string): TaskRecord {
  const now = new Date().toISOString();
  const builderCp: TaskCheckpoint = {
    id: 'cp-rfv',
    at: now,
    actor: 'builder-a',
    role: 'builder',
    outcome: 'ready_for_verification',
    changedPaths: ['src/lib/agent-tasks/types.ts'],
    diffStat: { files: 1, insertions: 1, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills'],
      commandResults: maSkillsEvidence(),
      candidateHeadSha: BASE_SHA,
      // Structured contract requires BOTH head and tree (a half-filled pair is refused).
      candidateTreeSha: TREE_SHA,
      notes: '',
    },
    blockers: [],
    mutationsPerformed: ['repo_files'],
    authorizationConsumed: [],
    nextRequestedAction: 'verify',
  };
  const verifiedCp: TaskCheckpoint = {
    id: 'cp-verified',
    at: now,
    actor: 'verifier-a',
    role: 'verifier',
    outcome: 'verified',
    changedPaths: [],
    diffStat: { files: 0, insertions: 0, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills'],
      commandResults: maSkillsEvidence(),
      candidateHeadSha: BASE_SHA,
      // Structured contract requires BOTH head and tree (a half-filled pair is refused).
      candidateTreeSha: TREE_SHA,
      notes: '',
    },
    blockers: [],
    mutationsPerformed: [],
    authorizationConsumed: [],
    nextRequestedAction: 'integrator',
  };
  return {
    id,
    title: 'Race test task',
    priority: 'normal',
    state: 'integration',
    authorizedScope: 'test',
    allowedPaths: ['src/lib/agent-tasks/**'],
    forbiddenPaths: ['.env*'],
    dependencies: [],
    assignedRole: 'integrator',
    branch: 'fix/test-branch',
    worktree: '.claude/worktrees/test',
    baseSha: BASE_SHA,
    lease: createLease('integrator-a', 'integrator', Date.now()),
    verificationProfile: ['ma-skills'],
    allowSameAgentVerification: false,
    checkpoints: [builderCp, verifiedCp],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['read_only', 'repo_files'],
    approvalRequired: 'human_review',
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

describe('approve revalidation under mutation lock', () => {
  let dir: string;
  let regPath: string;
  const taskId = 'TASK-RACE-APPROVE';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-approve-race-'));
    regPath = join(dir, 'registry.json');
    writeRegistryFile(regPath, seedRegistry([integrationTask(taskId)]));
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails closed when registry/evidence changes after handoff passes', () => {
    const handoff = prepareIntegrationHandoff(regPath, {
      taskId,
      actor: 'integrator-a',
      role: 'integrator',
      currentMainSha: ORIGIN_MAIN,
      mainAheadRaw: '0',
      worktreeArtifact: {
        headSha: BASE_SHA,
        treeSha: '1111111111111111111111111111111111111111',
        branch: 'fix/test-branch',
        clean: true,
        isDescendantOfBase: true,
      },
      skipWorktreeCheck: false,
    });
    expect(handoff.ok).toBe(true);

    const raw = JSON.parse(readFileSync(regPath, 'utf8')) as AgentTaskRegistry;
    const task = raw.tasks[taskId];
    const cp = task.checkpoints.find((c) => c.outcome === 'verified');
    if (cp) cp.evidence.commandResults = [];
    writeFileSync(regPath, JSON.stringify({ ...raw, revision: raw.revision + 1 }, null, 2));

    const approve = approveTask(regPath, {
      taskId,
      actor: 'admin',
      role: 'administrator',
      evidenceRef: 'review:ok',
      currentMainSha: ORIGIN_MAIN,
      mainAheadCount: 0,
      worktreeArtifact: {
        headSha: BASE_SHA,
        treeSha: '1111111111111111111111111111111111111111',
        branch: 'fix/test-branch',
        clean: true,
        isDescendantOfBase: true,
      },
      skipWorktreeCheck: false,
    });
    expect(approve.ok).toBe(false);
    if (!approve.ok) expect(approve.code).toBe('verification_incomplete');
  });
});

describe('stale lock recovery race', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lock-race-'));
    regPath = join(dir, 'registry.json');
    initRegistryFile(regPath);
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('atomic recovery cannot delete a newly acquired live lock', async () => {
    const lockDir = lockDirForRegistry(regPath);
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, 'meta.json'),
      JSON.stringify({
        owner: 'dead-agent',
        pid: 99999999,
        sessionId: 'dead',
        acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    );

    function runRecovery(): Promise<{ ok: boolean; code?: string }> {
      const probe = join(process.cwd(), 'scripts/agent-task-lock-recovery-probe.mts');
      return spawnTsxAsync(probe, [], {
        env: { ...process.env, AGENT_TASK_REGISTRY_PATH: regPath, MODE: 'recover' },
      }).then(({ stdout }) => {
        try {
          return JSON.parse(stdout || '{}');
        } catch {
          return { ok: false, code: 'parse_error' };
        }
      });
    }

    function runAcquire(): Promise<{ ok: boolean; code?: string }> {
      const probe = join(process.cwd(), 'scripts/agent-task-lock-recovery-probe.mts');
      return spawnTsxAsync(probe, [], {
        env: { ...process.env, AGENT_TASK_REGISTRY_PATH: regPath, MODE: 'acquire' },
      }).then(({ stdout }) => {
        try {
          return JSON.parse(stdout || '{}');
        } catch {
          return { ok: false, code: 'parse_error' };
        }
      });
    }

    const [rec, acq] = await Promise.all([runRecovery(), runAcquire()]);
    expect(rec.ok || acq.ok).toBe(true);
    if (existsSync(lockDir)) {
      const parsed = JSON.parse(readFileSync(join(lockDir, 'meta.json'), 'utf8'));
      expect(typeof parsed.owner).toBe('string');
      expect(parsed.pid).not.toBe(99999999);
    } else {
      expect(rec.ok).toBe(true);
    }
  });

  it('recoverStaleLockDirAtomic refuses non-stale live lock', () => {
    const live = acquireRegistryLock({ registryPath: regPath, owner: 'live-holder' });
    expect(live.ok).toBe(true);
    const recovered = recoverStaleLockDirAtomic({ registryPath: regPath });
    expect(recovered.ok).toBe(false);
    if (!recovered.ok) expect(recovered.code).toBe('lock_not_stale');
    live.ok && live.value.release();
  });
});

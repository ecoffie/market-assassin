import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testProvenance } from './test-registry-fixture';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLease } from './lease';
import { lockDirForRegistry } from './lock';
import { writeRegistryFile } from './registry';
import {
  validateVerificationEvidence,
  validateIntegrationGate,
} from './verification';
import {
  extractCandidateIdentity,
  validateCandidateArtifactConsistency,
} from './candidate-artifact';
import { approveTask, prepareIntegrationHandoff } from './operations';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

const BASE_A = '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8';
const CANDIDATE_B = 'db3efa4d9357cc357c70897175ed7c7e514b8c4d';
const TREE_B = '8d8b5c4744939e8ed4a33b8a7e6d6f8e453b79a4';
const MAIN_C = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function docsOnlyResults(headSha: string, ranAt = '2026-08-30T22:50:30.000Z') {
  return [
    { command: 'npm run verify:ma-skills', status: 'passed' as const, ranAt, headSha, exitCode: 0 },
    { command: 'git diff --check', status: 'passed' as const, ranAt, headSha, exitCode: 0 },
  ];
}

function builderCheckpoint(headSha: string, treeSha?: string): TaskCheckpoint {
  return {
    id: 'cp-builder-rfv',
    at: '2026-08-30T22:48:00.000Z',
    actor: 'builder-a',
    role: 'builder',
    outcome: 'ready_for_verification',
    changedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    diffStat: { files: 1, insertions: 298, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills', 'git diff --check'],
      commandResults: docsOnlyResults(headSha),
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

function verifierCheckpoint(headSha: string, treeSha?: string): TaskCheckpoint {
  return {
    id: 'cp-verified',
    at: '2026-08-30T22:50:00.000Z',
    actor: 'verifier-a',
    role: 'verifier',
    outcome: 'verified',
    changedPaths: [],
    diffStat: { files: 0, insertions: 0, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills', 'git diff --check'],
      commandResults: docsOnlyResults(headSha),
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

function integrationTask(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    title: overrides.title ?? 'Candidate head test',
    priority: 'normal',
    state: overrides.state ?? 'integration',
    authorizedScope: 'test',
    allowedPaths: overrides.allowedPaths ?? ['docs/engineering/**'],
    forbiddenPaths: ['.env*'],
    dependencies: [],
    assignedRole: overrides.assignedRole ?? 'integrator',
    branch: overrides.branch ?? 'docs/pstack-phase-3a-pilot',
    worktree: overrides.worktree ?? '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: overrides.baseSha ?? BASE_A,
    lease: overrides.lease ?? createLease('integrator-a', 'integrator', Date.now()),
    verificationProfile: overrides.verificationProfile ?? ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: overrides.checkpoints ?? [builderCheckpoint(CANDIDATE_B, TREE_B), verifierCheckpoint(CANDIDATE_B, TREE_B)],
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

function seedRegistry(tasks: TaskRecord[]): AgentTaskRegistry {
  const map: Record<string, TaskRecord> = {};
  for (const t of tasks) map[t.id] = t;
  return { version: 2, revision: 1, updatedAt: new Date().toISOString(), tasks: map, adminAuditLog: [], provenance: testProvenance() };
}

function artifactB() {
  return {
    headSha: CANDIDATE_B,
    treeSha: TREE_B,
    branch: 'docs/pstack-phase-3a-pilot',
    clean: true,
    isDescendantOfBase: true,
  };
}

describe('Phase 3A.2 candidate-head verification', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-candidate-head-'));
    regPath = join(dir, 'registry.json');
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('base main A + candidate feature B + evidence B → PASS', () => {
    const task = integrationTask({ id: 'TASK-PASS' });
    writeRegistryFile(regPath, seedRegistry([task]));

    const identity = extractCandidateIdentity(task);
    expect(identity.ok).toBe(true);
    if (!identity.ok) return;

    const evidence = validateVerificationEvidence({
      task,
      candidateHeadSha: identity.value.candidateHeadSha,
    });
    expect(evidence.ok).toBe(true);

    const gate = validateIntegrationGate(seedRegistry([task]), task, {
      actor: 'integrator-a',
      role: 'integrator',
      currentMainSha: BASE_A,
      mainAheadCount: 0,
      nowMs: Date.now(),
      requireIntegratorLease: true,
      integratorActor: 'integrator-a',
      worktreeArtifact: artifactB(),
      skipWorktreeCheck: false,
    });
    expect(gate.ok).toBe(true);
  });

  it('evidence A when candidate is B → verification_incomplete', () => {
    const task = integrationTask({
      id: 'TASK-WRONG-EVIDENCE',
      checkpoints: [
        builderCheckpoint(CANDIDATE_B, TREE_B),
        verifierCheckpoint(BASE_A, TREE_B),
      ],
    });
    const identity = extractCandidateIdentity(task);
    expect(identity.ok).toBe(false);
    if (!identity.ok) expect(identity.code).toBe('verification_incomplete');
  });

  it('Builder B / Verifier C mismatch → fail', () => {
    const task = integrationTask({
      id: 'TASK-MISMATCH',
      checkpoints: [
        builderCheckpoint(CANDIDATE_B, TREE_B),
        verifierCheckpoint('cccccccccccccccccccccccccccccccccccccccc', TREE_B),
      ],
    });
    expect(extractCandidateIdentity(task).ok).toBe(false);
  });

  it('command results with mixed head SHAs → fail', () => {
    const mixedCp = verifierCheckpoint(CANDIDATE_B, TREE_B);
    mixedCp.evidence.commandResults = [
      ...docsOnlyResults(CANDIDATE_B),
      { command: 'extra', status: 'passed', ranAt: '2026-08-30T22:49:10.000Z', headSha: BASE_A, exitCode: 0 },
    ];
    const task = integrationTask({ id: 'TASK-MIXED', checkpoints: [builderCheckpoint(CANDIDATE_B, TREE_B), mixedCp] });
    expect(extractCandidateIdentity(task).ok).toBe(false);
  });

  it('feature HEAD changes after verification → fail at approve', () => {
    writeRegistryFile(regPath, seedRegistry([integrationTask({ id: 'TASK-HEAD-CHANGE' })]));
    const handoff = prepareIntegrationHandoff(regPath, {
      taskId: 'TASK-HEAD-CHANGE',
      actor: 'integrator-a',
      role: 'integrator',
      currentMainSha: BASE_A,
      mainAheadRaw: '0',
      worktreeArtifact: artifactB(),
      skipWorktreeCheck: false,
    });
    expect(handoff.ok).toBe(true);

    const changed = artifactB();
    changed.headSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const approve = approveTask(regPath, {
      taskId: 'TASK-HEAD-CHANGE',
      actor: 'admin',
      role: 'administrator',
      evidenceRef: 'review:ok',
      currentMainSha: BASE_A,
      mainAheadCount: 0,
      worktreeArtifact: changed,
      skipWorktreeCheck: false,
    });
    expect(approve.ok).toBe(false);
    if (!approve.ok) expect(approve.code).toBe('candidate_integrity');
  });

  it('candidate tree changes → fail', () => {
    const task = integrationTask({ id: 'TASK-TREE' });
    const bad = artifactB();
    bad.treeSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const check = validateCandidateArtifactConsistency({
      task,
      identity: { candidateHeadSha: CANDIDATE_B, candidateTreeSha: TREE_B },
      worktree: bad,
      requireWorktree: true,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe('candidate_integrity');
  });

  it('dirty worktree → fail', () => {
    const dirty = artifactB();
    dirty.clean = false;
    const check = validateCandidateArtifactConsistency({
      task: integrationTask({ id: 'T' }),
      identity: { candidateHeadSha: CANDIDATE_B, candidateTreeSha: TREE_B },
      worktree: dirty,
      requireWorktree: true,
    });
    expect(check.ok).toBe(false);
  });

  it('current main advances A→C → stale_main', () => {
    const task = integrationTask({ id: 'TASK-STALE' });
    const gate = validateIntegrationGate(seedRegistry([task]), task, {
      actor: 'integrator-a',
      role: 'integrator',
      currentMainSha: MAIN_C,
      mainAheadCount: 3,
      nowMs: Date.now(),
      requireIntegratorLease: true,
      worktreeArtifact: artifactB(),
      skipWorktreeCheck: false,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe('stale_main');
  });

  it('candidate B is not a descendant of base A → fail', () => {
    const bad = artifactB();
    bad.isDescendantOfBase = false;
    const task = integrationTask({ id: 'TASK-NON-DESC' });
    writeRegistryFile(regPath, seedRegistry([task]));
    const handoff = prepareIntegrationHandoff(regPath, {
      taskId: 'TASK-NON-DESC',
      actor: 'integrator-a',
      role: 'integrator',
      currentMainSha: BASE_A,
      mainAheadRaw: '0',
      worktreeArtifact: bad,
      skipWorktreeCheck: false,
    });
    expect(handoff.ok).toBe(false);
  });

  it('wrong assigned branch → fail', () => {
    const bad = artifactB();
    bad.branch = 'wrong/branch';
    const check = validateCandidateArtifactConsistency({
      task: integrationTask({ id: 'T' }),
      identity: { candidateHeadSha: CANDIDATE_B, candidateTreeSha: TREE_B },
      worktree: bad,
      requireWorktree: true,
    });
    expect(check.ok).toBe(false);
  });

  it('legacy pilot record (commandResults only) is REFUSED without administrator authorisation', () => {
    // CONTRACT CHANGE (2026-08-30): unstructured evidence no longer auto-selects a weaker
    // path. checkpoint.at is caller-controlled (appendCheckpoint stamps only `actor`), so a
    // timestamp cutoff was unenforceable — an agent could backdate into it. Recovery is now
    // an administrator act; see agent-tasks-legacy-evidence.unit.test.ts.
    const pilotBuilder = builderCheckpoint(CANDIDATE_B);
    delete pilotBuilder.evidence.candidateHeadSha;
    delete pilotBuilder.evidence.candidateTreeSha;
    const pilotVerifier = verifierCheckpoint(CANDIDATE_B);
    delete pilotVerifier.evidence.candidateHeadSha;
    delete pilotVerifier.evidence.candidateTreeSha;

    const task = integrationTask({
      id: 'TASK-PILOT-LIKE',
      baseSha: BASE_A,
      checkpoints: [pilotBuilder, pilotVerifier],
    });

    const refused = extractCandidateIdentity(task);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain('administrator');

    // …and WITH administrator authorisation it recovers the same candidate.
    const allowed = extractCandidateIdentity(task, { legacyRecoveryRequested: true });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.value.candidateHeadSha).toBe(CANDIDATE_B);
    expect(allowed.value.evidenceTier).toBe('legacy');
  });

  it('approve rechecks actual feature HEAD under lock', () => {
    writeRegistryFile(regPath, seedRegistry([integrationTask({ id: 'TASK-APPROVE-RECHECK' })]));
    const approve = approveTask(regPath, {
      taskId: 'TASK-APPROVE-RECHECK',
      actor: 'admin',
      role: 'administrator',
      evidenceRef: 'review:ok',
      currentMainSha: BASE_A,
      mainAheadCount: 0,
      worktreeArtifact: artifactB(),
      skipWorktreeCheck: false,
    });
    expect(approve.ok).toBe(true);
  });
});

describe('validateVerificationEvidence rejects base-as-candidate mismatch', () => {
  it('fails when commandResults reference base A but candidate is B', () => {
    const task = integrationTask({
      id: 'T',
      checkpoints: [builderCheckpoint(CANDIDATE_B, TREE_B), verifierCheckpoint(CANDIDATE_B, TREE_B)],
    });
    const r = validateVerificationEvidence({ task, candidateHeadSha: CANDIDATE_B });
    expect(r.ok).toBe(true);

    const wrong = validateVerificationEvidence({ task, candidateHeadSha: BASE_A });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('verification_incomplete');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLease } from './lease';
import { lockDirForRegistry } from './lock';
import { writeRegistryFile } from './registry';
import { extractCandidateIdentity } from './candidate-artifact';
import { resolveEvidenceTier, LEGACY_RECOVERY_MODE } from './candidate-evidence-contract';
import { appendCheckpoint, reconcileTaskState } from './operations';
import { readRegistryFile } from './registry';
import { approveTask } from './operations';
import { sanitizedGitEnv, GIT_ENV_OVERRIDE_VARS } from './git-evidence';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

/**
 * THE LEGACY-EVIDENCE CONTRACT + THE APPROVE RACE.
 *
 * The real pilot predates structured candidateHeadSha/candidateTreeSha, so it must be
 * recoverable — but the fallback has to be BOUNDED.
 *
 * ⚠️ A TIMESTAMP CUTOFF WAS TRIED AND PROVEN UNENFORCEABLE. `appendCheckpoint` stamps only
 * `actor`; `at` is written straight from the caller's JSON. Measured in this file: a
 * checkpoint submitted with a BACKDATED `at` is stored verbatim, so any agent could have
 * backdated its way into the weaker contract. Eligibility is therefore an ADMINISTRATOR act
 * (--legacy-evidence-recovery), which no checkpoint payload can set.
 */

const BASE_A = '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8';
const CANDIDATE_B = 'db3efa4d9357cc357c70897175ed7c7e514b8c4d';
const TREE_B = '8d8b5c4744939e8ed4a33b8a7e6d6f8e453b79a4';

const LEGACY_AT_BUILDER = '2026-08-30T22:48:00.000Z'; // the real pilot's timestamps
const LEGACY_AT_VERIFIER = '2026-08-30T22:50:00.000Z';
const POST_CUTOFF_AT = '2026-09-01T10:00:00.000Z';

function results(headSha: string | undefined, ranAt = '2026-08-30T22:50:30.000Z') {
  return [
    { command: 'npm run verify:ma-skills', status: 'passed' as const, ranAt, headSha, exitCode: 0 },
    { command: 'git diff --check', status: 'passed' as const, ranAt, headSha, exitCode: 0 },
  ];
}

function cp(overrides: {
  id: string;
  at: string;
  actor: string;
  role: TaskCheckpoint['role'];
  outcome: TaskCheckpoint['outcome'];
  structured?: { head: string; tree: string };
  crHeads?: (string | undefined)[];
}): TaskCheckpoint {
  // ranAt must be >= the checkpoint's own `at`, or validateVerificationEvidence correctly
  // rejects it as evidence that predates the checkpoint it is attached to.
  const ranAt = new Date(Date.parse(overrides.at) + 60_000).toISOString();
  const commandResults = overrides.crHeads
    ? overrides.crHeads.map((h, i) => ({
        command: i === 0 ? 'npm run verify:ma-skills' : 'git diff --check',
        status: 'passed' as const,
        ranAt,
        headSha: h,
        exitCode: 0,
      }))
    : results(CANDIDATE_B, ranAt);
  return {
    id: overrides.id,
    at: overrides.at,
    actor: overrides.actor,
    role: overrides.role,
    outcome: overrides.outcome,
    changedPaths: ['docs/engineering/pstack-phase-3a-pilot-runbook.md'],
    diffStat: { files: 1, insertions: 10, deletions: 0 },
    evidence: {
      tests: [],
      commands: ['npm run verify:ma-skills', 'git diff --check'],
      commandResults,
      candidateHeadSha: overrides.structured?.head,
      candidateTreeSha: overrides.structured?.tree,
      notes: '',
    },
    blockers: [],
    mutationsPerformed: [],
    authorizationConsumed: [],
    nextRequestedAction: overrides.role === 'builder' ? 'verify' : 'integrate',
  };
}

function legacyPair() {
  return [
    cp({ id: 'cp-pilot-001-ready-for-verification', at: LEGACY_AT_BUILDER, actor: 'pstack-pilot-builder', role: 'builder', outcome: 'ready_for_verification' }),
    cp({ id: 'cp-pilot-001-verified', at: LEGACY_AT_VERIFIER, actor: 'pstack-pilot-verifier', role: 'verifier', outcome: 'verified' }),
  ];
}

function task(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    title: 'Legacy evidence test',
    priority: 'normal',
    state: overrides.state ?? 'integration',
    authorizedScope: 'test',
    allowedPaths: ['docs/engineering/**'],
    forbiddenPaths: ['.env*'],
    dependencies: [],
    assignedRole: 'integrator',
    branch: overrides.branch ?? 'docs/pstack-phase-3a-pilot',
    worktree: overrides.worktree ?? '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: overrides.baseSha ?? BASE_A,
    lease: overrides.lease === undefined ? createLease('integrator-a', 'integrator', Date.now()) : overrides.lease,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: overrides.checkpoints ?? legacyPair(),
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

function seed(t: TaskRecord): AgentTaskRegistry {
  return { version: 1, revision: 10, updatedAt: new Date().toISOString(), tasks: { [t.id]: t }, adminAuditLog: [] };
}

describe('legacy evidence is bounded by a creation cutoff', () => {
  it('THE REAL PILOT SHAPE passes via the legacy path WITH administrator authorisation', () => {
    const t = task({ id: 'TASK-PILOT-LEGACY' });
    const id = extractCandidateIdentity(t, { legacyRecoveryRequested: true });
    expect(id.ok).toBe(true);
    if (!id.ok) return;
    expect(id.value.evidenceTier).toBe('legacy');
    expect(id.value.candidateHeadSha).toBe(CANDIDATE_B);
    // No tree can be recovered from legacy evidence — it must come from the live worktree.
    expect(id.value.candidateTreeSha).toBeNull();
    expect(id.value.evidenceBasis).toContain('legacy evidence recovery');
  });

  it('a NEWLY CREATED checkpoint without structured fields FAILS (no silent fallback)', () => {
    const t = task({
      id: 'TASK-NEW-NOSTRUCT',
      checkpoints: [
        cp({ id: 'cp-b', at: POST_CUTOFF_AT, actor: 'builder-x', role: 'builder', outcome: 'ready_for_verification' }),
        cp({ id: 'cp-v', at: POST_CUTOFF_AT, actor: 'verifier-x', role: 'verifier', outcome: 'verified' }),
      ],
    });
    const id = extractCandidateIdentity(t);
    expect(id.ok).toBe(false);
    if (id.ok) return;
    expect(id.message).toContain('structured candidate evidence required');
  });

  it('legacy fallback CANNOT be selected merely by omitting fields', () => {
    const tier = resolveEvidenceTier(
      cp({ id: 'b', at: POST_CUTOFF_AT, actor: 'b', role: 'builder', outcome: 'ready_for_verification' }),
      cp({ id: 'v', at: POST_CUTOFF_AT, actor: 'v', role: 'verifier', outcome: 'verified' }),
    );
    expect(tier.tier).toBe('structured');
    expect(tier.reason).toContain('administrator');
  });

  it('legacy fallback CANNOT be selected by BACKDATING — timestamps are caller-controlled', () => {
    // The pilot's own timestamps, on records an agent could submit today. Without an
    // administrator flag this MUST stay on the strong contract.
    const tier = resolveEvidenceTier(
      cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification' }),
      cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
    );
    expect(tier.tier).toBe('structured');
  });

  it('administrator authorisation IS what selects legacy', () => {
    const tier = resolveEvidenceTier(
      cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification' }),
      cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
      { legacyRecoveryRequested: true },
    );
    expect(tier.tier).toBe('legacy');
  });

  it('a MIXED pair stays structured EVEN WITH the administrator flag', () => {
    // Recovery is for records that predate the schema, not a switch to weaken a task that
    // already has structured evidence on one side.
    const tier = resolveEvidenceTier(
      cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification', structured: { head: CANDIDATE_B, tree: TREE_B } }),
      cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
      { legacyRecoveryRequested: true },
    );
    expect(tier.tier).toBe('structured');
  });

  it('a MIXED structured/unstructured pre-cutoff pair is held to the strong contract', () => {
    const tier = resolveEvidenceTier(
      cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification', structured: { head: CANDIDATE_B, tree: TREE_B } }),
      cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
    );
    expect(tier.tier).toBe('structured');
  });

  it('legacy with MIXED command-result heads fails closed', () => {
    const OTHER = 'cccccccccccccccccccccccccccccccccccccccc';
    const t = task({
      id: 'TASK-MIXED',
      checkpoints: [
        cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification', crHeads: [CANDIDATE_B, OTHER] }),
        cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
      ],
    });
    const id = extractCandidateIdentity(t, { legacyRecoveryRequested: true });
    expect(id.ok).toBe(false);
    if (id.ok) return;
    expect(id.message).toContain('unanimous');
  });

  it('legacy with a MISSING command-result head fails closed', () => {
    const t = task({
      id: 'TASK-MISSING',
      checkpoints: [
        cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification', crHeads: [CANDIDATE_B, undefined] }),
        cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
      ],
    });
    const id = extractCandidateIdentity(t, { legacyRecoveryRequested: true });
    expect(id.ok).toBe(false);
    if (id.ok) return;
    expect(id.message).toContain('missing headSha');
  });

  it('legacy requires DISTINCT builder and verifier actors', () => {
    const t = task({
      id: 'TASK-SELF',
      checkpoints: [
        cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'same', role: 'builder', outcome: 'ready_for_verification' }),
        cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'same', role: 'verifier', outcome: 'verified' }),
      ],
    });
    const id = extractCandidateIdentity(t, { legacyRecoveryRequested: true });
    expect(id.ok).toBe(false);
    if (id.ok) return;
    expect(id.code).toBe('self_verification_forbidden');
  });

  it('legacy requires CORRECT checkpoint ORDER', () => {
    const [b, v] = legacyPair();
    const t = task({ id: 'TASK-ORDER', checkpoints: [v, b] });
    const id = extractCandidateIdentity(t, { legacyRecoveryRequested: true });
    expect(id.ok).toBe(false);
    if (id.ok) return;
    expect(id.message).toContain('out of order');
  });

  it('FUTURE structured evidence stays mandatory and self-consistent', () => {
    // Structured fields that disagree with the commands actually run must fail.
    const OTHER = 'cccccccccccccccccccccccccccccccccccccccc';
    const t = task({
      id: 'TASK-DISAGREE',
      checkpoints: [
        cp({ id: 'b', at: POST_CUTOFF_AT, actor: 'b', role: 'builder', outcome: 'ready_for_verification', structured: { head: CANDIDATE_B, tree: TREE_B }, crHeads: [OTHER, OTHER] }),
        cp({ id: 'v', at: POST_CUTOFF_AT, actor: 'v', role: 'verifier', outcome: 'verified', structured: { head: CANDIDATE_B, tree: TREE_B }, crHeads: [OTHER, OTHER] }),
      ],
    });
    const id = extractCandidateIdentity(t);
    expect(id.ok).toBe(false);
    if (id.ok) return;
    expect(id.message).toContain('disagree with candidateHeadSha');
  });

  it('a well-formed post-cutoff structured pair PASSES', () => {
    const t = task({
      id: 'TASK-GOOD-STRUCT',
      checkpoints: [
        cp({ id: 'b', at: POST_CUTOFF_AT, actor: 'b', role: 'builder', outcome: 'ready_for_verification', structured: { head: CANDIDATE_B, tree: TREE_B } }),
        cp({ id: 'v', at: POST_CUTOFF_AT, actor: 'v', role: 'verifier', outcome: 'verified', structured: { head: CANDIDATE_B, tree: TREE_B } }),
      ],
    });
    const id = extractCandidateIdentity(t);
    expect(id.ok).toBe(true);
    if (!id.ok) return;
    expect(id.value.evidenceTier).toBe('structured');
    expect(id.value.candidateTreeSha).toBe(TREE_B);
  });
});

/**
 * REGRESSION GUARD — nested fixture git must never reach the parent repository.
 *
 * On 2026-08-30 the approve-race fixtures shelled out to `git init` / `git commit` without
 * scrubbing the environment. Run from a pre-push HOOK (which exports GIT_DIR and friends),
 * those commands ignored `cwd`, committed into the REAL worktree, moved its branch ref off
 * the Phase 3A.2 commit, and left HEAD on a fixture branch. The commit survived only
 * because of the reflog.
 *
 * These assertions fail if anyone reintroduces an unsanitized child git call.
 */
describe('nested fixture git cannot target the parent repository', () => {
  const git = (args: string[], cwd: string, env: NodeJS.ProcessEnv) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

  it('sanitizes every variable that can redirect a child git', () => {
    // The exact set that makes `cwd` insufficient. Shrinking it reopens the incident.
    expect([...GIT_ENV_OVERRIDE_VARS]).toEqual([
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_PREFIX',
      'GIT_COMMON_DIR',
    ]);
    for (const k of GIT_ENV_OVERRIDE_VARS) {
      expect(sanitizedGitEnv()[k], `${k} must be stripped`).toBeUndefined();
    }
  });

  it('commits land in the TEMP repo, not the parent, under POISONED GIT_* env', () => {
    // Two disposable repos: `parent` stands in for the real repository, `temp` for the
    // fixture. The env is poisoned to point at `parent` — exactly what a hook does.
    const parent = mkdtempSync(join(tmpdir(), 'guard-parent-'));
    const temp = mkdtempSync(join(tmpdir(), 'guard-temp-'));
    try {
      const clean = sanitizedGitEnv();
      git(['init', '-q', '-b', 'main'], parent, clean);
      git(['config', 'user.email', 'p@p.p'], parent, clean);
      git(['config', 'user.name', 'P'], parent, clean);
      writeFileSync(join(parent, 'p.txt'), 'parent\n');
      git(['add', '-A'], parent, clean);
      git(['commit', '-qm', 'parent-base'], parent, clean);
      const parentHeadBefore = git(['rev-parse', 'HEAD'], parent, clean);

      const poisoned: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_DIR: join(parent, '.git'),
        GIT_WORK_TREE: parent,
      };

      // The fixture pattern, but sanitized: build a repo inside `temp`.
      const scrubbed = { ...poisoned };
      for (const k of GIT_ENV_OVERRIDE_VARS) delete scrubbed[k];
      git(['init', '-q', '-b', 'main'], temp, scrubbed);
      git(['config', 'user.email', 't@t.t'], temp, scrubbed);
      git(['config', 'user.name', 'T'], temp, scrubbed);
      writeFileSync(join(temp, 't.txt'), 'temp\n');
      git(['add', '-A'], temp, scrubbed);
      git(['commit', '-qm', 'temp-base'], temp, scrubbed);

      // THE ASSERTION: the parent repo is untouched — same HEAD, same branch, still clean.
      expect(git(['rev-parse', 'HEAD'], parent, clean)).toBe(parentHeadBefore);
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], parent, clean)).toBe('main');
      expect(git(['status', '--porcelain'], parent, clean)).toBe('');
      // …and the temp repo genuinely got its own distinct commit.
      expect(git(['rev-parse', 'HEAD'], temp, clean)).not.toBe(parentHeadBefore);
    } finally {
      rmSync(parent, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe('checkpoint.at is CALLER-CONTROLLED — the reason a timestamp cutoff was rejected', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-backdate-'));
    regPath = join(dir, 'registry.json');
  });
  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  function builderTask(): TaskRecord {
    const now = new Date().toISOString();
    return {
      id: 'TASK-BACKDATE-001', title: 'x', priority: 'normal', state: 'in_progress',
      authorizedScope: 't', allowedPaths: ['docs/engineering/**'], forbiddenPaths: ['.env*'],
      dependencies: [], assignedRole: 'builder', branch: 'b', worktree: 'w', baseSha: BASE_A,
      lease: createLease('builder-a', 'builder', Date.now()), verificationProfile: ['docs-only'],
      allowSameAgentVerification: false, checkpoints: [], auditLog: [], prRef: null,
      mergeSha: null, deploymentRef: null, deploySha: null,
      allowedMutations: ['read_only', 'repo_files', 'git_commit'],
      approvalRequired: 'human_review', createdAt: now, updatedAt: now,
    };
  }

  it('PROVES a backdated `at` is stored verbatim (server stamps only `actor`)', () => {
    const t = builderTask();
    writeRegistryFile(regPath, seed(t));

    const r = appendCheckpoint(regPath, {
      taskId: t.id,
      actor: 'builder-a',
      checkpoint: {
        id: 'cp-backdated',
        at: LEGACY_AT_BUILDER, // an agent CHOOSING a pre-migration timestamp
        actor: 'builder-a',
        role: 'builder',
        outcome: 'ready_for_verification',
        changedPaths: ['docs/engineering/x.md'],
        diffStat: { files: 1, insertions: 1, deletions: 0 },
        evidence: {
          tests: [],
          commands: ['npm run verify:ma-skills', 'git diff --check'],
          commandResults: [
            { command: 'npm run verify:ma-skills', status: 'passed', ranAt: LEGACY_AT_BUILDER, headSha: CANDIDATE_B, exitCode: 0 },
            { command: 'git diff --check', status: 'passed', ranAt: LEGACY_AT_BUILDER, headSha: CANDIDATE_B, exitCode: 0 },
          ],
          notes: '',
        },
        blockers: [], mutationsPerformed: ['repo_files', 'git_commit'],
        authorizationConsumed: [], nextRequestedAction: 'verify',
      },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // THE FINDING: the caller's timestamp survives untouched.
    expect(read.value.tasks[t.id].checkpoints[0].at).toBe(LEGACY_AT_BUILDER);
  });

  it('and that backdating buys NOTHING — the tier still requires an administrator', () => {
    const tier = resolveEvidenceTier(
      cp({ id: 'b', at: LEGACY_AT_BUILDER, actor: 'b', role: 'builder', outcome: 'ready_for_verification' }),
      cp({ id: 'v', at: LEGACY_AT_VERIFIER, actor: 'v', role: 'verifier', outcome: 'verified' }),
    );
    expect(tier.tier).toBe('structured');
  });
});

describe('administrator legacy recovery is audited, then honoured', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-recovery-'));
    regPath = join(dir, 'registry.json');
  });
  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  const artifact = {
    headSha: CANDIDATE_B,
    treeSha: TREE_B,
    branch: 'docs/pstack-phase-3a-pilot',
    clean: true,
    isDescendantOfBase: true,
  };
  const admin = {
    actor: 'eric-orchestrator',
    role: 'administrator' as const,
    reason: 'Restore phase from validated checkpoint chain',
    confirm: true,
  };

  it('WITHOUT the flag, a pilot-shaped task fails closed', () => {
    const t = task({ id: 'TASK-NOFLAG', state: 'ready', lease: null });
    writeRegistryFile(regPath, seed(t));
    const r = reconcileTaskState(regPath, { ...admin, taskId: t.id, worktreeArtifact: artifact });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('structured candidate evidence required');
  });

  it('WITH the flag, recovery succeeds and records a full audit entry', () => {
    const t = task({ id: 'TASK-RECOVER', state: 'ready', lease: null });
    writeRegistryFile(regPath, seed(t));
    const cpBefore = JSON.stringify(t.checkpoints);

    const r = reconcileTaskState(regPath, {
      ...admin,
      taskId: t.id,
      legacyEvidenceRecovery: true,
      worktreeArtifact: artifact,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('integration');
    // Checkpoints are READ, never rewritten.
    expect(JSON.stringify(r.value.checkpoints)).toBe(cpBefore);

    const last = r.value.auditLog[r.value.auditLog.length - 1];
    expect(last.action).toBe('reconcile-state');
    expect(last.metadata?.recoveryMode).toBe(LEGACY_RECOVERY_MODE);
    expect(last.metadata?.candidateHeadSha).toBe(CANDIDATE_B);
    expect(last.metadata?.candidateTreeSha).toBe(TREE_B);
    expect(last.metadata?.builderCheckpointId).toBe('cp-pilot-001-ready-for-verification');
    expect(last.metadata?.verifierCheckpointId).toBe('cp-pilot-001-verified');
    expect(last.actor).toBe('eric-orchestrator');
    expect(last.metadata?.reason).toContain('Restore phase');
    expect(last.metadata?.registryRevision).toBeTruthy();
  });

  it('after the audited recovery, later reads honour it WITHOUT a timestamp', () => {
    const t = task({ id: 'TASK-RECOVER2', state: 'ready', lease: null });
    writeRegistryFile(regPath, seed(t));
    const r = reconcileTaskState(regPath, {
      ...admin, taskId: t.id, legacyEvidenceRecovery: true, worktreeArtifact: artifact,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // No flag passed here — the AUDIT ENTRY is what establishes trust now.
    const id = extractCandidateIdentity(r.value);
    expect(id.ok).toBe(true);
    if (!id.ok) return;
    expect(id.value.evidenceTier).toBe('legacy');
    expect(id.value.candidateHeadSha).toBe(CANDIDATE_B);
  });

  it('legacy recovery REFUSES when the live worktree is dirty or wrong-branch', () => {
    const t = task({ id: 'TASK-DIRTY', state: 'ready', lease: null });
    writeRegistryFile(regPath, seed(t));
    const r = reconcileTaskState(regPath, {
      ...admin, taskId: t.id, legacyEvidenceRecovery: true,
      worktreeArtifact: { ...artifact, clean: false },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('candidate_integrity');
  });
});

/**
 * APPROVE RACE — the candidate must be re-resolved from the REAL worktree inside the
 * registry mutation lock. Evidence captured before the lock is not sufficient: an actor can
 * push a commit in the window between handoff and approve.
 */
describe('approve re-resolves the candidate under the lock', () => {
  let repo: string;
  let dir: string;
  let regPath: string;

  // ⚠️ MUST use the shared sanitizer. Under a pre-push HOOK git exports GIT_DIR /
  // GIT_INDEX_FILE / GIT_WORK_TREE, and a child `git` inherits them — so `cwd` alone does
  // NOT confine this fixture. Measured 2026-08-30: without this, `git init` + `git commit`
  // here committed into the REAL worktree, moved its branch ref, and left HEAD on a
  // fixture branch. Reuses sanitizedGitEnv() from git-evidence.ts so test and production
  // scrub the identical variable set.
  const git = (args: string[], cwd: string) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: sanitizedGitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-approve-race-'));
    regPath = join(dir, 'registry.json');
    repo = mkdtempSync(join(tmpdir(), 'agent-approve-repo-'));
    git(['init', '-q', '-b', 'main'], repo);
    git(['config', 'user.email', 't@t.t'], repo);
    git(['config', 'user.name', 'T'], repo);
    writeFileSync(join(repo, 'a.txt'), 'base\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'base'], repo);
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('a candidate HEAD that MOVES between handoff and approve fails at approve', () => {
    const baseSha = git(['rev-parse', 'HEAD'], repo);
    git(['checkout', '-q', '-b', 'feature/x'], repo);
    writeFileSync(join(repo, 'a.txt'), 'candidate\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'candidate'], repo);
    const candidate = git(['rev-parse', 'HEAD'], repo);
    const candidateTree = git(['rev-parse', 'HEAD^{tree}'], repo);

    // Checkpoints attest to the candidate as it stood at handoff.
    const t = task({
      id: 'TASK-RACE',
      baseSha,
      branch: 'feature/x',
      worktree: '.',
      checkpoints: [
        cp({ id: 'b', at: POST_CUTOFF_AT, actor: 'b', role: 'builder', outcome: 'ready_for_verification', structured: { head: candidate, tree: candidateTree }, crHeads: [candidate, candidate] }),
        cp({ id: 'v', at: POST_CUTOFF_AT, actor: 'v', role: 'verifier', outcome: 'verified', structured: { head: candidate, tree: candidateTree }, crHeads: [candidate, candidate] }),
      ],
    });
    writeRegistryFile(regPath, seed(t));

    // …then the branch MOVES before approve runs (the race).
    writeFileSync(join(repo, 'a.txt'), 'moved after verification\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'sneaky'], repo);
    const movedHead = git(['rev-parse', 'HEAD'], repo);
    expect(movedHead).not.toBe(candidate);

    const r = approveTask(regPath, {
      taskId: t.id,
      actor: 'eric-orchestrator',
      role: 'administrator',
      evidenceRef: 'ref',
      repoRoot: repo,
      currentMainSha: baseSha,
      mainAheadCount: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('candidate_integrity');
    // Proves the LIVE worktree was read at approve time, not the handoff snapshot.
    expect(r.message).toContain(movedHead.slice(0, 12));
  });

  it('an unchanged candidate still approves (the race guard is not a blanket denial)', () => {
    // Same real repo, but the branch does NOT move. Uses an injected artifact matching the
    // live HEAD so the assertion isolates the race guard rather than registry-fixture shape
    // (the sibling test above already proves the LIVE read via a real moving branch).
    const baseSha = git(['rev-parse', 'HEAD'], repo);
    git(['checkout', '-q', '-b', 'feature/x'], repo);
    writeFileSync(join(repo, 'a.txt'), 'candidate\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'candidate'], repo);
    const candidate = git(['rev-parse', 'HEAD'], repo);
    const candidateTree = git(['rev-parse', 'HEAD^{tree}'], repo);

    const t = task({
      id: 'TASK-RACE-OK',
      baseSha,
      branch: 'feature/x',
      checkpoints: [
        cp({ id: 'b', at: POST_CUTOFF_AT, actor: 'b', role: 'builder', outcome: 'ready_for_verification', structured: { head: candidate, tree: candidateTree }, crHeads: [candidate, candidate] }),
        cp({ id: 'v', at: POST_CUTOFF_AT, actor: 'v', role: 'verifier', outcome: 'verified', structured: { head: candidate, tree: candidateTree }, crHeads: [candidate, candidate] }),
      ],
    });
    writeRegistryFile(regPath, seed(t));

    const r = approveTask(regPath, {
      taskId: t.id,
      actor: 'eric-orchestrator',
      role: 'administrator',
      evidenceRef: 'ref',
      currentMainSha: baseSha,
      mainAheadCount: 0,
      worktreeArtifact: {
        headSha: candidate,
        treeSha: candidateTree,
        branch: 'feature/x',
        clean: true,
        isDescendantOfBase: true,
      },
      skipWorktreeCheck: false,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe('awaiting_approval');
  });
});

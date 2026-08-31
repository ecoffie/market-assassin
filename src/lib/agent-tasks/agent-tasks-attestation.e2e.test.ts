import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testProvenance } from './test-registry-fixture';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { spawnTsxSync } from './test-cli-spawn';
import { sanitizedGitEnv } from './git-evidence';
import { resolveSharedRepoRoot, resolveTaskWorktreePath } from './task-worktree';
import type { AgentTaskRegistry, TaskCheckpoint, TaskRecord } from './types';

/**
 * PHASE 3A.4 — FULL REAL-GIT INTEGRATION.
 *
 * Builds a DISPOSABLE repository that reproduces the TASK-PSTACK-PILOT-002 defect exactly:
 * a candidate one genuine commit ahead of main, separate Builder and Verifier checkpoints,
 * unanimous commandResults at the candidate head, a live clean task worktree, and NO
 * structured candidate fields on any checkpoint.
 *
 * Everything here is disposable — a tmpdir repo and a tmpdir registry. The real pilot
 * registry under the repo's git-common-dir is never opened, and the real repository is
 * never touched. `sanitizedGitEnv()` is mandatory: a pre-push hook exports GIT_DIR and
 * friends, and a child `git` inheriting them would operate on the OUTER repo regardless of
 * cwd (see git-evidence.ts).
 *
 * NOTE ON THE SPACE IN PATHS: the repo dir name deliberately contains a space, because the
 * real checkout lives under "/Users/.../Market Assasin/". Every git call is execFile argv,
 * never a shell string, so this must hold.
 */

const SCRIPT_SRC = join(process.cwd(), 'scripts/agent-task.mts');

let root: string;        // disposable repo root (the shared root)
let mainWt: string;      // the main checkout
let taskWt: string;      // the task's own linked worktree
let otherWt: string;     // an unrelated linked worktree (approve runs from here)
let regPath: string;     // disposable registry
let BASE = '';           // main commit
let CANDIDATE = '';      // candidate head (one commit ahead)
let CANDIDATE_TREE = '';

const TASK_ID = 'TASK-ATTEST-001';
const BRANCH = 'fix/attest-candidate';
const WT_REL = '.claude/worktrees/attest-candidate';
const DOC = 'docs/engineering/pstack-phase-3a-pilot-runbook.md';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: sanitizedGitEnv() }).trim();
}

function run(args: string[], cwd: string) {
  return spawnTsxSync(SCRIPT_SRC, [...args, '--registry', regPath], {
    cwd,
    env: { ...sanitizedGitEnv(), AGENT_TASK_REGISTRY_PATH: regPath },
    encoding: 'utf8',
  });
}

function results(head: string, at: string) {
  return [
    { command: 'npm run verify:ma-skills', status: 'passed' as const, ranAt: at, headSha: head, exitCode: 0 },
    { command: 'git diff --check', status: 'passed' as const, ranAt: at, headSha: head, exitCode: 0 },
  ];
}

/** The TASK-002 shape: candidate ONLY in prose + commandResults; structured fields absent. */
function legacyCheckpoints(): TaskCheckpoint[] {
  const notes = (kind: string) =>
    `${kind} candidateHeadSha=${CANDIDATE} candidateTreeSha=${CANDIDATE_TREE} baseSha=${BASE} branch=${BRANCH} worktree=${WT_REL}.`;
  return [
    {
      id: 'cp-attest-rfv',
      at: '2026-08-31T02:11:22.000Z',
      actor: 'attest-builder',
      role: 'builder',
      outcome: 'ready_for_verification',
      changedPaths: [DOC],
      diffStat: { files: 1, insertions: 3, deletions: 0 },
      evidence: {
        tests: [],
        commands: ['npm run verify:ma-skills', 'git diff --check'],
        commandResults: results(CANDIDATE, '2026-08-31T02:11:22.000Z'),
        notes: notes('builder'),
      },
      blockers: [],
      mutationsPerformed: ['repo_files', 'git_commit'],
      authorizationConsumed: [],
      nextRequestedAction: 'verify',
    },
    {
      id: 'cp-attest-verified',
      at: '2026-08-31T02:15:30.000Z',
      actor: 'attest-verifier',
      role: 'verifier',
      outcome: 'verified',
      changedPaths: [],
      diffStat: { files: 0, insertions: 0, deletions: 0 },
      evidence: {
        tests: [],
        commands: ['npm run verify:ma-skills', 'git diff --check'],
        commandResults: results(CANDIDATE, '2026-08-31T02:15:19.000Z'),
        notes: notes('verifier independent'),
      },
      blockers: [],
      mutationsPerformed: [],
      authorizationConsumed: [],
      nextRequestedAction: 'integrate',
    },
  ];
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: TASK_ID,
    title: 'Attestation fixture',
    priority: 'normal',
    state: 'integration',
    authorizedScope: 'docs only',
    allowedPaths: [DOC],
    forbiddenPaths: ['src/**'],
    dependencies: [],
    assignedRole: 'integrator',
    branch: BRANCH,
    worktree: WT_REL,
    baseSha: BASE,
    lease: null,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: legacyCheckpoints(),
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
    updatedAt: '2026-08-31T02:20:00.000Z',
    ...over,
  };
}

function seed(t: TaskRecord = task(), revision = 18) {
  const reg: AgentTaskRegistry = {
    version: 2,
    revision,
    updatedAt: '2026-08-31T02:20:00.000Z',
    tasks: { [t.id]: t },
    adminAuditLog: [],
    provenance: testProvenance(),
  };
  writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
}

function read(): AgentTaskRegistry {
  return JSON.parse(readFileSync(regPath, 'utf8'));
}

const ATTEST = [
  'attest-candidate-evidence',
  TASK_ID,
  '--actor',
  'eric-orchestrator',
  '--role',
  'administrator',
  '--reason',
  'Pilot chain predates the structured candidate contract',
  '--confirm',
];

beforeAll(() => {
  // Space in the directory name is deliberate — mirrors "Market Assasin".
  root = mkdtempSync(join(tmpdir(), 'pstack attest e2e-'));
  mainWt = join(root, 'main');
  mkdirSync(mainWt, { recursive: true });

  git(['init', '-b', 'main', '.'], mainWt);
  git(['config', 'user.email', 'pstack@example.test'], mainWt);
  git(['config', 'user.name', 'PStack Fixture'], mainWt);
  mkdirSync(join(mainWt, 'docs/engineering'), { recursive: true });
  writeFileSync(join(mainWt, DOC), '# runbook\n');
  git(['add', '.'], mainWt);
  git(['commit', '-m', 'base'], mainWt);
  BASE = git(['rev-parse', 'HEAD'], mainWt).toLowerCase();
  // origin/main must exist for stale-main resolution; point origin at ourselves.
  git(['remote', 'add', 'origin', mainWt], mainWt);
  git(['update-ref', 'refs/remotes/origin/main', BASE], mainWt);

  // The task worktree: ONE genuine commit ahead of main.
  taskWt = join(mainWt, WT_REL);
  git(['worktree', 'add', '-b', BRANCH, taskWt, BASE], mainWt);
  writeFileSync(join(taskWt, DOC), '# runbook\n\nphase 3a.4 candidate\n');
  git(['add', '.'], taskWt);
  git(['commit', '-m', 'candidate'], taskWt);
  CANDIDATE = git(['rev-parse', 'HEAD'], taskWt).toLowerCase();
  CANDIDATE_TREE = git(['rev-parse', 'HEAD^{tree}'], taskWt).toLowerCase();

  // An UNRELATED linked worktree — approve is invoked from here to prove C.
  otherWt = join(mainWt, '.claude/worktrees/other-linked');
  git(['worktree', 'add', '-b', 'chore/other-linked', otherWt, BASE], mainWt);

  const regDir = mkdtempSync(join(tmpdir(), 'pstack-attest-reg-'));
  regPath = join(regDir, 'registry.json');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(regPath, '..'), { recursive: true, force: true });
});

describe('C — one canonical worktree path from EVERY invocation location', () => {
  it('resolves the SAME absolute candidate path from main, the task worktree, and another linked worktree', () => {
    const fromMain = resolveTaskWorktreePath({ worktreeRel: WT_REL, cwd: mainWt });
    const fromTask = resolveTaskWorktreePath({ worktreeRel: WT_REL, cwd: taskWt });
    const fromOther = resolveTaskWorktreePath({ worktreeRel: WT_REL, cwd: otherWt });

    expect(fromMain.ok && fromTask.ok && fromOther.ok).toBe(true);
    if (!fromMain.ok || !fromTask.ok || !fromOther.ok) return;

    expect(fromTask.value.absPath).toBe(fromMain.value.absPath);
    expect(fromOther.value.absPath).toBe(fromMain.value.absPath);
    // And it is the REAL worktree, not a nested phantom.
    expect(git(['rev-parse', 'HEAD'], fromMain.value.absPath).toLowerCase()).toBe(CANDIDATE);
  });

  it('THE OLD BUG: join(cwd, task.worktree) from a linked worktree nests into a nonexistent path', () => {
    const buggy = join(taskWt, WT_REL);
    expect(buggy).not.toBe(resolveTaskWorktreePath({ worktreeRel: WT_REL, cwd: taskWt }).ok
      ? (resolveTaskWorktreePath({ worktreeRel: WT_REL, cwd: taskWt }) as { value: { absPath: string } }).value.absPath
      : '');
    expect(buggy).toContain(`${WT_REL}/${WT_REL}`);
    expect(() => git(['rev-parse', 'HEAD'], buggy)).toThrow();
  });

  it('the shared root is identical from every worktree', () => {
    const a = resolveSharedRepoRoot(mainWt);
    const b = resolveSharedRepoRoot(taskWt);
    const c = resolveSharedRepoRoot(otherWt);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(b.value).toBe(a.value);
    expect(c.value).toBe(a.value);
  });

  it('rejects path traversal outside the shared repository', () => {
    const r = resolveTaskWorktreePath({ worktreeRel: '../../../etc', cwd: mainWt });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('candidate_integrity');
    expect(r.message).toMatch(/outside the shared repository/);
  });

  it('handles spaces in the repository path (execFile argv, never a shell string)', () => {
    expect(root).toContain(' ');
    const r = resolveTaskWorktreePath({ worktreeRel: WT_REL, cwd: taskWt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.absPath).toContain(' ');
    expect(git(['rev-parse', 'HEAD'], r.value.absPath).toLowerCase()).toBe(CANDIDATE);
  });
});

describe('PHASE 3A.4 — full attestation lifecycle against real Git', () => {
  it('1. a NEW checkpoint without structured evidence FAILS at submission', () => {
    // Same task, but parked in verification with a live verifier lease, so a fresh
    // `verified` submission is the operation under test.
    const t = task({
      state: 'verification',
      assignedRole: 'verifier',
      checkpoints: [legacyCheckpoints()[0]],
      lease: {
        owner: 'attest-verifier',
        role: 'verifier',
        acquiredAt: '2026-08-31T02:12:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        lastHeartbeatAt: '2026-08-31T02:12:00.000Z',
      },
    });
    seed(t);
    const before = readFileSync(regPath, 'utf8');

    const cpFile = join(root, 'cp-new.json');
    writeFileSync(
      cpFile,
      JSON.stringify({
        ...legacyCheckpoints()[1],
        id: 'cp-attest-new-verified',
        at: new Date().toISOString(),
      }),
    );
    const r = run(['checkpoint', TASK_ID, '--owner', 'attest-verifier', '--file', cpFile], taskWt);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/verification_incomplete/);
    expect(r.stderr).toMatch(/prose|candidateHeadSha/i);
    // Nothing written.
    expect(readFileSync(regPath, 'utf8')).toBe(before);
  });

  it('2. administrator attestation SUCCEEDS once, and 3. checkpoints stay byte-identical', () => {
    seed();
    const before = read();
    const cpBefore = JSON.stringify(before.tasks[TASK_ID].checkpoints);

    const r = run(ATTEST, taskWt);
    expect(r.status, r.stderr).toBe(0);

    const after = read();
    const t = after.tasks[TASK_ID];

    // Derived identity — NOT supplied by the caller.
    expect(t.candidateEvidenceAttestation).toBeTruthy();
    expect(t.candidateEvidenceAttestation!.candidateHeadSha).toBe(CANDIDATE);
    expect(t.candidateEvidenceAttestation!.candidateTreeSha).toBe(CANDIDATE_TREE);
    expect(t.candidateEvidenceAttestation!.baseSha).toBe(BASE);
    expect(t.candidateEvidenceAttestation!.builderCheckpointId).toBe('cp-attest-rfv');
    expect(t.candidateEvidenceAttestation!.verifierCheckpointId).toBe('cp-attest-verified');
    expect(t.candidateEvidenceAttestation!.administrator).toBe('eric-orchestrator');
    expect(t.candidateEvidenceAttestation!.registryRevision).toBe(19);

    // CHECKPOINTS BYTE-IDENTICAL — the defining property of an attestation.
    expect(JSON.stringify(t.checkpoints)).toBe(cpBefore);

    // State / lease / assignedRole untouched; revision advanced EXACTLY once.
    expect(t.state).toBe('integration');
    expect(t.lease).toBeNull();
    expect(t.assignedRole).toBe('integrator');
    expect(after.revision).toBe(19);

    // Exactly one new audit entry, of the right action.
    expect(t.auditLog).toHaveLength(1);
    expect(t.auditLog[0].action).toBe('candidate-evidence-attested');
    expect(t.auditLog[0].fromState).toBe('integration');
    expect(t.auditLog[0].toState).toBe('integration');
    expect(t.auditLog[0].metadata.candidateHeadSha).toBe(CANDIDATE);
  });

  it('8. a REPEATED attestation fails', () => {
    seed();
    expect(run(ATTEST, taskWt).status).toBe(0);
    const afterFirst = readFileSync(regPath, 'utf8');

    const second = run(ATTEST, taskWt);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/attestation_conflict/);
    expect(readFileSync(regPath, 'utf8')).toBe(afterFirst);
  });

  it('4+6. integration-handoff succeeds FROM THE TASK WORKTREE using the attestation', () => {
    seed();
    expect(run(ATTEST, taskWt).status).toBe(0);
    expect(
      run(['claim', TASK_ID, '--owner', 'attest-integrator', '--role', 'integrator'], taskWt).status,
    ).toBe(0);

    const h = run(
      ['integration-handoff', TASK_ID, '--owner', 'attest-integrator', '--role', 'integrator'],
      taskWt,
    );
    expect(h.status, h.stderr).toBe(0);
    const out = JSON.parse(h.stdout);
    expect(out.candidateHeadSha).toBe(CANDIDATE);
    expect(out.candidateTreeSha).toBe(CANDIDATE_TREE);
    expect(out.worktreeArtifact.headSha).toBe(CANDIDATE);
    expect(out.worktreeArtifact.clean).toBe(true);
  });

  it('5+6. approve succeeds FROM A DIFFERENT LINKED WORKTREE and resolves the SAME candidate', () => {
    seed();
    expect(run(ATTEST, taskWt).status).toBe(0);
    expect(run(['claim', TASK_ID, '--owner', 'attest-integrator', '--role', 'integrator'], taskWt).status).toBe(0);

    // Handoff from the task worktree...
    const h = run(['integration-handoff', TASK_ID, '--owner', 'attest-integrator', '--role', 'integrator'], taskWt);
    expect(h.status, h.stderr).toBe(0);
    const handoffHead = JSON.parse(h.stdout).candidateHeadSha;

    // ...approve from an UNRELATED linked worktree. Under the old cwd-joined resolution
    // this produced a nested nonexistent path and could not resolve the artifact at all.
    const a = run(
      ['approve', TASK_ID, '--actor', 'eric-orchestrator', '--role', 'administrator', '--evidence', 'phase-3a4-e2e'],
      otherWt,
    );
    expect(a.status, a.stderr).toBe(0);
    const approved = JSON.parse(a.stdout);
    expect(approved.task.state).toBe('awaiting_approval');
    // BOTH invocation locations agreed on the SAME candidate.
    expect(handoffHead).toBe(CANDIDATE);
  });

  it('7. there is NO --no-git path and NO SHA override on attestation', () => {
    seed();
    for (const extra of [
      ['--no-git'],
      ['--candidate-head', CANDIDATE],
      ['--candidate-tree', CANDIDATE_TREE],
    ]) {
      const before = readFileSync(regPath, 'utf8');
      const r = run([...ATTEST, ...extra], taskWt);
      expect(r.status, `expected rejection for ${extra[0]}`).not.toBe(0);
      expect(r.stderr).toMatch(/no --no-git and no candidate SHA overrides/);
      expect(readFileSync(regPath, 'utf8')).toBe(before);
    }
  });

  it('9a. a DIRTY worktree fails attestation', () => {
    seed();
    const dirty = join(taskWt, 'docs/engineering/scratch.md');
    writeFileSync(dirty, 'uncommitted\n');
    try {
      const r = run(ATTEST, taskWt);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/not clean/);
      expect(read().tasks[TASK_ID].candidateEvidenceAttestation ?? null).toBeNull();
    } finally {
      rmSync(dirty, { force: true });
    }
  });

  it('9b. a DIVERGENT candidate (commandResults head != live HEAD) fails', () => {
    // Checkpoints claim a head the worktree does not have.
    const bogus = 'a'.repeat(40);
    const cps = legacyCheckpoints().map((c) => ({
      ...c,
      evidence: {
        ...c.evidence,
        commandResults: c.evidence.commandResults!.map((r) => ({ ...r, headSha: bogus })),
      },
    }));
    seed(task({ checkpoints: cps as TaskCheckpoint[] }));

    const r = run(ATTEST, taskWt);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/candidate_integrity|!== command consensus/);
    expect(read().tasks[TASK_ID].candidateEvidenceAttestation ?? null).toBeNull();
  });

  it('9c. NON-UNANIMOUS commandResults fail (no consensus to derive from)', () => {
    const cps = legacyCheckpoints();
    cps[1] = {
      ...cps[1],
      evidence: {
        ...cps[1].evidence,
        commandResults: results(BASE, '2026-08-31T02:15:19.000Z'),
      },
    };
    seed(task({ checkpoints: cps }));
    const r = run(ATTEST, taskWt);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/disagree on candidate head/);
  });

  it('9d. a STALE base (main moved on) fails attestation', () => {
    // Advance origin/main past the task base.
    writeFileSync(join(mainWt, 'docs/engineering/newer.md'), 'newer\n');
    git(['add', '.'], mainWt);
    git(['commit', '-m', 'main moves on'], mainWt);
    const newMain = git(['rev-parse', 'HEAD'], mainWt).toLowerCase();
    git(['update-ref', 'refs/remotes/origin/main', newMain], mainWt);
    try {
      seed();
      const r = run(ATTEST, taskWt);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/stale_main/);
      expect(read().tasks[TASK_ID].candidateEvidenceAttestation ?? null).toBeNull();
    } finally {
      git(['update-ref', 'refs/remotes/origin/main', BASE], mainWt);
      git(['reset', '--hard', BASE], mainWt);
    }
  });

  it('9e. SELF-VERIFIED chains cannot be laundered through attestation', () => {
    const cps = legacyCheckpoints().map((c) => ({ ...c, actor: 'same-agent' }));
    seed(task({ checkpoints: cps }));
    const r = run(ATTEST, taskWt);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/self_verification_forbidden/);
  });

  it('9f. an ACTIVE LEASE blocks attestation, and a non-integration state does too', () => {
    seed(
      task({
        lease: {
          owner: 'someone-working',
          role: 'integrator',
          acquiredAt: '2026-08-31T02:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          lastHeartbeatAt: '2026-08-31T02:00:00.000Z',
        },
      }),
    );
    expect(run(ATTEST, taskWt).stderr).toMatch(/lease_conflict/);

    seed(task({ state: 'verification', lease: null, assignedRole: 'verifier' }));
    expect(run(ATTEST, taskWt).stderr).toMatch(/invalid_transition/);
  });

  it('9g. structured evidence already present => nothing to attest', () => {
    const cps = legacyCheckpoints().map((c) => ({
      ...c,
      evidence: { ...c.evidence, candidateHeadSha: CANDIDATE, candidateTreeSha: CANDIDATE_TREE },
    }));
    seed(task({ checkpoints: cps }));
    const r = run(ATTEST, taskWt);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/attestation_conflict|nothing to attest/);
  });

  it('9h. administrator role, --confirm and a non-empty --reason are all REQUIRED', () => {
    seed();
    const base = ['attest-candidate-evidence', TASK_ID, '--actor', 'eric-orchestrator'];
    // no --role administrator
    expect(run([...base, '--reason', 'x'.repeat(20), '--confirm'], taskWt).status).not.toBe(0);
    // no --confirm
    expect(
      run([...base, '--role', 'administrator', '--reason', 'x'.repeat(20)], taskWt).stderr,
    ).toMatch(/--confirm/);
    // no --reason
    expect(run([...base, '--role', 'administrator', '--confirm'], taskWt).status).not.toBe(0);
    expect(read().tasks[TASK_ID].candidateEvidenceAttestation ?? null).toBeNull();
  });

  it('10. registry writes stay ATOMIC — a failed attestation leaves no tmp debris', () => {
    seed();
    const before = readFileSync(regPath, 'utf8');
    // Force a failure late in the flow (divergent head) and confirm no partial write.
    const cps = legacyCheckpoints().map((c) => ({
      ...c,
      evidence: { ...c.evidence, commandResults: results('b'.repeat(40), '2026-08-31T02:11:22.000Z') },
    }));
    seed(task({ checkpoints: cps as TaskCheckpoint[] }));
    const seeded = readFileSync(regPath, 'utf8');
    const r = run(ATTEST, taskWt);
    expect(r.status).not.toBe(0);
    expect(readFileSync(regPath, 'utf8')).toBe(seeded);

    // And a SUCCESSFUL write leaves exactly one registry file, no .tmp siblings.
    seed();
    expect(run(ATTEST, taskWt).status).toBe(0);
    const dirEntries = execFileSync('ls', [join(regPath, '..')], { encoding: 'utf8' });
    expect(dirEntries).toContain('registry.json');
    expect(dirEntries).not.toMatch(/\.tmp\./);
    expect(before.length).toBeGreaterThan(0);
  });
});

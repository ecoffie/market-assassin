import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { spawnTsxSync } from './test-cli-spawn';
import { lockDirForRegistry } from './lock';
import { initRegistryFile, readRegistryFile } from './registry';
import { createLease } from './lease';
import { DEFAULT_LEASE_MS } from './types';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/agent-task.mts');
const FIXTURE = join(ROOT, 'scripts/fixtures/agent-tasks/example-task.json');
const BASE_SHA = '13c30b762da10e19e3897079f5e1059dee1fb475';
const CANDIDATE_TREE = '1111111111111111111111111111111111111111';

function noGitFlags(candidateHead = BASE_SHA) {
  return [
    '--no-git',
    '--current-main',
    BASE_SHA,
    '--main-ahead',
    '0',
    '--candidate-head',
    candidateHead,
    '--candidate-tree',
    CANDIDATE_TREE,
  ];
}

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

function run(args: string[], regPath: string) {
  const cmd = args[0];
  const base = [...args, '--registry', regPath, '--no-git'];
  if (cmd === 'claim' && !args.includes('--current-main')) {
    base.push('--current-main', BASE_SHA, '--main-ahead', '0');
  }
  if ((cmd === 'integration-handoff' || cmd === 'approve') && !args.includes('--current-main')) {
    base.push(...noGitFlags());
  }
  return spawnTsxSync(SCRIPT, base, {
    cwd: ROOT,
    env: { ...process.env, AGENT_TASK_SKIP_GIT: '1' },
    encoding: 'utf8',
  });
}

function expectOk(r: ReturnType<typeof run>, label: string) {
  if (r.status !== 0) {
    throw new Error(`${label} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
}

describe('agent-task CLI e2e (disposable registry)', { timeout: 120_000 }, () => {
  let dir: string;
  let regPath: string;
  let cpDir: string;
  const taskId = 'TASK-E2E-001';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-cli-e2e-'));
    regPath = join(dir, 'registry.json');
    cpDir = join(dir, 'cps');
    mkdirSync(cpDir, { recursive: true });
    initRegistryFile(regPath);

    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    fixture.id = taskId;
    fixture.state = 'proposed';
    fixture.verificationProfile = ['ma-skills'];
    fixture.baseSha = BASE_SHA;
    const seedPath = join(dir, 'seed.json');
    writeFileSync(seedPath, JSON.stringify(fixture, null, 2));
    expectOk(
      run(['seed-task', '--file', seedPath, '--actor', 'admin', '--role', 'administrator'], regPath),
      'seed-task',
    );
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  function writeCp(name: string, body: Record<string, unknown>) {
    const p = join(cpDir, name);
    writeFileSync(p, JSON.stringify(body, null, 2));
    return p;
  }

  it('runs full operator lifecycle via real CLI', () => {
    expectOk(
      run(
        ['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'prd:phase3a'],
        regPath,
      ),
      'promote',
    );

    expectOk(run(['claim', taskId, '--owner', 'builder-a', '--role', 'builder'], regPath), 'claim builder');
    expectOk(run(['heartbeat', taskId, '--owner', 'builder-a'], regPath), 'heartbeat');

    const progressCp = writeCp('progress.json', {
      id: 'cp-progress',
      at: new Date().toISOString(),
      actor: 'builder-a',
      role: 'builder',
      outcome: 'progress',
      changedPaths: ['src/lib/agent-tasks/types.ts'],
      diffStat: { files: 1, insertions: 1, deletions: 0 },
      evidence: { tests: [], commands: [], notes: '' },
      blockers: [],
      mutationsPerformed: ['repo_files'],
      authorizationConsumed: ['repo_files'],
      nextRequestedAction: 'continue',
    });
    expectOk(run(['checkpoint', taskId, '--owner', 'builder-a', '--file', progressCp], regPath), 'checkpoint progress');

    const handoffCp = writeCp('verify-ready.json', {
      id: 'cp-rfv',
      at: new Date().toISOString(),
      actor: 'builder-a',
      role: 'builder',
      outcome: 'ready_for_verification',
      changedPaths: ['src/lib/agent-tasks/types.ts'],
      diffStat: { files: 1, insertions: 1, deletions: 0 },
      evidence: {
        tests: ['vitest'],
        commands: [],
        commandResults: maSkillsEvidence(),
        candidateHeadSha: BASE_SHA,
        // Structured contract requires BOTH — a half-filled pair is refused by design.
        candidateTreeSha: CANDIDATE_TREE,
        notes: '',
      },
      blockers: [],
      mutationsPerformed: ['repo_files'],
      authorizationConsumed: ['repo_files'],
      nextRequestedAction: 'verifier review',
    });
    expectOk(run(['checkpoint', taskId, '--owner', 'builder-a', '--file', handoffCp], regPath), 'checkpoint rfv');

    expectOk(run(['claim', taskId, '--owner', 'verifier-a', '--role', 'verifier'], regPath), 'claim verifier');

    const verifiedCp = writeCp('verified.json', {
      id: 'cp-verified',
      at: new Date().toISOString(),
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
        // Structured contract requires BOTH — a half-filled pair is refused by design.
        candidateTreeSha: CANDIDATE_TREE,
        notes: '',
      },
      blockers: [],
      mutationsPerformed: [],
      authorizationConsumed: [],
      nextRequestedAction: 'integrator',
    });
    expectOk(run(['checkpoint', taskId, '--owner', 'verifier-a', '--file', verifiedCp], regPath), 'checkpoint verified');

    expectOk(run(['claim', taskId, '--owner', 'integrator-a', '--role', 'integrator', '--branch', 'fix/e2e-test', '--worktree', '.claude/worktrees/e2e-test'], regPath), 'claim integrator');
    expectOk(
      run(['integration-handoff', taskId, '--owner', 'integrator-a', '--role', 'integrator', ...noGitFlags()], regPath),
      'handoff',
    );

    expectOk(
      run(['approve', taskId, '--actor', 'eric', '--role', 'administrator', '--evidence', 'review:ok', ...noGitFlags()], regPath),
      'approve',
    );
    expectOk(
      run([
        'record-merged',
        taskId,
        '--actor',
        'eric',
        '--role',
        'administrator',
        '--pr',
        'https://github.com/org/repo/pull/1',
        '--sha',
        BASE_SHA,
        '--evidence',
        'gh:merge',
      ], regPath),
      'record-merged',
    );
    expectOk(
      run([
        'record-deployed',
        taskId,
        '--actor',
        'eric',
        '--role',
        'administrator',
        '--deployment',
        'https://getmindy.ai',
        '--sha',
        BASE_SHA,
        '--evidence',
        'vercel:prod',
      ], regPath),
      'record-deployed',
    );

    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.tasks[taskId].state).toBe('deployed');
      expect(read.value.revision).toBeGreaterThan(0);
      expect(read.value.tasks[taskId].auditLog.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('rejects stale main on claim when git metadata diverges', () => {
    expectOk(
      run(['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    read.value.tasks[taskId].baseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    writeFileSync(regPath, JSON.stringify(read.value, null, 2));

    const r = run(
      [
        'claim',
        taskId,
        '--owner',
        'b',
        '--role',
        'builder',
        '--origin-main',
        BASE_SHA,
        '--main-ahead',
        '5',
      ],
      regPath,
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr || r.stdout).toMatch(/stale_main/);
  });

  it('rejects path collision on claim', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    fixture.id = 'TASK-E2E-002';
    fixture.state = 'in_progress';
    fixture.verificationProfile = ['ma-skills'];
    fixture.allowedPaths = ['src/lib/agent-tasks/**'];
    fixture.lease = createLease('other', 'builder', Date.now());
    const p2 = join(dir, 'task2.json');
    writeFileSync(p2, JSON.stringify(fixture, null, 2));
    expectOk(run(['seed-task', '--file', p2, '--actor', 'admin', '--role', 'administrator'], regPath), 'seed 2');

    expectOk(
      run(['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    const r = run(['claim', taskId, '--owner', 'b', '--role', 'builder'], regPath);
    expect(r.status).not.toBe(0);
    expect(r.stderr || r.stdout).toMatch(/path_collision/);
  });

  it('rejects malformed checkpoint file', () => {
    expectOk(
      run(['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    expectOk(run(['claim', taskId, '--owner', 'b', '--role', 'builder'], regPath), 'claim');
    const bad = join(cpDir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ id: 'only-id' }));
    const r = run(['checkpoint', taskId, '--owner', 'b', '--file', bad], regPath);
    expect(r.status).not.toBe(0);
    expect(r.stderr || r.stdout).toMatch(/malformed_checkpoint/);
  });

  it('recovers expired lease on subsequent claim', () => {
    expectOk(
      run(['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    const read0 = readRegistryFile(regPath);
    expect(read0.ok).toBe(true);
    if (!read0.ok) return;
    const task = read0.value.tasks[taskId];
    const expired = createLease('old-builder', 'builder', Date.now() - DEFAULT_LEASE_MS - 1000);
    task.lease = expired;
    task.state = 'in_progress';
    writeFileSync(regPath, JSON.stringify({ ...read0.value, tasks: { ...read0.value.tasks, [taskId]: task } }, null, 2));

    expectOk(run(['claim', taskId, '--owner', 'new-builder', '--role', 'builder'], regPath), 'claim after expiry');
    const read1 = readRegistryFile(regPath);
    expect(read1.ok).toBe(true);
    if (read1.ok) expect(read1.value.tasks[taskId].lease?.owner).toBe('new-builder');
  });

  it('block command sets blocked state', () => {
    expectOk(
      run(['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    expectOk(run(['claim', taskId, '--owner', 'b', '--role', 'builder'], regPath), 'claim');
    expectOk(run(['block', taskId, '--owner', 'b', '--reason', 'waiting on dependency'], regPath), 'block');
    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.tasks[taskId].state).toBe('blocked');
  });

  it('release returns task to ready', () => {
    expectOk(
      run(['promote', taskId, '--state', 'ready', '--actor', 'eric', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    expectOk(run(['claim', taskId, '--owner', 'b', '--role', 'builder'], regPath), 'claim');
    expectOk(run(['release', taskId, '--owner', 'b'], regPath), 'release');
    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.tasks[taskId].state).toBe('ready');
  });
});

describe('verification profile enforcement via CLI', { timeout: 120_000 }, () => {
  let dir: string;
  let regPath: string;
  let cpDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-cli-verify-'));
    regPath = join(dir, 'registry.json');
    cpDir = join(dir, 'cps');
    mkdirSync(cpDir, { recursive: true });
    initRegistryFile(regPath);
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    fixture.id = 'TASK-VERIFY-001';
    fixture.state = 'proposed';
    fixture.verificationProfile = ['ma-skills'];
    fixture.baseSha = BASE_SHA;
    const p = join(dir, 'seed.json');
    writeFileSync(p, JSON.stringify(fixture, null, 2));
    expectOk(run(['seed-task', '--file', p, '--actor', 'admin', '--role', 'administrator'], regPath), 'seed');
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('integration-handoff rejects missing command evidence', () => {
    expectOk(
      run(['promote', 'TASK-VERIFY-001', '--state', 'ready', '--actor', 'a', '--role', 'administrator', '--evidence', 'x'], regPath),
      'promote',
    );
    expectOk(run(['claim', 'TASK-VERIFY-001', '--owner', 'builder', '--role', 'builder'], regPath), 'claim b');
    const progress = join(cpDir, 'progress.json');
    writeFileSync(
      progress,
      JSON.stringify({
        id: 'cp-progress',
        at: new Date().toISOString(),
        actor: 'builder',
        role: 'builder',
        outcome: 'progress',
        changedPaths: [],
        diffStat: { files: 0, insertions: 0, deletions: 0 },
        evidence: { tests: [], commands: [], notes: '' },
        blockers: [],
        mutationsPerformed: [],
        authorizationConsumed: [],
        nextRequestedAction: 'continue',
      }),
    );
    expectOk(run(['checkpoint', 'TASK-VERIFY-001', '--owner', 'builder', '--file', progress], regPath), 'progress');
    const rfv = join(cpDir, 'rfv.json');
    writeFileSync(
      rfv,
      JSON.stringify({
        id: 'cp-rfv',
        at: new Date().toISOString(),
        actor: 'builder',
        role: 'builder',
        outcome: 'ready_for_verification',
        changedPaths: [],
        diffStat: { files: 0, insertions: 0, deletions: 0 },
        evidence: {
          tests: [],
          commands: [],
          commandResults: maSkillsEvidence(),
          candidateHeadSha: BASE_SHA,
        // Structured contract requires BOTH — a half-filled pair is refused by design.
        candidateTreeSha: CANDIDATE_TREE,
          notes: '',
        },
        blockers: [],
        mutationsPerformed: [],
        authorizationConsumed: [],
        nextRequestedAction: 'verify',
      }),
    );
    expectOk(run(['checkpoint', 'TASK-VERIFY-001', '--owner', 'builder', '--file', rfv], regPath), 'rfv');
    expectOk(run(['claim', 'TASK-VERIFY-001', '--owner', 'verifier', '--role', 'verifier'], regPath), 'claim v');
    const verified = join(cpDir, 'v.json');
    writeFileSync(
      verified,
      JSON.stringify({
        id: 'cp-v',
        at: new Date().toISOString(),
        actor: 'verifier',
        role: 'verifier',
        outcome: 'verified',
        changedPaths: [],
        diffStat: { files: 0, insertions: 0, deletions: 0 },
        evidence: {
          tests: [],
          commands: [],
          commandResults: [],
          notes: 'no results',
        },
        blockers: [],
        mutationsPerformed: [],
        authorizationConsumed: [],
        nextRequestedAction: 'integrate',
      }),
    );
    expectOk(run(['checkpoint', 'TASK-VERIFY-001', '--owner', 'verifier', '--file', verified], regPath), 'verified');
    expectOk(run(['claim', 'TASK-VERIFY-001', '--owner', 'integrator', '--role', 'integrator', '--branch', 'fix/verify', '--worktree', '.claude/worktrees/verify'], regPath), 'claim i');
    const handoff = run(['integration-handoff', 'TASK-VERIFY-001', '--owner', 'integrator', '--role', 'integrator', ...noGitFlags()], regPath);
    expect(handoff.status).not.toBe(0);
    expect(handoff.stderr || handoff.stdout).toMatch(/verification_incomplete/);
  });
});

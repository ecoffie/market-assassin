#!/usr/bin/env tsx
/**
 * PStack Phase 3A — agent task registry CLI.
 * No auto merge, deploy, or production mutation.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveRuntimeRegistryPath,
  SEED_REGISTRY_REL,
} from '../src/lib/agent-tasks/registry';
import { diagnoseRegistry } from '../src/lib/agent-tasks/doctor';
import { readLockMeta } from '../src/lib/agent-tasks/lock';
import {
  readRegistryFile,
  listTasks,
  claimTask,
  heartbeatTask,
  releaseTask,
  reconcileTaskState,
  supersedeTask,
  blockTask,
  appendCheckpoint,
  detectAllPathCollisions,
  verifyTaskDependencies,
  prepareIntegrationHandoff,
  parseMainAheadCount,
  promoteTask,
  approveTask,
  recordMergedTask,
  recordDeployedTask,
  upsertTask,
  recoverRegistryLock,
} from '../src/lib/agent-tasks/operations';
import { parseTaskRecord } from '../src/lib/agent-tasks/validate';
import {
  explicitNoGitMeta,
  resolveCurrentMainSha,
  resolveGitMainMeta,
  resolveWorktreeArtifact,
} from '../src/lib/agent-tasks/git-evidence';

const ROOT = process.cwd();

function registryOverridePath(): string | undefined {
  const flagIdx = process.argv.indexOf('--registry');
  if (flagIdx >= 0 && process.argv[flagIdx + 1]) {
    const p = process.argv[flagIdx + 1];
    return p.startsWith('/') ? p : join(ROOT, p);
  }
  return undefined;
}

function registryPath(): string {
  const resolved = resolveRuntimeRegistryPath(ROOT, registryOverridePath());
  if (!resolved.ok) fail(`${resolved.code}: ${resolved.message}`);
  return resolved.value;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function gitMetaForTask(
  baseSha: string,
  opts?: { requireCandidate?: boolean },
): {
  currentMainSha: string;
  mainAheadCount: number | null;
  candidateHeadSha?: string;
  candidateTreeSha?: string;
} {
  if (hasFlag('--no-git') || process.env.AGENT_TASK_SKIP_GIT === '1') {
    const explicit = explicitNoGitMeta({
      baseSha,
      currentMainSha: arg('--current-main'),
      mainAheadCount: arg('--main-ahead'),
      candidateHeadSha: arg('--candidate-head'),
      candidateTreeSha: arg('--candidate-tree'),
      requireCandidate: opts?.requireCandidate,
    });
    if (!explicit.ok) fail(`${explicit.code}: ${explicit.message}`);
    if (opts?.requireCandidate && !arg('--candidate-head')) {
      fail('verification_incomplete: integration/approve with --no-git requires --candidate-head');
    }
    return {
      currentMainSha: explicit.value.currentMainSha,
      mainAheadCount: explicit.value.mainAheadCount,
      candidateHeadSha: explicit.value.candidateHeadSha,
      candidateTreeSha: explicit.value.candidateTreeSha,
    };
  }
  const main = resolveGitMainMeta(ROOT, baseSha);
  if (!main.ok) fail(`${main.code}: ${main.message}`);
  return {
    currentMainSha: main.value.currentMainSha,
    mainAheadCount: main.value.mainAheadCount,
  };
}

function worktreeArtifactForTask(task: {
  baseSha: string;
  branch: string | null;
  worktree: string | null;
}): ReturnType<typeof resolveWorktreeArtifact> | { ok: true; value: import('../src/lib/agent-tasks/git-evidence').WorktreeArtifact } {
  if (hasFlag('--no-git') || process.env.AGENT_TASK_SKIP_GIT === '1') {
    const head = arg('--candidate-head');
    const tree = arg('--candidate-tree');
    const branch = task.branch ?? arg('--branch') ?? 'unknown';
    if (!head || !tree) {
      fail('candidate_integrity: --no-git integration/approve requires --candidate-head and --candidate-tree');
    }
    return {
      ok: true,
      value: {
        headSha: head.toLowerCase(),
        treeSha: tree.toLowerCase(),
        branch,
        clean: true,
        isDescendantOfBase: true,
      },
    };
  }
  if (!task.worktree?.trim() || !task.branch?.trim()) {
    fail('candidate_integrity: task missing worktree or branch for git artifact resolution');
  }
  return resolveWorktreeArtifact({
    repoRoot: ROOT,
    worktreeRel: task.worktree,
    expectedBranch: task.branch,
    baseSha: task.baseSha,
  });
}

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

function printJson(v: unknown) {
  console.log(JSON.stringify(v, null, 2));
}

function actorContext(): { actor: string; role?: 'administrator' } {
  const actor = arg('--actor') ?? arg('--owner');
  if (!actor) fail('missing --actor or --owner');
  const role = arg('--role');
  return role === 'administrator' ? { actor, role: 'administrator' } : { actor };
}

const cmd = process.argv[2];
if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`agent-task — PStack Phase 3A registry CLI
Default runtime: {git-common-dir}/agent-tasks/registry.json
Tracked seed: ${SEED_REGISTRY_REL} (bootstrap only — runtime never writes here)
Override: --registry PATH or AGENT_TASK_REGISTRY_PATH

Commands:
  doctor [--registry PATH]
  list [--ready] [--registry PATH]
  promote TASK-ID --state ready --actor NAME --role administrator --evidence REF
  claim TASK-ID --owner NAME --role builder|verifier|integrator [--no-git --current-main SHA --main-ahead N]
  heartbeat TASK-ID --owner NAME [--role ROLE]
  checkpoint TASK-ID --owner NAME --file cp.json
  release TASK-ID --owner NAME   (phase-aware: builder->ready, verifier->verification, integrator->integration)
  reconcile-state TASK-ID --actor NAME --role administrator --reason TEXT --confirm [--legacy-evidence-recovery]
  supersede TASK-OLD --new-task TASK-NEW --branch BRANCH --worktree WORKTREE --actor NAME --role administrator --reason TEXT --confirm
  block TASK-ID --owner NAME --reason TEXT
  approve TASK-ID --actor NAME --role administrator --evidence REF [--no-git --current-main SHA --main-ahead N --candidate-head SHA --candidate-tree SHA]
  record-merged TASK-ID --actor NAME --role administrator --pr URL --sha SHA --evidence REF
  record-deployed TASK-ID --actor NAME --role administrator --deployment URL --sha SHA --evidence REF
  collisions [--registry PATH]
  deps TASK-ID
  integration-handoff TASK-ID --owner NAME --role integrator [--no-git --current-main SHA --main-ahead N --candidate-head SHA --candidate-tree SHA]
  recover-lock --actor NAME --role administrator --confirm
  seed-task --file PATH --actor NAME (admin upsert from JSON fixture)`);
  process.exit(0);
}

if (cmd === 'doctor') {
  printJson(diagnoseRegistry(ROOT, registryOverridePath()));
} else {
  const REG = registryPath();
  switch (cmd) {
  case 'list': {
    const read = readRegistryFile(REG);
    if (!read.ok) fail(`${read.code}: ${read.message}`);
    const tasks = listTasks(read.value, { ready: hasFlag('--ready'), state: arg('--state') as never });
    printJson({ revision: read.value.revision, count: tasks.length, tasks });
    break;
  }

  case 'promote': {
    const taskId = process.argv[3];
    const ctx = actorContext();
    const evidence = arg('--evidence') ?? fail('promote requires --evidence');
    const state = arg('--state') ?? 'ready';
    if (state !== 'ready') fail('only --state ready supported');
    if (!taskId) fail('usage: promote TASK-ID --state ready --actor NAME --role administrator --evidence REF');
    const r = promoteTask(REG, {
      taskId,
      actor: ctx.actor,
      role: 'administrator',
      toState: 'ready',
      evidenceRef: evidence,
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, task: r.value });
    break;
  }

  case 'claim': {
    const taskId = process.argv[3];
    const owner = arg('--owner') ?? arg('--actor');
    const roleRaw = arg('--role');
    if (!taskId || !owner || !roleRaw || !['builder', 'verifier', 'integrator'].includes(roleRaw)) {
      fail('usage: claim TASK-ID --owner NAME --role builder|verifier|integrator');
    }
    const role = roleRaw as 'builder' | 'verifier' | 'integrator';
    const read = readRegistryFile(REG);
    const baseSha = read.ok ? read.value.tasks[taskId]?.baseSha : undefined;
    const originOverride = arg('--origin-main');
    const aheadOverride = arg('--main-ahead');
    const git =
      originOverride !== undefined
        ? {
            currentMainSha: originOverride,
            mainAheadCount: aheadOverride !== undefined ? parseMainAheadCount(aheadOverride) : null,
          }
        : baseSha
          ? gitMetaForTask(baseSha)
          : { currentMainSha: undefined, mainAheadCount: null };
    const r = claimTask(REG, {
      taskId,
      actor: owner,
      role,
      branch: arg('--branch'),
      worktree: arg('--worktree'),
      originMainSha: git.currentMainSha,
      mainAheadCount: git.mainAheadCount,
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, task: r.value });
    break;
  }

  case 'heartbeat': {
    const taskId = process.argv[3];
    const owner = arg('--owner') ?? arg('--actor');
    if (!taskId || !owner) fail('usage: heartbeat TASK-ID --owner NAME');
    const r = heartbeatTask(REG, {
      taskId,
      actor: owner,
      role: arg('--role') as never,
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, lease: r.value.lease });
    break;
  }

  case 'release': {
    const taskId = process.argv[3];
    const owner = arg('--owner') ?? arg('--actor');
    if (!taskId || !owner) fail('usage: release TASK-ID --owner NAME');
    const r = releaseTask(REG, { taskId, actor: owner });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, state: r.value.state });
    break;
  }

  case 'reconcile-state': {
    // Administrator phase repair. The target state is DERIVED from the validated
    // checkpoint chain — deliberately no --state flag, because an operator who can name
    // a state can launder a task into integration without evidence.
    const taskId = process.argv[3];
    const ctx = actorContext();
    const reason = arg('--reason');
    const confirm = process.argv.includes('--confirm');
    if (!taskId || !reason) {
      fail(
        'usage: reconcile-state TASK-ID --actor NAME --role administrator --reason TEXT --confirm [--legacy-evidence-recovery]',
      );
    }
    // --legacy-evidence-recovery is an ADMINISTRATOR act. It cannot be set by any
    // checkpoint payload, which is the whole point: checkpoint `at` is caller-controlled,
    // so a timestamp could never have gated this safely.
    const legacyEvidenceRecovery = process.argv.includes('--legacy-evidence-recovery');
    const r = reconcileTaskState(REG, {
      ...ctx,
      taskId,
      reason,
      confirm,
      legacyEvidenceRecovery,
      repoRoot: ROOT,
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({
      revision: r.revision,
      state: r.value.state,
      derivedFrom:
        r.value.auditLog[r.value.auditLog.length - 1]?.metadata?.derivedFrom ?? null,
    });
    break;
  }

  case 'supersede': {
    // baseSha is IMMUTABLE — supersede closes a stale task and opens its current-main
    // successor atomically. There is deliberately no --base flag: the successor's base
    // is resolved from REAL origin/main, never supplied by the caller.
    const taskId = process.argv[3];
    const ctx = actorContext();
    const newTaskId = arg('--new-task');
    const branch = arg('--branch');
    const worktree = arg('--worktree');
    const reason = arg('--reason');
    const confirm = process.argv.includes('--confirm');
    if (!taskId || !newTaskId || !branch || !worktree || !reason) {
      fail(
        'usage: supersede TASK-OLD --new-task TASK-NEW --branch BRANCH --worktree WORKTREE --actor NAME --role administrator --reason TEXT --confirm',
      );
    }
    // No --no-git path and no --current-main override: fabricated main metadata is the
    // one input that could silently anchor a successor at a base that is not real.
    const main = resolveCurrentMainSha(ROOT);
    if (!main.ok) fail(`${main.code}: ${main.message}`);
    const r = supersedeTask(REG, {
      ...ctx,
      taskId,
      newTaskId,
      branch,
      worktree,
      reason,
      confirm,
      currentMainSha: main.value,
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({
      revision: r.revision,
      source: { id: r.value.source.id, state: r.value.source.state, baseSha: r.value.source.baseSha, supersededByTaskId: r.value.source.supersededByTaskId },
      successor: { id: r.value.successor.id, state: r.value.successor.state, baseSha: r.value.successor.baseSha, supersedesTaskId: r.value.successor.supersedesTaskId, checkpoints: r.value.successor.checkpoints.length },
    });
    break;
  }

  case 'block': {
    const taskId = process.argv[3];
    const owner = arg('--owner') ?? arg('--actor') ?? 'system';
    const reason = arg('--reason') ?? 'blocked via CLI';
    if (!taskId) fail('usage: block TASK-ID --owner NAME --reason TEXT');
    const r = blockTask(REG, { taskId, actor: owner, reason });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, state: r.value.state });
    break;
  }

  case 'checkpoint': {
    const taskId = process.argv[3];
    const owner = arg('--owner') ?? arg('--actor');
    const file = arg('--file');
    if (!taskId || !owner || !file) fail('usage: checkpoint TASK-ID --owner NAME --file cp.json');
    if (!existsSync(file)) fail(`checkpoint file missing: ${file}`);
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    const r = appendCheckpoint(REG, { taskId, actor: owner, checkpoint: payload });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, state: r.value.state, checkpointCount: r.value.checkpoints.length });
    break;
  }

  case 'approve': {
    const taskId = process.argv[3];
    const ctx = actorContext();
    const evidence = arg('--evidence') ?? fail('approve requires --evidence');
    if (!taskId) fail('usage: approve TASK-ID --actor NAME --role administrator --evidence REF');
    const read = readRegistryFile(REG);
    if (!read.ok) fail(`${read.code}: ${read.message}`);
    const task = read.value.tasks[taskId];
    if (!task) fail('task_not_found');
    const originOverride = arg('--origin-main');
    const aheadOverride = arg('--main-ahead');
    const git =
      originOverride !== undefined
        ? {
            currentMainSha: originOverride,
            mainAheadCount: aheadOverride !== undefined ? parseMainAheadCount(aheadOverride) : null,
          }
        : gitMetaForTask(task.baseSha, { requireCandidate: true });
    const wt = worktreeArtifactForTask(task);
    if (!wt.ok) fail(`${wt.code}: ${wt.message}`);
    const r = approveTask(REG, {
      taskId,
      actor: ctx.actor,
      role: 'administrator',
      evidenceRef: evidence,
      currentMainSha: git.currentMainSha,
      mainAheadCount: git.mainAheadCount,
      repoRoot: ROOT,
      worktreeArtifact: wt.value,
      skipWorktreeCheck: hasFlag('--no-git'),
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, task: r.value });
    break;
  }

  case 'record-merged': {
    const taskId = process.argv[3];
    const ctx = actorContext();
    const pr = arg('--pr');
    const sha = arg('--sha');
    const evidence = arg('--evidence') ?? fail('record-merged requires --evidence');
    if (!taskId || !pr || !sha) fail('usage: record-merged TASK-ID --actor NAME --role administrator --pr URL --sha SHA --evidence REF');
    const r = recordMergedTask(REG, { taskId, actor: ctx.actor, role: 'administrator', pr, sha, evidenceRef: evidence });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, task: r.value });
    break;
  }

  case 'record-deployed': {
    const taskId = process.argv[3];
    const ctx = actorContext();
    const deployment = arg('--deployment');
    const sha = arg('--sha');
    const evidence = arg('--evidence') ?? fail('record-deployed requires --evidence');
    if (!taskId || !deployment || !sha) {
      fail('usage: record-deployed TASK-ID --actor NAME --role administrator --deployment URL --sha SHA --evidence REF');
    }
    const r = recordDeployedTask(REG, {
      taskId,
      actor: ctx.actor,
      role: 'administrator',
      deployment,
      sha,
      evidenceRef: evidence,
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, task: r.value });
    break;
  }

  case 'collisions': {
    const r = detectAllPathCollisions(REG);
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ collisionCount: r.value.length, collisions: r.value });
    break;
  }

  case 'deps': {
    const taskId = process.argv[3];
    if (!taskId) fail('usage: deps TASK-ID');
    const r = verifyTaskDependencies(REG, taskId);
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson(r.value);
    break;
  }

  case 'integration-handoff': {
    const taskId = process.argv[3];
    const owner = arg('--owner') ?? arg('--actor');
    const role = arg('--role');
    if (!taskId || !owner || role !== 'integrator') {
      fail('usage: integration-handoff TASK-ID --owner NAME --role integrator');
    }
    const read = readRegistryFile(REG);
    if (!read.ok) fail(`${read.code}: ${read.message}`);
    const task = read.value.tasks[taskId];
    if (!task) fail('task_not_found');
    const git = gitMetaForTask(task.baseSha, { requireCandidate: true });
    const wt = worktreeArtifactForTask(task);
    if (!wt.ok) fail(`${wt.code}: ${wt.message}`);
    const aheadRaw = git.mainAheadCount !== null ? String(git.mainAheadCount) : '';
    const r = prepareIntegrationHandoff(REG, {
      taskId,
      actor: owner,
      role: 'integrator',
      currentMainSha: git.currentMainSha || undefined,
      mainAheadRaw: aheadRaw,
      repoRoot: ROOT,
      worktreeArtifact: wt.value,
      skipWorktreeCheck: hasFlag('--no-git'),
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson(r.value);
    break;
  }

  case 'recover-lock': {
    const ctx = actorContext();
    if (ctx.role !== 'administrator') fail('recover-lock requires --role administrator');
    const evidence = arg('--evidence') ?? fail('recover-lock requires --evidence');
    const r = recoverRegistryLock(REG, {
      actor: ctx.actor,
      role: 'administrator',
      evidenceRef: evidence,
      confirm: hasFlag('--confirm'),
    });
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ recovered: r.value, revision: r.revision });
    break;
  }

  case 'seed-task': {
    const ctx = actorContext();
    if (ctx.role !== 'administrator') fail('seed-task requires --role administrator');
    const file = arg('--file');
    if (!file || !existsSync(file)) fail('seed-task requires --file PATH');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const task = parseTaskRecord(raw);
    if (!task) fail('malformed task fixture');
    const r = upsertTask(REG, task, ctx.actor);
    if (!r.ok) fail(`${r.code}: ${r.message}`);
    printJson({ revision: r.revision, task: r.value });
    break;
  }

  default:
    fail(`unknown command: ${cmd}`);
  }
}

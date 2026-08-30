#!/usr/bin/env tsx
/**
 * PStack Phase 3A — agent task registry CLI.
 * No auto merge, deploy, or production mutation.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

function gitMetaForTask(baseSha: string): { originMainSha: string; mainAheadCount: number | null } {
  if (hasFlag('--no-git') || process.env.AGENT_TASK_SKIP_GIT === '1') {
    return { originMainSha: baseSha, mainAheadCount: 0 };
  }
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], { cwd: ROOT, stdio: 'pipe' });
  } catch {
    /* offline */
  }
  try {
    const originMainSha = execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8', cwd: ROOT }).trim();
    const raw = execFileSync(
      'git',
      ['rev-list', '--count', `${baseSha}..origin/main`],
      { encoding: 'utf8', cwd: ROOT },
    ).trim();
    return { originMainSha, mainAheadCount: parseMainAheadCount(raw) };
  } catch {
    return { originMainSha: '', mainAheadCount: null };
  }
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
  claim TASK-ID --owner NAME --role builder|verifier|integrator [--no-git]
  heartbeat TASK-ID --owner NAME [--role ROLE]
  checkpoint TASK-ID --owner NAME --file cp.json
  release TASK-ID --owner NAME
  block TASK-ID --owner NAME --reason TEXT
  approve TASK-ID --actor NAME --role administrator --evidence REF
  record-merged TASK-ID --actor NAME --role administrator --pr URL --sha SHA --evidence REF
  record-deployed TASK-ID --actor NAME --role administrator --deployment URL --sha SHA --evidence REF
  collisions [--registry PATH]
  deps TASK-ID
  integration-handoff TASK-ID --owner NAME --role integrator [--no-git]
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
            originMainSha: originOverride,
            mainAheadCount: aheadOverride !== undefined ? parseMainAheadCount(aheadOverride) : null,
          }
        : baseSha
          ? gitMetaForTask(baseSha)
          : { originMainSha: undefined, mainAheadCount: null };
    const r = claimTask(REG, {
      taskId,
      actor: owner,
      role,
      branch: arg('--branch'),
      worktree: arg('--worktree'),
      originMainSha: git.originMainSha,
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
            originMainSha: originOverride,
            mainAheadCount: aheadOverride !== undefined ? parseMainAheadCount(aheadOverride) : null,
          }
        : gitMetaForTask(task.baseSha);
    const r = approveTask(REG, {
      taskId,
      actor: ctx.actor,
      role: 'administrator',
      evidenceRef: evidence,
      originMainSha: git.originMainSha,
      mainAheadCount: git.mainAheadCount,
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
    const git = gitMetaForTask(task.baseSha);
    const aheadRaw = git.mainAheadCount !== null ? String(git.mainAheadCount) : '';
    const r = prepareIntegrationHandoff(REG, {
      taskId,
      actor: owner,
      role: 'integrator',
      originMainSha: git.originMainSha || undefined,
      mainAheadRaw: aheadRaw,
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

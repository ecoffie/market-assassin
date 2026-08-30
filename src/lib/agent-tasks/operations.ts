import { canTransition } from './states';
import { createLease, renewLease, canClaimLease, assertLeaseOwner, isLeaseExpired } from './lease';
import { findPathCollisions } from './collisions';
import { evaluateDependencies, listReadyTasks } from './dependencies';
import { detectStaleMain, parseMainAheadCount } from './stale-main';
import {
  applyCheckpointMutations,
  stateForCheckpointOutcome,
  validateCheckpointPayload,
} from './checkpoint';
import {
  assertRoleForState,
  findBuilderForVerification,
  validateVerificationEvidence,
  validateIntegrationGate,
} from './verification';
import { assertRegisteredVerificationProfiles, requiredCommandsForProfiles } from './verification-profiles';
import { mutateRegistry, readRegistryFile, initRegistryFile, type RegistryUpdateResult } from './registry';
import { recoverStaleLockDirAtomic } from './lock';
import type {
  AgentRole,
  AgentTaskRegistry,
  RegistryAdminAuditEntry,
  RegistryLockMeta,
  RegistryResult,
  TaskAuditEntry,
  TaskCheckpoint,
  TaskRecord,
} from './types';

export type ActorContext = {
  actor: string;
  role?: AgentRole;
};

export type ClaimInput = ActorContext & {
  taskId: string;
  role: 'builder' | 'verifier' | 'integrator';
  branch?: string;
  worktree?: string;
  nowMs?: number;
  originMainSha?: string;
  mainAheadCount?: number | null;
};

export type TaskMutationInput = ActorContext & {
  taskId: string;
  nowMs?: number;
};

export type BlockInput = TaskMutationInput & { reason: string };

export type CheckpointInput = TaskMutationInput & { checkpoint: unknown };

export type PromoteInput = ActorContext & {
  taskId: string;
  toState: 'ready';
  evidenceRef: string;
  nowMs?: number;
};

export type ApproveInput = ActorContext & {
  taskId: string;
  evidenceRef: string;
  originMainSha?: string;
  mainAheadCount?: number | null;
  nowMs?: number;
};

export type RecoverLockInput = ActorContext & {
  evidenceRef: string;
  confirm: boolean;
  nowMs?: number;
};

export type RecordMergedInput = ActorContext & {
  taskId: string;
  pr: string;
  sha: string;
  evidenceRef: string;
  nowMs?: number;
};

export type RecordDeployedInput = ActorContext & {
  taskId: string;
  deployment: string;
  sha: string;
  evidenceRef: string;
  nowMs?: number;
};

export type IntegrationHandoffInput = ActorContext & {
  taskId: string;
  role: 'integrator';
  originMainSha?: string;
  mainAheadRaw?: string;
};

export type IntegrationHandoff = {
  task: TaskRecord;
  latestCheckpoint: TaskCheckpoint | null;
  dependencyStatuses: ReturnType<typeof evaluateDependencies>;
  staleMain: ReturnType<typeof detectStaleMain> | null;
  pathCollisions: ReturnType<typeof findPathCollisions>;
  verificationProfile: TaskRecord['verificationProfile'];
  requiredCommands: ReturnType<typeof requiredCommandsForProfiles>;
  commandEvidence: TaskCheckpoint['evidence']['commandResults'];
  suggestedWorktree: string;
  suggestedCommands: string[];
};

function err<C extends string>(code: C, message: string): { ok: false; code: C; message: string } {
  return { ok: false, code, message };
}

function lockOpts(actor: string) {
  return { lockOwner: actor };
}

function staleCheck(
  task: TaskRecord,
  originMainSha?: string,
  mainAheadCount?: number | null,
): RegistryResult<true> | null {
  if (!originMainSha) return null;
  const count = mainAheadCount ?? null;
  if (count === null) {
    return err('stale_main', 'mainAheadCount unknown — run git fetch && rev-list before claim/integration');
  }
  const stale = detectStaleMain({
    taskBaseSha: task.baseSha,
    originMainSha,
    mainAheadCount: count,
  });
  if (stale.stale) {
    return err(
      'stale_main',
      `origin/main is ${stale.mainAheadCount} commit(s) ahead of task base ${stale.taskBaseSha.slice(0, 12)}`,
    );
  }
  return null;
}

function auditMeta(
  reg: AgentTaskRegistry,
  fields: {
    role?: AgentRole;
    leaseOwner?: string | null;
    reason?: string;
    extra?: Record<string, string>;
  },
): Record<string, string> {
  return {
    registryRevision: String(reg.revision + 1),
    leaseOwner: fields.leaseOwner ?? 'none',
    ...(fields.role ? { role: fields.role } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.extra ?? {}),
  };
}

function appendRegistryAdminAudit(
  reg: AgentTaskRegistry,
  entry: Omit<RegistryAdminAuditEntry, 'id' | 'at'> & { nowMs: number },
): void {
  const row: RegistryAdminAuditEntry = {
    id: `admin-audit-${entry.nowMs}-${entry.action}`,
    at: new Date(entry.nowMs).toISOString(),
    actor: entry.actor,
    role: entry.role,
    action: entry.action,
    evidenceRef: entry.evidenceRef,
    metadata: entry.metadata,
  };
  reg.adminAuditLog = [...(reg.adminAuditLog ?? []), row];
}
function appendAudit(
  task: TaskRecord,
  entry: Omit<TaskAuditEntry, 'id' | 'at'> & { nowMs: number },
): TaskRecord {
  const audit: TaskAuditEntry = {
    id: `audit-${entry.nowMs}-${entry.action}`,
    at: new Date(entry.nowMs).toISOString(),
    actor: entry.actor,
    action: entry.action,
    fromState: entry.fromState,
    toState: entry.toState,
    evidenceRef: entry.evidenceRef,
    metadata: entry.metadata,
  };
  return { ...task, auditLog: [...task.auditLog, audit], updatedAt: audit.at };
}

function assertAdministrator(actor: ActorContext): RegistryResult<true> | null {
  if (actor.role !== 'administrator') {
    return err('unauthorized_actor', 'administrator role required for this command');
  }
  return null;
}

export function promoteTask(
  registryPath: string,
  input: PromoteInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (task.state !== 'proposed') {
        return err('invalid_transition', `promote requires proposed, got ${task.state}`);
      }
      if (input.toState !== 'ready') {
        return err('invalid_transition', 'promote only supports --state ready');
      }
      if (!canTransition(task.state, 'ready')) {
        return err('invalid_transition', `cannot promote ${task.state} -> ready`);
      }
      const profileCheck = assertRegisteredVerificationProfiles(task.verificationProfile, {
        allowedPaths: task.allowedPaths,
        promoteEvidenceRef: input.evidenceRef,
      });
      if (!profileCheck.ok) return profileCheck;
      reg.tasks[input.taskId] = appendAudit(
        { ...task, state: 'ready' },
        {
          nowMs,
          actor: input.actor,
          action: 'promote',
          fromState: task.state,
          toState: 'ready',
          evidenceRef: input.evidenceRef,
          metadata: auditMeta(reg, {
            role: input.role ?? 'administrator',
            leaseOwner: task.lease?.owner ?? null,
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function approveTask(
  registryPath: string,
  input: ApproveInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      const gate = validateIntegrationGate(reg, task, {
        actor: input.actor,
        role: 'administrator',
        originMainSha: input.originMainSha,
        mainAheadCount: input.mainAheadCount ?? null,
        nowMs,
        requireIntegratorLease: true,
      });
      if (!gate.ok) return gate;
      const integratorOwner = task.lease?.owner ?? 'none';
      reg.tasks[input.taskId] = appendAudit(
        { ...task, state: 'awaiting_approval', lease: null, assignedRole: null },
        {
          nowMs,
          actor: input.actor,
          action: 'approve',
          fromState: task.state,
          toState: 'awaiting_approval',
          evidenceRef: input.evidenceRef,
          metadata: auditMeta(reg, {
            role: input.role ?? 'administrator',
            leaseOwner: integratorOwner,
            extra: { integratorLeaseOwner: integratorOwner },
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function recordMergedTask(
  registryPath: string,
  input: RecordMergedInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (task.state !== 'awaiting_approval') {
        return err('invalid_transition', `record-merged requires awaiting_approval, got ${task.state}`);
      }
      if (!input.pr || !input.sha) {
        return err('malformed_checkpoint', 'record-merged requires --pr and --sha');
      }
      reg.tasks[input.taskId] = appendAudit(
        {
          ...task,
          state: 'merged',
          prRef: input.pr,
          mergeSha: input.sha.toLowerCase(),
        },
        {
          nowMs,
          actor: input.actor,
          action: 'record_merged',
          fromState: task.state,
          toState: 'merged',
          evidenceRef: input.evidenceRef,
          metadata: auditMeta(reg, {
            role: input.role ?? 'administrator',
            leaseOwner: task.lease?.owner ?? null,
            extra: { pr: input.pr, sha: input.sha.toLowerCase() },
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function recordDeployedTask(
  registryPath: string,
  input: RecordDeployedInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (task.state !== 'merged') {
        return err('invalid_transition', `record-deployed requires merged, got ${task.state}`);
      }
      reg.tasks[input.taskId] = appendAudit(
        {
          ...task,
          state: 'deployed',
          deploymentRef: input.deployment,
          deploySha: input.sha.toLowerCase(),
        },
        {
          nowMs,
          actor: input.actor,
          action: 'record_deployed',
          fromState: task.state,
          toState: 'deployed',
          evidenceRef: input.evidenceRef,
          metadata: auditMeta(reg, {
            role: input.role ?? 'administrator',
            leaseOwner: task.lease?.owner ?? null,
            extra: { deployment: input.deployment, sha: input.sha.toLowerCase() },
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function recoverRegistryLock(
  registryPath: string,
  input: RecoverLockInput,
): RegistryUpdateResult<RegistryLockMeta | null> {
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  if (!input.confirm) {
    return err('unauthorized_actor', 'recover-lock requires --confirm — stale takeover is never silent');
  }
  const nowMs = input.nowMs ?? Date.now();
  const recovered = recoverStaleLockDirAtomic({ registryPath, nowMs });
  if (!recovered.ok) return recovered;
  return mutateRegistry(
    registryPath,
    null,
    (reg) => {
      appendRegistryAdminAudit(reg, {
        nowMs,
        actor: input.actor,
        role: input.role ?? 'administrator',
        action: 'recover_stale_lock',
        evidenceRef: input.evidenceRef,
        metadata: auditMeta(reg, {
          role: input.role ?? 'administrator',
          reason: 'stale_lock_recovery',
          extra: recovered.value
            ? {
                previousLockOwner: recovered.value.owner,
                previousLockPid: String(recovered.value.pid),
              }
            : { previousLockOwner: 'none' },
        }),
      });
      return { ok: true, value: recovered.value };
    },
    lockOpts(input.actor),
  );
}

export function claimTask(
  registryPath: string,
  input: ClaimInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);

      if (task.lease && isLeaseExpired(task.lease, nowMs) && task.state !== 'ready') {
        task.state = 'ready';
        task.lease = null;
        task.assignedRole = null;
      }

      if (task.state === 'ready') {
        /* claim from ready */
      } else if (task.state === 'integration' && input.role === 'integrator') {
        /* integrator picks up verified work */
      } else if (task.state === 'verification' && input.role === 'verifier') {
        /* verifier picks up after builder handoff — lease may be cleared */
      } else {
        return err('invalid_transition', `task ${input.taskId} is ${task.state}, cannot claim as ${input.role}`);
      }

      if (task.state === 'ready' || (task.state === 'integration' && input.role === 'integrator')) {
        const deps = evaluateDependencies(reg, task);
        if (!deps.ok) {
          return err('dependency_unmet', `dependencies not complete: ${deps.unmet.map((d) => d.id).join(', ')}`);
        }
        const stale = staleCheck(task, input.originMainSha, input.mainAheadCount ?? null);
        if (stale && !stale.ok) return stale;
      }

      if (task.state === 'verification' && input.role === 'verifier') {
        const builder = findBuilderForVerification(task);
        if (builder && builder === input.actor && !task.allowSameAgentVerification) {
          return err('self_verification_forbidden', 'verifier cannot verify own builder checkpoint');
        }
      }

      const claim = canClaimLease(task.lease, input.actor, nowMs);
      if (!claim.allowed) {
        return err(claim.reason, 'lease held by another owner until expiry');
      }

      const collisions = findPathCollisions(task, Object.values(reg.tasks), nowMs);
      if (collisions.length) {
        const c = collisions[0];
        return err('path_collision', `${c.path} overlaps ${c.otherTaskId} (${c.otherPath})`);
      }

      const lease = createLease(input.actor, input.role, nowMs);
      const nextState =
        task.state === 'verification'
          ? 'verification'
          : task.state === 'integration'
            ? 'integration'
            : 'claimed';
      const fromState = task.state;
      const updated: TaskRecord = {
        ...task,
        state: nextState,
        lease,
        assignedRole: input.role,
        branch: input.branch ?? task.branch,
        worktree: input.worktree ?? task.worktree ?? `.claude/worktrees/${input.taskId.toLowerCase()}`,
        updatedAt: new Date(nowMs).toISOString(),
      };
      reg.tasks[input.taskId] = appendAudit(updated, {
        nowMs,
        actor: input.actor,
        action: 'claim',
        fromState,
        toState: nextState,
        evidenceRef: `claim:${input.role}`,
        metadata: auditMeta(reg, { role: input.role, leaseOwner: input.actor }),
      });
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function heartbeatTask(
  registryPath: string,
  input: TaskMutationInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (!task.lease) return err('lease_not_owner', 'task has no active lease');
      if (!assertLeaseOwner(task.lease, input.actor)) {
        return err('lease_not_owner', 'heartbeat rejected — not lease owner');
      }
      if (input.role && task.lease.role !== input.role) {
        return err('role_forbidden', `heartbeat role ${input.role} !== lease role ${task.lease.role}`);
      }
      if (isLeaseExpired(task.lease, nowMs)) {
        return err('lease_expired', 'lease expired — release or recover before heartbeat');
      }
      reg.tasks[input.taskId] = {
        ...task,
        lease: renewLease(task.lease, nowMs),
        updatedAt: new Date(nowMs).toISOString(),
      };
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function releaseTask(
  registryPath: string,
  input: TaskMutationInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (task.lease && !assertLeaseOwner(task.lease, input.actor) && !isLeaseExpired(task.lease, nowMs)) {
        return err('lease_not_owner', 'release rejected — not lease owner');
      }
      const fromState = task.state;
      reg.tasks[input.taskId] = appendAudit(
        {
          ...task,
          state: 'ready',
          lease: null,
          assignedRole: null,
          updatedAt: new Date(nowMs).toISOString(),
        },
        {
          nowMs,
          actor: input.actor,
          action: 'release',
          fromState,
          toState: 'ready',
          evidenceRef: 'release',
          metadata: auditMeta(reg, {
            role: task.lease?.role,
            leaseOwner: task.lease?.owner ?? null,
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function blockTask(
  registryPath: string,
  input: BlockInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const nowMs = input.nowMs ?? Date.now();
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (task.lease && !assertLeaseOwner(task.lease, input.actor) && !isLeaseExpired(task.lease, nowMs)) {
        return err('lease_not_owner', 'block rejected — not lease owner');
      }
      const cp: TaskCheckpoint = {
        id: `cp-block-${nowMs}`,
        at: new Date(nowMs).toISOString(),
        actor: input.actor,
        role: task.assignedRole ?? 'builder',
        outcome: 'blocked',
        changedPaths: [],
        diffStat: { files: 0, insertions: 0, deletions: 0 },
        evidence: { tests: [], commands: [], notes: input.reason },
        blockers: [input.reason],
        mutationsPerformed: [],
        authorizationConsumed: [],
        nextRequestedAction: 'unblock to ready after resolving blockers',
      };
      const fromState = task.state;
      reg.tasks[input.taskId] = appendAudit(
        {
          ...task,
          state: 'blocked',
          lease: null,
          checkpoints: [...task.checkpoints, cp],
          updatedAt: new Date(nowMs).toISOString(),
        },
        {
          nowMs,
          actor: input.actor,
          action: 'block',
          fromState,
          toState: 'blocked',
          evidenceRef: input.reason,
          metadata: auditMeta(reg, {
            role: task.lease?.role,
            leaseOwner: task.lease?.owner ?? null,
            reason: input.reason,
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function appendCheckpoint(
  registryPath: string,
  input: CheckpointInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const validated = validateCheckpointPayload(input.checkpoint);
  if (!validated.ok) return validated;

  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);
      if (!task.lease) return err('lease_not_owner', 'checkpoint requires active lease');
      if (!assertLeaseOwner(task.lease, input.actor)) {
        return err('lease_not_owner', 'checkpoint rejected — not lease owner');
      }

      const cp = { ...validated.value, actor: input.actor };
      if (cp.role !== task.lease.role) {
        return err('role_forbidden', `checkpoint role ${cp.role} must match lease role ${task.lease.role}`);
      }
      if (!assertRoleForState(task.lease.role, task.state)) {
        return err('role_forbidden', `lease role ${task.lease.role} cannot checkpoint in state ${task.state}`);
      }

      if (cp.role === 'verifier' && cp.outcome === 'verified') {
        const builder = findBuilderForVerification(task);
        if (builder && builder === input.actor && !task.allowSameAgentVerification) {
          return err('self_verification_forbidden', 'verifier cannot verify own builder checkpoint');
        }
      }

      const mutationCheck = applyCheckpointMutations(task, cp);
      if (!mutationCheck.ok) return mutationCheck;

      const nextState = stateForCheckpointOutcome(task.state, cp.outcome);
      if (!nextState) {
        return err('malformed_checkpoint', `outcome ${cp.outcome} has no state mapping from ${task.state}`);
      }
      if (!canTransition(task.state, nextState) && task.state !== nextState) {
        return err('invalid_transition', `cannot transition ${task.state} -> ${nextState} via ${cp.outcome}`);
      }

      const handoffOutcomes = new Set(['ready_for_verification', 'verified']);
      const keepLease =
        handoffOutcomes.has(cp.outcome)
          ? false
          : ['claimed', 'in_progress', 'verification', 'integration'].includes(nextState);
      const fromState = task.state;
      const nextTask: TaskRecord = {
        ...task,
        state: nextState,
        lease: keepLease ? task.lease : null,
        assignedRole: keepLease ? task.assignedRole : null,
        checkpoints: [...task.checkpoints, cp],
        updatedAt: new Date(nowMs).toISOString(),
      };
      reg.tasks[input.taskId] = appendAudit(nextTask, {
        nowMs,
        actor: input.actor,
        action: 'checkpoint',
        fromState,
        toState: nextState,
        evidenceRef: cp.id,
        metadata: auditMeta(reg, {
          role: cp.role,
          leaseOwner: task.lease?.owner ?? input.actor,
          extra: { outcome: cp.outcome },
        }),
      });
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

export function prepareIntegrationHandoff(
  registryPath: string,
  input: IntegrationHandoffInput,
): RegistryResult<IntegrationHandoff> {
  const read = readRegistryFile(registryPath);
  if (!read.ok) return read;
  const task = read.value.tasks[input.taskId];
  if (!task) return err('task_not_found', `unknown task ${input.taskId}`);

  if (input.role !== 'integrator') {
    return err('role_forbidden', 'integration-handoff requires integrator role');
  }

  const mainAhead = parseMainAheadCount(input.mainAheadRaw ?? '');
  if (input.originMainSha && mainAhead === null) {
    return err('stale_main', 'cannot assess stale main — mainAheadCount parse failed');
  }

  const gate = validateIntegrationGate(read.value, task, {
    actor: input.actor,
    role: 'integrator',
    originMainSha: input.originMainSha,
    mainAheadCount: mainAhead,
    nowMs: Date.now(),
    requireIntegratorLease: true,
    integratorActor: input.actor,
  });
  if (!gate.ok) return gate;

  const deps = evaluateDependencies(read.value, task);
  const latest = task.checkpoints[task.checkpoints.length - 1] ?? null;
  const slug = task.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const suggestedWorktree = task.worktree ?? `.claude/worktrees/${slug}`;
  const profileCommands = requiredCommandsForProfiles(task.verificationProfile);

  return {
    ok: true,
    value: {
      task,
      latestCheckpoint: latest,
      dependencyStatuses: deps,
      staleMain:
        input.originMainSha && mainAhead !== null
          ? detectStaleMain({ taskBaseSha: task.baseSha, originMainSha: input.originMainSha, mainAheadCount: mainAhead })
          : null,
      pathCollisions: findPathCollisions(task, Object.values(read.value.tasks), Date.now()),
      verificationProfile: task.verificationProfile,
      requiredCommands: profileCommands,
      commandEvidence: gate.value,
      suggestedWorktree,
      suggestedCommands: profileCommands.map((c) => c.command),
    },
  };
}

export function detectAllPathCollisions(
  registryPath: string,
  nowMs?: number,
): RegistryResult<ReturnType<typeof findPathCollisions>> {
  const read = readRegistryFile(registryPath);
  if (!read.ok) return read;
  const ms = nowMs ?? Date.now();
  const all: ReturnType<typeof findPathCollisions> = [];
  for (const task of Object.values(read.value.tasks)) {
    all.push(...findPathCollisions(task, Object.values(read.value.tasks), ms));
  }
  return { ok: true, value: all };
}

export function verifyTaskDependencies(
  registryPath: string,
  taskId: string,
): RegistryResult<ReturnType<typeof evaluateDependencies>> {
  const read = readRegistryFile(registryPath);
  if (!read.ok) return read;
  const task = read.value.tasks[taskId];
  if (!task) return err('task_not_found', `unknown task ${taskId}`);
  return { ok: true, value: evaluateDependencies(read.value, task) };
}

export function upsertTask(
  registryPath: string,
  task: TaskRecord,
  actor: string,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      if (task.state === 'ready') {
        const profileCheck = assertRegisteredVerificationProfiles(task.verificationProfile, {
          allowedPaths: task.allowedPaths,
        });
        if (!profileCheck.ok) return profileCheck;
      }
      reg.tasks[task.id] = task;
      return { ok: true, value: task };
    },
    lockOpts(actor),
  );
}

export { listReadyTasks, readRegistryFile, parseMainAheadCount, initRegistryFile };

export function listTasks(registry: AgentTaskRegistry, filter?: { ready?: boolean; state?: TaskRecord['state'] }) {
  let tasks = Object.values(registry.tasks);
  if (filter?.ready) tasks = listReadyTasks(registry);
  else if (filter?.state) tasks = tasks.filter((t) => t.state === filter.state);
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

export function bumpRevisionProbe(
  registryPath: string,
  actor: string,
  expectedRevision: number,
): RegistryUpdateResult<{ previous: number; next: number }> {
  return mutateRegistry(
    registryPath,
    expectedRevision,
    (reg) => ({
      ok: true,
      value: { previous: reg.revision, next: reg.revision + 1 },
    }),
    lockOpts(actor),
  );
}

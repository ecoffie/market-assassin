import { canTransition, isLeaseHolding, isTerminal } from './states';
import { createLease, renewLease, canClaimLease, assertLeaseOwner, isLeaseExpired } from './lease';
import { findPathCollisions } from './collisions';
import { evaluateDependencies, listReadyTasks } from './dependencies';
import {
  assertScopeNotWidened,
  buildSuccessor,
  findAssignmentConflicts,
  findSuccessorCollisions,
  validateSupersedeInput,
  type SupersedeInput,
  type SupersedeResult,
} from './supersession';
import { detectStaleMain, parseMainAheadCount } from './stale-main';
import {
  assertNoActiveLease,
  assertRepairable,
  deriveSupersessionEvidence,
  validateRepairInput,
  type DerivedSupersessionEvidence,
  type RepairSupersessionLinkInput,
  type RepairSupersessionLinkResult,
} from './supersession-repair';
import {
  applyCheckpointMutations,
  stateForCheckpointOutcome,
  validateCheckpointPayload,
} from './checkpoint';
import { validateCandidateBearingCheckpoint } from './checkpoint-evidence';
import {
  assertRoleForState,
  findBuilderForVerification,
  validateIntegrationGate,
  validateVerificationEvidence,
} from './verification';
import { resolveGitMainMeta, resolveWorktreeArtifact, type WorktreeArtifact } from './git-evidence';
import { extractCandidateIdentity, findBuilderReadyCheckpoint, latestVerifierCheckpoint, validateCandidateArtifactConsistency } from './candidate-artifact';
import { deriveStateFromCheckpoints, resolveReleaseState } from './release-phase';
import { LEGACY_RECOVERY_MODE } from './candidate-evidence-contract';
import {
  buildAttestation,
  deriveAttestationFromCheckpoints,
  reconcileAttestationWithGit,
} from './attestation';
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

export type ReconcileStateInput = TaskMutationInput & {
  reason: string;
  /** Explicit operator confirmation — reconciliation is a phase repair, never routine. */
  confirm: boolean;
  /**
   * Administrator opt-in to LEGACY evidence recovery (pre-structured checkpoints).
   * Deliberately a separate flag from `confirm`: recovering a task whose candidate can only
   * be inferred from commandResults is a strictly larger act than repairing its phase, and
   * must be visible as such in the audit log. NOTHING in the checkpoint payload can set it.
   */
  legacyEvidenceRecovery?: boolean;
  /** Repo root for live worktree resolution (required when recovering legacy evidence). */
  repoRoot?: string;
  /** Injected artifact for hermetic tests; production resolves from the real worktree. */
  worktreeArtifact?: WorktreeArtifact | null;
};

export type CheckpointInput = TaskMutationInput & { checkpoint: unknown };

/**
 * PHASE 3A.4 (B) — administrator candidate-evidence attestation.
 *
 * ⚠️ There is deliberately NO candidateHeadSha / candidateTreeSha field, and no `--no-git`
 * escape. The identity is DERIVED from command consensus + live Git; a caller who could
 * supply it would be attesting to their own input.
 */
export type AttestCandidateEvidenceInput = TaskMutationInput & {
  reason: string;
  confirm: boolean;
  /** Shared repository root for live worktree resolution (never process.cwd()). */
  repoRoot?: string;
  /** Injected artifact for hermetic tests; production resolves the real worktree. */
  worktreeArtifact?: WorktreeArtifact | null;
  /** Current origin/main — attestation refuses on a stale base. */
  currentMainSha?: string;
  mainAheadCount?: number | null;
};

export type PromoteInput = ActorContext & {
  taskId: string;
  toState: 'ready';
  evidenceRef: string;
  nowMs?: number;
};

export type ApproveInput = ActorContext & {
  taskId: string;
  evidenceRef: string;
  currentMainSha?: string;
  mainAheadCount?: number | null;
  repoRoot?: string;
  worktreeArtifact?: WorktreeArtifact | null;
  skipWorktreeCheck?: boolean;
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
  currentMainSha?: string;
  mainAheadRaw?: string;
  repoRoot?: string;
  worktreeArtifact?: WorktreeArtifact | null;
  skipWorktreeCheck?: boolean;
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
  candidateHeadSha: string;
  candidateTreeSha: string;
  worktreeArtifact: WorktreeArtifact | null;
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

function resolveWorktreeForTask(
  task: TaskRecord,
  repoRoot: string | undefined,
  override: WorktreeArtifact | null | undefined,
): RegistryResult<WorktreeArtifact | null> {
  if (override !== undefined) return { ok: true, value: override };
  if (!repoRoot || !task.worktree?.trim() || !task.branch?.trim()) {
    return { ok: true, value: null };
  }
  return resolveWorktreeArtifact({
    repoRoot,
    worktreeRel: task.worktree,
    expectedBranch: task.branch,
    baseSha: task.baseSha,
  });
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

      const wt = resolveWorktreeForTask(task, input.repoRoot, input.worktreeArtifact);
      if (!wt.ok) return wt;

      const gate = validateIntegrationGate(reg, task, {
        actor: input.actor,
        role: 'administrator',
        currentMainSha: input.currentMainSha,
        mainAheadCount: input.mainAheadCount ?? null,
        nowMs,
        requireIntegratorLease: true,
        worktreeArtifact: wt.value,
        skipWorktreeCheck: input.skipWorktreeCheck,
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

      // DEFECT B: the phase belongs to the TASK's evidence; the lease belongs to the ACTOR.
      // Releasing surrenders the lease only. Hardcoding 'ready' here destroyed verified work
      // (integration -> ready), forcing the whole builder/verifier chain to be re-run.
      // The role is taken from the LEASE (who actually held it), falling back to assignedRole
      // for an expired lease that was already cleared — recovery must preserve phase too.
      const releaseRole = task.lease?.role ?? task.assignedRole ?? null;
      const target = resolveReleaseState(fromState, releaseRole);
      if (!target.ok) return target;
      const toState = target.value;

      reg.tasks[input.taskId] = appendAudit(
        {
          ...task,
          state: toState,
          lease: null,
          // assignedRole is retained for non-ready phases: the next actor must know which
          // role the task is waiting on. Only a true return-to-pool clears it.
          assignedRole: toState === 'ready' ? null : task.assignedRole,
          updatedAt: new Date(nowMs).toISOString(),
        },
        {
          nowMs,
          actor: input.actor,
          action: 'release',
          fromState,
          toState,
          evidenceRef: 'release',
          metadata: auditMeta(reg, {
            role: releaseRole ?? undefined,
            leaseOwner: task.lease?.owner ?? null,
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

/**
 * DEFECT B — administrator-only, checkpoint-DERIVED phase reconciliation.
 *
 * Repairs a task whose phase was destroyed by the old always-ready release. It exists
 * because the real pilot is sitting in `ready` with a valid verified checkpoint chain
 * behind it, and re-running builder+verifier to recover a phase we can already PROVE
 * would be wasted work resting on nothing.
 *
 * ⚠️ The state is DERIVED, never supplied. There is deliberately no `toState` parameter:
 * an operator who can name any state can launder a task into `integration` without
 * evidence, which is precisely the authority this registry exists to withhold. The
 * checkpoint chain is the only input that decides.
 *
 * Refuses when a lease is active — reconciliation must never race an actor mid-work.
 * Appends audit, advances the revision exactly once, and NEVER rewrites, reorders, or
 * fabricates a checkpoint.
 */
export function reconcileTaskState(
  registryPath: string,
  input: ReconcileStateInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  if (!input.confirm) {
    return err('unauthorized_actor', 'reconcile-state requires --confirm');
  }
  if (!input.reason?.trim()) {
    return err('unauthorized_actor', 'reconcile-state requires --reason');
  }

  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);

      // Never race a live actor. An expired lease is recoverable; an active one is not.
      if (task.lease && !isLeaseExpired(task.lease, nowMs)) {
        return err(
          'lease_conflict',
          `task holds an active lease (${task.lease.owner}) — release or await expiry before reconciling`,
        );
      }

      if (isTerminal(task.state)) {
        return err('invalid_transition', `cannot reconcile terminal state ${task.state}`);
      }

      const derived = deriveStateFromCheckpoints(task);
      if (!derived.ok) return derived;
      const toState = derived.value.state;

      // Validate candidate identity + evidence for any phase that CLAIMS verified work.
      // Deriving `integration` asserts a verified candidate exists; prove it before writing.
      let evidenceNote = derived.value.basis;
      const recoveryExtra: Record<string, string> = {};
      if (toState === 'integration') {
        const identity = extractCandidateIdentity(task, {
          legacyRecoveryRequested: input.legacyEvidenceRecovery === true,
        });
        if (!identity.ok) return identity;

        // A live clean worktree is MANDATORY for legacy recovery — legacy evidence carries no
        // tree, so branch/HEAD/tree/base can only be established from the real worktree.
        if (identity.value.evidenceTier === 'legacy') {
          const wt = resolveWorktreeForTask(task, input.repoRoot, input.worktreeArtifact);
          if (!wt.ok) return wt;
          const artifact = validateCandidateArtifactConsistency({
            task,
            identity: identity.value,
            worktree: wt.value,
            requireWorktree: true,
          });
          if (!artifact.ok) return artifact;
          recoveryExtra.recoveryMode = LEGACY_RECOVERY_MODE;
          recoveryExtra.candidateHeadSha = artifact.value.candidateHeadSha;
          recoveryExtra.candidateTreeSha = artifact.value.candidateTreeSha ?? 'unknown';
          recoveryExtra.builderCheckpointId = findBuilderReadyCheckpoint(task)?.id ?? 'none';
          recoveryExtra.verifierCheckpointId = latestVerifierCheckpoint(task)?.id ?? 'none';
        }

        const evidence = validateVerificationEvidence({
          task,
          candidateHeadSha: identity.value.candidateHeadSha,
          requireVerifiedCheckpoint: true,
        });
        if (!evidence.ok) return evidence;

        evidenceNote =
          identity.value.evidenceTier === 'legacy'
            ? `${derived.value.basis} | LEGACY EVIDENCE RECOVERY: ${identity.value.evidenceBasis}`
            : `${derived.value.basis} | structured candidate ${identity.value.candidateHeadSha.slice(0, 12)}`;
      }

      const fromState = task.state;
      if (fromState === toState) {
        return err('invalid_transition', `task already in derived state ${toState} — nothing to reconcile`);
      }

      reg.tasks[input.taskId] = appendAudit(
        {
          ...task,
          state: toState,
          lease: null,
          assignedRole: toState === 'ready' ? null : task.assignedRole,
          updatedAt: new Date(nowMs).toISOString(),
        },
        {
          nowMs,
          actor: input.actor,
          action: 'reconcile-state',
          fromState,
          toState,
          evidenceRef: derived.value.basis,
          metadata: auditMeta(reg, {
            role: 'administrator',
            leaseOwner: null,
            reason: input.reason.trim(),
            extra: { derivedFrom: derived.value.basis, evidence: evidenceNote, ...recoveryExtra },
          }),
        },
      );
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

/**
 * PHASE 3A.4 (B) — ATTEST CANDIDATE EVIDENCE (administrator only).
 *
 * Records an administrator-DERIVED candidate identity for a task whose verified checkpoint
 * chain predates the structured contract, WITHOUT touching the checkpoints. See
 * attestation.ts for why derivation (not caller input) is the entire point.
 *
 * PRECONDITIONS, all fail-closed and all checked before anything is written:
 *   - explicit administrator role, `--confirm`, and a non-empty `--reason`
 *   - state is `integration` and lease is `null` (never race a live actor)
 *   - a verified Builder -> Verifier chain exists, in order, with DISTINCT actors
 *   - structured candidate evidence is genuinely MISSING (else nothing to attest)
 *   - required commands passed, carry heads, and postdate the appropriate checkpoints
 *   - commandResults are UNANIMOUS on one head with none missing
 *   - `task.baseSha` equals current origin/main — no attesting onto a stale base
 *   - the live worktree is on the right branch, CLEAN, at that exact head, descended
 *     from base; the tree is READ from it
 *   - no prior attestation exists (repeat attestation is refused)
 *
 * ON SUCCESS the write is deliberately NARROW: state, lease, assignedRole, checkpoints and
 * every prior audit entry are untouched. Only `candidateEvidenceAttestation` is set and one
 * `candidate-evidence-attested` audit entry is appended, advancing the revision exactly once.
 */
export function attestCandidateEvidence(
  registryPath: string,
  input: AttestCandidateEvidenceInput,
  expectedRevision?: number,
): RegistryUpdateResult<TaskRecord> {
  const admin = assertAdministrator(input);
  if (admin && !admin.ok) return admin;
  if (!input.confirm) {
    return err('unauthorized_actor', 'attest-candidate-evidence requires --confirm');
  }
  if (!input.reason?.trim()) {
    return err('unauthorized_actor', 'attest-candidate-evidence requires a non-empty --reason');
  }
  const nowMs = input.nowMs ?? Date.now();

  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const task = reg.tasks[input.taskId];
      if (!task) return err('task_not_found', `unknown task ${input.taskId}`);

      // STATE + LEASE — attestation is an out-of-band administrator act on a parked task.
      if (task.state !== 'integration') {
        return err('invalid_transition', `attest-candidate-evidence requires integration, got ${task.state}`);
      }
      if (task.lease) {
        return err(
          'lease_conflict',
          `task holds an active lease (${task.lease.owner}) — release it before attesting`,
        );
      }

      // REPEAT ATTESTATION — refused. An attestation is a one-time administrator act; a
      // second one would silently replace a recorded derivation with a newer one.
      if (task.candidateEvidenceAttestation) {
        return err(
          'attestation_conflict',
          `task already carries a candidate-evidence attestation from ${task.candidateEvidenceAttestation.administrator} at ${task.candidateEvidenceAttestation.at}`,
        );
      }

      // STALE MAIN — attesting a candidate whose base has been overtaken would certify work
      // against a main that no longer exists. Checked here as well as at approve.
      const stale = staleCheck(task, input.currentMainSha, input.mainAheadCount);
      if (stale && !stale.ok) return stale;

      // DERIVE from the checkpoint chain (no Git yet, no caller input at all).
      const derived = deriveAttestationFromCheckpoints(task);
      if (!derived.ok) return derived;

      // RECONCILE against the LIVE worktree — supplies the tree and binds the head.
      const wt = resolveWorktreeForTask(task, input.repoRoot, input.worktreeArtifact);
      if (!wt.ok) return wt;
      const reconciled = reconcileAttestationWithGit({
        task,
        derivation: derived.value,
        worktree: wt.value,
      });
      if (!reconciled.ok) return reconciled;

      const at = new Date(nowMs).toISOString();
      const attestation = buildAttestation({
        task,
        derivation: reconciled.value,
        administrator: input.actor,
        reason: input.reason.trim(),
        at,
        registryRevision: reg.revision + 1,
      });

      // NARROW WRITE: state, lease, assignedRole, checkpoints and prior audits untouched.
      const next: TaskRecord = { ...task, candidateEvidenceAttestation: attestation, updatedAt: at };
      reg.tasks[input.taskId] = appendAudit(next, {
        nowMs,
        actor: input.actor,
        action: 'candidate-evidence-attested',
        fromState: task.state,
        toState: task.state,
        evidenceRef: reconciled.value.basis,
        metadata: auditMeta(reg, {
          role: 'administrator',
          leaseOwner: null,
          reason: input.reason.trim(),
          extra: {
            candidateHeadSha: attestation.candidateHeadSha,
            candidateTreeSha: attestation.candidateTreeSha,
            baseSha: attestation.baseSha,
            branch: attestation.branch,
            worktree: attestation.worktree,
            builderCheckpointId: attestation.builderCheckpointId,
            verifierCheckpointId: attestation.verifierCheckpointId,
            derivation: reconciled.value.basis,
          },
        }),
      });
      return { ok: true, value: reg.tasks[input.taskId] };
    },
    lockOpts(input.actor),
  );
}

/**
 * PHASE 3A.3 — ATOMIC SUPERSESSION (administrator only).
 *
 * Closes a task whose `baseSha` has gone stale and opens its current-main successor
 * in ONE registry mutation. `baseSha` is immutable by design (see supersession.ts),
 * so this is the only lifecycle-correct way to move work onto a newer base.
 *
 * ATOMICITY: both halves are written inside a single `mutateRegistry` call. The
 * mutator either returns ok — and the registry is written once, revision +1 — or it
 * returns an error and NOTHING is written. There is no window in which the source is
 * cancelled but the successor is missing, which would strand the work permanently.
 *
 * The source's baseSha, checkpoints, and prior audit entries are never touched; the
 * source only gains a cancellation audit entry and a forward pointer.
 */
export function supersedeTask(
  registryPath: string,
  input: SupersedeInput,
  expectedRevision?: number,
): RegistryUpdateResult<SupersedeResult> {
  const pre = validateSupersedeInput(input);
  if (!pre.ok) return pre;
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      const source = reg.tasks[input.taskId];
      if (!source) return err('task_not_found', `unknown task ${input.taskId}`);

      if (reg.tasks[input.newTaskId]) {
        return err('malformed_task', `successor id ${input.newTaskId} already exists`);
      }
      if (isTerminal(source.state)) {
        return err('invalid_transition', `cannot supersede terminal task (${source.state})`);
      }
      // Never race a live actor. An expired lease is recoverable; an active one is not.
      if (source.lease && !isLeaseExpired(source.lease, nowMs)) {
        return err(
          'lease_conflict',
          `task holds an active lease (${source.lease.owner}) — release or await expiry before superseding`,
        );
      }
      if (!canTransition(source.state, 'cancelled')) {
        return err('invalid_transition', `cannot cancel from ${source.state}`);
      }

      // Branch/worktree must not already belong to another live task.
      const assignConflicts = findAssignmentConflicts(reg, input.branch, input.worktree, input.taskId);
      if (assignConflicts.length) {
        const c = assignConflicts[0];
        return err('path_collision', `successor ${c.field} ${c.value} already assigned to ${c.taskId}`);
      }

      const successor = buildSuccessor({
        source,
        newTaskId: input.newTaskId,
        branch: input.branch,
        worktree: input.worktree,
        baseSha: input.currentMainSha,
        nowIso,
      });

      // The successor must never be broader than what it replaces.
      const scopeCheck = assertScopeNotWidened(source, successor);
      if (!scopeCheck.ok) return scopeCheck;

      // Path collisions against every OTHER active task. The source is excluded because
      // it is cancelled in this same atomic write — see findSuccessorCollisions.
      const collisions = findSuccessorCollisions(
        reg,
        successor.allowedPaths,
        source.id,
        successor.id,
        nowMs,
      );
      if (collisions.length) {
        const c = collisions[0];
        return err('path_collision', `${c.path} overlaps ${c.otherTaskId} (${c.otherPath})`);
      }

      // Dependencies are copied verbatim; they must still resolve in this registry or the
      // successor would carry a dangling reference past assertRegistryInvariants.
      for (const dep of successor.dependencies) {
        if (!reg.tasks[dep]) {
          return err('dependency_unmet', `successor dependency ${dep} does not exist`);
        }
      }

      const sourceMeta = auditMeta(reg, {
        role: 'administrator',
        leaseOwner: null,
        reason: input.reason.trim(),
        extra: {
          supersededByTaskId: successor.id,
          oldBaseSha: source.baseSha,
          newBaseSha: successor.baseSha,
          currentMainSha: input.currentMainSha.toLowerCase(),
        },
      });
      const successorMeta = auditMeta(reg, {
        role: 'administrator',
        leaseOwner: null,
        reason: input.reason.trim(),
        extra: {
          supersedesTaskId: source.id,
          sourceTaskId: source.id,
          newBaseSha: successor.baseSha,
          oldBaseSha: source.baseSha,
        },
      });

      // SOURCE: cancelled + forward pointer. baseSha, checkpoints and prior audit
      // entries are carried through untouched by the spread.
      reg.tasks[source.id] = appendAudit(
        { ...source, state: 'cancelled', lease: null, supersededByTaskId: successor.id },
        {
          nowMs,
          actor: input.actor,
          action: 'supersede',
          fromState: source.state,
          toState: 'cancelled',
          evidenceRef: `supersede -> ${successor.id}`,
          metadata: sourceMeta,
        },
      );

      // SUCCESSOR: its own audit history, starting with its creation.
      reg.tasks[successor.id] = appendAudit(successor, {
        nowMs,
        actor: input.actor,
        action: 'superseded-from',
        fromState: 'proposed',
        toState: 'ready',
        evidenceRef: `superseded-from ${source.id}`,
        metadata: successorMeta,
      });

      return {
        ok: true,
        value: { source: reg.tasks[source.id], successor: reg.tasks[successor.id] },
      };
    },
    lockOpts(input.actor),
  );
}

/**
 * PHASE 3A.5 (A) — repair a supersession link whose durable fields were never written.
 *
 * The successor is DERIVED from the mutually corroborating audit pair (see
 * `supersession-repair.ts`); the caller cannot name it, and there is no field/value
 * interface. Both durable fields are set in ONE `mutateRegistry` call, so the registry
 * never observes a half-repaired link — `assertRegistryInvariants` would reject one
 * anyway, which is the backstop that makes the atomicity self-enforcing.
 *
 * `allowLegacyUpgrade` is set because this is the bounded administrator path: the live
 * registry needing repair is a legacy version-1 file, and the same single revision that
 * repairs the link also migrates it to version 2 (Phase 3A.5 B).
 */
export function repairSupersessionLink(
  registryPath: string,
  input: RepairSupersessionLinkInput,
  expectedRevision?: number,
): RegistryUpdateResult<RepairSupersessionLinkResult> {
  const pre = validateRepairInput(input);
  if (!pre.ok) return pre;
  const nowMs = input.nowMs ?? Date.now();

  return mutateRegistry(
    registryPath,
    expectedRevision ?? null,
    (reg) => {
      // 1. DERIVE the relationship from audits alone. Refuses on missing, ambiguous,
      //    conflicting, or mutually inconsistent evidence.
      const derived = deriveSupersessionEvidence(reg, input.taskId);
      if (!derived.ok) return derived;
      const evidence: DerivedSupersessionEvidence = derived.value;

      const source = reg.tasks[evidence.sourceTaskId];
      const successor = reg.tasks[evidence.successorTaskId];
      if (!source || !successor) {
        return err('task_not_found', 'derived task missing from registry');
      }

      // 2. Never race a live actor on EITHER side of the link.
      const leaseCheck = assertNoActiveLease(source, successor, nowMs);
      if (!leaseCheck.ok) return leaseCheck;

      // 3. Repair only when the durable fields are genuinely absent. A repeat is
      //    `already_repaired`, not an audited no-op.
      const repairable = assertRepairable(source, successor);
      if (!repairable.ok) return repairable;

      const meta = auditMeta(reg, {
        role: 'administrator',
        leaseOwner: null,
        reason: input.reason.trim(),
        extra: {
          repairedSourceTaskId: evidence.sourceTaskId,
          repairedSuccessorTaskId: evidence.successorTaskId,
          derivedFromSourceAuditId: evidence.sourceAuditId,
          derivedFromSuccessorAuditId: evidence.successorAuditId,
          supersessionRegistryRevision: evidence.registryRevision,
          supersessionAt: evidence.at,
          supersessionActor: evidence.actor,
        },
      });

      // 4. THE WRITE. Only the two link fields change. Every other field — state, base,
      //    branch, worktree, scope, lease, checkpoints, prior audits — rides through the
      //    spread untouched, which is what keeps the rest of the record byte-identical.
      reg.tasks[source.id] = appendAudit(
        { ...source, supersededByTaskId: successor.id },
        {
          nowMs,
          actor: input.actor,
          action: 'supersession-link-repaired',
          fromState: source.state,
          toState: source.state,
          evidenceRef: `supersession-link-repaired -> ${successor.id}`,
          metadata: meta,
        },
      );
      reg.tasks[successor.id] = appendAudit(
        { ...successor, supersedesTaskId: source.id },
        {
          nowMs,
          actor: input.actor,
          action: 'supersession-link-repaired',
          fromState: successor.state,
          toState: successor.state,
          evidenceRef: `supersession-link-repaired <- ${source.id}`,
          metadata: meta,
        },
      );

      return {
        ok: true,
        value: {
          source: reg.tasks[source.id],
          successor: reg.tasks[successor.id],
          evidence,
        },
      };
    },
    { ...lockOpts(input.actor), allowLegacyUpgrade: true },
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

      // PHASE 3A.4 (A) — CANDIDATE-EVIDENCE GATE, BEFORE ANY WRITE.
      // A `ready_for_verification` / `verified` checkpoint asserts that a candidate exists;
      // it must therefore CARRY that candidate in the structured schema slot, agree with
      // every blocking command it cites, and (for a verifier) match the builder checkpoint
      // it answers. This is positioned above every mutation deliberately: on rejection the
      // registry is left byte-identical — no revision, state, checkpoint, audit or lease
      // change — so the submitter keeps its lease and can resubmit a complete checkpoint.
      // Previously the sole enforcement lived in `extractCandidateIdentity`, THREE state
      // transitions later at integration-handoff, by which time the leases were gone.
      const candidateCheck = validateCandidateBearingCheckpoint({ task, checkpoint: cp, actor: input.actor });
      if (!candidateCheck.ok) return candidateCheck;

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
  if (input.currentMainSha && mainAhead === null) {
    return err('stale_main', 'cannot assess stale main — mainAheadCount parse failed');
  }

  const wt = resolveWorktreeForTask(task, input.repoRoot, input.worktreeArtifact);
  if (!wt.ok) return wt;

  const gate = validateIntegrationGate(read.value, task, {
    actor: input.actor,
    role: 'integrator',
    currentMainSha: input.currentMainSha,
    mainAheadCount: mainAhead,
    nowMs: Date.now(),
    requireIntegratorLease: true,
    integratorActor: input.actor,
    worktreeArtifact: wt.value,
    skipWorktreeCheck: input.skipWorktreeCheck,
  });
  if (!gate.ok) return gate;

  const identity = extractCandidateIdentity(task);
  if (!identity.ok) return identity;

  const deps = evaluateDependencies(read.value, task);
  const latest = task.checkpoints[task.checkpoints.length - 1] ?? null;
  const slug = task.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const suggestedWorktree = task.worktree ?? `.claude/worktrees/${slug}`;
  const profileCommands = requiredCommandsForProfiles(task.verificationProfile);
  const candidateTreeSha =
    identity.value.candidateTreeSha ?? wt.value?.treeSha ?? '';

  return {
    ok: true,
    value: {
      task,
      latestCheckpoint: latest,
      dependencyStatuses: deps,
      staleMain:
        input.currentMainSha && mainAhead !== null
          ? detectStaleMain({
              taskBaseSha: task.baseSha,
              originMainSha: input.currentMainSha,
              mainAheadCount: mainAhead,
            })
          : null,
      pathCollisions: findPathCollisions(task, Object.values(read.value.tasks), Date.now()),
      verificationProfile: task.verificationProfile,
      requiredCommands: profileCommands,
      commandEvidence: gate.value,
      candidateHeadSha: identity.value.candidateHeadSha,
      candidateTreeSha,
      worktreeArtifact: wt.value,
      suggestedWorktree,
      suggestedCommands: profileCommands.map((c) => c.command),
    },
  };
}

/**
 * PHASE 3A.4 (D) — GLOBAL COLLISION REPORT, BOTH SIDES ACTIVE.
 *
 * ⚠️ THE FALSE POSITIVE THIS REMOVES: `findPathCollisions` filters only the OTHER side
 * (`isLeaseHolding(other.state)`); it never questions the CANDIDATE. The global sweep fed
 * EVERY task in as a candidate, so a CANCELLED predecessor was still reported as colliding
 * with its own live successor — which is precisely the shape supersession creates on
 * purpose: TASK-PSTACK-PILOT-001 (cancelled) and TASK-PSTACK-PILOT-002 (active) share
 * `docs/engineering/pstack-phase-3a-pilot-runbook.md` BY DESIGN. A report that flags the
 * intended outcome of a supported operation trains operators to ignore it, which is worse
 * than no report.
 *
 * TWO corrections, both required:
 *   1. the CANDIDATE must itself be an active, lease-holding, non-expired task — a
 *      terminal or lease-less task can never be the outer subject of a collision;
 *   2. each genuine overlap is emitted ONCE. Two active tasks previously produced two
 *      MIRRORED rows (A-vs-B and B-vs-A), inflating the count and reading as two problems.
 *      Canonical ordering (`taskId < otherTaskId`) picks a single stable direction.
 *
 * ⚠️ TASK-SPECIFIC behaviour is deliberately UNCHANGED. `findPathCollisions` is still the
 * gate inside `validateIntegrationGate` and `claimTask`, where the candidate is a KNOWN
 * active task being admitted and asymmetry is correct: the question there is "may THIS task
 * proceed", not "what overlaps exist". Narrowing the shared helper would silently weaken
 * both gates.
 */
export function detectAllPathCollisions(
  registryPath: string,
  nowMs?: number,
): RegistryResult<ReturnType<typeof findPathCollisions>> {
  const read = readRegistryFile(registryPath);
  if (!read.ok) return read;
  const ms = nowMs ?? Date.now();
  const tasks = Object.values(read.value.tasks);
  const all: ReturnType<typeof findPathCollisions> = [];
  for (const task of tasks) {
    // The candidate side must be active too — same predicate the other side already uses.
    if (!isLeaseHolding(task.state)) continue;
    if (task.lease && isLeaseExpired(task.lease, ms)) continue;
    for (const hit of findPathCollisions(task, tasks, ms)) {
      // Canonical direction only — the mirrored row describes the identical overlap.
      if (hit.taskId < hit.otherTaskId) all.push(hit);
    }
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

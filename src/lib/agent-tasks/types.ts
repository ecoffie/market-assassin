/** PStack Phase 3A — repository-backed agent task registry types. */

export const TASK_STATES = [
  'proposed',
  'ready',
  'claimed',
  'in_progress',
  'verification',
  'integration',
  'awaiting_approval',
  'merged',
  'deployed',
  'blocked',
  'failed',
  'cancelled',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const AGENT_ROLES = ['builder', 'verifier', 'integrator', 'administrator'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const CHECKPOINT_OUTCOMES = [
  'progress',
  'blocked',
  'ready_for_verification',
  'verified',
  'ready_for_integration',
  'failed',
  'awaiting_approval',
  'released',
] as const;

export type CheckpointOutcome = (typeof CHECKPOINT_OUTCOMES)[number];

export const VERIFICATION_PROFILES = [
  'map-contract-verify',
  'data-provenance',
  'cross-surface-parity',
  'ma-skills',
  'oracles',
  'docs-only',
] as const;

export type VerificationProfile = (typeof VERIFICATION_PROFILES)[number];

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export type MutationBoundary =
  | 'read_only'
  | 'repo_files'
  | 'git_commit'
  | 'git_push'
  | 'open_pr'
  | 'merge'
  | 'deploy'
  | 'production_data';

export type ApprovalBoundary = 'none' | 'human_review' | 'eric_explicit';

export type CommandEvidenceStatus = 'passed' | 'failed' | 'skipped' | 'warn';

export type CommandEvidenceResult = {
  command: string;
  status: CommandEvidenceStatus;
  ranAt: string;
  headSha?: string;
  exitCode?: number;
};

export type TaskLease = {
  owner: string;
  role: AgentRole;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
};

export type TaskCheckpoint = {
  id: string;
  at: string;
  actor: string;
  role: AgentRole;
  outcome: CheckpointOutcome;
  changedPaths: string[];
  diffStat: { files: number; insertions: number; deletions: number };
  evidence: {
    tests: string[];
    commands: string[];
    commandResults?: CommandEvidenceResult[];
    /** Committed feature HEAD being handed off for verification / integration. */
    candidateHeadSha?: string;
    /** Tree object belonging to candidateHeadSha. */
    candidateTreeSha?: string;
    notes: string;
  };
  blockers: string[];
  mutationsPerformed: MutationBoundary[];
  authorizationConsumed: string[];
  nextRequestedAction: string;
};

export type TaskAuditAction =
  | 'claim'
  | 'release'
  | 'block'
  | 'checkpoint'
  | 'promote'
  | 'approve'
  | 'record_merged'
  | 'record_deployed'
  /** Administrator phase repair derived from the checkpoint chain (never operator-supplied). */
  | 'reconcile-state'
  /** Administrator atomic close of a stale task (baseSha is immutable — the task is replaced). */
  | 'supersede'
  /** Successor creation, written on the NEW task in the same atomic supersession write. */
  | 'superseded-from'
  /**
   * Administrator attestation of candidate identity DERIVED from an existing verified
   * checkpoint chain plus live Git. Never rewrites a checkpoint (Phase 3A.4 B).
   */
  | 'candidate-evidence-attested';

export type RegistryAdminAuditAction = 'recover_stale_lock';

export type RegistryAdminAuditEntry = {
  id: string;
  at: string;
  actor: string;
  role: AgentRole;
  action: RegistryAdminAuditAction;
  evidenceRef: string;
  metadata: Record<string, string>;
};

export type TaskAuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: TaskAuditAction;
  fromState: TaskState;
  toState: TaskState;
  evidenceRef: string;
  metadata: Record<string, string>;
};

/**
 * PHASE 3A.4 (B) — TYPED, TASK-LEVEL CANDIDATE-EVIDENCE ATTESTATION.
 *
 * Written ONLY by `attestCandidateEvidence`. It sits BESIDE the checkpoints, never inside
 * them: a checkpoint is a signed statement by the actor who made it, and an administrator
 * editing one after the fact would destroy the only thing that makes the chain evidence.
 * The attestation instead records what an administrator independently DERIVED — from
 * unanimous commandResults consensus reconciled against the live worktree — and cites the
 * exact checkpoints it was derived from.
 *
 * Every field is DERIVED or administrator-supplied context. `candidateHeadSha` /
 * `candidateTreeSha` are NEVER caller-supplied: there is no flag that can set them.
 */
export type CandidateEvidenceAttestation = {
  /** Derived from commandResults consensus AND confirmed equal to live worktree HEAD. */
  candidateHeadSha: string;
  /** Read from the live worktree HEAD^{tree} — never inferred, never supplied. */
  candidateTreeSha: string;
  /** The task base the candidate must descend from, copied from the task at attest time. */
  baseSha: string;
  branch: string;
  worktree: string;
  /** Checkpoint the candidate was handed off in. */
  builderCheckpointId: string;
  /** Checkpoint that independently verified it. */
  verifierCheckpointId: string;
  /** Administrator who attested. */
  administrator: string;
  reason: string;
  at: string;
  /** Registry revision produced by the attesting write. */
  registryRevision: number;
};

export type TaskRecord = {
  id: string;
  title: string;
  priority: TaskPriority;
  state: TaskState;
  authorizedScope: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  dependencies: string[];
  assignedRole: AgentRole | null;
  branch: string | null;
  worktree: string | null;
  baseSha: string;
  lease: TaskLease | null;
  verificationProfile: VerificationProfile[];
  allowSameAgentVerification: boolean;
  checkpoints: TaskCheckpoint[];
  auditLog: TaskAuditEntry[];
  prRef: string | null;
  mergeSha: string | null;
  deploymentRef: string | null;
  deploySha: string | null;
  allowedMutations: MutationBoundary[];
  approvalRequired: ApprovalBoundary;
  /** Set on the SOURCE when it is superseded — points forward to its replacement. */
  supersededByTaskId?: string | null;
  /** Set on the SUCCESSOR — points back to the task it replaced. */
  supersedesTaskId?: string | null;
  /**
   * Administrator-derived candidate identity for a task whose verified checkpoints predate
   * the structured contract. Additive: checkpoints stay byte-identical. Consumed by
   * integration-handoff/approve as candidate identity, but NEVER as a substitute for the
   * live stale-main and candidate-artifact validation those commands still perform.
   */
  candidateEvidenceAttestation?: CandidateEvidenceAttestation | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentTaskRegistry = {
  version: number;
  revision: number;
  updatedAt: string;
  tasks: Record<string, TaskRecord>;
  adminAuditLog: RegistryAdminAuditEntry[];
};

export type RegistryLockMeta = {
  owner: string;
  pid: number;
  sessionId: string;
  acquiredAt: string;
};

export type RegistryErrorCode =
  | 'not_git_repository'
  | 'malformed_registry'
  | 'malformed_task'
  | 'malformed_checkpoint'
  | 'task_not_found'
  | 'invalid_transition'
  | 'lease_conflict'
  | 'lease_not_owner'
  | 'lease_expired'
  | 'path_collision'
  | 'dependency_unmet'
  | 'stale_main'
  | 'revision_conflict'
  | 'forbidden_mutation'
  | 'lock_conflict'
  | 'lock_timeout'
  | 'lock_not_stale'
  | 'role_forbidden'
  | 'verification_incomplete'
  | 'candidate_integrity'
  | 'self_verification_forbidden'
  | 'unauthorized_actor'
  | 'attestation_conflict';

export type RegistryError = {
  ok: false;
  code: RegistryErrorCode;
  message: string;
};

export type RegistryOk<T> = { ok: true; value: T };

export type RegistryResult<T> = RegistryOk<T> | RegistryError;

export const DEFAULT_LEASE_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_LOCK_WAIT_MS = 5_000;
export const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

export function createEmptyRegistry(now = new Date().toISOString()): AgentTaskRegistry {
  return { version: 1, revision: 0, updatedAt: now, tasks: {}, adminAuditLog: [] };
}

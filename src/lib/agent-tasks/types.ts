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
  | 'candidate-evidence-attested'
  /**
   * PHASE 3A.5 (A) — administrator repair of a supersession link whose DURABLE fields
   * were never written, using the mutually-corroborating audit pair as the only source
   * of truth. Never invents a relationship; only re-materializes a proven one.
   */
  | 'supersession-link-repaired';

/**
 * PHASE 3A.5 (B) — REGISTRY FORMAT VERSION.
 *
 * The format version is a WRITER-COMPATIBILITY BOUNDARY, not a decoration. Every parser
 * generation shipped before 3A.5 begins `parseRegistry` with `if (o.version !== 1) return null`,
 * so a version-2 registry is rejected by them as `malformed_registry` BEFORE any record is
 * parsed and before any mutation path is entered. That was verified experimentally against
 * all four historical generations (27f0f935, 4b6c511c, 5d8a3007, dd90ea7c) rather than
 * assumed — see docs/engineering/pstack-registry-repair-and-version-boundary.md.
 *
 * Raising the version is therefore how a modern registry QUARANTINES itself from older
 * writers: an old CLI cannot silently drop fields it does not understand, because it
 * cannot get far enough to write at all.
 */
export const REGISTRY_FORMAT_VERSION = 2 as const;

/** The legacy format. Readable ONLY on the bounded administrator repair/migration path. */
export const REGISTRY_LEGACY_VERSION = 1 as const;

export type RegistryFormatVersion =
  | typeof REGISTRY_LEGACY_VERSION
  | typeof REGISTRY_FORMAT_VERSION;

/**
 * PHASE 3A.5 (B) — EXECUTION PROVENANCE.
 *
 * Recorded on every version-2 write so a registry can answer "which writer produced this
 * state, and from where". Without it, a registry damaged by an unexpected writer is
 * indistinguishable from one written correctly — the state looks the same either way.
 */
export type RegistryProvenance = {
  /** Writer generation — the format version this writer emits. */
  writerVersion: number;
  /** Resolved absolute path of the CLI/module that performed the write. */
  writerPath: string;
  /** Resolved absolute worktree the write was invoked from. */
  worktreePath: string;
  /** Resolved absolute git common dir the registry belongs to. */
  gitCommonDir: string;
  /** Actor that owned the write. */
  actor: string;
  at: string;
};

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
  version: RegistryFormatVersion;
  revision: number;
  updatedAt: string;
  tasks: Record<string, TaskRecord>;
  adminAuditLog: RegistryAdminAuditEntry[];
  /**
   * PHASE 3A.5 (B) — present on every version-2 registry, absent on legacy version-1.
   * Optional in the type ONLY so a legacy registry can be read on the bounded repair
   * path; `assertRegistryInvariants` requires it once version is 2.
   */
  provenance?: RegistryProvenance | null;
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
  | 'attestation_conflict'
  /** PHASE 3A.5 (B) — an ordinary mutation was attempted against a legacy version-1 registry. */
  | 'registry_upgrade_required'
  /** PHASE 3A.5 (B) — the registry declares a version this writer does not support. */
  | 'unsupported_registry_version'
  /** PHASE 3A.5 (C) — mutation attempted from a bare repo, or outside a registered worktree. */
  | 'unhealthy_worktree'
  /** PHASE 3A.5 (A) — the supersession link is already durable; repair would be a no-op. */
  | 'already_repaired'
  /** PHASE 3A.5 (A) — audit evidence is missing, ambiguous, or mutually inconsistent. */
  | 'insufficient_repair_evidence';

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

/**
 * A freshly bootstrapped registry is a VERSION-2 registry, so it must carry provenance
 * like any other version-2 registry — `assertRegistryInvariants` requires it. Callers
 * that have a resolved writer context pass it; the default is a self-describing bootstrap
 * stamp rather than null, because a null here would make the very first write unreadable.
 */
export function createEmptyRegistry(
  now = new Date().toISOString(),
  provenance?: RegistryProvenance,
): AgentTaskRegistry {
  return {
    version: REGISTRY_FORMAT_VERSION,
    revision: 0,
    updatedAt: now,
    tasks: {},
    adminAuditLog: [],
    provenance: provenance ?? {
      writerVersion: REGISTRY_FORMAT_VERSION,
      writerPath: 'bootstrap',
      worktreePath: 'bootstrap',
      gitCommonDir: 'bootstrap',
      actor: 'bootstrap',
      at: now,
    },
  };
}

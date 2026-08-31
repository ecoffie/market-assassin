import {
  AGENT_ROLES,
  CHECKPOINT_OUTCOMES,
  TASK_STATES,
  VERIFICATION_PROFILES,
  type AgentTaskRegistry,
  type CandidateEvidenceAttestation,
  type CommandEvidenceResult,
  type TaskAuditEntry,
  type TaskCheckpoint,
  type TaskLease,
  type TaskRecord,
  type AgentRole,
  type RegistryAdminAuditEntry,
} from './types';

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const TASK_ID_RE = /^TASK-[A-Z0-9-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
const LEASE_ROLES = ['builder', 'verifier', 'integrator'] as const;

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function parseCommandResults(raw: unknown): CommandEvidenceResult[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: CommandEvidenceResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.command !== 'string' || typeof o.status !== 'string') return null;
    if (!['passed', 'failed', 'skipped', 'warn'].includes(o.status)) return null;
    if (typeof o.ranAt !== 'string' || !ISO_RE.test(o.ranAt)) return null;
    if (o.headSha !== undefined && typeof o.headSha !== 'string') return null;
    if (o.exitCode !== undefined && typeof o.exitCode !== 'number') return null;
    out.push({
      command: o.command,
      status: o.status as CommandEvidenceResult['status'],
      ranAt: o.ranAt,
      headSha: o.headSha as string | undefined,
      exitCode: o.exitCode as number | undefined,
    });
  }
  return out;
}

function parseLease(raw: unknown): TaskLease | null {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.owner !== 'string' || !o.owner.trim()) return null;
  if (!LEASE_ROLES.includes(o.role as (typeof LEASE_ROLES)[number])) return null;
  for (const k of ['acquiredAt', 'expiresAt', 'lastHeartbeatAt'] as const) {
    if (typeof o[k] !== 'string' || !ISO_RE.test(o[k])) return null;
  }
  return {
    owner: o.owner.trim(),
    role: o.role as TaskLease['role'],
    acquiredAt: o.acquiredAt as string,
    expiresAt: o.expiresAt as string,
    lastHeartbeatAt: o.lastHeartbeatAt as string,
  };
}

export function parseCheckpoint(raw: unknown): TaskCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.at !== 'string' || !ISO_RE.test(o.at)) return null;
  if (typeof o.actor !== 'string' || !o.actor.trim()) return null;
  if (!LEASE_ROLES.includes(o.role as (typeof LEASE_ROLES)[number])) return null;
  if (!CHECKPOINT_OUTCOMES.includes(o.outcome as TaskCheckpoint['outcome'])) return null;
  if (!isStringArray(o.changedPaths)) return null;
  const ds = o.diffStat as Record<string, unknown> | undefined;
  if (!ds || typeof ds.files !== 'number' || typeof ds.insertions !== 'number' || typeof ds.deletions !== 'number') {
    return null;
  }
  const ev = o.evidence as Record<string, unknown> | undefined;
  if (!ev || !isStringArray(ev.tests) || !isStringArray(ev.commands) || typeof ev.notes !== 'string') {
    return null;
  }
  const commandResults = parseCommandResults(ev.commandResults);
  if (commandResults === null) return null;
  if (ev.candidateHeadSha !== undefined && (typeof ev.candidateHeadSha !== 'string' || !SHA_RE.test(ev.candidateHeadSha))) {
    return null;
  }
  if (ev.candidateTreeSha !== undefined && (typeof ev.candidateTreeSha !== 'string' || !SHA_RE.test(ev.candidateTreeSha))) {
    return null;
  }
  if (!isStringArray(o.blockers)) return null;
  if (!isStringArray(o.mutationsPerformed)) return null;
  if (!isStringArray(o.authorizationConsumed)) return null;
  if (typeof o.nextRequestedAction !== 'string') return null;

  return {
    id: o.id,
    at: o.at,
    actor: o.actor.trim(),
    role: o.role as TaskCheckpoint['role'],
    outcome: o.outcome as TaskCheckpoint['outcome'],
    changedPaths: o.changedPaths,
    diffStat: { files: ds.files, insertions: ds.insertions, deletions: ds.deletions },
    evidence: {
      tests: ev.tests,
      commands: ev.commands,
      commandResults,
      candidateHeadSha: ev.candidateHeadSha as string | undefined,
      candidateTreeSha: ev.candidateTreeSha as string | undefined,
      notes: ev.notes,
    },
    blockers: o.blockers,
    mutationsPerformed: o.mutationsPerformed as TaskCheckpoint['mutationsPerformed'],
    authorizationConsumed: o.authorizationConsumed,
    nextRequestedAction: o.nextRequestedAction,
  };
}

function parseAdminAuditEntry(raw: unknown): RegistryAdminAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.at !== 'string' || !ISO_RE.test(o.at)) return null;
  if (typeof o.actor !== 'string' || !o.actor.trim()) return null;
  if (o.action !== 'recover_stale_lock') return null;
  if (!AGENT_ROLES.includes(o.role as AgentRole)) return null;
  if (typeof o.evidenceRef !== 'string') return null;
  const metadata = o.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object') return null;
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v !== 'string') return null;
    meta[k] = v;
  }
  return {
    id: o.id,
    at: o.at,
    actor: o.actor.trim(),
    role: o.role as AgentRole,
    action: 'recover_stale_lock',
    evidenceRef: o.evidenceRef,
    metadata: meta,
  };
}

function parseAuditEntry(raw: unknown): TaskAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.at !== 'string' || !ISO_RE.test(o.at)) return null;
  if (typeof o.actor !== 'string' || !o.actor.trim()) return null;
  if (typeof o.action !== 'string' || typeof o.evidenceRef !== 'string') return null;
  if (!TASK_STATES.includes(o.fromState as TaskAuditEntry['fromState'])) return null;
  if (!TASK_STATES.includes(o.toState as TaskAuditEntry['toState'])) return null;
  const metadata = o.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== 'object') return null;
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (typeof v !== 'string') return null;
    meta[k] = v;
  }
  return {
    id: o.id,
    at: o.at,
    actor: o.actor.trim(),
    action: o.action as TaskAuditEntry['action'],
    fromState: o.fromState as TaskAuditEntry['fromState'],
    toState: o.toState as TaskAuditEntry['toState'],
    evidenceRef: o.evidenceRef,
    metadata: meta,
  };
}

/**
 * PHASE 3A.4 (B) — parse the typed candidate-evidence attestation.
 *
 * STRICT by construction: every field is required and SHA fields must match the same
 * `SHA_RE` the checkpoint fields use. `parseTaskRecord` rebuilds a TaskRecord field by
 * field, so an attestation that failed to parse would be silently DROPPED on the next
 * read/write cycle — the registry would quietly forget an administrator act. Returning
 * `undefined` (absent) vs `null` (present-but-invalid) keeps those cases distinguishable so
 * an invalid one fails the record instead of vanishing.
 */
function parseCandidateEvidenceAttestation(raw: unknown): CandidateEvidenceAttestation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  for (const k of ['candidateHeadSha', 'candidateTreeSha', 'baseSha'] as const) {
    if (typeof o[k] !== 'string' || !SHA_RE.test(o[k] as string)) return null;
  }
  for (const k of [
    'branch',
    'worktree',
    'builderCheckpointId',
    'verifierCheckpointId',
    'administrator',
    'reason',
  ] as const) {
    if (typeof o[k] !== 'string' || !(o[k] as string).trim()) return null;
  }
  if (typeof o.at !== 'string' || !ISO_RE.test(o.at)) return null;
  if (typeof o.registryRevision !== 'number' || !Number.isFinite(o.registryRevision) || o.registryRevision < 0) {
    return null;
  }
  return {
    candidateHeadSha: (o.candidateHeadSha as string).toLowerCase(),
    candidateTreeSha: (o.candidateTreeSha as string).toLowerCase(),
    baseSha: (o.baseSha as string).toLowerCase(),
    branch: (o.branch as string).trim(),
    worktree: (o.worktree as string).trim(),
    builderCheckpointId: (o.builderCheckpointId as string).trim(),
    verifierCheckpointId: (o.verifierCheckpointId as string).trim(),
    administrator: (o.administrator as string).trim(),
    reason: (o.reason as string).trim(),
    at: o.at as string,
    registryRevision: o.registryRevision as number,
  };
}

export function parseTaskRecord(raw: unknown): TaskRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !TASK_ID_RE.test(o.id)) return null;
  if (typeof o.title !== 'string' || !o.title.trim()) return null;
  if (!TASK_STATES.includes(o.state as TaskRecord['state'])) return null;
  if (typeof o.authorizedScope !== 'string') return null;
  if (!isStringArray(o.allowedPaths) || o.allowedPaths.length === 0) return null;
  if (!isStringArray(o.forbiddenPaths)) return null;
  if (!isStringArray(o.dependencies)) return null;
  if (o.assignedRole !== null && o.assignedRole !== undefined && !AGENT_ROLES.includes(o.assignedRole as AgentRole)) {
    return null;
  }
  if (o.branch !== null && typeof o.branch !== 'string') return null;
  if (o.worktree !== null && typeof o.worktree !== 'string') return null;
  if (typeof o.baseSha !== 'string' || !SHA_RE.test(o.baseSha)) return null;
  const lease = parseLease(o.lease);
  if (o.lease !== null && o.lease !== undefined && lease === null) return null;
  if (!isStringArray(o.verificationProfile)) return null;
  if (!o.verificationProfile.every((p) => VERIFICATION_PROFILES.includes(p as TaskRecord['verificationProfile'][number]))) {
    return null;
  }
  if (!Array.isArray(o.checkpoints)) return null;
  const checkpoints: TaskCheckpoint[] = [];
  for (const cp of o.checkpoints) {
    const parsed = parseCheckpoint(cp);
    if (!parsed) return null;
    checkpoints.push(parsed);
  }
  const auditLog: TaskAuditEntry[] = [];
  if (o.auditLog !== undefined) {
    if (!Array.isArray(o.auditLog)) return null;
    for (const entry of o.auditLog) {
      const parsed = parseAuditEntry(entry);
      if (!parsed) return null;
      auditLog.push(parsed);
    }
  }
  if (o.prRef !== null && o.prRef !== undefined && typeof o.prRef !== 'string') return null;
  if (o.mergeSha !== null && o.mergeSha !== undefined && typeof o.mergeSha !== 'string') return null;
  if (o.deploymentRef !== null && o.deploymentRef !== undefined && typeof o.deploymentRef !== 'string') return null;
  if (o.deploySha !== null && o.deploySha !== undefined && typeof o.deploySha !== 'string') return null;
  if (!isStringArray(o.allowedMutations)) return null;
  if (typeof o.approvalRequired !== 'string') return null;
  if (o.supersededByTaskId !== null && o.supersededByTaskId !== undefined) {
    if (typeof o.supersededByTaskId !== 'string' || !TASK_ID_RE.test(o.supersededByTaskId)) return null;
  }
  if (o.supersedesTaskId !== null && o.supersedesTaskId !== undefined) {
    if (typeof o.supersedesTaskId !== 'string' || !TASK_ID_RE.test(o.supersedesTaskId)) return null;
  }
  let candidateEvidenceAttestation: CandidateEvidenceAttestation | null = null;
  if (o.candidateEvidenceAttestation !== null && o.candidateEvidenceAttestation !== undefined) {
    candidateEvidenceAttestation = parseCandidateEvidenceAttestation(o.candidateEvidenceAttestation);
    // Present but invalid = a corrupt administrator act. Fail the record; never drop it.
    if (!candidateEvidenceAttestation) return null;
  }
  if (typeof o.createdAt !== 'string' || !ISO_RE.test(o.createdAt)) return null;
  if (typeof o.updatedAt !== 'string' || !ISO_RE.test(o.updatedAt)) return null;

  const priority = o.priority as TaskRecord['priority'];
  if (!['critical', 'high', 'normal', 'low'].includes(priority)) return null;

  return {
    id: o.id,
    title: o.title.trim(),
    priority,
    state: o.state as TaskRecord['state'],
    authorizedScope: o.authorizedScope,
    allowedPaths: o.allowedPaths,
    forbiddenPaths: o.forbiddenPaths,
    dependencies: o.dependencies,
    assignedRole: o.assignedRole as TaskRecord['assignedRole'],
    branch: o.branch as string | null,
    worktree: o.worktree as string | null,
    baseSha: o.baseSha.toLowerCase(),
    lease,
    verificationProfile: o.verificationProfile as TaskRecord['verificationProfile'],
    allowSameAgentVerification: o.allowSameAgentVerification === true,
    checkpoints,
    auditLog,
    prRef: (o.prRef ?? null) as string | null,
    mergeSha: (o.mergeSha ?? null) as string | null,
    deploymentRef: (o.deploymentRef ?? null) as string | null,
    deploySha: (o.deploySha ?? null) as string | null,
    allowedMutations: o.allowedMutations as TaskRecord['allowedMutations'],
    approvalRequired: o.approvalRequired as TaskRecord['approvalRequired'],
    supersededByTaskId: (o.supersededByTaskId ?? null) as string | null,
    supersedesTaskId: (o.supersedesTaskId ?? null) as string | null,
    candidateEvidenceAttestation,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export function parseRegistry(raw: unknown): AgentTaskRegistry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (typeof o.revision !== 'number' || o.revision < 0) return null;
  if (typeof o.updatedAt !== 'string' || !ISO_RE.test(o.updatedAt)) return null;
  if (!o.tasks || typeof o.tasks !== 'object') return null;

  const tasks: Record<string, TaskRecord> = {};
  for (const [key, val] of Object.entries(o.tasks as Record<string, unknown>)) {
    const task = parseTaskRecord(val);
    if (!task || task.id !== key) return null;
    tasks[key] = task;
  }

  const adminAuditLog: RegistryAdminAuditEntry[] = [];
  if (o.adminAuditLog !== undefined) {
    if (!Array.isArray(o.adminAuditLog)) return null;
    for (const entry of o.adminAuditLog) {
      const parsed = parseAdminAuditEntry(entry);
      if (!parsed) return null;
      adminAuditLog.push(parsed);
    }
  }

  return { version: 1, revision: o.revision, updatedAt: o.updatedAt, tasks, adminAuditLog };
}

export function assertRegistryInvariants(registry: AgentTaskRegistry): string | null {
  for (const task of Object.values(registry.tasks)) {
    if (task.lease && !['claimed', 'in_progress', 'verification', 'integration'].includes(task.state)) {
      return `${task.id}: lease present but state is ${task.state}`;
    }
    if (!task.lease && ['claimed', 'in_progress'].includes(task.state)) {
      return `${task.id}: active state ${task.state} without lease`;
    }
    for (const dep of task.dependencies) {
      if (!registry.tasks[dep]) return `${task.id}: unknown dependency ${dep}`;
    }

    // SUPERSESSION LINKAGE — a dangling or one-sided link is a corrupt chain. Both
    // halves are written in ONE atomic mutation, so anything asymmetric on disk means
    // a partial write or a hand edit, and must fail the registry rather than be walked.
    if (task.supersededByTaskId) {
      const successor = registry.tasks[task.supersededByTaskId];
      if (!successor) {
        return `${task.id}: supersededByTaskId ${task.supersededByTaskId} does not exist`;
      }
      if (successor.supersedesTaskId !== task.id) {
        return `${task.id}: supersession link not mutual with ${successor.id}`;
      }
      if (task.state !== 'cancelled') {
        return `${task.id}: superseded task must be cancelled, found ${task.state}`;
      }
    }
    if (task.supersedesTaskId) {
      const source = registry.tasks[task.supersedesTaskId];
      if (!source) {
        return `${task.id}: supersedesTaskId ${task.supersedesTaskId} does not exist`;
      }
      if (source.supersededByTaskId !== task.id) {
        return `${task.id}: supersession link not mutual with ${source.id}`;
      }
    }
    if (task.supersedesTaskId && task.supersedesTaskId === task.id) {
      return `${task.id}: task cannot supersede itself`;
    }
  }
  return null;
}

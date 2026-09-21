import type {
  AgentTaskRegistry,
  RegistryResult,
  TaskRecord,
} from './types';
import { isLeaseExpired } from './lease';
import { isTerminal } from './states';
import { normalizePath, pathsCollide } from './collisions';
import { isLeaseHolding } from './states';

/**
 * PHASE 3A.3 — TASK SUPERSESSION.
 *
 * `baseSha` is IMMUTABLE. It is the anchor every integration guarantee is measured
 * against: `detectStaleMain` compares it to origin/main, and
 * `resolveWorktreeArtifact` proves the candidate descends from it. Editing it in
 * place would silently re-point those proofs at a base the recorded evidence was
 * never produced against — the verified checkpoints would still LOOK valid while
 * describing work done somewhere else. That is the precise failure class this
 * registry exists to prevent, so there is deliberately no baseSha writer anywhere.
 *
 * When main moves past a task's base, the lifecycle-correct answer is therefore NOT
 * to mutate the task. It is to CLOSE it and open a successor anchored at current
 * main, preserving the original's evidence as history. That is supersession.
 *
 * ⚠️ Supersede is NOT reconcile-state. Reconcile REPAIRS a phase that was destroyed
 * by the old always-ready release, using evidence that is still valid against the
 * SAME base. Supersede retires evidence that can no longer be integrated because the
 * base itself is stale. Reconcile preserves the task; supersede replaces it.
 *
 * ⚠️ Old verification evidence is retained HISTORICALLY and is never reused. The
 * successor starts with zero checkpoints precisely so nobody can integrate on the
 * strength of a verification that ran against a different base.
 */

/** Fields the administrator supplies. Everything else is COPIED or reset — never widened. */
export type SupersedeInput = {
  taskId: string;
  newTaskId: string;
  branch: string;
  worktree: string;
  actor: string;
  role?: string;
  reason: string;
  confirm: boolean;
  /** Real current origin/main, resolved by the CLI from git. Never caller-fabricated in normal use. */
  currentMainSha: string;
  nowMs?: number;
};

export type SupersedeResult = {
  source: TaskRecord;
  successor: TaskRecord;
};

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const TASK_ID_RE = /^TASK-[A-Z0-9-]+$/;

function err<C extends string>(code: C, message: string): { ok: false; code: C; message: string } {
  return { ok: false, code, message };
}

/**
 * Scope carried from source to successor, VERBATIM. Listed explicitly rather than
 * spread, so adding a permission-bearing field to TaskRecord cannot silently start
 * flowing into successors — a new field must be considered and added here on purpose.
 */
export type CopiedScope = Pick<
  TaskRecord,
  | 'title'
  | 'authorizedScope'
  | 'priority'
  | 'dependencies'
  | 'allowedPaths'
  | 'forbiddenPaths'
  | 'verificationProfile'
  | 'allowSameAgentVerification'
  | 'allowedMutations'
  | 'approvalRequired'
>;

export function copyScope(source: TaskRecord): CopiedScope {
  return {
    title: source.title,
    authorizedScope: source.authorizedScope,
    priority: source.priority,
    // Cloned, not aliased — a shared array would let a later mutation of one task
    // silently edit the other's permissions.
    dependencies: [...source.dependencies],
    allowedPaths: [...source.allowedPaths],
    forbiddenPaths: [...source.forbiddenPaths],
    verificationProfile: [...source.verificationProfile],
    allowSameAgentVerification: source.allowSameAgentVerification,
    allowedMutations: [...source.allowedMutations],
    approvalRequired: source.approvalRequired,
  };
}

/**
 * Prove the successor's scope is not WIDER than the source's.
 *
 * Called after construction as a self-check rather than trusted from copyScope alone:
 * the whole security property of supersession is that an administrator who can name a
 * successor cannot use it to grant that successor more authority than the task it
 * replaces. Verifying the built object closes the gap between intent and result.
 */
export function assertScopeNotWidened(
  source: TaskRecord,
  successor: TaskRecord,
): RegistryResult<true> {
  const widerPaths = successor.allowedPaths.filter(
    (p) => !source.allowedPaths.some((sp) => normalizePath(sp) === normalizePath(p)),
  );
  if (widerPaths.length) {
    return err('forbidden_mutation', `successor widens allowedPaths: ${widerPaths.join(', ')}`);
  }
  // Forbidden paths may only be kept or ADDED (adding is a tightening, never a widening).
  const droppedForbidden = source.forbiddenPaths.filter(
    (p) => !successor.forbiddenPaths.some((sp) => normalizePath(sp) === normalizePath(p)),
  );
  if (droppedForbidden.length) {
    return err('forbidden_mutation', `successor drops forbiddenPaths: ${droppedForbidden.join(', ')}`);
  }
  const widerMutations = successor.allowedMutations.filter((m) => !source.allowedMutations.includes(m));
  if (widerMutations.length) {
    return err('forbidden_mutation', `successor widens allowedMutations: ${widerMutations.join(', ')}`);
  }
  const droppedProfiles = source.verificationProfile.filter(
    (p) => !successor.verificationProfile.includes(p),
  );
  if (droppedProfiles.length) {
    return err('forbidden_mutation', `successor drops verificationProfile: ${droppedProfiles.join(', ')}`);
  }
  if (successor.approvalRequired !== source.approvalRequired) {
    return err(
      'forbidden_mutation',
      `successor changes approvalRequired ${source.approvalRequired} -> ${successor.approvalRequired}`,
    );
  }
  if (successor.allowSameAgentVerification && !source.allowSameAgentVerification) {
    return err('forbidden_mutation', 'successor enables allowSameAgentVerification');
  }
  const droppedDeps = source.dependencies.filter((d) => !successor.dependencies.includes(d));
  if (droppedDeps.length) {
    // Dropping a dependency would let the successor run ahead of work the source was
    // required to wait for — a silent broadening of when it may execute.
    return err('dependency_unmet', `successor drops dependencies: ${droppedDeps.join(', ')}`);
  }
  return { ok: true, value: true };
}

/**
 * Path collisions for a PROPOSED successor.
 *
 * Differs from findPathCollisions in exactly one way: the source task is excluded,
 * because within a single atomic supersession the source is being cancelled in the
 * same write. Excluding it is safe ONLY because cancellation is part of the same
 * mutation — outside that atomic pair the source would still hold its paths.
 * Every OTHER active task is evaluated normally.
 */
export function findSuccessorCollisions(
  registry: AgentTaskRegistry,
  successorPaths: string[],
  excludeTaskId: string,
  successorId: string,
  nowMs: number,
): { otherTaskId: string; path: string; otherPath: string }[] {
  const hits: { otherTaskId: string; path: string; otherPath: string }[] = [];
  for (const other of Object.values(registry.tasks)) {
    if (other.id === excludeTaskId) continue; // being cancelled in this same write
    if (other.id === successorId) continue;
    if (!isLeaseHolding(other.state)) continue;
    if (other.lease && isLeaseExpired(other.lease, nowMs)) continue;
    for (const p of successorPaths) {
      for (const op of other.allowedPaths) {
        if (pathsCollide(p, op)) {
          hits.push({ otherTaskId: other.id, path: p, otherPath: op });
        }
      }
    }
  }
  return hits;
}

/** Reject a branch/worktree already assigned to any other live (non-terminal) task. */
export function findAssignmentConflicts(
  registry: AgentTaskRegistry,
  branch: string,
  worktree: string,
  excludeTaskId: string,
): { taskId: string; field: 'branch' | 'worktree'; value: string }[] {
  const hits: { taskId: string; field: 'branch' | 'worktree'; value: string }[] = [];
  const b = branch.trim();
  const w = normalizePath(worktree.trim());
  for (const other of Object.values(registry.tasks)) {
    if (other.id === excludeTaskId) continue;
    if (isTerminal(other.state)) continue;
    if (other.branch && other.branch.trim() === b) {
      hits.push({ taskId: other.id, field: 'branch', value: b });
    }
    if (other.worktree && normalizePath(other.worktree.trim()) === w) {
      hits.push({ taskId: other.id, field: 'worktree', value: w });
    }
  }
  return hits;
}

/** Validate supersession inputs that do not require registry state. */
export function validateSupersedeInput(input: SupersedeInput): RegistryResult<true> {
  if (input.role !== 'administrator') {
    return err('unauthorized_actor', 'administrator role required for supersede');
  }
  if (!input.confirm) {
    return err('unauthorized_actor', 'supersede requires --confirm');
  }
  if (!input.reason?.trim()) {
    return err('unauthorized_actor', 'supersede requires a non-empty --reason');
  }
  if (!input.actor?.trim()) {
    return err('unauthorized_actor', 'supersede requires --actor');
  }
  if (!TASK_ID_RE.test(input.newTaskId)) {
    return err('malformed_task', `successor id ${input.newTaskId} must match TASK-[A-Z0-9-]+`);
  }
  if (input.newTaskId === input.taskId) {
    return err('malformed_task', 'successor id must differ from the source task id');
  }
  if (!input.branch?.trim()) {
    return err('malformed_task', 'supersede requires --branch for the successor');
  }
  if (!input.worktree?.trim()) {
    return err('malformed_task', 'supersede requires --worktree for the successor');
  }
  if (!input.currentMainSha?.trim() || !SHA_RE.test(input.currentMainSha.trim())) {
    return err('stale_main', 'supersede requires a resolved current origin/main sha');
  }
  return { ok: true, value: true };
}

/**
 * Build the successor record. Pure — no registry mutation, so it can be unit-tested
 * and so the caller can validate the RESULT before committing to a write.
 *
 * Deliberately NOT carried over: checkpoints, lease, assignedRole, prior audit,
 * prRef/mergeSha/deploymentRef/deploySha (merge+deploy evidence belongs to the work
 * that actually merged), and any blocked/stale execution state. The successor's
 * state is always `ready` — never the source's state.
 */
export function buildSuccessor(opts: {
  source: TaskRecord;
  newTaskId: string;
  branch: string;
  worktree: string;
  baseSha: string;
  nowIso: string;
}): TaskRecord {
  const scope = copyScope(opts.source);
  return {
    id: opts.newTaskId,
    ...scope,
    state: 'ready',
    assignedRole: null,
    branch: opts.branch.trim(),
    worktree: opts.worktree.trim(),
    baseSha: opts.baseSha.toLowerCase(),
    lease: null,
    checkpoints: [],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    supersedesTaskId: opts.source.id,
    supersededByTaskId: null,
    createdAt: opts.nowIso,
    updatedAt: opts.nowIso,
  };
}

/** Walk a supersession chain forward from a task id. Traceability, per the contract. */
export function supersessionChain(registry: AgentTaskRegistry, startId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = startId;
  while (cur && registry.tasks[cur] && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = registry.tasks[cur].supersededByTaskId ?? null;
  }
  return chain;
}

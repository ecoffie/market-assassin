import type { AgentTaskRegistry, RegistryResult, TaskAuditEntry, TaskRecord } from './types';
import { isLeaseExpired } from './lease';

/**
 * PHASE 3A.5 (A) — SUPERSESSION-LINK REPAIR.
 *
 * ⚠️ WHAT IS ACTUALLY BROKEN. The live pilot registry records a supersession that really
 * happened: TASK-PSTACK-PILOT-001 carries a `supersede` audit naming -002, and -002
 * carries the mutually corroborating `superseded-from` audit naming -001. Both were
 * written in ONE atomic revision (11) by the same administrator at the same instant.
 * But the DURABLE fields — `supersededByTaskId` / `supersedesTaskId` — are null, because
 * the writer generation of the day recorded the relationship only in the audit trail.
 *
 * So the chain is provable but not traversable: `supersessionChain` walks the durable
 * fields and sees nothing, and `assertRegistryInvariants` cannot enforce a link it cannot
 * see. The history is intact; the index into it is missing.
 *
 * ⚠️ WHY THIS IS NOT A FIELD EDITOR. The obvious shape — `--field supersededByTaskId
 * --value TASK-...` — would be a general-purpose registry rewriter wearing a repair
 * costume. It would let an administrator ASSERT any lineage at all, which is precisely
 * the class of claim this registry exists to make impossible. A repair that can invent a
 * relationship is indistinguishable, on disk, from the corruption it claims to fix.
 *
 * THE CONTRACT INSTEAD: the caller supplies ONLY the source task id. Everything else —
 * the successor id above all — is DERIVED from the audit pair and cross-checked. There is
 * no flag that can name a successor, and no flag that can name a field or a value. The
 * command can therefore only ever re-materialize a relationship that two independent
 * audit records already agree on, or refuse.
 *
 * FAIL-CLOSED, in order: no evidence, ambiguous evidence, conflicting evidence, a
 * durable field that is already set, or an active lease on EITHER task, all refuse.
 */

const SUPERSEDE_ACTION = 'supersede';
const SUPERSEDED_FROM_ACTION = 'superseded-from';

function err<C extends string>(code: C, message: string): { ok: false; code: C; message: string } {
  return { ok: false, code, message };
}

/** Fields the administrator supplies. Deliberately minimal — see the header. */
export type RepairSupersessionLinkInput = {
  /** The SOURCE task. The successor is derived, never supplied. */
  taskId: string;
  actor: string;
  role?: string;
  reason: string;
  confirm: boolean;
  nowMs?: number;
};

/** What the audit pair proves, once it has been shown to be unambiguous and consistent. */
export type DerivedSupersessionEvidence = {
  sourceTaskId: string;
  successorTaskId: string;
  /** Registry revision both audits agree the supersession was written in. */
  registryRevision: string;
  /** Timestamp both audits agree on. */
  at: string;
  /** Actor both audits agree on. */
  actor: string;
  sourceAuditId: string;
  successorAuditId: string;
};

export type RepairSupersessionLinkResult = {
  source: TaskRecord;
  successor: TaskRecord;
  evidence: DerivedSupersessionEvidence;
};

export function validateRepairInput(
  input: RepairSupersessionLinkInput,
): RegistryResult<true> {
  // Same gate ordering and error code as every other administrator command, so an
  // operator sees one consistent failure vocabulary.
  if (input.role !== 'administrator') {
    return err('unauthorized_actor', 'administrator role required for repair-supersession-link');
  }
  if (!input.confirm) {
    return err('unauthorized_actor', 'repair-supersession-link requires --confirm');
  }
  if (!input.reason?.trim()) {
    return err('unauthorized_actor', 'repair-supersession-link requires a non-empty --reason');
  }
  if (!input.actor?.trim()) {
    return err('unauthorized_actor', 'repair-supersession-link requires --actor');
  }
  if (!input.taskId?.trim()) {
    return err('unauthorized_actor', 'repair-supersession-link requires a source task id');
  }
  return { ok: true, value: true };
}

/** Audits of one action on one task. Used to prove UNIQUENESS before trusting any of them. */
function auditsFor(task: TaskRecord, action: string): TaskAuditEntry[] {
  return task.auditLog.filter((a) => a.action === action);
}

/**
 * Derive the supersession relationship from audit metadata ALONE.
 *
 * Requires, and this is the whole security argument:
 *  1. exactly ONE `supersede` audit on the source (ambiguity is a refusal, not a "latest wins"),
 *  2. it names a successor that exists,
 *  3. exactly ONE `superseded-from` audit on that successor,
 *  4. the two agree on source id, successor id, registry revision, timestamp, and actor,
 *  5. the successor's corroborating `sourceTaskId` metadata agrees as well.
 *
 * Point 5 is not redundant with point 4. `supersedesTaskId` and `sourceTaskId` are written
 * as SEPARATE keys by the supersession writer, so requiring both to agree means a single
 * hand-edited key cannot manufacture a link — an attacker would have to forge a consistent
 * set across two records and two independent keys.
 */
export function deriveSupersessionEvidence(
  registry: AgentTaskRegistry,
  sourceTaskId: string,
): RegistryResult<DerivedSupersessionEvidence> {
  const source = registry.tasks[sourceTaskId];
  if (!source) return err('task_not_found', `unknown task ${sourceTaskId}`);

  const supersedeAudits = auditsFor(source, SUPERSEDE_ACTION);
  if (supersedeAudits.length === 0) {
    return err(
      'insufficient_repair_evidence',
      `${sourceTaskId}: no ${SUPERSEDE_ACTION} audit — there is no evidence this task was ever superseded`,
    );
  }
  if (supersedeAudits.length > 1) {
    return err(
      'insufficient_repair_evidence',
      `${sourceTaskId}: ${supersedeAudits.length} ${SUPERSEDE_ACTION} audits — ambiguous lineage, refusing to choose`,
    );
  }
  const sourceAudit = supersedeAudits[0];

  const successorTaskId = sourceAudit.metadata?.supersededByTaskId;
  if (!successorTaskId) {
    return err(
      'insufficient_repair_evidence',
      `${sourceTaskId}: ${SUPERSEDE_ACTION} audit carries no supersededByTaskId metadata`,
    );
  }
  if (successorTaskId === sourceTaskId) {
    return err(
      'insufficient_repair_evidence',
      `${sourceTaskId}: audit claims the task supersedes itself`,
    );
  }

  const successor = registry.tasks[successorTaskId];
  if (!successor) {
    return err(
      'insufficient_repair_evidence',
      `${sourceTaskId}: audit names successor ${successorTaskId}, which does not exist in this registry`,
    );
  }

  const fromAudits = auditsFor(successor, SUPERSEDED_FROM_ACTION);
  if (fromAudits.length === 0) {
    return err(
      'insufficient_repair_evidence',
      `${successorTaskId}: no ${SUPERSEDED_FROM_ACTION} audit — the successor does not corroborate the link`,
    );
  }
  if (fromAudits.length > 1) {
    return err(
      'insufficient_repair_evidence',
      `${successorTaskId}: ${fromAudits.length} ${SUPERSEDED_FROM_ACTION} audits — ambiguous lineage, refusing to choose`,
    );
  }
  const successorAudit = fromAudits[0];

  // Cross-checks. Each is a distinct way the two records could disagree; a mismatch in
  // ANY of them means the pair does not describe one atomic event.
  const claimedSource = successorAudit.metadata?.supersedesTaskId;
  if (claimedSource !== sourceTaskId) {
    return err(
      'insufficient_repair_evidence',
      `${successorTaskId}: supersedesTaskId ${String(claimedSource)} conflicts with source ${sourceTaskId}`,
    );
  }
  const corroboratingSource = successorAudit.metadata?.sourceTaskId;
  if (corroboratingSource !== sourceTaskId) {
    return err(
      'insufficient_repair_evidence',
      `${successorTaskId}: corroborating sourceTaskId ${String(corroboratingSource)} conflicts with source ${sourceTaskId}`,
    );
  }
  if (sourceAudit.metadata?.registryRevision !== successorAudit.metadata?.registryRevision) {
    return err(
      'insufficient_repair_evidence',
      `audit pair disagrees on registryRevision (${String(sourceAudit.metadata?.registryRevision)} vs ${String(successorAudit.metadata?.registryRevision)}) — not one atomic write`,
    );
  }
  if (sourceAudit.at !== successorAudit.at) {
    return err(
      'insufficient_repair_evidence',
      `audit pair disagrees on timestamp (${sourceAudit.at} vs ${successorAudit.at}) — not one atomic write`,
    );
  }
  if (sourceAudit.actor !== successorAudit.actor) {
    return err(
      'insufficient_repair_evidence',
      `audit pair disagrees on actor (${sourceAudit.actor} vs ${successorAudit.actor}) — not one atomic write`,
    );
  }

  const registryRevision = sourceAudit.metadata?.registryRevision;
  if (!registryRevision) {
    return err(
      'insufficient_repair_evidence',
      `${sourceTaskId}: audit pair carries no registryRevision metadata`,
    );
  }

  return {
    ok: true,
    value: {
      sourceTaskId,
      successorTaskId,
      registryRevision,
      at: sourceAudit.at,
      actor: sourceAudit.actor,
      sourceAuditId: sourceAudit.id,
      successorAuditId: successorAudit.id,
    },
  };
}

/**
 * Assert the durable fields are genuinely ABSENT and repair is therefore additive.
 *
 * A repeat repair fails closed as `already_repaired` rather than writing an audited
 * no-op: a no-op would advance the revision and append an audit entry describing a change
 * that did not happen, which is a small lie the registry would then carry forever.
 */
export function assertRepairable(
  source: TaskRecord,
  successor: TaskRecord,
): RegistryResult<true> {
  const sourceSet = source.supersededByTaskId != null;
  const successorSet = successor.supersedesTaskId != null;

  if (sourceSet && successorSet) {
    if (source.supersededByTaskId === successor.id && successor.supersedesTaskId === source.id) {
      return err(
        'already_repaired',
        `${source.id} -> ${successor.id} supersession link is already durable; nothing to repair`,
      );
    }
    return err(
      'insufficient_repair_evidence',
      `${source.id}: existing durable link (${String(source.supersededByTaskId)} / ${String(successor.supersedesTaskId)}) conflicts with the derived pair`,
    );
  }

  // A HALF-set link is corruption of a different shape. Repairing only the missing half
  // would silently endorse whichever half is present, and that half was never proven.
  if (sourceSet !== successorSet) {
    return err(
      'insufficient_repair_evidence',
      `${source.id}: supersession link is half-written (source=${String(source.supersededByTaskId)}, successor=${String(successor.supersedesTaskId)}) — refusing a partial repair`,
    );
  }

  return { ok: true, value: true };
}

/** Neither task may be under an ACTIVE lease — never race a live actor. */
export function assertNoActiveLease(
  source: TaskRecord,
  successor: TaskRecord,
  nowMs: number,
): RegistryResult<true> {
  for (const task of [source, successor]) {
    if (task.lease && !isLeaseExpired(task.lease, nowMs)) {
      return err(
        'lease_conflict',
        `${task.id} holds an active lease (${task.lease.owner}) — release or await expiry before repairing`,
      );
    }
  }
  return { ok: true, value: true };
}

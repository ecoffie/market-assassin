import type { TaskCheckpoint, TaskRecord } from './types';

/**
 * THE CANDIDATE-EVIDENCE CONTRACT — structured always, legacy only by administrator act.
 *
 * Phase 3A.2 introduced structured `candidateHeadSha` / `candidateTreeSha`. The REAL pilot
 * (TASK-PSTACK-PILOT-001) predates them: its candidate exists ONLY inside
 * `commandResults[].headSha`. Recovering it is legitimate; letting any record claim that
 * shape is not.
 *
 * ⚠️ A TIMESTAMP CUTOFF WAS TRIED AND REJECTED — it was not enforceable.
 * `appendCheckpoint` stamps only `actor`:
 *
 *     const cp = { ...validated.value, actor: input.actor };   // operations.ts
 *
 * `at` comes straight from the caller's checkpoint JSON and is never overwritten. Measured:
 * a checkpoint submitted with `at: '2026-08-30T22:48:00.000Z'` is stored verbatim. So any
 * agent could BACKDATE `at` before a cutoff and select the weaker contract at will — the
 * "boundary" would have been a suggestion enforced against the one party able to ignore it.
 *
 * Eligibility is therefore NOT derived from data the agent controls. Legacy recovery is an
 * ADMINISTRATOR ACT, recorded in the audit log:
 *
 *   normal path        -> structured candidateHeadSha + candidateTreeSha, always
 *   legacy recovery    -> administrator + --confirm + --reason + --legacy-evidence-recovery
 *
 * The checkpoint payload cannot set that flag, and nothing an agent writes can reach the
 * legacy branch. After a recovery is audited, later handoff/approve read the AUDIT ENTRY —
 * never a timestamp — so trust is established once, by a human, and then cited.
 */

export type EvidenceTier = 'structured' | 'legacy';

/** Audit action that records an administrator-authorised legacy recovery. */
export const LEGACY_RECOVERY_ACTION = 'reconcile-state';
/** Marker written into audit metadata; the ONLY durable proof a recovery was authorised. */
export const LEGACY_RECOVERY_MODE = 'legacy_evidence_recovery';

export function hasStructuredCandidate(cp: TaskCheckpoint): boolean {
  return (
    typeof cp.evidence.candidateHeadSha === 'string' &&
    cp.evidence.candidateHeadSha.length > 0 &&
    typeof cp.evidence.candidateTreeSha === 'string' &&
    cp.evidence.candidateTreeSha.length > 0
  );
}

/**
 * Has an administrator already authorised legacy recovery for this task?
 *
 * Reads the AUDIT LOG, which only registry operations write — an agent's checkpoint payload
 * cannot forge one. This is what lets integration handoff and approve honour a recovery
 * without re-deciding trust (and without ever consulting a timestamp again).
 */
export function hasAuditedLegacyRecovery(task: TaskRecord): boolean {
  return task.auditLog.some(
    (e) => e.action === LEGACY_RECOVERY_ACTION && e.metadata?.recoveryMode === LEGACY_RECOVERY_MODE,
  );
}

/**
 * Decide which contract a builder+verifier pair must satisfy.
 *
 * `legacy` is returned ONLY when the caller is an administrator explicitly requesting
 * recovery, or when a prior recovery is already audited. Mixed structured/unstructured
 * pairs stay on the strong contract so a partial write can never downgrade a task.
 */
export function resolveEvidenceTier(
  builderCp: TaskCheckpoint,
  verifierCp: TaskCheckpoint,
  opts: {
    /** Administrator explicitly passed --legacy-evidence-recovery on THIS call. */
    legacyRecoveryRequested?: boolean;
    /** A previous administrator recovery is recorded in the task's audit log. */
    auditedLegacyRecovery?: boolean;
  } = {},
): { tier: EvidenceTier; reason: string } {
  const bothStructured = hasStructuredCandidate(builderCp) && hasStructuredCandidate(verifierCp);
  if (bothStructured) {
    return { tier: 'structured', reason: 'both checkpoints carry structured candidate fields' };
  }

  const anyStructured = hasStructuredCandidate(builderCp) || hasStructuredCandidate(verifierCp);
  if (anyStructured) {
    // Half-migrated pair — hold to the strong contract rather than silently downgrade.
    return {
      tier: 'structured',
      reason: 'mixed structured/unstructured checkpoint pair — strong contract enforced',
    };
  }

  if (opts.legacyRecoveryRequested) {
    return {
      tier: 'legacy',
      reason: 'administrator-authorised legacy evidence recovery (--legacy-evidence-recovery)',
    };
  }
  if (opts.auditedLegacyRecovery) {
    return {
      tier: 'legacy',
      reason: 'previously audited administrator legacy evidence recovery',
    };
  }

  // No structured fields and no administrator authorisation → fail closed. A backdated
  // timestamp buys nothing here, which is the entire point.
  return {
    tier: 'structured',
    reason:
      'structured candidate evidence required — legacy recovery needs an administrator with --legacy-evidence-recovery',
  };
}

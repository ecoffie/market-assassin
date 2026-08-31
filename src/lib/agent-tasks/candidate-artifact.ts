import type { CommandEvidenceResult, RegistryResult, TaskCheckpoint, TaskRecord } from './types';
import type { WorktreeArtifact } from './git-evidence';
import { resolveEvidenceTier, hasAuditedLegacyRecovery, type EvidenceTier } from './candidate-evidence-contract';
import { attestationMatchesTask } from './attestation';

export type CandidateIdentity = {
  candidateHeadSha: string;
  candidateTreeSha: string | null;
  /** Which contract satisfied this identity — surfaced so the audit can say so explicitly. */
  evidenceTier: EvidenceTier;
  /** Human-readable basis, recorded on an administrator reconcile. */
  evidenceBasis: string;
  /** True when identity came from a Phase 3A.4 administrator attestation. */
  attested?: boolean;
};

function verificationErr(message: string): RegistryResult<never> {
  return { ok: false, code: 'verification_incomplete', message };
}

function normalizeSha(sha: string): string {
  return sha.trim().toLowerCase();
}

export function findBuilderReadyCheckpoint(task: TaskRecord): TaskCheckpoint | null {
  for (let i = task.checkpoints.length - 1; i >= 0; i--) {
    const cp = task.checkpoints[i];
    if (cp.role === 'builder' && cp.outcome === 'ready_for_verification') return cp;
  }
  return null;
}

export function latestVerifierCheckpoint(task: TaskRecord): TaskCheckpoint | null {
  for (let i = task.checkpoints.length - 1; i >= 0; i--) {
    const cp = task.checkpoints[i];
    if (cp.role === 'verifier' && cp.outcome === 'verified') return cp;
  }
  return null;
}

function structuredHead(cp: TaskCheckpoint): string | null {
  const h = cp.evidence.candidateHeadSha;
  return h && typeof h === 'string' ? normalizeSha(h) : null;
}

function structuredTree(cp: TaskCheckpoint): string | null {
  const t = cp.evidence.candidateTreeSha;
  return t && typeof t === 'string' ? normalizeSha(t) : null;
}

function headShasFromCommandResults(results: CommandEvidenceResult[] | undefined): string[] {
  if (!results?.length) return [];
  return results.filter((r) => r.headSha).map((r) => normalizeSha(r.headSha!));
}

/** Derive candidate HEAD/tree from builder + verifier checkpoints (structured fields + commandResults consensus). */
export function extractCandidateIdentity(
  task: TaskRecord,
  opts: {
    /**
     * Administrator explicitly requested legacy recovery on THIS call. NEVER derived from
     * the checkpoint payload — `at` is caller-controlled (appendCheckpoint stamps only
     * `actor`), so any agent could backdate its way into the weaker contract.
     */
    legacyRecoveryRequested?: boolean;
  } = {},
): RegistryResult<CandidateIdentity> {
  const builderCp = findBuilderReadyCheckpoint(task);
  const verifierCp = latestVerifierCheckpoint(task);

  /**
   * PHASE 3A.4 (B) — a typed administrator attestation supplies candidate identity for a
   * chain that predates the structured contract.
   *
   * ⚠️ IT IS NOT A BYPASS, and it is NOT the legacy tier. The caller
   * (`validateIntegrationGate`) still runs `validateCandidateArtifactConsistency` against
   * the LIVE worktree and still runs the stale-main check, so an attested candidate that
   * has since drifted, gone dirty, or been overtaken by main is REJECTED exactly like any
   * other. What the attestation removes is only the need to re-derive identity from prose
   * that was never machine-readable in the first place.
   *
   * It is honoured only while it still describes THIS task — `attestationMatchesTask`
   * re-checks base/branch/worktree, so a supersede or re-point invalidates it rather than
   * silently carrying an old approval onto new work.
   */
  const attestation = task.candidateEvidenceAttestation;
  if (attestation && attestationMatchesTask(task)) {
    if (!builderCp || !verifierCp) {
      return verificationErr('attested task is missing its builder/verifier checkpoint chain');
    }
    if (builderCp.actor === verifierCp.actor && !task.allowSameAgentVerification) {
      return {
        ok: false,
        code: 'self_verification_forbidden',
        message: `verifier ${verifierCp.actor} is the same actor as the builder`,
      };
    }
    return {
      ok: true,
      value: {
        candidateHeadSha: attestation.candidateHeadSha,
        candidateTreeSha: attestation.candidateTreeSha,
        evidenceTier: 'structured',
        evidenceBasis: `administrator attestation by ${attestation.administrator} at ${attestation.at} (${attestation.builderCheckpointId} + ${attestation.verifierCheckpointId})`,
        attested: true,
      },
    };
  }

  if (!builderCp) {
    return verificationErr('no builder checkpoint with outcome ready_for_verification');
  }
  if (!verifierCp) {
    return verificationErr('no verifier checkpoint with outcome verified');
  }

  // ORDERING + DISTINCT ACTORS are preconditions for BOTH tiers. A verified checkpoint that
  // precedes its handoff, or one signed by the builder, is not evidence of anything.
  const bIdx = task.checkpoints.indexOf(builderCp);
  const vIdx = task.checkpoints.indexOf(verifierCp);
  if (vIdx < bIdx) {
    return verificationErr('verified checkpoint precedes ready_for_verification — chain out of order');
  }
  if (builderCp.actor === verifierCp.actor && !task.allowSameAgentVerification) {
    return {
      ok: false,
      code: 'self_verification_forbidden',
      message: `verifier ${verifierCp.actor} is the same actor as the builder`,
    };
  }

  const { tier, reason } = resolveEvidenceTier(builderCp, verifierCp, {
    legacyRecoveryRequested: opts.legacyRecoveryRequested,
    auditedLegacyRecovery: hasAuditedLegacyRecovery(task),
  });

  // ── STRUCTURED CONTRACT (default, and mandatory for anything post-cutoff) ──────────────
  if (tier === 'structured') {
    const bHead = structuredHead(builderCp);
    const vHead = structuredHead(verifierCp);
    const bTree = structuredTree(builderCp);
    const vTree = structuredTree(verifierCp);

    if (!bHead || !bTree || !vHead || !vTree) {
      return verificationErr(
        `structured candidate evidence required (${reason}) — builder and verifier must both carry candidateHeadSha + candidateTreeSha`,
      );
    }
    if (bHead !== vHead) {
      return verificationErr(
        `builder/verifier candidateHeadSha mismatch: ${bHead.slice(0, 12)} vs ${vHead.slice(0, 12)}`,
      );
    }
    if (bTree !== vTree) {
      return verificationErr(
        `builder/verifier candidateTreeSha mismatch: ${bTree.slice(0, 12)} vs ${vTree.slice(0, 12)}`,
      );
    }
    // Command results must agree with the declared candidate — a structured field that
    // disagrees with the commands actually run is worse than no field at all.
    const crHeads = [
      ...headShasFromCommandResults(builderCp.evidence.commandResults),
      ...headShasFromCommandResults(verifierCp.evidence.commandResults),
    ];
    const disagreeing = [...new Set(crHeads)].filter((h) => h !== bHead);
    if (disagreeing.length > 0) {
      return verificationErr(
        `commandResults head(s) ${disagreeing.map((h) => h.slice(0, 12)).join(', ')} disagree with candidateHeadSha ${bHead.slice(0, 12)}`,
      );
    }
    return {
      ok: true,
      value: { candidateHeadSha: bHead, candidateTreeSha: bTree, evidenceTier: 'structured', evidenceBasis: reason },
    };
  }

  // ── LEGACY RECOVERY (bounded: pre-cutoff records only) ────────────────────────────────
  // Identity comes ONLY from a UNANIMOUS head across every command result on both
  // checkpoints. There is no tree to recover, so the caller MUST reconcile against a live
  // clean worktree (validateCandidateArtifactConsistency with requireWorktree) — legacy
  // evidence alone is never sufficient to approve.
  const legacyHeads = [
    ...headShasFromCommandResults(builderCp.evidence.commandResults),
    ...headShasFromCommandResults(verifierCp.evidence.commandResults),
  ];
  if (legacyHeads.length === 0) {
    return verificationErr('legacy evidence recovery requires commandResults headSha — none present');
  }
  const uniqueLegacy = [...new Set(legacyHeads)];
  if (uniqueLegacy.length > 1) {
    return verificationErr(
      `legacy evidence recovery requires ONE unanimous candidate head; found ${uniqueLegacy.map((h) => h.slice(0, 12)).join(', ')}`,
    );
  }
  // Every BLOCKING result must carry a head — a missing one means we cannot prove what ran.
  const missing = [
    ...(builderCp.evidence.commandResults ?? []),
    ...(verifierCp.evidence.commandResults ?? []),
  ].filter((r) => !r.headSha);
  if (missing.length > 0) {
    return verificationErr(
      `legacy evidence recovery: ${missing.length} command result(s) missing headSha — cannot establish candidate`,
    );
  }

  return {
    ok: true,
    value: {
      candidateHeadSha: uniqueLegacy[0],
      candidateTreeSha: null, // recovered from the live worktree, never invented
      evidenceTier: 'legacy',
      evidenceBasis: `legacy evidence recovery (${reason}) — unanimous commandResults head ${uniqueLegacy[0].slice(0, 12)}`,
    },
  };
}

/** Reconcile checkpoint-derived identity with live worktree artifact (handoff / approve). */
export function validateCandidateArtifactConsistency(opts: {
  task: TaskRecord;
  identity: CandidateIdentity;
  worktree: WorktreeArtifact | null;
  requireWorktree: boolean;
}): RegistryResult<CandidateIdentity> {
  const { task, worktree, requireWorktree } = opts;
  let resolvedIdentity = opts.identity;

  if (!task.branch?.trim()) {
    return { ok: false, code: 'candidate_integrity', message: 'task.branch is required for integration' };
  }
  if (!task.worktree?.trim()) {
    return { ok: false, code: 'candidate_integrity', message: 'task.worktree is required for integration' };
  }

  if (requireWorktree && !worktree) {
    return {
      ok: false,
      code: 'candidate_integrity',
      message: 'worktree artifact required — assign worktree or supply --no-git candidate overrides',
    };
  }

  // LEGACY evidence carries no candidateTreeSha, so the live worktree is the ONLY thing that
  // can establish the tree. Without it a legacy identity is a head with nothing behind it.
  if (opts.identity.evidenceTier === 'legacy' && !worktree) {
    return {
      ok: false,
      code: 'candidate_integrity',
      message:
        'legacy evidence recovery requires a live clean worktree to establish the candidate tree — --no-git cannot substitute',
    };
  }

  if (worktree) {
    if (worktree.branch !== task.branch) {
      return {
        ok: false,
        code: 'candidate_integrity',
        message: `worktree branch ${worktree.branch} !== task.branch ${task.branch}`,
      };
    }
    if (!worktree.clean) {
      return {
        ok: false,
        code: 'candidate_integrity',
        message: 'assigned worktree is not clean — commit or discard changes before integration',
      };
    }
    if (!worktree.isDescendantOfBase) {
      return {
        ok: false,
        code: 'candidate_integrity',
        message: `candidate HEAD is not a descendant of base ${task.baseSha.slice(0, 12)}`,
      };
    }
    if (worktree.headSha !== resolvedIdentity.candidateHeadSha) {
      return {
        ok: false,
        code: 'candidate_integrity',
        message: `worktree HEAD ${worktree.headSha.slice(0, 12)} !== verified candidate ${resolvedIdentity.candidateHeadSha.slice(0, 12)}`,
      };
    }
    if (resolvedIdentity.candidateTreeSha && worktree.treeSha !== resolvedIdentity.candidateTreeSha) {
      return {
        ok: false,
        code: 'candidate_integrity',
        message: `worktree tree ${worktree.treeSha.slice(0, 12)} !== candidateTreeSha ${resolvedIdentity.candidateTreeSha.slice(0, 12)}`,
      };
    }
    if (!resolvedIdentity.candidateTreeSha) {
      resolvedIdentity = { ...resolvedIdentity, candidateTreeSha: worktree.treeSha };
    }
  }

  return { ok: true, value: resolvedIdentity };
}

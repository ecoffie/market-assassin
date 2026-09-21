import { findBuilderReadyCheckpoint, latestVerifierCheckpoint } from './candidate-artifact';
import { hasStructuredCandidate } from './candidate-evidence-contract';
import { requiredCommandsForProfiles } from './verification-profiles';
import type {
  CandidateEvidenceAttestation,
  CommandEvidenceResult,
  RegistryResult,
  TaskCheckpoint,
  TaskRecord,
} from './types';
import type { WorktreeArtifact } from './git-evidence';

/**
 * PHASE 3A.4 (B) — ADMINISTRATOR CANDIDATE-EVIDENCE ATTESTATION (pure derivation).
 *
 * ⚠️ WHAT THIS IS NOT. It is NOT legacy recovery (that path exists separately, is flagged
 * `--legacy-evidence-recovery`, and answers "this record predates the contract"). It is NOT
 * a checkpoint rewrite: the checkpoints stay BYTE-IDENTICAL, which is the whole point — a
 * checkpoint is a statement signed by the actor who made it, and an administrator silently
 * editing one would destroy the only property that makes the chain evidence at all. And it
 * is NOT an override: there is deliberately no `--candidate-head` / `--candidate-tree`
 * flag, no `--no-git` path, and no way for the caller to name the SHAs. If the caller could
 * supply the identity, the attestation would attest to nothing but the caller's typing.
 *
 * WHAT IT IS: an administrator DERIVES the candidate from evidence that already exists —
 * unanimous `commandResults[].headSha` consensus across the Builder and Verifier
 * checkpoints — and reconciles it against LIVE GIT (correct branch, clean worktree, HEAD
 * equal to the consensus, tree read from that HEAD, descendant of the task base, base equal
 * to current origin/main). The result is stored BESIDE the checkpoints as a typed record
 * and recorded in the audit log.
 *
 * The consensus and the live worktree must AGREE. Either alone is insufficient: consensus
 * alone is a claim about a commit nobody re-checked, and a worktree alone proves only where
 * a directory happens to point right now.
 */

export type AttestationDerivation = {
  candidateHeadSha: string;
  candidateTreeSha: string;
  builderCheckpointId: string;
  verifierCheckpointId: string;
  /** Human-readable basis, recorded in the audit entry. */
  basis: string;
};

function attestErr(
  code: 'verification_incomplete' | 'candidate_integrity' | 'self_verification_forbidden' | 'attestation_conflict',
  message: string,
): RegistryResult<never> {
  return { ok: false, code, message };
}

function norm(sha: string | undefined | null): string {
  return (sha ?? '').trim().toLowerCase();
}

function headsOf(results: CommandEvidenceResult[] | undefined): string[] {
  return (results ?? []).filter((r) => r.headSha).map((r) => norm(r.headSha));
}

/**
 * Derive candidate identity from the checkpoint chain ALONE (no Git yet).
 *
 * Requires: a Builder ready_for_verification checkpoint, a later Verifier verified
 * checkpoint, DISTINCT actors, structured evidence genuinely ABSENT on both (otherwise
 * nothing needs attesting), required commands PASSED and POSTDATING their checkpoints, and
 * a single unanimous head across every command result on both checkpoints with none
 * missing a head.
 */
export function deriveAttestationFromCheckpoints(task: TaskRecord): RegistryResult<AttestationDerivation> {
  const builderCp = findBuilderReadyCheckpoint(task);
  const verifierCp = latestVerifierCheckpoint(task);

  if (!builderCp) {
    return attestErr('verification_incomplete', 'no builder checkpoint with outcome ready_for_verification');
  }
  if (!verifierCp) {
    return attestErr('verification_incomplete', 'no verifier checkpoint with outcome verified');
  }

  // ORDERING — a "verified" that precedes the handoff it claims to verify is not evidence.
  const bIdx = task.checkpoints.indexOf(builderCp);
  const vIdx = task.checkpoints.indexOf(verifierCp);
  if (vIdx < bIdx) {
    return attestErr(
      'verification_incomplete',
      'verified checkpoint precedes ready_for_verification — chain out of order',
    );
  }

  // DISTINCT ACTORS — self-verification cannot be laundered through an administrator.
  if (builderCp.actor === verifierCp.actor && !task.allowSameAgentVerification) {
    return attestErr(
      'self_verification_forbidden',
      `verifier ${verifierCp.actor} is the same actor as the builder — attestation cannot repair self-verification`,
    );
  }

  // STRUCTURED EVIDENCE MUST BE ABSENT. If either checkpoint already carries it there is
  // nothing to attest, and attesting anyway would let an administrator introduce a SECOND,
  // possibly conflicting, identity beside one the agents already signed.
  if (hasStructuredCandidate(builderCp) || hasStructuredCandidate(verifierCp)) {
    return attestErr(
      'attestation_conflict',
      'structured candidate evidence already present on the checkpoint chain — nothing to attest',
    );
  }

  // REQUIRED COMMANDS: present, passed, headed, and POSTDATING their own checkpoint. A
  // result that predates the checkpoint it is filed under describes an earlier artifact.
  const specs = requiredCommandsForProfiles(task.verificationProfile).filter((s) => s.required);
  for (const [label, cp] of [
    ['builder', builderCp],
    ['verifier', verifierCp],
  ] as const) {
    const results = cp.evidence.commandResults ?? [];
    const cpAt = Date.parse(cp.at);
    for (const spec of specs) {
      const match = results.find((r) => r.command === spec.command);
      if (!match) {
        return attestErr(
          'verification_incomplete',
          `${label} checkpoint ${cp.id} missing required command result: ${spec.command}`,
        );
      }
      if (match.status !== 'passed') {
        return attestErr(
          'verification_incomplete',
          `${label} checkpoint ${cp.id} command ${spec.command} is ${match.status}, expected passed`,
        );
      }
      if (!match.headSha) {
        return attestErr(
          'verification_incomplete',
          `${label} checkpoint ${cp.id} command ${spec.command} missing headSha`,
        );
      }
      const ranAt = Date.parse(match.ranAt);
      if (Number.isFinite(ranAt) && Number.isFinite(cpAt) && ranAt > cpAt) {
        return attestErr(
          'verification_incomplete',
          `${label} checkpoint ${cp.id} command ${spec.command} ran AFTER the checkpoint it is filed under`,
        );
      }
    }
  }

  // The verifier's evidence must postdate the builder handoff — otherwise the verifier is
  // citing work done before the candidate it claims to have verified even existed.
  const builderAt = Date.parse(builderCp.at);
  for (const r of verifierCp.evidence.commandResults ?? []) {
    const ranAt = Date.parse(r.ranAt);
    if (Number.isFinite(ranAt) && Number.isFinite(builderAt) && ranAt < builderAt) {
      return attestErr(
        'verification_incomplete',
        `verifier command ${r.command} ran before the builder handoff checkpoint ${builderCp.id}`,
      );
    }
  }

  // UNANIMOUS CONSENSUS — one head across BOTH checkpoints, and none missing.
  const allResults = [...(builderCp.evidence.commandResults ?? []), ...(verifierCp.evidence.commandResults ?? [])];
  if (allResults.length === 0) {
    return attestErr('verification_incomplete', 'no commandResults on the checkpoint chain — nothing to derive from');
  }
  const missing = allResults.filter((r) => !r.headSha);
  if (missing.length > 0) {
    return attestErr(
      'verification_incomplete',
      `${missing.length} command result(s) missing headSha — candidate consensus cannot be established`,
    );
  }
  const unique = [...new Set(headsOf(allResults))];
  if (unique.length > 1) {
    return attestErr(
      'verification_incomplete',
      `command results disagree on candidate head: ${unique.map((h) => h.slice(0, 12)).join(', ')}`,
    );
  }

  return {
    ok: true,
    value: {
      candidateHeadSha: unique[0],
      // Tree is NOT derivable from checkpoints — only live Git can supply it. Filled by
      // reconcileAttestationWithGit; deliberately empty here so a caller cannot skip Git.
      candidateTreeSha: '',
      builderCheckpointId: builderCp.id,
      verifierCheckpointId: verifierCp.id,
      basis: `unanimous commandResults head ${unique[0].slice(0, 12)} across ${builderCp.id} + ${verifierCp.id}`,
    },
  };
}

/**
 * Reconcile a checkpoint-derived candidate against the LIVE worktree.
 *
 * The worktree artifact has already asserted branch match, cleanliness, and base ancestry
 * (`resolveWorktreeArtifact` fails closed on each). What remains, and what only this step
 * can do, is bind the DERIVED head to the REAL head, and take the tree from Git rather than
 * from anything a caller could type.
 */
export function reconcileAttestationWithGit(opts: {
  task: TaskRecord;
  derivation: AttestationDerivation;
  worktree: WorktreeArtifact | null;
}): RegistryResult<AttestationDerivation> {
  const { task, derivation, worktree } = opts;

  if (!task.branch?.trim()) {
    return attestErr('candidate_integrity', 'task.branch is required for attestation');
  }
  if (!task.worktree?.trim()) {
    return attestErr('candidate_integrity', 'task.worktree is required for attestation');
  }
  if (!worktree) {
    return attestErr(
      'candidate_integrity',
      'attestation requires a live worktree — there is no --no-git path and no SHA override',
    );
  }
  if (worktree.branch !== task.branch) {
    return attestErr('candidate_integrity', `worktree branch ${worktree.branch} !== task.branch ${task.branch}`);
  }
  if (!worktree.clean) {
    return attestErr('candidate_integrity', 'worktree is not clean — attestation requires a clean candidate');
  }
  if (!worktree.isDescendantOfBase) {
    return attestErr(
      'candidate_integrity',
      `candidate HEAD is not a descendant of base ${task.baseSha.slice(0, 12)}`,
    );
  }
  if (norm(worktree.headSha) !== norm(derivation.candidateHeadSha)) {
    return attestErr(
      'candidate_integrity',
      `live worktree HEAD ${worktree.headSha.slice(0, 12)} !== command consensus ${derivation.candidateHeadSha.slice(0, 12)}`,
    );
  }
  if (!worktree.treeSha) {
    return attestErr('candidate_integrity', 'worktree did not yield a tree SHA');
  }

  return {
    ok: true,
    value: {
      ...derivation,
      candidateHeadSha: norm(worktree.headSha),
      // TREE COMES FROM GIT — never from the caller, never inferred.
      candidateTreeSha: norm(worktree.treeSha),
      basis: `${derivation.basis}; reconciled with live worktree ${task.worktree}`,
    },
  };
}

/** Build the immutable record written onto the task. */
export function buildAttestation(opts: {
  task: TaskRecord;
  derivation: AttestationDerivation;
  administrator: string;
  reason: string;
  at: string;
  registryRevision: number;
}): CandidateEvidenceAttestation {
  return {
    candidateHeadSha: opts.derivation.candidateHeadSha,
    candidateTreeSha: opts.derivation.candidateTreeSha,
    baseSha: opts.task.baseSha.toLowerCase(),
    branch: opts.task.branch!.trim(),
    worktree: opts.task.worktree!.trim(),
    builderCheckpointId: opts.derivation.builderCheckpointId,
    verifierCheckpointId: opts.derivation.verifierCheckpointId,
    administrator: opts.administrator,
    reason: opts.reason,
    at: opts.at,
    registryRevision: opts.registryRevision,
  };
}

/**
 * Read an attestation as candidate identity, but ONLY when it still describes THIS task.
 *
 * An attestation is a statement about a specific base/branch/worktree. If any of those have
 * since changed the attestation is stale and must not be honoured — otherwise a supersede
 * or re-point could silently carry an old approval onto new work.
 */
export function attestationMatchesTask(task: TaskRecord): boolean {
  const a = task.candidateEvidenceAttestation;
  if (!a) return false;
  return (
    a.baseSha === task.baseSha.toLowerCase() &&
    a.branch === (task.branch ?? '').trim() &&
    a.worktree === (task.worktree ?? '').trim()
  );
}

/** Checkpoint pair an attestation cites — used to prove they were left byte-identical. */
export function attestedCheckpoints(task: TaskRecord): { builder: TaskCheckpoint | null; verifier: TaskCheckpoint | null } {
  const a = task.candidateEvidenceAttestation;
  if (!a) return { builder: null, verifier: null };
  return {
    builder: task.checkpoints.find((c) => c.id === a.builderCheckpointId) ?? null,
    verifier: task.checkpoints.find((c) => c.id === a.verifierCheckpointId) ?? null,
  };
}

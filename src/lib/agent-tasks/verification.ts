import type { CommandEvidenceResult, TaskCheckpoint, TaskRecord } from './types';
import type { AgentTaskRegistry, RegistryResult } from './types';
import { requiredCommandsForProfiles } from './verification-profiles';
import { findPathCollisions } from './collisions';
import { evaluateDependencies } from './dependencies';
import { detectStaleMain } from './stale-main';
import { assertLeaseOwner } from './lease';
import type { WorktreeArtifact } from './git-evidence';
import {
  extractCandidateIdentity,
  findBuilderReadyCheckpoint,
  latestVerifierCheckpoint,
  validateCandidateArtifactConsistency,
} from './candidate-artifact';

function verificationErr(message: string): RegistryResult<CommandEvidenceResult[]> {
  return { ok: false, code: 'verification_incomplete', message };
}

export { latestVerifierCheckpoint, findBuilderReadyCheckpoint };

export function findBuilderForVerification(task: TaskRecord): string | null {
  const cp = findBuilderReadyCheckpoint(task);
  return cp?.actor ?? null;
}

export function validateVerificationEvidence(opts: {
  task: TaskRecord;
  candidateHeadSha: string;
  requireVerifiedCheckpoint?: boolean;
}): RegistryResult<CommandEvidenceResult[]> {
  const { task, candidateHeadSha, requireVerifiedCheckpoint = true } = opts;
  const specs = requiredCommandsForProfiles(task.verificationProfile);
  const verifiedCp = latestVerifierCheckpoint(task);

  if (requireVerifiedCheckpoint && !verifiedCp) {
    return verificationErr('no verifier checkpoint with outcome verified');
  }

  const sourceCp = verifiedCp ?? task.checkpoints[task.checkpoints.length - 1];
  if (!sourceCp) {
    if (specs.some((s) => s.required)) {
      return verificationErr('no checkpoint evidence on task');
    }
    return { ok: true, value: [] };
  }

  const results = sourceCp.evidence.commandResults ?? [];
  const checkpointAt = Date.parse(sourceCp.at);
  const expectedHead = candidateHeadSha.toLowerCase();

  for (const spec of specs) {
    if (!spec.required) continue;
    const match = results.find((r) => r.command === spec.command);
    if (!match) {
      return verificationErr(`missing required command result: ${spec.command}`);
    }
    if (match.status === 'failed') {
      return verificationErr(`command failed: ${spec.command}`);
    }
    if (spec.blocking && match.status === 'warn') {
      return verificationErr(`warn-only result cannot satisfy blocking command: ${spec.command}`);
    }
    if (match.status === 'skipped' && spec.blocking) {
      return verificationErr(`required command skipped: ${spec.command}`);
    }
    if (match.headSha && match.headSha.toLowerCase() !== expectedHead) {
      return verificationErr(
        `command ${spec.command} ran at candidate head ${match.headSha.slice(0, 12)} but verified candidate is ${expectedHead.slice(0, 12)}`,
      );
    }
    if (!match.headSha) {
      return verificationErr(`command ${spec.command} missing headSha — must reference candidate commit`);
    }
    const ranAt = Date.parse(match.ranAt);
    if (Number.isFinite(ranAt) && Number.isFinite(checkpointAt) && ranAt < checkpointAt) {
      return verificationErr(
        `command ${spec.command} result predates latest verifier checkpoint`,
      );
    }
  }

  const allHeads = results.filter((r) => r.headSha).map((r) => r.headSha!.toLowerCase());
  const uniqueHeads = [...new Set(allHeads)];
  if (uniqueHeads.length > 1) {
    return verificationErr(
      `mixed commandResults headSha values: ${uniqueHeads.map((h) => h.slice(0, 12)).join(', ')}`,
    );
  }

  return { ok: true, value: results };
}

export function assertRoleForState(role: TaskRecord['assignedRole'], state: TaskRecord['state']): boolean {
  if (!role) return false;
  if (state === 'claimed' || state === 'in_progress') return role === 'builder';
  if (state === 'verification') return role === 'verifier';
  if (state === 'integration') return role === 'integrator';
  return false;
}

function gateErr(
  code: 'lease_not_owner' | 'role_forbidden' | 'invalid_transition' | 'dependency_unmet' | 'stale_main' | 'path_collision' | 'verification_incomplete' | 'candidate_integrity',
  message: string,
): RegistryResult<CommandEvidenceResult[]> {
  return { ok: false, code, message };
}

/** Shared integration/approve gate — must pass under mutation lock at approve time. */
export function validateIntegrationGate(
  reg: AgentTaskRegistry,
  task: TaskRecord,
  opts: {
    actor: string;
    role: 'integrator' | 'administrator';
    /** Current origin/main — used only for stale-main detection, never as candidate substitute. */
    currentMainSha?: string;
    mainAheadCount?: number | null;
    nowMs: number;
    requireIntegratorLease: boolean;
    integratorActor?: string;
    worktreeArtifact?: WorktreeArtifact | null;
    /** When true, skip live worktree resolution (unit tests with injected artifact). */
    skipWorktreeCheck?: boolean;
  },
): RegistryResult<CommandEvidenceResult[]> {
  if (task.state !== 'integration') {
    return gateErr('invalid_transition', `task ${task.id} is ${task.state}, expected integration`);
  }

  if (opts.requireIntegratorLease) {
    if (!task.lease) {
      return gateErr('lease_not_owner', 'integration gate requires active integrator lease');
    }
    if (task.lease.role !== 'integrator') {
      return gateErr('role_forbidden', 'integration gate requires integrator lease role');
    }
    if (opts.integratorActor && !assertLeaseOwner(task.lease, opts.integratorActor)) {
      return gateErr('lease_not_owner', 'integration gate requires active lease owned by actor');
    }
  }

  const deps = evaluateDependencies(reg, task);
  if (!deps.ok) {
    return gateErr('dependency_unmet', `dependencies not complete: ${deps.unmet.map((d) => d.id).join(', ')}`);
  }

  if (opts.currentMainSha) {
    const count = opts.mainAheadCount ?? null;
    if (count === null) {
      return gateErr('stale_main', 'mainAheadCount unknown — run git fetch && rev-list before approve/integration');
    }
    const stale = detectStaleMain({
      taskBaseSha: task.baseSha,
      originMainSha: opts.currentMainSha,
      mainAheadCount: count,
    });
    if (stale.stale) {
      return gateErr(
        'stale_main',
        `integration blocked: origin/main is ${stale.mainAheadCount} commit(s) ahead of base`,
      );
    }
  }

  const identity = extractCandidateIdentity(task);
  if (!identity.ok) return identity;

  const artifactCheck = validateCandidateArtifactConsistency({
    task,
    identity: identity.value,
    worktree: opts.worktreeArtifact ?? null,
    requireWorktree: !opts.skipWorktreeCheck,
  });
  if (!artifactCheck.ok) return artifactCheck;

  const evidence = validateVerificationEvidence({
    task,
    candidateHeadSha: artifactCheck.value.candidateHeadSha,
    requireVerifiedCheckpoint: true,
  });
  if (!evidence.ok) return evidence;

  const collisions = findPathCollisions(task, Object.values(reg.tasks), opts.nowMs);
  if (collisions.length) {
    const c = collisions[0];
    return gateErr('path_collision', `${c.path} overlaps ${c.otherTaskId} (${c.otherPath})`);
  }

  return evidence;
}

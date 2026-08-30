import type { CommandEvidenceResult, TaskCheckpoint, TaskRecord } from './types';
import type { AgentTaskRegistry, RegistryResult } from './types';
import { requiredCommandsForProfiles } from './verification-profiles';
import { findPathCollisions } from './collisions';
import { evaluateDependencies } from './dependencies';
import { detectStaleMain } from './stale-main';
import { assertLeaseOwner } from './lease';

function verificationErr(message: string): RegistryResult<CommandEvidenceResult[]> {
  return { ok: false, code: 'verification_incomplete', message };
}

export function latestVerifierCheckpoint(task: TaskRecord): TaskCheckpoint | null {
  for (let i = task.checkpoints.length - 1; i >= 0; i--) {
    const cp = task.checkpoints[i];
    if (cp.role === 'verifier' && cp.outcome === 'verified') return cp;
  }
  return null;
}

export function validateVerificationEvidence(opts: {
  task: TaskRecord;
  originMainSha?: string;
  requireVerifiedCheckpoint?: boolean;
}): RegistryResult<CommandEvidenceResult[]> {
  const { task, originMainSha, requireVerifiedCheckpoint = true } = opts;
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
    if (originMainSha && match.headSha && match.headSha.toLowerCase() !== originMainSha.toLowerCase()) {
      return verificationErr(
        `command ${spec.command} ran at head ${match.headSha.slice(0, 12)} but current main is ${originMainSha.slice(0, 12)}`,
      );
    }
    const ranAt = Date.parse(match.ranAt);
    if (Number.isFinite(ranAt) && Number.isFinite(checkpointAt) && ranAt < checkpointAt) {
      return verificationErr(
        `command ${spec.command} result predates latest verifier checkpoint`,
      );
    }
  }

  return { ok: true, value: results };
}

export function findBuilderForVerification(task: TaskRecord): string | null {
  for (let i = task.checkpoints.length - 1; i >= 0; i--) {
    const cp = task.checkpoints[i];
    if (cp.role === 'builder' && cp.outcome === 'ready_for_verification') return cp.actor;
  }
  return null;
}

export function assertRoleForState(role: TaskRecord['assignedRole'], state: TaskRecord['state']): boolean {
  if (!role) return false;
  if (state === 'claimed' || state === 'in_progress') return role === 'builder';
  if (state === 'verification') return role === 'verifier';
  if (state === 'integration') return role === 'integrator';
  return false;
}

function gateErr(code: 'lease_not_owner' | 'role_forbidden' | 'invalid_transition' | 'dependency_unmet' | 'stale_main' | 'path_collision', message: string): RegistryResult<CommandEvidenceResult[]> {
  return { ok: false, code, message };
}

/** Shared integration/approve gate — must pass under mutation lock at approve time. */
export function validateIntegrationGate(
  reg: AgentTaskRegistry,
  task: TaskRecord,
  opts: {
    actor: string;
    role: 'integrator' | 'administrator';
    originMainSha?: string;
    mainAheadCount?: number | null;
    nowMs: number;
    requireIntegratorLease: boolean;
    integratorActor?: string;
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

  if (opts.originMainSha) {
    const count = opts.mainAheadCount ?? null;
    if (count === null) {
      return gateErr('stale_main', 'mainAheadCount unknown — run git fetch && rev-list before approve/integration');
    }
    const stale = detectStaleMain({
      taskBaseSha: task.baseSha,
      originMainSha: opts.originMainSha,
      mainAheadCount: count,
    });
    if (stale.stale) {
      return gateErr(
        'stale_main',
        `integration blocked: origin/main is ${stale.mainAheadCount} commit(s) ahead of base`,
      );
    }
  }

  const evidence = validateVerificationEvidence({
    task,
    originMainSha: opts.originMainSha,
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

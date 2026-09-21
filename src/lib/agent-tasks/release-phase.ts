import type { AgentRole, RegistryResult, TaskRecord, TaskState } from './types';
import { findBuilderReadyCheckpoint, latestVerifierCheckpoint } from './candidate-artifact';

/**
 * DEFECT B — phase-aware release.
 *
 * `releaseTask` used to hardcode `state: 'ready'` for every release, which silently
 * DESTROYED verified work. The real pilot proved it: a task sitting in `integration`
 * with a valid verified checkpoint was released and landed back in `ready`, so the
 * builder→verifier→integrator phases already paid for had to be re-run from scratch.
 *
 *     integration --release--> ready        (defect: phase lost)
 *     integration --release--> integration  (correct: lease dropped, phase kept)
 *
 * Releasing a lease is "I am stepping away", NOT "throw away what was proven". The
 * phase belongs to the TASK's evidence; the lease belongs to the ACTOR. Only the
 * lease is surrendered.
 */

/** Where a release lands, given who held the lease and where the task was. */
export function resolveReleaseState(
  fromState: TaskState,
  role: AgentRole | null | undefined,
): RegistryResult<TaskState> {
  // Builder holds the pre-verification phases. Releasing genuinely returns the task
  // to the pool because nothing has been verified yet.
  if (role === 'builder') {
    if (fromState === 'claimed' || fromState === 'in_progress') {
      return { ok: true, value: 'ready' };
    }
    return {
      ok: false,
      code: 'invalid_transition',
      message: `builder cannot release from ${fromState} — builder releases only from claimed/in_progress`,
    };
  }

  // Verifier is mid-verification: the builder's ready_for_verification evidence stands,
  // so the task stays in verification for the next verifier to pick up.
  if (role === 'verifier') {
    if (fromState === 'verification') {
      return { ok: true, value: 'verification' };
    }
    return {
      ok: false,
      code: 'invalid_transition',
      message: `verifier cannot release from ${fromState} — verifier releases only from verification`,
    };
  }

  // Integrator releasing keeps the verified candidate in integration. Dropping to ready
  // here is exactly the pilot defect.
  if (role === 'integrator') {
    if (fromState === 'integration') {
      return { ok: true, value: 'integration' };
    }
    return {
      ok: false,
      code: 'invalid_transition',
      message: `integrator cannot release from ${fromState} — integrator releases only from integration`,
    };
  }

  if (role === 'administrator') {
    return {
      ok: false,
      code: 'role_forbidden',
      message: 'administrator does not hold work leases — use reconcile-state for phase repair',
    };
  }

  return {
    ok: false,
    code: 'invalid_transition',
    message: `cannot resolve release phase without a lease role (state ${fromState})`,
  };
}

/**
 * DEFECT B — checkpoint-derived reconciliation (administrator only).
 *
 * DERIVES the phase from the validated checkpoint chain. It never accepts a caller-supplied
 * target state: an operator who can type any state can launder a task into `integration`
 * without evidence, which is the exact authority this whole registry exists to withhold.
 *
 *   latest valid verified checkpoint          -> integration
 *   latest valid ready_for_verification       -> verification
 *   otherwise                                 -> ready
 */
export function deriveStateFromCheckpoints(task: TaskRecord): RegistryResult<{
  state: TaskState;
  basis: string;
}> {
  const verified = latestVerifierCheckpoint(task);
  const ready = findBuilderReadyCheckpoint(task);

  if (verified) {
    // Ordering: a verified checkpoint is only meaningful AFTER the builder handed off.
    if (!ready) {
      return {
        ok: false,
        code: 'malformed_checkpoint',
        message: 'verified checkpoint present without a preceding ready_for_verification checkpoint',
      };
    }
    const readyIdx = task.checkpoints.indexOf(ready);
    const verifiedIdx = task.checkpoints.indexOf(verified);
    if (verifiedIdx < readyIdx) {
      return {
        ok: false,
        code: 'malformed_checkpoint',
        message: 'verified checkpoint precedes ready_for_verification — checkpoint chain out of order',
      };
    }
    // Self-verification is forbidden here for the same reason it is at handoff.
    if (verified.actor === ready.actor) {
      return {
        ok: false,
        code: 'self_verification_forbidden',
        message: `verifier ${verified.actor} is the same actor as the builder — cannot derive integration`,
      };
    }
    return { ok: true, value: { state: 'integration', basis: verified.id } };
  }

  if (ready) {
    return { ok: true, value: { state: 'verification', basis: ready.id } };
  }

  return { ok: true, value: { state: 'ready', basis: 'no builder/verifier checkpoints' } };
}

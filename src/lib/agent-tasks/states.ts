import type { AgentRole, TaskState } from './types';

/** States that hold an active path lease. */
export const LEASE_HOLDING_STATES: ReadonlySet<TaskState> = new Set([
  'claimed',
  'in_progress',
  'verification',
  'integration',
]);

/** Terminal states — no further work without explicit reopen. */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'merged',
  'deployed',
  'cancelled',
]);

const ROLE_ALLOWED: Record<AgentRole, ReadonlySet<TaskState>> = {
  builder: new Set(['ready', 'claimed', 'in_progress', 'verification', 'blocked', 'failed']),
  verifier: new Set(['verification', 'integration', 'blocked', 'failed']),
  integrator: new Set(['integration', 'awaiting_approval', 'blocked', 'failed']),
  administrator: new Set([]),
};

export function canRoleTouchState(role: AgentRole, state: TaskState): boolean {
  return ROLE_ALLOWED[role].has(state);
}

export function isLeaseHolding(state: TaskState): boolean {
  return LEASE_HOLDING_STATES.has(state);
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Legal state transitions enforced by the registry (human merge/deploy recorded, never auto). */
export const ALLOWED_TRANSITIONS: ReadonlyMap<TaskState, ReadonlySet<TaskState>> = new Map([
  ['proposed', new Set(['ready', 'cancelled'])],
  ['ready', new Set(['claimed', 'blocked', 'cancelled'])],
  ['claimed', new Set(['in_progress', 'ready', 'blocked', 'cancelled', 'failed'])],
  ['in_progress', new Set(['verification', 'ready', 'blocked', 'cancelled', 'failed'])],
  ['verification', new Set(['integration', 'in_progress', 'blocked', 'failed'])],
  ['integration', new Set(['awaiting_approval', 'verification', 'blocked', 'failed'])],
  ['awaiting_approval', new Set(['merged', 'integration', 'blocked', 'failed'])],
  ['merged', new Set(['deployed'])],
  ['blocked', new Set(['ready', 'cancelled', 'failed'])],
  ['failed', new Set(['ready', 'cancelled'])],
  ['deployed', new Set()],
  ['cancelled', new Set()],
]);

export function canTransition(from: TaskState, to: TaskState): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

/**
 * PHASE 3A.6 — SUPERSESSION ELIGIBILITY (deliberately NOT the transition table).
 *
 * Supersession is an administrator-only COMPOUND lifecycle operation: it atomically
 * terminates a stale source as `cancelled` while creating a `ready` successor anchored
 * at real current main. That is a different contract from ordinary cancellation, and
 * conflating the two is what this set exists to prevent.
 *
 * The bug that motivated it: TASK-PSTACK-PILOT-002 sat in `integration` with its lease
 * released, its base two commits behind main, and no way forward — `supersede` gated on
 * `canTransition(state, 'cancelled')` and `integration` legally reaches only
 * awaiting_approval / verification / blocked / failed. The live run returned
 * `invalid_transition: cannot cancel from integration`.
 *
 * ⚠️ The tempting one-line "fix" — adding `cancelled` to the `integration` row of
 * ALLOWED_TRANSITIONS — is WRONG and must never be done. That row governs every
 * ordinary path (release, block, fail, generic cancel), so widening it would let any
 * caller abandon a task mid-integration, discarding verified evidence with no successor
 * and no audit symmetry. `canTransition('integration', 'cancelled')` must stay FALSE;
 * a test asserts it.
 *
 * Eligibility is enumerated per state rather than derived, so a state added to
 * TASK_STATES cannot drift into being supersedable by accident:
 *
 *   proposed          ELIGIBLE — never started; replacing it loses nothing.
 *   ready             ELIGIBLE — the original 3A.3 case (stale base, unclaimed).
 *   claimed           ELIGIBLE when lease-free (an expired lease left it stranded).
 *   in_progress       ELIGIBLE when lease-free (ditto).
 *   verification      ELIGIBLE when lease-free — evidence is kept as history, never reused.
 *   integration       ELIGIBLE when lease-free — THE 3A.6 CASE.
 *   awaiting_approval ELIGIBLE when lease-free. Chosen DELIBERATELY, not inherited: the
 *                     task is parked pending Eric's decision and its base can go stale
 *                     exactly like any other. Superseding is the honest move — it records
 *                     a cancelled source plus a fresh successor. It does NOT approve,
 *                     merge, or deploy anything, and `approvalRequired` is copied verbatim
 *                     onto the successor, so the human gate is preserved, not bypassed.
 *   blocked           ELIGIBLE — blocked-on-stale-base is a normal reason to replace.
 *   merged            INELIGIBLE — terminal; the work landed. Superseding would imply the
 *                     merge did not happen.
 *   deployed          INELIGIBLE — terminal, and in production.
 *   cancelled         INELIGIBLE — terminal; already closed. Re-superseding would fork
 *                     lineage from a dead node.
 *   failed            INELIGIBLE — `failed` legally reaches `ready` and `cancelled`
 *                     already, so it has an ordinary route out and needs no compound
 *                     operation. Kept narrow on purpose.
 *
 * Lease-freedom is NOT encoded here — it is a runtime property of the record, not of the
 * state. `supersedeTask` performs the active-lease check separately and rejects first.
 */
export const SUPERSEDABLE_STATES: ReadonlySet<TaskState> = new Set([
  'proposed',
  'ready',
  'claimed',
  'in_progress',
  'verification',
  'integration',
  'awaiting_approval',
  'blocked',
]);

/**
 * May a task in this state be SUPERSEDED (closed as part of atomic successor creation)?
 *
 * Used ONLY by `supersedeTask`. Every other caller must keep using `canTransition`.
 * Callers must still independently reject an active lease and an already-superseded
 * source — this answers the state question alone.
 */
export function canSupersedeFrom(state: TaskState): boolean {
  return SUPERSEDABLE_STATES.has(state);
}

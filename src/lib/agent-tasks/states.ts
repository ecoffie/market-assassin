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

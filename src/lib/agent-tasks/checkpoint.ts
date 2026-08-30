import { parseCheckpoint } from './validate';
import { touchesForbiddenPath } from './collisions';
import type { RegistryResult, TaskCheckpoint, TaskRecord } from './types';

export function validateCheckpointPayload(raw: unknown): RegistryResult<TaskCheckpoint> {
  const cp = parseCheckpoint(raw);
  if (!cp) {
    return { ok: false, code: 'malformed_checkpoint', message: 'checkpoint failed schema validation' };
  }
  return { ok: true, value: cp };
}

export function applyCheckpointMutations(
  task: TaskRecord,
  cp: TaskCheckpoint,
): RegistryResult<TaskRecord> {
  const forbidden = touchesForbiddenPath(task, cp.changedPaths);
  if (forbidden.length) {
    return {
      ok: false,
      code: 'forbidden_mutation',
      message: `checkpoint changed forbidden paths: ${forbidden.join(', ')}`,
    };
  }

  for (const m of cp.mutationsPerformed) {
    if (!task.allowedMutations.includes(m)) {
      return {
        ok: false,
        code: 'forbidden_mutation',
        message: `checkpoint mutation ${m} not in allowedMutations for ${task.id}`,
      };
    }
  }

  // Auto-merge/deploy never allowed via checkpoint
  if (cp.mutationsPerformed.includes('merge') || cp.mutationsPerformed.includes('deploy')) {
    return {
      ok: false,
      code: 'forbidden_mutation',
      message: 'merge and deploy cannot be recorded via checkpoint — human approval only',
    };
  }

  return { ok: true, value: task };
}

export function stateForCheckpointOutcome(
  current: TaskRecord['state'],
  outcome: TaskCheckpoint['outcome'],
): TaskRecord['state'] | null {
  switch (outcome) {
    case 'progress':
      return current === 'claimed' ? 'in_progress' : current;
    case 'ready_for_verification':
      return 'verification';
    case 'verified':
      return 'integration';
    case 'ready_for_integration':
      return 'integration';
    case 'awaiting_approval':
      return 'awaiting_approval';
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'failed';
    case 'released':
      return 'ready';
    default:
      return null;
  }
}

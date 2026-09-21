import type { AgentTaskRegistry, TaskRecord } from './types';

const COMPLETE_STATES = new Set(['merged', 'deployed']);

export type DependencyStatus = {
  id: string;
  state: TaskRecord['state'];
  complete: boolean;
};

export function evaluateDependencies(
  registry: AgentTaskRegistry,
  task: TaskRecord,
): { ok: true; statuses: DependencyStatus[] } | { ok: false; unmet: DependencyStatus[] } {
  const statuses: DependencyStatus[] = task.dependencies.map((id) => {
    const dep = registry.tasks[id];
    if (!dep) {
      return { id, state: 'failed' as const, complete: false };
    }
    return { id, state: dep.state, complete: COMPLETE_STATES.has(dep.state) };
  });
  const unmet = statuses.filter((s) => !s.complete);
  if (unmet.length) return { ok: false, unmet };
  return { ok: true, statuses };
}

export function listReadyTasks(registry: AgentTaskRegistry): TaskRecord[] {
  return Object.values(registry.tasks)
    .filter((t) => t.state === 'ready')
    .filter((t) => evaluateDependencies(registry, t).ok)
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, normal: 2, low: 3 };
      return rank[a.priority] - rank[b.priority] || a.id.localeCompare(b.id);
    });
}

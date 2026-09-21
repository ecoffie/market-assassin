import type { TaskRecord } from './types';
import { isLeaseHolding } from './states';
import { isLeaseExpired } from './lease';

/** Normalize repo-relative path for prefix comparison. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.';
}

/**
 * Two path patterns collide when either is a prefix of the other (directory overlap)
 * or they are equal. Glob `**` suffix means the whole subtree.
 */
export function pathsCollide(a: string, b: string): boolean {
  const na = normalizePath(a.replace(/\/\*\*$/, ''));
  const nb = normalizePath(b.replace(/\/\*\*$/, ''));
  if (na === nb) return true;
  return na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

export type PathCollision = {
  taskId: string;
  path: string;
  otherTaskId: string;
  otherPath: string;
};

export function findPathCollisions(
  candidate: TaskRecord,
  others: TaskRecord[],
  nowMs: number,
): PathCollision[] {
  const hits: PathCollision[] = [];
  for (const other of others) {
    if (other.id === candidate.id) continue;
    if (!isLeaseHolding(other.state)) continue;
    if (other.lease && isLeaseExpired(other.lease, nowMs)) continue;

    for (const p of candidate.allowedPaths) {
      for (const op of other.allowedPaths) {
        if (pathsCollide(p, op)) {
          hits.push({ taskId: candidate.id, path: p, otherTaskId: other.id, otherPath: op });
        }
      }
    }
  }
  return hits;
}

export function pathMatchesPattern(path: string, pattern: string): boolean {
  const np = normalizePath(path);
  const pat = normalizePath(pattern.replace(/\/\*\*$/, ''));
  if (pattern.includes('*')) {
    const re = new RegExp(
      `^${pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`,
    );
    return re.test(np);
  }
  return np === pat || np.startsWith(`${pat}/`);
}

export function touchesForbiddenPath(task: TaskRecord, changedPaths: string[]): string[] {
  const violations: string[] = [];
  for (const changed of changedPaths) {
    for (const forbidden of task.forbiddenPaths) {
      if (pathMatchesPattern(changed, forbidden)) violations.push(changed);
    }
  }
  return [...new Set(violations)];
}

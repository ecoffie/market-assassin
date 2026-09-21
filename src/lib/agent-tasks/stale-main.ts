export type StaleMainInput = {
  taskBaseSha: string;
  originMainSha: string;
  /** Commits origin/main has that taskBaseSha lacks (0 = current). */
  mainAheadCount: number;
};

export type StaleMainResult =
  | { stale: false }
  | { stale: true; reason: 'main_moved_forward'; mainAheadCount: number; taskBaseSha: string; originMainSha: string };

/**
 * Fail-closed before claim and integration when main has advanced past the task base.
 * Does not auto-rebase — surfaces drift for Integrator review.
 */
export function detectStaleMain(input: StaleMainInput): StaleMainResult {
  const base = input.taskBaseSha.toLowerCase();
  const main = input.originMainSha.toLowerCase();
  if (base === main) return { stale: false };
  if (input.mainAheadCount > 0) {
    return {
      stale: true,
      reason: 'main_moved_forward',
      mainAheadCount: input.mainAheadCount,
      taskBaseSha: base,
      originMainSha: main,
    };
  }
  return { stale: false };
}

/** Parse `git rev-list --count base..origin/main` output. Unknown → fail closed. */
export function parseMainAheadCount(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

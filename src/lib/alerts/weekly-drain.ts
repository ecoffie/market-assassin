/**
 * Weekly-alert cycle draining — every eligible user is evaluated once per cycle.
 *
 * THE BUG THIS REPLACES (measured 2026-10-06)
 * The weekly job took `.slice(0, BATCH_SIZE)` = 75 unprocessed users per run, in
 * user_email order, and the dispatcher fires it 10 times a cycle (6 Sunday + 4
 * Monday windows). 75 × 10 = 750, and alert_log shows EXACTLY 750 weekly rows on
 * every cycle date. The eligible population is ~1,790, so the alphabetical tail —
 * every address after roughly "j" — was never evaluated on any cycle: 72 users who
 * chose weekly alerts and matched live opportunities had no alert_log row in 30 days.
 * Each run finished its 75 users in ~70s of a 300s function budget.
 *
 * THE FIX
 * A run no longer takes a fixed number of users. It drains the pending list until
 * it is empty or the run's time budget is spent. The cursor is the cycle's own
 * alert_log rows (unique on user_email + alert_date + alert_type): a user with a row
 * is done, so a retried or overlapping window cannot select them again.
 *
 * A time budget is a property of ONE invocation, not of the population: if a cycle
 * still has users pending when a run ends, the run reports it (see `remaining`)
 * instead of the tail silently falling off.
 */

export interface DrainUser {
  user_email: string;
}

/**
 * Users still to evaluate this cycle: eligible minus already-processed, case-folded,
 * deduped, in a stable email order so concurrent readers partition the same way.
 */
export function pendingForCycle<T extends DrainUser>(eligible: readonly T[], processed: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const sorted = [...eligible].sort((a, b) => a.user_email.toLowerCase().localeCompare(b.user_email.toLowerCase()));
  for (const u of sorted) {
    const key = u.user_email.toLowerCase();
    if (!key || seen.has(key) || processed.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export interface DrainResult {
  /** Users this run handed to `processOne` (each exactly once). */
  attempted: number;
  /** Users still pending when the run stopped. 0 means the cycle is fully drained. */
  remaining: number;
  /** True when the run stopped because its time budget ran out, not because it finished. */
  stoppedForBudget: boolean;
}

/**
 * Evaluate pending users one at a time until none remain or `budgetMs` is spent.
 * The budget is checked BEFORE each user, so a run never starts a user it has no
 * time to finish. `processOne` must record its own outcome (sent / skipped /
 * failed) — that record is what keeps the user out of the next run.
 */
export async function drainCycle<T extends DrainUser>(
  pending: readonly T[],
  processOne: (user: T) => Promise<void>,
  opts: { budgetMs: number; now?: () => number },
): Promise<DrainResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  let attempted = 0;
  for (const user of pending) {
    if (now() - started >= opts.budgetMs) {
      return { attempted, remaining: pending.length - attempted, stoppedForBudget: true };
    }
    attempted++;
    await processOne(user);
  }
  return { attempted, remaining: 0, stoppedForBudget: false };
}

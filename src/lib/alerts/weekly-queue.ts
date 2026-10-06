/**
 * Explicit weekly subscribers go FIRST in a weekly-alerts cycle (2026-10-06).
 *
 * #1854 replaced the fixed 750-user ceiling with a time-budgeted drain (lib/alerts/weekly-drain.ts),
 * which processes pending users in user_email order until the run budget is spent. When a run is cut
 * short, whoever sorts last waits — and the eligible audience is mostly the free weekly FALLBACK
 * (daily-frequency users who also get this email), not the users who CHOSE weekly. Before the drain,
 * that ordering meant 106 of 148 explicit weekly subscribers missed all 7 cycles from 2026-08-23.
 *
 * Rule (Eric, 2026-10-06): keep the fallback audience, but it must never displace users who
 * explicitly selected weekly. So the pending list is reordered: explicit weekly first, then the rest,
 * each group keeping the drain's own (email) order. Pure and stable.
 */
export function prioritizeExplicitWeekly<T extends { alert_frequency: string }>(pending: readonly T[]): T[] {
  const explicit = pending.filter((u) => u.alert_frequency === 'weekly');
  const rest = pending.filter((u) => u.alert_frequency !== 'weekly');
  return [...explicit, ...rest];
}

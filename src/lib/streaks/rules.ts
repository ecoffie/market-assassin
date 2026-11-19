/**
 * Login streak rules (owner, 2026-11-19). Client-safe: no server imports.
 *
 *   +25 credits on every 7th day in a row (7, 14, 21, 28, 35 …)
 *   +100 credits on every 30th day in a row (30, 60, 90 …) — replaces the 25 on a day that is both
 *
 * A day is the America/New_York calendar day, decided by the server.
 */
export const STREAK_WEEK_REWARD = 25;
export const STREAK_MONTH_REWARD = 100;

/** Credits earned on the day the streak reaches `streak`. */
export function rewardFor(streak: number): number {
  if (!Number.isInteger(streak) || streak <= 0) return 0;
  if (streak % 30 === 0) return STREAK_MONTH_REWARD;
  if (streak % 7 === 0) return STREAK_WEEK_REWARD;
  return 0;
}

/** The next milestone after today: how many more days, and what it pays. */
export function nextReward(streak: number): { inDays: number; credits: number } {
  const s = Math.max(0, Math.floor(streak));
  for (let d = s + 1; d <= s + 30; d++) {
    const r = rewardFor(d);
    if (r > 0) return { inDays: d - s, credits: r };
  }
  return { inDays: 7, credits: STREAK_WEEK_REWARD };
}

/** YYYY-MM-DD for the America/New_York calendar day at `now`. */
export function easternDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

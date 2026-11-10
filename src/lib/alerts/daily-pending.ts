/**
 * Daily-alert batch planning — who is owed an alert today, and who goes in THIS run.
 *
 * THE BUG THIS REPLACES (measured in production 2026-11-10)
 * The route removed users with a row in alert_log today, rotated, then sliced
 * BATCH_SIZE (70). Two kinds of user were then dropped inside the per-user loop with
 * a bare `continue` and NO alert_log row:
 *   (a) users not due today (weekdays on a weekend, mwf/tth off-days, weekends on a weekday)
 *   (b) users with no targeting (no known NAICS and no keywords)
 * With no row they stayed "pending" all day, were re-selected by every one of the 72
 * runs, consumed batch slots, and were invisible in alert_log. 356 due users had no
 * row that day (344 no-targeting + 2 malformed NAICS that knownNaicsForMatch rejects),
 * and measured throughput was ~38 users per run despite BATCH_SIZE 70.
 *
 * THE FIX
 * Partition BEFORE batching:
 *   notDueToday — excluded, no row needed (they are not owed an alert today)
 *   noTargeting — excluded from the batch; the route records ONE 'skipped' row per day
 *                 (error_message NO_TARGETING_REASON) so they leave the queue and are visible
 *   pending     — due + targeted + unprocessed; only these compete for batch slots
 * Matching semantics are unchanged: targeting is the same knownNaicsForMatch + keywords
 * test the loop used.
 */
import { knownNaicsForMatch } from '@/lib/codes/validate-market-codes';

/** Stable alert_log.error_message for a skipped no-targeting user. */
export const NO_TARGETING_REASON = 'no_targeting';

/**
 * The last scheduled run of the daily send window (cron `0,10,...,50 3-14 * * *` UTC
 * → last fire 14:50). A run at or after this time-of-day is the final chance to
 * drain the day's recipients.
 */
export const FINAL_RUN_UTC_HOUR = 14;
export const FINAL_RUN_UTC_MINUTE = 50;

export interface DailyPlanUser {
  user_email: string;
  alert_frequency: string;
  naics_codes?: string[] | null;
  keywords?: string[] | null;
}

/** Is a user with this frequency owed an alert on this UTC day-of-week (0=Sun..6=Sat)? */
export function isDueOnUtcDay(frequency: string, utcDay: number): boolean {
  const isWeekend = utcDay === 0 || utcDay === 6;
  switch (frequency) {
    case 'weekdays': return !isWeekend;
    case 'weekends': return isWeekend;
    case 'mwf': return utcDay === 1 || utcDay === 3 || utcDay === 5;
    case 'tth': return utcDay === 2 || utcDay === 4;
    default: return true; // 'daily' (and anything the eligibility query let through)
  }
}

/** Same gate the per-user loop applies: at least one known NAICS, or any keyword. */
export function hasDailyTargeting(user: Pick<DailyPlanUser, 'naics_codes' | 'keywords'>): boolean {
  return knownNaicsForMatch(user.naics_codes || []).length > 0 || (user.keywords || []).length > 0;
}

export interface DailyPlan<T> {
  notDueToday: T[];
  /** Unprocessed today, due, but nothing to match on. Record a skipped row; never batch. */
  noTargeting: T[];
  /** Due, targeted, unprocessed — the users who compete for batch slots (pre-rotation order). */
  pending: T[];
  batch: T[];
}

export function planDailyBatch<T extends DailyPlanUser>(opts: {
  users: readonly T[];
  processed: ReadonlySet<string>;
  utcDay: number;
  batchSize: number;
  /** Day-of-year rotation seed (see the route: stops the same inboxes losing out). */
  dayOfYear?: number;
  /** Test sends bypass the day-of-week gate, as before. */
  skipDayCheck?: boolean;
}): DailyPlan<T> {
  const { users, processed, utcDay, batchSize, dayOfYear = 0, skipDayCheck = false } = opts;
  const notDueToday: T[] = [];
  const noTargeting: T[] = [];
  const pending: T[] = [];
  for (const u of users) {
    if (processed.has(u.user_email)) continue;
    if (!skipDayCheck && !isDueOnUtcDay(u.alert_frequency, utcDay)) { notDueToday.push(u); continue; }
    if (!hasDailyTargeting(u)) { noTargeting.push(u); continue; }
    pending.push(u);
  }
  const rotateBy = pending.length > 0 ? (dayOfYear * batchSize) % pending.length : 0;
  const rotated = rotateBy === 0 ? pending : [...pending.slice(rotateBy), ...pending.slice(0, rotateBy)];
  return { notDueToday, noTargeting, pending, batch: rotated.slice(0, Math.max(0, batchSize)) };
}

/** True when `now` is at/after the final scheduled run of the daily window (UTC). */
export function isFinalRunOfWindow(now: Date): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= FINAL_RUN_UTC_HOUR * 60 + FINAL_RUN_UTC_MINUTE;
}

/** The final run ending with due, targeted recipients still unprocessed is a failure. */
export function shouldFailForPending(now: Date, pendingAfterRun: number): boolean {
  return pendingAfterRun > 0 && isFinalRunOfWindow(now);
}

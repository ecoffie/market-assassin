/**
 * Who the daily-alerts BATCH should spend a slot on today.
 *
 * THE BUG (measured 2026-09-13, Sunday). Day-of-week and no-targeting skips
 * used `continue` WITHOUT writing alert_log. Those users stayed in `pending`
 * and occupied BATCH_SIZE forever. By window close, 501 of 774 remaining
 * (65%) were weekdays-on-Sunday or unmatchable — they could never have been
 * sent — and 252 sendable daily users sat behind them. Coverage finished at
 * 83% with the cron reporting success.
 *
 * Filter BEFORE the batch, not after. A slot spent on a user we will
 * immediately skip is a slot stolen from someone who should have been mailed.
 */

export type AlertFrequency = 'daily' | 'weekdays' | 'weekends' | 'mwf' | 'tth' | string;

export interface TargetingProfile {
  naics_codes?: string[] | null;
  keywords?: string[] | null;
}

/** NAICS or keywords — the same condition daily-alerts uses to skip unmatchable profiles. */
export function hasAlertTargeting(user: TargetingProfile): boolean {
  return (user.naics_codes?.length || 0) > 0 || (user.keywords?.length || 0) > 0;
}

/**
 * Is this frequency supposed to send on this UTC day?
 * 0 = Sun … 6 = Sat. Matches the in-loop day-of-week skip in daily-alerts.
 */
export function isAlertDueToday(frequency: AlertFrequency | null | undefined, utcDay: number): boolean {
  const freq = (frequency || 'daily').toLowerCase();
  const isWeekend = utcDay === 0 || utcDay === 6;
  const isMWF = utcDay === 1 || utcDay === 3 || utcDay === 5;
  const isTTh = utcDay === 2 || utcDay === 4;
  if (freq === 'weekdays' && isWeekend) return false;
  if (freq === 'weekends' && !isWeekend) return false;
  if (freq === 'mwf' && !isMWF) return false;
  if (freq === 'tth' && !isTTh) return false;
  return true;
}

export function isSendableToday<T extends TargetingProfile & { alert_frequency?: AlertFrequency | null }>(
  user: T,
  utcDay: number,
): boolean {
  return isAlertDueToday(user.alert_frequency, utcDay) && hasAlertTargeting(user);
}

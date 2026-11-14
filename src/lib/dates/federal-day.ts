/**
 * One date basis for every contract status and expiration calculation: the federal business day in
 * US Eastern time. Before this, the expiring-contracts query and timing overlay used the UTC date
 * while award status used Eastern time, so between 7 PM and midnight Eastern they disagreed by a day
 * ("105 days ago" vs "106"; a window "as of 2026-11-14" next to a status computed for 2026-11-13).
 */
export const FEDERAL_TIME_ZONE = 'America/New_York';

/** YYYY-MM-DD of the federal business day (US Eastern) for an instant. */
export function federalToday(now: Date = new Date()): string {
  try {
    return now.toLocaleDateString('en-CA', { timeZone: FEDERAL_TIME_ZONE });
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Calendar-month arithmetic on a YYYY-MM-DD date (day clamped to the month's end). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

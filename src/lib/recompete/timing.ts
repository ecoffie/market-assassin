/**
 * Recompete timing — capture-start date vs remaining clock.
 *
 * Canonical offset for estimated_recompete_date is 12 calendar months before
 * period_of_performance_current_end. Evidence (not invented):
 *   • DB trigger `update_recompete_computed_fields` (20260405 + 20260716):
 *     `NEW.estimated_recompete_date := pop_end - INTERVAL '12 months'`
 *   • docs/PRD-forecast-intelligence.md: `estimated_recompete_date DATE, -- 12 months before end`
 *   • MEMORY.md: "the trigger hardcodes end − 12 months, correct-per-design"
 *   • src/data/glossary.ts / brand kit: flag 12 months before expiry
 *
 * The MCP overlay briefly used 9 months (FM-U06, 2026-07-29) with no PRD, glossary,
 * or trigger support. 9 months is not a product decision. MINDY-006 (2026-09-17):
 * do not clamp to today — a past capture date stays past.
 *
 * lead_time_months is a different quantity: whole months from today until PoP
 * end (remaining clock). It is not the capture-start date and is never derived
 * from estimated_recompete_date.
 */

/** Capture-start lead. Matches the DB trigger and the forecast PRD. */
export const RECOMPETE_CAPTURE_LEAD_MONTHS = 12;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_MONTH = 30.4375 * 86_400_000;

export function isoDateOnly(value: string | null | undefined): string | null {
  const iso = String(value || '').slice(0, 10);
  return ISO_DATE.test(iso) ? iso : null;
}

/**
 * Add (or subtract) whole calendar months, matching Postgres `date + INTERVAL 'N months'`
 * including month-end clamping (29 Feb minus 12 months → 28 Feb in a non-leap year).
 */
export function addCalendarMonths(isoDate: string, months: number): string | null {
  const iso = isoDateOnly(isoDate);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12; // 0–11
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Capture-start: PoP end minus 12 calendar months. Never uses today. Past stays past. */
export function estimatedRecompeteDateFromPopEnd(popEnd: string | null | undefined): string | null {
  return addCalendarMonths(popEnd || '', -RECOMPETE_CAPTURE_LEAD_MONTHS);
}

/**
 * Remaining clock: whole months from `now` until PoP end.
 * A contract that has not ended is not "0 months" — round() alone turned a
 * 10-day expiry into 0 (query.ts, FM-U06 follow-up). Future ends are at least 1.
 */
export function leadTimeMonthsFromPopEnd(popEnd: string | null | undefined, now: Date = new Date()): number | null {
  const iso = isoDateOnly(popEnd);
  if (!iso) return null;
  const end = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(end)) return null;
  const rawMonths = (end - now.getTime()) / MS_PER_MONTH;
  return end > now.getTime() ? Math.max(1, Math.round(rawMonths)) : 0;
}

export function overlayRecompeteTiming(
  popEnd: string | null | undefined,
  now: Date = new Date(),
): { estimated_recompete_date: string; lead_time_months: number } | null {
  const estimated = estimatedRecompeteDateFromPopEnd(popEnd);
  const lead = leadTimeMonthsFromPopEnd(popEnd, now);
  if (estimated == null || lead == null) return null;
  return { estimated_recompete_date: estimated, lead_time_months: lead };
}

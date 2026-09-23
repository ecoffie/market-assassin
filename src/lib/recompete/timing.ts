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

/**
 * What `estimated_recompete_date` can honestly say about one contract.
 *
 *   capture_start_upcoming — PoP end − 12 months is still ahead of today. That date is the
 *                            documented capture-start estimate and is emitted as-is.
 *   capture_window_open    — PoP end − 12 months is already BEHIND today while the contract
 *                            has not ended. The follow-on acquisition may already be under
 *                            way, bridged or extended; nothing we store dates it. The field is
 *                            NULL (unknown) — never a past date, never clamped to today.
 *   order_under_vehicle    — set by annotateRecompeteRow(): a task/delivery order is not
 *                            re-competed on its own; its recompete signal is the parent
 *                            vehicle's ordering end, which this row does not carry.
 *
 * IMI test (2026-09-22): FA850126F0034 ends 2026-11-09 and printed
 * "estimated_recompete_date: 2025-11-09" beside likelihood "high" — a date a year in the past
 * for a contract with seven weeks left. The capture-start value is still returned under its
 * own name (`capture_start_date`), so nothing measured is hidden (MINDY-006 holds: no clamp).
 */
export type RecompeteDateStatus = 'capture_start_upcoming' | 'capture_window_open' | 'order_under_vehicle';

export interface RecompeteTiming {
  /** PoP end − 12 calendar months (MINDY-006). May be in the past; never clamped. */
  capture_start_date: string;
  /** capture_start_date while it is still ahead of today; otherwise NULL (unknown). */
  estimated_recompete_date: string | null;
  recompete_date_status: RecompeteDateStatus;
  /** The rule behind the date — a stated method, not a measurement. */
  recompete_date_basis: 'pop_end_minus_12_months';
  lead_time_months: number;
}

export function overlayRecompeteTiming(
  popEnd: string | null | undefined,
  now: Date = new Date(),
): RecompeteTiming | null {
  const capture = estimatedRecompeteDateFromPopEnd(popEnd);
  const lead = leadTimeMonthsFromPopEnd(popEnd, now);
  if (capture == null || lead == null) return null;
  const today = now.toISOString().slice(0, 10);
  const upcoming = capture >= today;
  return {
    capture_start_date: capture,
    estimated_recompete_date: upcoming ? capture : null,
    recompete_date_status: upcoming ? 'capture_start_upcoming' : 'capture_window_open',
    recompete_date_basis: 'pop_end_minus_12_months',
    lead_time_months: lead,
  };
}

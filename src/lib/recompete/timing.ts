/**
 * Recompete timing — capture-start date vs remaining clock.
 *
 * Canonical offset for capture_start_date is 12 calendar months before
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

/** Suggested capture start: PoP end minus 12 calendar months. Never uses today. Past stays past. */
export function captureStartDateFromPopEnd(popEnd: string | null | undefined): string | null {
  return addCalendarMonths(popEnd || '', -RECOMPETE_CAPTURE_LEAD_MONTHS);
}

/** The derived rule behind capture_start_date, stated on every row that carries one. */
export const CAPTURE_START_BASIS =
  'derived: period_of_performance_current_end − 12 months (Mindy capture lead rule)' as const;

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
 * The date contract (Eric, 2026-09-22 — final):
 *
 *   capture_start_date       = PoP end − 12 months: a SUGGESTED capture start, derived by our rule.
 *   capture_start_basis      = that rule, stated.
 *   estimated_recompete_date = NULL. Nothing we store independently establishes when a follow-on
 *                              will be solicited or awarded, so the field is unknown. It is never
 *                              a copy of capture_start_date and never a copy of PoP end.
 *
 * Customer story: "Contract ends 2027-11-09. Suggested capture start: 2026-11-09." — never
 * "Estimated recompete date". The DB trigger still writes PoP end − 12 months into the
 * estimated_recompete_date COLUMN; every reader overrides it at read time (annotate.ts).
 *
 * IMI test (2026-09-22): FA850126F0034 ends 2026-11-09 and printed
 * "estimated_recompete_date: 2025-11-09" beside likelihood "high".
 */
export interface RecompeteTiming {
  /** PoP end − 12 calendar months (MINDY-006). May be in the past; never clamped. */
  capture_start_date: string;
  capture_start_basis: typeof CAPTURE_START_BASIS;
  /** True when the suggested capture start is already behind today. */
  capture_start_passed: boolean;
  /** Always null: no independent source establishes a recompete/acquisition date. */
  estimated_recompete_date: null;
  lead_time_months: number;
}

export function overlayRecompeteTiming(
  popEnd: string | null | undefined,
  now: Date = new Date(),
): RecompeteTiming | null {
  const capture = captureStartDateFromPopEnd(popEnd);
  const lead = leadTimeMonthsFromPopEnd(popEnd, now);
  if (capture == null || lead == null) return null;
  const today = now.toISOString().slice(0, 10);
  return {
    capture_start_date: capture,
    capture_start_basis: CAPTURE_START_BASIS,
    capture_start_passed: capture < today,
    estimated_recompete_date: null,
    lead_time_months: lead,
  };
}

/**
 * ONE date formatter for opportunity dates — the single source of truth so every surface (list card,
 * drawer Overview, drawer Bid facts, target card) shows the IDENTICAL day for the same DB value.
 *
 * Eric 2026-07-27: "why don't everything pull from the same place so even if it was wrong it would
 * show the same information?" — they didn't, and diverged: the sidebar card, drawer Overview, and
 * Bid facts each re-formatted `posted_date`/`response_deadline` independently, so one opp read
 * "posted Jul 20 / due Jul 26" in the drawer, "2026-07-21 / 2026-07-27" in Bid facts, and "posted
 * today / due Jul 27" on the card.
 *
 * THE BUG: SAM stores dates as UTC-midnight ("2026-07-21T00:00:00+00:00"). Parsing that with
 * `new Date(iso)` and formatting in a US (negative-offset) timezone shifts it BACK one day
 * ("Jul 21" → "Jul 20"). So we take the CALENDAR date (first 10 chars) and anchor it to LOCAL NOON —
 * noon can't cross a day boundary in any US timezone, so the displayed day always equals the stored
 * calendar day.
 *
 * The client map (opportunity-map/route.ts + template.html) has an INLINE copy of this exact logic
 * (it's a template-literal HTML string, can't import). `opp-date.consistency.unit.test.ts` asserts
 * the two stay identical so they can never drift back apart.
 */

/** The calendar date (YYYY-MM-DD) from any ISO/date string, or '' if none. */
export function ymd(d: string | null | undefined): string {
  const m = String(d ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** A Date anchored to LOCAL noon on the value's calendar date (never shifts a day in US zones). */
export function localNoon(d: string | null | undefined): Date | null {
  const y = ymd(d);
  return y ? new Date(`${y}T12:00:00`) : null;
}

/** "Jul 21, 2026" — the ONE display format for an opportunity date. '—' when absent/invalid. */
export function longDate(d: string | null | undefined): string {
  const dt = localNoon(d);
  return dt && !Number.isNaN(dt.getTime())
    ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

/** Whole days from today (local noon) to the value's calendar date. Negative = past. null if absent. */
export function daysUntil(d: string | null | undefined): number | null {
  const dt = localNoon(d);
  if (!dt || Number.isNaN(dt.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((dt.getTime() - today.getTime()) / 86_400_000);
}

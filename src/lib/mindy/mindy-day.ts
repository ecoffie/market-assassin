/**
 * Mindy Day — the single source of truth for the live product-unveil event.
 *
 * The event date used to be hardcoded as string literals across ~7 files
 * (banner, confirmation/reminder/lifetime emails, reminder route, pricing),
 * so each new event meant hunting down every literal and one always got missed.
 * This is the one place to change it. Every surface imports from here.
 *
 * When the event moves: edit the fields below (date, times, ISO, dismiss key),
 * and every banner/email/calendar-link updates. The reminder CRON SCHEDULE is
 * separate — it lives in cron_jobs rows (funnels repo dispatcher) and must be
 * rescheduled there by hand; this constant does not drive cron timing.
 *
 * Current event: Saturday, July 25, 2026 · 10:00 AM – 1:00 PM ET.
 */
export const MINDY_DAY = {
  /** Full human date for headlines/save-the-date blocks. */
  dateLabel: 'Saturday, July 25, 2026',
  /** Short date for pills/badges/subjects (e.g. "July 25"). */
  shortDate: 'July 25',
  /** ISO date (YYYY-MM-DD) for keys, deadlines, and machine use. */
  iso: '2026-07-25',
  /** ISO with no dashes — for Google Calendar dates + dismiss keys. */
  isoCompact: '20260725',
  /** Displayed time window (ET). */
  timeLabel: '10:00 AM – 1:00 PM ET',
  /** Shorter time label for prep bullets etc. */
  timeShort: '10 AM–1 PM ET',
  /**
   * Google Calendar dates param. 10:00 AM–1:00 PM ET on Jul 25, 2026.
   * July is EDT (UTC-4), so 10:00 ET = 14:00 UTC, 13:00 ET = 17:00 UTC.
   */
  calendarDates: '20260725T140000Z/20260725T170000Z',
  /** localStorage dismiss key for the announcement bar — bump per event so a
   *  visitor who dismissed the last one still sees the new bar. */
  dismissKey: 'mindy-bootcamp-2026-07-25',
  /** Public registration/details page (rewritten from the funnels-one project). */
  eventUrl: 'https://govcongiants.com/mindy-launch',
} as const;

/**
 * The "honest extension" deadline for the post-event Founders Lifetime offer —
 * the Monday after the event (2 days after a Saturday event). Derived from the
 * event ISO so it moves with MINDY_DAY. Rendered in the lifetime email's
 * extension/finalclose phases (e.g. "Monday, July 27").
 */
export const MINDY_DAY_EXTENSION_LABEL: string = (() => {
  const d = new Date(`${MINDY_DAY.iso}T12:00:00-04:00`);
  d.setDate(d.getDate() + 2); // Saturday event → the following Monday
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
})();

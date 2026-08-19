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
 * Current event: Saturday, August 22, 2026 · 10:00 AM – 1:00 PM ET.
 */
export const MINDY_DAY = {
  /** Full human date for headlines/save-the-date blocks. */
  dateLabel: 'Saturday, August 22, 2026',
  /** Short date for pills/badges/subjects (e.g. "August 22"). */
  shortDate: 'August 22',
  /** ISO date (YYYY-MM-DD) for keys, deadlines, and machine use. */
  iso: '2026-08-22',
  /** ISO with no dashes — for Google Calendar dates + dismiss keys. */
  isoCompact: '20260822',
  /** Displayed time window (ET). */
  timeLabel: '10:00 AM – 1:00 PM ET',
  /** Shorter time label for prep bullets etc. */
  timeShort: '10 AM–1 PM ET',
  /**
   * Google Calendar dates param. 10:00 AM–1:00 PM ET on Aug 22, 2026.
   * August is EDT (UTC-4), so 10:00 ET = 14:00 UTC, 13:00 ET = 17:00 UTC.
   */
  calendarDates: '20260822T140000Z/20260822T170000Z',
  /** localStorage dismiss key for the announcement bar — bump per event so a
   *  visitor who dismissed the last one still sees the new bar. */
  dismissKey: 'mindy-bootcamp-2026-08-22',
  /** Public registration/details page (rewritten from the funnels-one project). */
  eventUrl: 'https://govcongiants.com/mindy-launch',
  /**
   * Zoom join link for the live session (added 2026-08-19).
   *
   * TIMEZONE — RESOLVED. Every Mindy surface says 10:00 AM – 1:00 PM **ET** (calendarDates
   * encodes 14:00–17:00Z = 10 AM–1 PM EDT). The FIRST Zoom invite read "10:00 AM Pacific"
   * (= 1 PM ET, the moment the event was meant to END); it was rescheduled the same day to
   * **7:00 AM Pacific = 10:00 AM ET**, which now matches. The invite still DISPLAYS Pacific
   * because that is the Zoom account's timezone — the underlying start time is correct.
   * ⚠️ ET is the source of truth. Never edit these constants to match a Pacific-labelled
   * invite; reschedule the Zoom instead.
   */
  joinUrl: 'https://us06web.zoom.us/j/86152556791?pwd=xf3TVmV6zvWW5EQpFkwaVSjHsWFokb.1',
  /** Meeting id, formatted as Zoom displays it (for dial-in / manual entry). */
  meetingId: '861 5255 6791',
  /** Passcode for both the web join and the phone bridge. */
  passcode: '48690',
  /** One-tap mobile dial-in (US · San Jose). */
  dialInOneTap: '+16699006833,,86152556791#,,,,*48690#',
} as const;

/**
 * The "honest extension" deadline for the post-event Founders Lifetime offer —
 * the Monday after the event (2 days after a Saturday event). Derived from the
 * event ISO so it moves with MINDY_DAY. Rendered in the lifetime email's
 * extension/finalclose phases (e.g. "Monday, August 24").
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

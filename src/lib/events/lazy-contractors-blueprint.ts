/**
 * The Lazy Contractor's Blueprint — the Nov 28, 2026 Mindy Day live event.
 *
 * One place for the event facts. The registration page, the API route and the
 * homepage banner all read from here, so a date or tag change is one edit.
 *
 * GHL: every registrant is tagged `ghlTag`. The GHL workflows (confirmation,
 * reminders, new vs. existing contact) trigger off that tag — do not rename it
 * without updating the workflows in GHL.
 */
export const LAZY_CONTRACTORS_BLUEPRINT = {
  title: "The Lazy Contractor's Blueprint",
  /** Public registration page path on getmindy.ai. */
  path: '/lazy-contractors-blueprint',
  dateLabel: 'Saturday, November 28, 2026',
  shortDate: 'Nov 28',
  iso: '2026-11-28',
  /** Start time, shown on the page. */
  timeLabel: '11:00 AM ET' as string,
  format: 'Free live online event',
  /** The tag GHL workflows trigger on. */
  ghlTag: 'MD Lazy Contractors Blueprint',
  /** Extra tag when the registrant checks the SMS consent box. */
  smsOptInTag: 'sms-opt-in',
  /** Interest form for the New Year program (shown after the Mindy sign-up). */
  programPath: '/lazy-contractors-blueprint/program',
  programName: 'Lazy Contractor First Contract Program',
  programStartLabel: 'January 2027',
  /** Everyone who fills in the interest form. */
  programInterestTag: 'MD LCB Program Interest',
  /** Added when they say they are ready to start in January. */
  programHotTag: 'MD LCB Program Hot',
  /** GHL contact field that holds each registrant's personal Zoom link ({{contact.zoom_join_link}}). */
  ghlZoomFieldId: 'Gis0uE1EkzuqDwcl2Gdo',
  ghlZoomFieldKey: 'zoom_join_link',
  /** Seats in the Zoom room. When it fills, Zoom turns people away: they go to the YouTube overflow. */
  zoomCapacity: 500,
  /** YouTube live link for overflow. Empty until Cash sets up the stream; shown in emails once filled. */
  youtubeOverflowUrl: '' as string,
  /** Tags the site writes when it sends the confirmation email / welcome text (for counting). */
  emailConfirmationTag: 'lcb-email-confirmation',
  smsWelcomeTag: 'lcb-sms-welcome',
  /** Attendance tags written after the event. */
  attendedTag: 'mindy-day-attended',
  noShowTag: 'mindy-day-no-show',
} as const;

/**
 * The Zoom event for Nov 28: LCB_ZOOM_EVENT_ID (the webinar or meeting ID, digits only) and
 * LCB_ZOOM_EVENT_TYPE ('webinar' or 'meeting', default 'webinar'). Null until it is set.
 */
export function lazyBlueprintZoomEvent(): { kind: 'webinar' | 'meeting'; id: string } | null {
  const id = (process.env.LCB_ZOOM_EVENT_ID || '').replace(/\D/g, '');
  if (!id) return null;
  return { kind: process.env.LCB_ZOOM_EVENT_TYPE === 'meeting' ? 'meeting' : 'webinar', id };
}

/** True once the event day is over (ET). The banner hides itself after this. */
export function lazyBlueprintIsOver(now: Date = new Date()): boolean {
  // Midnight ET at the end of Nov 28 = 2026-11-29T05:00Z (EST, UTC-5).
  return now.getTime() >= Date.parse('2026-11-29T05:00:00Z');
}

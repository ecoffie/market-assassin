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
} as const;

/** True once the event day is over (ET). The banner hides itself after this. */
export function lazyBlueprintIsOver(now: Date = new Date()): boolean {
  // Midnight ET at the end of Nov 28 = 2026-11-29T05:00Z (EST, UTC-5).
  return now.getTime() >= Date.parse('2026-11-29T05:00:00Z');
}

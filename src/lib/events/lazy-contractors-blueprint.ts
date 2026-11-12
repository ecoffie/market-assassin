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
  /** Typed a name + email on the form but did not register. A GHL email workflow nudges these
   *  (email only — no text consent was given); removed when they register. */
  startedTag: 'lcb-started-not-registered',
  /** Live-only form: registered attendees claim extra Mindy credits, granted on submit. */
  claimPath: '/lazy-contractors-blueprint/claim',
  claimCredits: 250,
  /** Claim window: Sat Nov 28, 11:00 AM – 3:00 PM ET (EST, UTC-5). */
  claimOpensAt: '2026-11-28T16:00:00Z',
  claimClosesAt: '2026-11-28T20:00:00Z',
  /** Tag written on a successful claim (the dashboard's "Claimed $50" step reads it). */
  claimTag: 'mindy-day-bonus-claimed',
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

/** 'before' | 'open' | 'after' for the live credit claim. */
export function lazyBlueprintClaimState(now: Date = new Date()): 'before' | 'open' | 'after' {
  const t = now.getTime();
  if (t < Date.parse(LAZY_CONTRACTORS_BLUEPRINT.claimOpensAt)) return 'before';
  if (t >= Date.parse(LAZY_CONTRACTORS_BLUEPRINT.claimClosesAt)) return 'after';
  return 'open';
}

/**
 * Claim-form questions. Option values for revenue and support are EXACTLY the picklist values
 * of the existing GHL contact fields (ids below), so the answers land in those fields.
 */
export const LCB_CLAIM_QUESTIONS = {
  years: ['Not started yet', 'Less than 1 year', '1–3 years', '3–10 years', '10+ years'],
  revenue: ['$0 - $249k', '$250k - $499k', '$500k - $999k', '$1M - $5M', '$5M+'],
  certifications: ['8(a)', 'WOSB / EDWOSB', 'SDVOSB / VOSB', 'HUBZone', 'None yet', 'Not sure'],
  sam: ['Yes', 'No', 'Not sure'],
  bids: ['Never', '1–2', '3–10', 'More than 10'],
  challenge: [
    'Finding the right opportunities',
    'Getting registered (SAM.gov, certifications)',
    'Writing proposals',
    'Pricing my bid',
    'Knowing who to talk to at the agency',
    'Finding teaming partners',
  ],
  /**
   * "Which of these sounds most like you?" Reads as a self-description; each answer carries a
   * monthly budget band (shown in the GHL note) and maps to the existing GHL support field.
   */
  stage: [
    { value: 'testing', label: "I'm testing the waters and want to keep costs close to zero", budget: '$0 (free tools only)', support: 'Self Paced: Do it yourself ($0 - $1k)' },
    { value: 'tool', label: "I'd pay for a good tool that saves me hours each week", budget: 'Under $150/month', support: 'Self Paced: Do it yourself ($0 - $1k)' },
    { value: 'coaching', label: "I'd invest in training or coaching so I get it right the first time", budget: '$150–$500/month', support: 'Technical Support: Done with you ($2k - $5k)' },
    { value: 'handson', label: "I'd invest in hands-on help to win my first contract faster", budget: '$500–$2,000/month', support: 'Technical Support: Done with you ($2k - $5k)' },
    { value: 'team', label: "I want a team doing this for me, and I'll budget for it", budget: '$2,000+/month', support: 'Business Development: Done for you ($8k+' },
  ],
  call: ['Yes', 'No'],
} as const;

/** Existing GHL contact fields the claim answers fill. */
export const LCB_GHL_FIELDS = {
  industry: 'KkcWt0NPAzlbF1BtTIzV',
  revenue: 'ksuw8aXHyIEALTtVHeu2',
  support: 'woFckg0BhEIEK20DqJL8',
} as const;

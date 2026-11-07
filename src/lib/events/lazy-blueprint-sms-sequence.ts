/**
 * The text-message sequence for The Lazy Contractor's Blueprint (Nov 28, 2026, 11:00 AM ET).
 *
 * The welcome text goes out at registration (register route). These are the scheduled ones.
 * Each step sends inside its own window only, so someone who registers late never gets a
 * text that is already out of date (no "one week to go" on the day before). A GHL tag per
 * step records who got it, so a re-run never texts anyone twice.
 *
 * Only contacts tagged sms-opt-in (they ticked the box) are ever texted. Every text ends
 * "Reply STOP to opt out"; GHL refuses anyone who already opted out.
 */
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';

export interface SmsStep {
  id: string;
  /** When the step starts sending (UTC). November is EST, UTC-5. */
  sendAt: string;
  /** How long after sendAt it may still go out. */
  windowMinutes: number;
  /** GHL tag written once a contact has been texted for this step. */
  tag: string;
  /** Plain-English time for people reading the schedule. */
  label: string;
  text: (firstName: string, joinLink: string | null) => string;
}

const link = (url: string | null) => url || 'the link in your confirmation email';

export const LCB_SMS_STEPS: SmsStep[] = [
  {
    id: 'week',
    sendAt: '2026-11-21T16:00:00Z',
    windowMinutes: 6 * 60,
    tag: 'lcb-sms-week',
    label: 'Sat Nov 21, 11:00 AM ET (one week out)',
    text: (n) => `Hi ${n}, one week until ${EVENT.title}: Sat Nov 28 at 11:00 AM ET. Show up live for $50 in free Mindy credits. Your join link is in your email. Reply STOP to opt out.`,
  },
  {
    id: 'day',
    sendAt: '2026-11-27T17:00:00Z',
    windowMinutes: 6 * 60,
    tag: 'lcb-sms-day',
    label: 'Fri Nov 27, 12:00 PM ET (the day before)',
    text: (n, url) => `Hi ${n}, it's tomorrow! ${EVENT.title} starts at 11:00 AM ET. Your personal join link: ${link(url)} The room seats ${EVENT.zoomCapacity}, so join a few minutes early. Reply STOP to opt out.`,
  },
  {
    id: 'soon',
    sendAt: '2026-11-28T15:45:00Z',
    windowMinutes: 14,
    tag: 'lcb-sms-soon',
    label: 'Sat Nov 28, 10:45 AM ET (15 minutes before)',
    text: (n, url) => `${n}, we go live in 15 minutes. Join now: ${link(url)} Reply STOP to opt out.`,
  },
  {
    id: 'live',
    sendAt: '2026-11-28T16:00:00Z',
    windowMinutes: 60,
    tag: 'lcb-sms-live',
    label: 'Sat Nov 28, 11:00 AM ET (we are live)',
    text: (n, url) => `We're LIVE, ${n}! Jump in: ${link(url)} Stay to the end for $50 in free Mindy credits. Reply STOP to opt out.`,
  },
];

/** Steps whose send window contains `now`. */
export function dueSmsSteps(now: Date = new Date()): SmsStep[] {
  const t = now.getTime();
  return LCB_SMS_STEPS.filter((s) => {
    const start = Date.parse(s.sendAt);
    return t >= start && t < start + s.windowMinutes * 60_000;
  });
}

export function firstNameFor(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

/**
 * Post-bootcamp lifetime offer — private email to bootcamp attendees.
 *
 * The $2,997 discounted "alumni rate" was DISCONTINUED 2026-07-05. This flow now
 * offers the single Founders Lifetime price ($4,997, 100 seats) — same as public.
 * The scarcity is the 100-seat cap + the deadline, not a discount.
 *
 * Checkout: getmindy.ai/checkout/founders-lifetime.
 */

import {
  FOUNDERS_LIFETIME_PRICE,
  bootcampDeadlineLabel,
  foundersBreakEvenMonths,
} from '@/lib/mindy/lifetime-pricing';

export const BOOTCAMP_LIFETIME_EMAIL_TYPE = 'bootcamp_lifetime_offer';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export const BOOTCAMP_LIFETIME_CHECKOUT_URL =
  `${SITE}/checkout/founders-lifetime?utm_source=email&utm_medium=bootcamp_lifetime&utm_campaign=mindy_founders_lifetime`;

/** @deprecated Use BOOTCAMP_LIFETIME_CHECKOUT_URL */
export const ULTIMATE_CHECKOUT_URL = BOOTCAMP_LIFETIME_CHECKOUT_URL;

export function bootcampLifetimeSubject(): string {
  return 'Your founding seat on Mindy — lifetime, before the 100 fill (closes soon)';
}

export function bootcampLifetimeHtml(deadlineLabel?: string): string {
  const deadline = deadlineLabel || bootcampDeadlineLabel();
  const breakEven = foundersBreakEvenMonths();

  const body = `
<p>Hey there,</p>
<p>Thanks for showing up to Mindy Day. If you took one thing away, I hope it was this: the contractors who win aren't the ones who work harder — they're the ones who see the market clearly and move early.</p>
<p>That's exactly what Mindy does for you every day. But I don't want the monthly bill to be the thing that stops you from building the habit.</p>
<p><b>Founders Lifetime is $${FOUNDERS_LIFETIME_PRICE.toLocaleString()}</b> — one payment, and Mindy Pro is yours for life. It's the same lifetime price people paid for our courses before Mindy existed, and it's capped at 100 founding seats:</p>
<div style="margin:20px 0;padding:20px;border:1px solid #7c3aed;border-radius:14px;background:linear-gradient(135deg,#1e3a8a0d,#7c3aed14);">
  <p style="margin:0 0 6px;font-weight:700;font-size:18px;color:#111827;">Founders Lifetime — one of 100 seats</p>
  <p style="margin:0 0 10px;color:#374151;"><b style="color:#7c3aed;">$${FOUNDERS_LIFETIME_PRICE.toLocaleString()}</b> once — no subscription, no renewal, ever</p>
  <ul style="margin:8px 0 0;padding-left:20px;color:#374151;">
    <li><b>Full Mindy Pro — lifetime</b> (no monthly, no renewal, ever)</li>
    <li>Daily AI-matched briefings, recompete alerts, competitor tracking</li>
    <li>Forecasts, contractor database, proposal assist — every Pro feature, forever</li>
  </ul>
</div>
<p>At $149/mo, Founders pays for itself in about ${breakEven} months — then it's free, for life.</p>
<p style="margin:24px 0;"><a href="${BOOTCAMP_LIFETIME_CHECKOUT_URL}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:600;font-size:16px;">Claim your founding seat — $${FOUNDERS_LIFETIME_PRICE.toLocaleString()} →</a></p>
<p style="color:#b91c1c;font-weight:600;">The 100 founding seats close ${deadline}. After that it's $149/mo only.</p>
<p>Go build something,</p>
<p>Eric Coffie<br/>GovCon Giants</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. There are only 100 founding seats, and they don't come back. If lifetime isn't the move right now, Mindy is still free for daily alerts.</p>
`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:16px;line-height:1.6;">${body}</div>`;
}

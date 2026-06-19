/**
 * Post-bootcamp lifetime offer — private email to bootcamp attendees only.
 *
 * ANCHOR: Founders Lifetime is $4,997 (public price, 100 seats). Bootcamp
 * alumni get $2,997 through the deadline — never lead with the lower number;
 * frame it as an earned alumni rate, not "Mindy costs $2,997."
 *
 * Checkout: getmindy.ai/checkout/bootcamp-lifetime (not on public homepage).
 */

import {
  BOOTCAMP_LIFETIME_PRICE,
  FOUNDERS_LIFETIME_PRICE,
  bootcampDeadlineLabel,
  bootcampBreakEvenMonths,
  bootcampLifetimeSavings,
} from '@/lib/mindy/lifetime-pricing';

export const BOOTCAMP_LIFETIME_EMAIL_TYPE = 'bootcamp_lifetime_offer';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

export const BOOTCAMP_LIFETIME_CHECKOUT_URL =
  `${SITE}/checkout/bootcamp-lifetime?utm_source=email&utm_medium=bootcamp_lifetime&utm_campaign=mindy_bootcamp_june27`;

/** @deprecated Use BOOTCAMP_LIFETIME_CHECKOUT_URL */
export const ULTIMATE_CHECKOUT_URL = BOOTCAMP_LIFETIME_CHECKOUT_URL;

export function bootcampLifetimeSubject(): string {
  return 'Your Mindy Day attendee rate on Founders Lifetime (closes soon)';
}

export function bootcampLifetimeHtml(deadlineLabel?: string): string {
  const deadline = deadlineLabel || bootcampDeadlineLabel();
  const savings = bootcampLifetimeSavings();
  const breakEven = bootcampBreakEvenMonths();

  const body = `
<p>Hey there,</p>
<p>Thanks for showing up to Mindy Day. If you took one thing away, I hope it was this: the contractors who win aren't the ones who work harder — they're the ones who see the market clearly and move early.</p>
<p>That's exactly what Mindy does for you every day. But I don't want the monthly bill to be the thing that stops you from building the habit.</p>
<p><b>Founders Lifetime is $${FOUNDERS_LIFETIME_PRICE.toLocaleString()}</b> — the same lifetime price people paid for our courses before Mindy existed, and what we're selling publicly (100 founding seats). Because you attended Mindy Day, you get an attendee window at <b>$${BOOTCAMP_LIFETIME_PRICE.toLocaleString()}</b> through ${deadline}:</p>
<div style="margin:20px 0;padding:20px;border:1px solid #7c3aed;border-radius:14px;background:linear-gradient(135deg,#1e3a8a0d,#7c3aed14);">
  <p style="margin:0 0 6px;font-weight:700;font-size:18px;color:#111827;">Founders Lifetime — Mindy Day Attendee Rate</p>
  <p style="margin:0 0 10px;color:#374151;">Public price: <b>$${FOUNDERS_LIFETIME_PRICE.toLocaleString()}</b> · Your rate: <b style="color:#7c3aed;">$${BOOTCAMP_LIFETIME_PRICE.toLocaleString()}</b> · one time, forever</p>
  <ul style="margin:8px 0 0;padding-left:20px;color:#374151;">
    <li><b>Full Mindy Pro — lifetime</b> (no monthly, no renewal, ever)</li>
    <li>Daily AI-matched briefings, recompete alerts, competitor tracking</li>
    <li>Forecasts, contractor database, proposal assist — every Pro feature, forever</li>
  </ul>
</div>
<p>At $149/mo, Founders pays for itself in about ${Math.ceil(FOUNDERS_LIFETIME_PRICE / 149)} months — your alumni rate breaks even in ~${breakEven}. You're saving <b>$${savings.toLocaleString()}</b> vs the public Founders price.</p>
<p style="margin:24px 0;"><a href="${BOOTCAMP_LIFETIME_CHECKOUT_URL}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:600;font-size:16px;">Claim alumni rate — $${BOOTCAMP_LIFETIME_PRICE.toLocaleString()} →</a></p>
<p style="color:#b91c1c;font-weight:600;">Alumni pricing closes ${deadline}. After that, Founders Lifetime is $${FOUNDERS_LIFETIME_PRICE.toLocaleString()} for everyone — or $149/mo.</p>
<p>Go build something,</p>
<p>Eric Coffie<br/>GovCon Giants</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. This email is for Mindy Day attendees only — we don't advertise the attendee rate on the site. If lifetime isn't the move right now, Mindy is still free for daily alerts.</p>
`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:16px;line-height:1.6;">${body}</div>`;
}

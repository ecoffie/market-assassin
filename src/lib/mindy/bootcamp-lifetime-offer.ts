/**
 * Post-bootcamp lifetime offer — time-boxed $1,497 Mindy Lifetime for bootcamp
 * attendees (June 27, 2026 cohort).
 *
 * 1-1-1 aligned: one product (Mindy), not Ultimate Giant Bundle. Founders
 * Lifetime is $4,997 (capped at 100); bootcamp attendees get $1,497 through
 * the event deadline only.
 *
 * Checkout routes through getmindy.ai/checkout/bootcamp-lifetime for attribution.
 */

import {
  BOOTCAMP_LIFETIME_PRICE,
  FOUNDERS_LIFETIME_PRICE,
  bootcampDeadlineLabel,
} from '@/lib/mindy/lifetime-pricing';

export const BOOTCAMP_LIFETIME_EMAIL_TYPE = 'bootcamp_lifetime_offer';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

// Attribution-friendly checkout hop (not raw buy.stripe.com).
export const BOOTCAMP_LIFETIME_CHECKOUT_URL =
  `${SITE}/checkout/bootcamp-lifetime?utm_source=email&utm_medium=bootcamp_lifetime&utm_campaign=mindy_bootcamp_june27`;

/** @deprecated Use BOOTCAMP_LIFETIME_CHECKOUT_URL — shop bundle URL retired for 1-1-1. */
export const ULTIMATE_CHECKOUT_URL = BOOTCAMP_LIFETIME_CHECKOUT_URL;

export function bootcampLifetimeSubject(): string {
  return 'Keep your bootcamp edge for life (closing soon)';
}

export function bootcampLifetimeHtml(deadlineLabel?: string): string {
  const deadline = deadlineLabel || bootcampDeadlineLabel();
  const savings = FOUNDERS_LIFETIME_PRICE - BOOTCAMP_LIFETIME_PRICE;

  const body = `
<p>Hey there,</p>
<p>Thanks for showing up to the Mindy Bootcamp. If you took one thing away, I hope it was this: the contractors who win aren't the ones who work harder — they're the ones who see the market clearly and move early.</p>
<p>That's exactly what Mindy does for you every day. But I don't want the monthly bill to be the thing that stops you from building the habit.</p>
<p>Founders Lifetime is <b>$${FOUNDERS_LIFETIME_PRICE.toLocaleString()}</b> — same price people paid for lifetime course access before Mindy existed. Bootcamp attendees get one shot at <b>$${BOOTCAMP_LIFETIME_PRICE.toLocaleString()}</b> through ${deadline}:</p>
<div style="margin:20px 0;padding:20px;border:1px solid #7c3aed;border-radius:14px;background:linear-gradient(135deg,#1e3a8a0d,#7c3aed14);">
  <p style="margin:0 0 6px;font-weight:700;font-size:18px;color:#111827;">Mindy Lifetime — Bootcamp Special — <span style="color:#9ca3af;text-decoration:line-through;">$${FOUNDERS_LIFETIME_PRICE.toLocaleString()}</span> <span style="color:#7c3aed;">$${BOOTCAMP_LIFETIME_PRICE.toLocaleString()}</span>, one time, forever</p>
  <ul style="margin:8px 0 0;padding-left:20px;color:#374151;">
    <li><b>Full Mindy Pro — lifetime</b> (no monthly, no renewal, ever)</li>
    <li>Daily AI-matched briefings, recompete alerts, competitor tracking</li>
    <li>Forecasts, contractor database, proposal assist — every Pro feature, forever</li>
  </ul>
</div>
<p>At $149/mo, Mindy pays for herself in about 10 months at the bootcamp price — then it's free for life. You're saving <b>$${savings.toLocaleString()}</b> vs Founders Lifetime.</p>
<p style="margin:24px 0;"><a href="${BOOTCAMP_LIFETIME_CHECKOUT_URL}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:600;font-size:16px;">Lock in lifetime — $${BOOTCAMP_LIFETIME_PRICE.toLocaleString()} →</a></p>
<p style="color:#b91c1c;font-weight:600;">This $${BOOTCAMP_LIFETIME_PRICE.toLocaleString()} price closes ${deadline}. After that, Founders Lifetime is $${FOUNDERS_LIFETIME_PRICE.toLocaleString()} (100 seats) — or $149/mo.</p>
<p>Go build something,</p>
<p>Eric Coffie<br/>GovCon Giants</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. If lifetime isn't the move right now, Mindy is still free for daily alerts — just keep showing up. But the bootcamp door closes ${deadline}; after that it's $${FOUNDERS_LIFETIME_PRICE.toLocaleString()} Founders or monthly.</p>
`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:16px;line-height:1.6;">${body}</div>`;
}

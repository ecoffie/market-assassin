/**
 * Post-bootcamp lifetime offer — the time-boxed $1,497 Ultimate Giant Bundle
 * (lifetime Mindy + the full tool suite) sent to bootcamp leads after the June 27
 * Mindy Bootcamp.
 *
 * Voice follows the nurture playbook (memory marketing-email-voice): it opens by
 * acknowledging the bootcamp lesson they just learned, frames lifetime as the way
 * to keep that edge without a monthly bill, and lets the offer + a real deadline
 * carry the ask. Eric's first-person voice, signed Eric.
 *
 * Offer is the EXISTING product (shop.govcongiants.com/bundles/ultimate, $1,497) —
 * no new Stripe product. 67 of these fund a $100K month (see mindy_100k_goal_math).
 */

export const BOOTCAMP_LIFETIME_EMAIL_TYPE = 'bootcamp_lifetime_offer';

// UTM-tagged so the purchase attribution dashboard credits the bootcamp blast.
export const ULTIMATE_CHECKOUT_URL =
  'https://shop.govcongiants.com/bundles/ultimate?utm_source=email&utm_medium=bootcamp_lifetime&utm_campaign=mindy_bootcamp_june27';

export function bootcampLifetimeSubject(): string {
  return 'Keep your bootcamp edge for life (closing soon)';
}

export function bootcampLifetimeHtml(deadlineLabel: string): string {
  const body = `
<p>Hey there,</p>
<p>Thanks for showing up to the Mindy Bootcamp. If you took one thing away, I hope it was this: the contractors who win aren't the ones who work harder — they're the ones who see the market clearly and move early.</p>
<p>That's exactly what Mindy does for you every day. But I don't want the monthly bill to be the thing that stops you from building the habit.</p>
<p>After the bootcamp, lifetime access to Mindy goes to <b>$2,997</b> — and that's where it stays. But for everyone who showed up, I'm cutting it in half:</p>
<div style="margin:20px 0;padding:20px;border:1px solid #7c3aed;border-radius:14px;background:linear-gradient(135deg,#1e3a8a0d,#7c3aed14);">
  <p style="margin:0 0 6px;font-weight:700;font-size:18px;color:#111827;">The Ultimate Giant Bundle — <span style="color:#9ca3af;text-decoration:line-through;">$2,997</span> <span style="color:#7c3aed;">$1,497</span>, one time, forever</p>
  <ul style="margin:8px 0 0;padding-left:20px;color:#374151;">
    <li><b>Mindy — lifetime</b> (no monthly, no renewal, ever)</li>
    <li>The full tool suite: Market Assassin, Recompete Tracker, Contractor Database, Content Reaper</li>
    <li>Every Pro feature: forecasts, recompetes, pricing intel, proposal assist, the full database</li>
  </ul>
</div>
<p>At $149/mo, Mindy alone pays this back in under a year — then it's free for life. The rest of the suite is the bonus. And you're getting it for <b>$1,500 less</b> than anyone after the bootcamp will ever pay.</p>
<p style="margin:24px 0;"><a href="${ULTIMATE_CHECKOUT_URL}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:600;font-size:16px;">Lock in lifetime — $1,497 →</a></p>
<p style="color:#b91c1c;font-weight:600;">This $1,497 price closes ${deadlineLabel}. After that, lifetime is $2,997 — no exceptions.</p>
<p>Go build something,</p>
<p>Eric Coffie<br/>GovCon Giants</p>
<p style="color:#6b7280;font-size:14px;margin-top:24px;">P.S. If lifetime isn't the move right now, Mindy is still free for daily alerts — just keep showing up. But the half-price door closes ${deadlineLabel}; after that it's $2,997 or monthly.</p>
`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;font-size:16px;line-height:1.6;">${body}</div>`;
}

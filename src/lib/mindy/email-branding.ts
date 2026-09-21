export const MINDY_SITE_URL = process.env.NEXT_PUBLIC_MINDY_SITE_URL || 'https://getmindy.ai';

/**
 * WHERE AN EMAIL CTA LANDS — Maps-native, never a legacy surface.
 *
 * ── THE MIGRATION RULE ─────────────────────────────────────────────────────────────────
 * No active customer email may intentionally send a user to `/app` or `/briefings`.
 * Both are legacy surfaces being retired; the Map is the product.
 *
 * ── WHY THIS USED TO POINT AT /briefings, AND WHY THAT NO LONGER APPLIES ────────────────
 * The previous default was deliberate and correct AT THE TIME: beta alert/free users never
 * set a password, so linking them to the OAuth-gated `/app` locked them out and forced
 * re-signup. `/briefings` was the email-only dashboard that could identify a visitor from
 * `?email=` alone.
 *
 * That constraint is GONE. Measured 2026-08-25: `/opportunity-map` returns HTTP 200 with no
 * auth and no redirect, for any visitor. The lock-out risk that justified `/briefings`
 * cannot occur on the Map, so the reason to stay on a legacy surface has expired.
 *
 * ⚠️ The `/app` guard below is KEPT. An env override pointing at `/app` was the exact
 * regression that stranded beta users once, and `/app` is still credential-gated.
 */
function resolveEmailDashboardUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MINDY_APP_URL;
  // Never honour an override at a legacy surface — that is the regression this guards.
  if (configured && !/\/(app|briefings)(\b|\/|$)/.test(configured)) return configured;
  return `${MINDY_SITE_URL}/opportunity-map`;
}
export const MINDY_APP_URL = resolveEmailDashboardUrl();

/**
 * Where "Manage preferences" should land. Kept SEPARATE from the dashboard CTA: one is
 * "show me opportunities", the other is "change my settings", and collapsing them is how
 * both ended up on /briefings.
 */
export const MINDY_PREFERENCES_URL = `${MINDY_SITE_URL}/alerts/preferences`;

/**
 * The dashboard URL for an EMAIL CTA — always carrying the recipient's identity.
 *
 * THE BUG (reported with screenshots 2026-08-04): "Open Mindy v1.0" in a saved-search
 * alert linked to a bare https://getmindy.ai/briefings. /briefings cannot identify the
 * visitor client-side, so it ran its "no authenticated user" branch and redirected to
 * /alerts/signup — an existing subscriber clicking the flagship CTA was asked to sign
 * up for the alerts they were already receiving.
 *
 * The email rendered perfectly. The landing was the failure, which is why it survived:
 * nothing errors, nothing logs, and the send metrics stay green.
 *
 * Every sibling link already did this correctly — preferencesUrl, unsubscribeUrl and
 * the add-to-pipeline actions all carry ?email=. Only the dashboard CTA did not, in
 * SIX separate senders (daily-alerts, weekly-alerts, send-weekly-fast,
 * send-pursuit-fast, pursuit-brief, weekly-deep-dive). Fixing it here rather than at
 * each call site is what stops the seventh sender reintroducing it.
 *
 * The destination reads ?email= to identify the recipient without a login round-trip.
 *
 * Deliberately NOT createSecureAccessUrl(): those tokens carry a 15-minute TTL and an
 * alert email is routinely opened hours later — that trades a broken link for an
 * expired one. This matches the ?email= scheme the preferences link already uses.
 */
export function mindyDashboardUrlFor(email: string): string {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return MINDY_APP_URL; // nothing to attach; better a generic link than a malformed one
  const sep = MINDY_APP_URL.includes('?') ? '&' : '?';
  return `${MINDY_APP_URL}${sep}email=${encodeURIComponent(clean)}`;
}
export const MINDY_FROM_NAME = process.env.MINDY_FROM_NAME || "Mindy";
export const MINDY_PRODUCT_NAME = 'Mindy';
export const MINDY_PRODUCT_DESCRIPTION = 'Your Market Intelligence Analyst';

export function renderMindyEmailLogo(size = 48): string {
  const radius = Math.round(size * 0.24);
  const fontSize = Math.round(size * 0.58);

  return `
    <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 12px auto; border-collapse:separate;">
      <tr>
        <td width="${size}" height="${size}" align="center" valign="middle" bgcolor="#5928c2" style="width:${size}px; height:${size}px; border-radius:${radius}px; background:#5928c2; color:#ffffff; font-family:Arial,Helvetica,sans-serif; font-size:${fontSize}px; font-weight:800; line-height:${size}px; mso-line-height-rule:exactly; text-align:center;">
          M
        </td>
      </tr>
    </table>
  `;
}

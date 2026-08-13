export const MINDY_SITE_URL = process.env.NEXT_PUBLIC_MINDY_SITE_URL || 'https://getmindy.ai';
// While Mindy is in beta, email "Open Dashboard" CTAs MUST go to /briefings
// (the existing EMAIL-ONLY dashboard) rather than /app (the OAuth/password-
// gated new Mindy workbench). Beta alert/free users never set a password, so
// linking them to /app locked them out and forced re-signup.
//
// We deliberately DO NOT honor NEXT_PUBLIC_MINDY_APP_URL here when it points
// at /app — an env-var override to /app was the exact regression that
// stranded beta users. Normalize any configured value back to the
// email-only /briefings dashboard. Flip this once everyone has app creds.
function resolveEmailDashboardUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MINDY_APP_URL;
  if (configured && !/\/app(\b|\/|$)/.test(configured)) return configured;
  return `${MINDY_SITE_URL}/briefings`;
}
export const MINDY_APP_URL = resolveEmailDashboardUrl();

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
 * /briefings reads ?email= and short-circuits the signup redirect.
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

/** Opportunity Map URL for email CTAs. Pass noticeId to open that listing's drawer (`?opp=`). */
export function mindyMapUrl(opts?: { noticeId?: string | null; src?: string }): string {
  const p = new URLSearchParams();
  p.set('src', (opts && opts.src) || 'alert');
  if (opts && opts.noticeId) p.set('opp', String(opts.noticeId));
  return `${MINDY_SITE_URL}/opportunity-map?${p.toString()}`;
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

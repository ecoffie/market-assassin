export const MINDY_SITE_URL = process.env.NEXT_PUBLIC_MINDY_SITE_URL || 'https://mi.govcongiants.com';
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
export const MINDY_FROM_NAME = process.env.MINDY_FROM_NAME || "Mindy";
export const MINDY_PRODUCT_NAME = 'Mindy';
export const MINDY_PRODUCT_DESCRIPTION = 'Your Market Intelligence Analyst';

export function renderMindyEmailLogo(size = 48): string {
  const radius = Math.round(size * 0.24);
  const fontSize = Math.round(size * 0.58);

  return `
    <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 12px auto; border-collapse:separate;">
      <tr>
        <td width="${size}" height="${size}" align="center" valign="middle" bgcolor="#8b3cf6" style="width:${size}px; height:${size}px; border-radius:${radius}px; background:#8b3cf6; color:#ffffff; font-family:Arial,Helvetica,sans-serif; font-size:${fontSize}px; font-weight:800; line-height:${size}px; mso-line-height-rule:exactly; text-align:center;">
          M
        </td>
      </tr>
    </table>
  `;
}

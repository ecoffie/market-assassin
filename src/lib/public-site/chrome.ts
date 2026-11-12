/**
 * The public header and footer content, declared once. PublicHeader (React) and html.ts
 * (raw-HTML route handlers) both render the header from site-nav.ts, which reads these lists,
 * so the homepage and every public page show the same top bar (since 2026-11-05).
 */
export interface MpChromeLink {
  href: string;
  label: string;
}

/** Left of the top bar, after the logo. Hidden at <=980px. */
export const MP_HEADER_PRODUCT_LINKS: readonly MpChromeLink[] = [
  { href: '/mcp/gallery', label: 'Mindy in your AI' },
  { href: '/learn', label: 'Learn' },
  { href: '/jobs', label: 'Jobs' },
];

/**
 * Right of the top bar, before the "Start for free" button. Sign in is for signed-out visitors
 * only (hidden once the account avatar paints). Contact sales was removed from the bar (2026-11-12).
 */
export const MP_HEADER_ACCOUNT_LINKS: readonly MpChromeLink[] = [
  { href: '/app', label: 'Sign in' },
  { href: '/pricing', label: 'Plans & Pricing' },
];

/** No free plan for new users (2026-11): the signup CTA is the 14-day trial, chosen on /pricing. */
export const MP_HEADER_SIGNUP_LINK: MpChromeLink = { href: '/pricing', label: 'Start for free' };

export const MP_LOGO_SRC = '/brand/mindy-logo-icon.png';

export const MP_FOOTER_TAGLINE =
  'Mindy — federal market intelligence built on SAM.gov, USASpending and agency forecast data.';

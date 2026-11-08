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
];

/**
 * Right of the top bar, before the "Sign up free" button. Sign in and Contact sales are for
 * signed-out visitors only (hidden once the account avatar paints).
 */
export const MP_HEADER_ACCOUNT_LINKS: readonly MpChromeLink[] = [
  { href: '/app', label: 'Sign in' },
  { href: '/contact-sales', label: 'Contact sales' },
  { href: '/pricing', label: 'Plans & Pricing' },
];

export const MP_HEADER_SIGNUP_LINK: MpChromeLink = { href: '/signup', label: 'Sign up free' };

export const MP_LOGO_SRC = '/brand/mindy-logo-icon.png';

export const MP_FOOTER_TAGLINE =
  'Mindy — federal market intelligence built on SAM.gov, USASpending and agency forecast data.';

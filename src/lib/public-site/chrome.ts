/**
 * The public header and footer content, declared once. PublicHeader / PublicFooter (React) and
 * html.ts (raw-HTML route handlers) both render from these lists, so the two can never drift.
 * Same links, order and logo as the homepage's .zhead (src/app/today/route.ts).
 */
export interface MpChromeLink {
  href: string;
  label: string;
}

export const MP_HEADER_PRODUCT_LINKS: readonly MpChromeLink[] = [
  { href: '/opportunity-map', label: 'Opportunities' },
  { href: '/opportunity-map?mode=companies', label: 'Players' },
  { href: '/opportunity-map/pursuits', label: 'Pursuits' },
  { href: '/opportunity-map/reports', label: 'Markets' },
];

export const MP_HEADER_ACCOUNT_LINKS: readonly MpChromeLink[] = [
  { href: '/bid', label: 'Bid with confidence' },
  // Mindy Learn. Second, not first: at <=1000px the first account link is hidden (css.ts).
  { href: '/learn', label: 'Learn' },
  { href: '/pricing', label: 'Pricing' },
];

export const MP_LOGO_SRC = '/brand/mindy-logo-icon.png';

export const MP_FOOTER_TAGLINE =
  'Mindy — federal market intelligence built on SAM.gov, USASpending and agency forecast data.';

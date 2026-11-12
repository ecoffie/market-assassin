/**
 * The public header and footer content, declared once. PublicHeader (React) and html.ts
 * (raw-HTML route handlers) both render the header from site-nav.ts, which reads these lists,
 * so the homepage and every public page show the same top bar (since 2026-11-05).
 */
import { FEATURE_PAGES } from './features';

export interface MpChromeLink {
  href: string;
  label: string;
}

/** Left of the top bar, after the "How it works" menu. Hidden at <=980px. */
export const MP_HEADER_PRODUCT_LINKS: readonly MpChromeLink[] = [
  { href: '/mcp/gallery', label: 'Mindy in your AI' },
  { href: '/jobs', label: 'Jobs' },
];

export interface MpHowItWorksItem extends MpChromeLink {
  /** One plain sentence under the title. */
  desc: string;
  /** Inner markup of a 24x24 stroked icon (paths only). */
  icon: string;
}

/**
 * "How it works" — the first item of the top bar, a menu of every way Mindy works (Eric 2026-11-12:
 * "take away the learn tab and replace it with the how it works tab with all the different ways mindy
 * works", modelled on fyxer.com). Each item opens its /features/<slug> page (features.ts).
 */
export const MP_HOW_IT_WORKS: readonly MpHowItWorksItem[] = FEATURE_PAGES.map((f) => ({
  href: `/features/${f.slug}`,
  label: f.name,
  desc: f.menuDesc,
  icon: f.icon,
}));

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

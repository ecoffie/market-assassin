/**
 * The public header and footer content, declared once. PublicHeader (React) and html.ts
 * (raw-HTML route handlers) both render the header from site-nav.ts, which reads these lists,
 * so the homepage and every public page show the same top bar (since 2026-11-05).
 */
import { FEATURE_PAGES } from './features';

export interface MpChromeLink {
  href: string;
  label: string;
  /** A small menu under the link (desktop hover/focus; its own section in the phone menu). */
  sub?: readonly MpAiMenuItem[];
}

export interface MpAiMenuItem {
  href: string;
  label: string;
  /** One plain sentence under the title. */
  desc: string;
  /** Inner markup of a 24x24 stroked icon (paths only). */
  icon: string;
}

/**
 * The menu under "Mindy in your AI" (2026-11-13): the path from seeing what an AI agent produces
 * with Mindy, to connecting one, to sizing a plan. "See examples" is the gallery the top-level
 * link already opens; it is named here so visitors know examples exist.
 */
export const MP_AI_MENU: readonly MpAiMenuItem[] = [
  {
    href: '/mcp/gallery',
    label: 'See examples',
    desc: 'Finished work an AI agent hands back with Mindy.',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  },
  {
    href: '/mcp/about',
    label: 'How Mindy in your AI works',
    desc: 'What it is, what it can answer, and what it costs.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  },
  {
    href: '/mcp',
    label: 'Connect your AI',
    desc: 'Claude, ChatGPT, Cursor or any MCP agent.',
    icon: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0zM12 16v5"/>',
  },
  {
    href: '/mcp/pricing',
    label: 'Pricing for AI agents',
    desc: 'Estimate your workload and pick a plan.',
    icon: '<path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.4 5 3.5-2.2 3-5 3-5-1.1-5-3"/>',
  },
];

/** Left of the top bar, after the "How it works" menu. Hidden at <=980px. */
export const MP_HEADER_PRODUCT_LINKS: readonly MpChromeLink[] = [
  { href: '/mcp/gallery', label: 'Mindy in your AI', sub: MP_AI_MENU },
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
 * only (hidden once the account avatar paints). Contact sales (2026-11-12) and Plans & Pricing
 * (2026-11-13: "the start for free button goes to that page") were removed from the bar.
 */
export const MP_HEADER_ACCOUNT_LINKS: readonly MpChromeLink[] = [
  { href: '/app', label: 'Sign in' },
];

/** No free plan for new users (2026-11): the signup CTA is the 14-day trial, chosen on /pricing. */
export const MP_HEADER_SIGNUP_LINK: MpChromeLink = { href: '/pricing', label: 'Start for free' };

export const MP_LOGO_SRC = '/brand/mindy-logo-icon.png';

export const MP_FOOTER_TAGLINE =
  'Mindy — federal market intelligence built on SAM.gov, USASpending and agency forecast data.';

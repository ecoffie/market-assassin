/**
 * The public header and footer content, declared once. PublicHeader (React) and html.ts
 * (raw-HTML route handlers) both render the header from site-nav.ts, which reads these lists,
 * so the homepage and every public page show the same top bar (since 2026-11-05).
 */
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
 * works", modelled on fyxer.com). Every href is a live page.
 */
export const MP_HOW_IT_WORKS: readonly MpHowItWorksItem[] = [
  { href: '/opportunity-map', label: 'Opportunity Map', desc: 'Every open federal opportunity on one map.', icon: '<path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>' },
  { href: '/mcp/about', label: 'Mindy in your AI', desc: 'Ask Claude or ChatGPT. Answers come from federal data.', icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },
  { href: '/opportunity-map?mode=recompete', label: 'Contracts coming back', desc: 'Recompetes up to 12 months before the RFP.', icon: '<path d="M3 12a9 9 0 0115.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>' },
  { href: '/forecasts', label: 'Agency forecasts', desc: 'What agencies plan to buy in the next 6 to 18 months.', icon: '<path d="M8 3v4M16 3v4M4 10h16"/><rect x="4" y="5" width="16" height="16" rx="2"/>' },
  { href: '/opportunity-map?mode=companies', label: 'Players', desc: 'Incumbents, competitors and teaming partners.', icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>' },
  { href: '/opportunity-map/reports', label: 'Market research', desc: 'Who buys what you sell, and how much they spend.', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  { href: '/bid', label: 'Bid with confidence', desc: 'A bid or no-bid read before you write a proposal.', icon: '<path d="M9 12l2 2 4-4"/><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>' },
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

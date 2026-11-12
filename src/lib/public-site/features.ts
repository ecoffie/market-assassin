/**
 * The "How it works" feature pages (/features/<slug>), one per way Mindy works. Modelled on
 * fyxer.com/flows and /spaces (Eric 2026-11-12): a hero, three alternating sections, a closing
 * call to action. Every image is a real Mindy screen: `live` ones were captured from getmindy.ai;
 * the rest are Mindy results for an example company, captioned as samples.
 *
 * The top-bar "How it works" menu (MP_HOW_IT_WORKS in chrome.ts) links to these pages, and the
 * order here is the menu order.
 */

export interface FeatureMedia {
  /** Image under /public. */
  src: string;
  alt: string;
  /** Captured from the live product (true) or a sample result for an example company (false). */
  live: boolean;
  /** Optional looping demo clip; `src` is then its poster. */
  video?: string;
}

export interface FeatureSection {
  eyebrow: string;
  heading: string;
  body: string;
  media: FeatureMedia;
}

export interface FeaturePage {
  slug: string;
  /** Name in the menu and the browser tab. */
  name: string;
  /** One line under the name in the menu. */
  menuDesc: string;
  /** Inner markup of a 24x24 stroked icon (paths only). */
  icon: string;
  metaDescription: string;
  eyebrow: string;
  /** Headline, then the highlighted phrase that ends it. */
  headline: string;
  headlineAccent: string;
  sub: string;
  hero: FeatureMedia;
  /** Where the product itself lives. */
  tryHref: string;
  tryLabel: string;
  sections: [FeatureSection, FeatureSection, FeatureSection];
}

const img = (name: string, alt: string, live: boolean): FeatureMedia => ({ src: `/features/${name}.webp`, alt, live });
const clip = (name: string, alt: string): FeatureMedia => ({ src: `/demo/${name}.jpg`, video: `/demo/${name}.mp4`, alt, live: true });

export const FEATURE_PAGES: readonly FeaturePage[] = [
  {
    slug: 'opportunity-map',
    name: 'Opportunity Map',
    menuDesc: 'Every open federal opportunity on one map.',
    icon: '<path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    metaDescription: 'See every open federal opportunity on one map, filter it the way you sell, and get new matches by email every day.',
    eyebrow: 'Opportunity Map',
    headline: 'See where the federal work is,',
    headlineAccent: 'on one map',
    sub: 'Every open notice from SAM.gov, placed where the work happens, with contracts coming back and agency forecasts beside it.',
    hero: clip('mindy-map-filters', 'The Mindy Opportunity Map filtered to one market'),
    tryHref: '/opportunity-map',
    tryLabel: 'Open the map',
    sections: [
      {
        eyebrow: 'Find',
        heading: 'Filter the way you sell',
        body: 'Narrow by agency, value, set-aside, notice type and industry in a couple of clicks. Sources sought and RFIs show up next to open bids, so you can get in early.',
        media: img('map-sources-sought', 'The map filtered to sources sought notices', true),
      },
      {
        eyebrow: 'Read',
        heading: 'The whole notice in one view',
        body: 'Scope of work, attachments, deadlines and the contracting officer, without leaving the map. Save it to your pursuits when it fits.',
        media: img('d-open', 'An open opportunity with its details, documents and contact', true),
      },
      {
        eyebrow: 'Get alerts',
        heading: 'New matches in your inbox',
        body: 'Save a search once. Mindy emails you the new matches every day, and flags when a notice you saved changes.',
        media: img('g-weekly', 'A list of new and changed opportunities for a saved search', false),
      },
    ],
  },
  {
    slug: 'mindy-in-your-ai',
    name: 'Mindy in your AI',
    menuDesc: 'Ask Claude or ChatGPT. Answers come from federal data.',
    icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    metaDescription: 'Connect Mindy to Claude, ChatGPT or any MCP agent and ask federal contracting questions in plain English. Every answer comes from official federal data.',
    eyebrow: 'Mindy in your AI',
    headline: 'Ask your AI about federal contracts,',
    headlineAccent: 'get real answers',
    sub: 'Connect Mindy to Claude, ChatGPT or Cursor. Ask in plain English and get answers built from SAM.gov, USASpending and agency forecasts.',
    hero: clip('mindy-in-your-ai', 'Mindy answering a federal contracting question inside an AI chat'),
    tryHref: '/mcp/about',
    tryLabel: 'Connect Mindy to your AI',
    sections: [
      {
        eyebrow: 'Ask',
        heading: 'Plain English in, the market out',
        body: '"Where is the money for facilities work in Florida?" Mindy returns what is open now, what is coming back and what is coming soon, with the buyers behind each.',
        media: img('g-moneymap', 'A map of facilities work in Florida: open now, coming back and coming soon', false),
      },
      {
        eyebrow: 'Write',
        heading: 'Drafts from the same data',
        body: 'Capability statements, sources sought responses and proposal sections, written from your company record and the notice in front of you.',
        media: img('g-proposal', 'A drafted technical approach section of a proposal', false),
      },
      {
        eyebrow: 'Plan',
        heading: 'A plan you can act on this week',
        body: 'Ask where to start and Mindy names the first buyer, why it fits you, and the 90-day goal, from the same federal record.',
        media: img('g-gtm', 'A go-to-market plan naming the first buyer and a 90-day goal', false),
      },
    ],
  },
  {
    slug: 'recompetes',
    name: 'Contracts coming back',
    menuDesc: 'Recompetes up to 12 months before the RFP.',
    icon: '<path d="M3 12a9 9 0 0115.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
    metaDescription: 'See federal contracts that are ending and coming back up for bid, with the incumbent, the value and the end date, before the solicitation posts.',
    eyebrow: 'Contracts coming back',
    headline: 'Get in front of the recompete',
    headlineAccent: 'before the RFP',
    sub: 'Every federal contract ending in the next year, with who holds it now, what it is worth and when it ends.',
    hero: clip('mindy-recompete-incumbent', 'A contract coming back, with its incumbent and end date'),
    tryHref: '/opportunity-map?mode=recompete',
    tryLabel: 'See contracts coming back',
    sections: [
      {
        eyebrow: 'Spot',
        heading: 'Every contract ending near you',
        body: 'Contracts coming back sit on the same map as open bids, so you can see the next round of work in your market at a glance.',
        media: img('map-recompete', 'The map showing contracts coming back up for bid', true),
      },
      {
        eyebrow: 'Know',
        heading: 'Who holds it, and for how long',
        body: 'The incumbent, the ceiling, the end date and the vehicle it sits on, straight from the award record.',
        media: img('d-recompete', 'A contract coming back with its incumbent, value and end date', true),
      },
      {
        eyebrow: 'Plan',
        heading: 'A year to get ready, not a week',
        body: 'Agencies start planning 12 to 18 months before a contract ends. Line up the buyer, the team and the past performance while there is still time.',
        media: img('g-expiring', 'A list of recompetes in the next 12 months with holder and end date', false),
      },
    ],
  },
  {
    slug: 'forecasts',
    name: 'Agency forecasts',
    menuDesc: 'What agencies plan to buy in the next 6 to 18 months.',
    icon: '<path d="M8 3v4M16 3v4M4 10h16"/><rect x="4" y="5" width="16" height="16" rx="2"/>',
    metaDescription: 'See what federal agencies plan to buy in the next 6 to 18 months, from their published procurement forecasts, on one map.',
    eyebrow: 'Agency forecasts',
    headline: 'Know what agencies will buy',
    headlineAccent: 'before they post it',
    sub: 'Agency procurement forecasts in one place, so you can meet the buyer while the requirement is still being written.',
    hero: clip('mindy-upcoming-buys', 'Upcoming agency buys from procurement forecasts'),
    tryHref: '/opportunity-map?horizon=forecast',
    tryLabel: 'See agency forecasts',
    sections: [
      {
        eyebrow: 'See',
        heading: 'Planned buys on the map',
        body: 'Forecasts sit next to open bids and recompetes, so one view shows what is open, what is ending and what is planned.',
        media: img('map-forecast', 'The map showing agency forecasts', true),
      },
      {
        eyebrow: 'Read',
        heading: 'The buy, the quarter, the office',
        body: 'Each forecast shows what the agency plans to buy, the expected quarter and value, and the office that owns it.',
        media: img('d-forecast', 'A forecast with its expected quarter, value and buying office', true),
      },
      {
        eyebrow: 'Prepare',
        heading: 'Show up before the solicitation',
        body: 'Use the lead time to answer sources sought, meet the small business office and shape the requirement.',
        media: img('g-rfi', 'A drafted response to a sources sought notice', false),
      },
    ],
  },
  {
    slug: 'players',
    name: 'Players',
    menuDesc: 'Incumbents, competitors and teaming partners.',
    icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>',
    metaDescription: 'See who wins federal work in your market: incumbents, competitors and teaming partners, from their award history.',
    eyebrow: 'Players',
    headline: 'Know who you are up against,',
    headlineAccent: 'and who to team with',
    sub: 'The companies winning federal work in your market, with their award history, the buyers they win with and the set-asides they hold.',
    hero: img('g-whoholds', 'An incumbent check: who holds a contract, its ceiling and end date', false),
    tryHref: '/opportunity-map?mode=companies',
    tryLabel: 'Meet the players',
    sections: [
      {
        eyebrow: 'Size up',
        heading: 'A dossier on any competitor',
        body: 'What they won, who they won it from, what ends soon and which set-asides they used, from the award record.',
        media: img('g-competitor', 'A competitor dossier with awards, top buyer and expiring contracts', false),
      },
      {
        eyebrow: 'Team',
        heading: 'Find the partner you are missing',
        body: 'Small businesses with the certification or the past performance you need, already winning in your market.',
        media: img('g-teaming', 'A list of teaming partners with certifications and award totals', false),
      },
      {
        eyebrow: 'Reach',
        heading: 'Get on a prime’s radar',
        body: 'The small business liaisons at the primes who buy what you do, so you can ask for the subcontract.',
        media: img('g-primes', 'A list of small business liaisons at large primes', false),
      },
    ],
  },
  {
    slug: 'market-research',
    name: 'Market research',
    menuDesc: 'Who buys what you sell, and how much they spend.',
    icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    metaDescription: 'Research any federal market: who buys it, how much they spend, who wins it and what the agencies are struggling with.',
    eyebrow: 'Market research',
    headline: 'Understand your federal market',
    headlineAccent: 'in minutes',
    sub: 'Who buys what you sell, how much they spend, who wins it and where small businesses get in.',
    hero: img('g-whowins', 'A competitive landscape: market size, market share and awards per quarter', false),
    tryHref: '/opportunity-map/reports',
    tryLabel: 'Open Markets',
    sections: [
      {
        eyebrow: 'Buyers',
        heading: 'A one-pager on any agency',
        body: 'What it buys most, what it is struggling with, how much goes to small business and who to call first.',
        media: img('g-agency', 'An agency one-pager with buying patterns and who to call', false),
      },
      {
        eyebrow: 'Needs',
        heading: 'What the agency is struggling with',
        body: 'Priorities and problems from GAO, inspector general and budget documents, so your pitch answers a real need.',
        media: img('g-priorities', 'An agency brief listing its priorities and problems with sources', false),
      },
      {
        eyebrow: 'Events',
        heading: 'Where to meet the buyers',
        body: 'Industry days, outreach sessions and small business forums, with the date, place and whether they are in person.',
        media: img('g-calendar', 'An event calendar of industry days and small business forums', false),
      },
    ],
  },
  {
    slug: 'bid-with-confidence',
    name: 'Bid with confidence',
    menuDesc: 'A bid or no-bid read before you write a proposal.',
    icon: '<path d="M9 12l2 2 4-4"/><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    metaDescription: 'Decide whether to bid before you spend a week on a proposal, then build the compliance matrix, the price and the capture plan from the same data.',
    eyebrow: 'Bid with confidence',
    headline: 'Know if you should bid',
    headlineAccent: 'before you write',
    sub: 'A bid or no-bid read on any opportunity, then the compliance matrix, the price and the capture plan to win it.',
    hero: img('g-bid', 'A bid decision with a fit score and the reasons behind it', false),
    tryHref: '/bid',
    tryLabel: 'See how to bid',
    sections: [
      {
        eyebrow: 'Comply',
        heading: 'Every requirement, mapped',
        body: 'Mindy reads the solicitation and lists every instruction and evaluation factor, where it goes in your proposal, and what is still missing.',
        media: img('g-matrix', 'A compliance matrix mapping requirements to proposal sections', false),
      },
      {
        eyebrow: 'Price',
        heading: 'Price to win, from real rates',
        body: 'Low, typical and high labor rates for the roles on the bid, from federal contract pricing data.',
        media: img('g-ptw', 'A price-to-win table of labor rates by role', false),
      },
      {
        eyebrow: 'Capture',
        heading: 'A plan from today to award',
        body: 'Who holds it now, who else will bid, who to meet and which partner fills the gap.',
        media: img('g-capture', 'A capture plan with the incumbent, likely bidders and next steps', false),
      },
    ],
  },
];

export function featurePage(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((f) => f.slug === slug);
}

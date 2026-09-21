/**
 * The public content surface, as one list, so every shell links the same set.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On 2026-08-24 the homepage cut over from `/mindy-landing` to `/today` (#1315).
 * `/mindy-landing` linked to `/contractors`, `/naics`, `/top`, `/discover` and
 * `/research`. `/today` linked to none of them — it ships app chrome only.
 *
 * Measured on 2026-09-21 against the live site and Google's URL Inspection API:
 *
 *   - The root is the ONLY page on the domain Google reliably indexes.
 *   - The root's HTML contained ZERO references to /contractors, /agencies,
 *     /glossary, /blog, /compare, /research or /market-intelligence — checked
 *     including the RSC flight payload, not just visible markup.
 *   - 15 of 21 sampled URLs across every cluster came back "Crawled - currently
 *     not indexed", and that set now includes /pricing and /compare/govwin.
 *
 * A 36,077-URL sitemap with no internal links pointing into it is not a
 * discoverable site; it is a list Google is free to ignore, and it did. These
 * links are the repair. Keep them as real server-rendered `<a href>` elements:
 * a crawler that has to run JavaScript to find a link mostly does not find it.
 *
 * Only URLs verified to return HTTP 200 belong here. `/expiring-contracts`
 * (308 → `/`, retired product) and `/bd-assist` (307 → `/briefings`) are
 * deliberately absent — linking a redirect spends the equity this file exists to
 * deliver. `/forecasts` was absent for the same reason until its route was
 * built; it is listed now because it serves 200.
 */

export interface SiteLink {
  href: string;
  label: string;
}

export interface SiteLinkGroup {
  heading: string;
  links: SiteLink[];
}

export const SITE_LINK_GROUPS: SiteLinkGroup[] = [
  {
    heading: 'Contractor data',
    links: [
      { href: '/contractors', label: 'Federal contractor database' },
      { href: '/top', label: 'Top contractor rankings' },
      { href: '/awards', label: 'Federal award records' },
      { href: '/recompete', label: 'Contract recompetes' },
      { href: '/forecasts', label: 'Agency forecasts' },
      { href: '/naics', label: 'Contracts by NAICS code' },
    ],
  },
  {
    heading: 'Buyers & markets',
    links: [
      { href: '/agencies', label: 'Federal agency directory' },
      { href: '/opportunity-hunter', label: 'Open opportunities' },
      { href: '/spending', label: 'Federal spending explorer' },
      { href: '/market-intelligence', label: 'Market intelligence' },
      { href: '/discover', label: 'Discover the federal market' },
    ],
  },
  {
    heading: 'Set-aside programs',
    links: [
      { href: '/set-asides', label: 'All set-aside programs' },
      { href: '/set-asides/8a', label: '8(a) contracts' },
      { href: '/set-asides/hubzone', label: 'HUBZone contracts' },
      { href: '/set-asides/sdvosb', label: 'SDVOSB contracts' },
      { href: '/set-asides/wosb', label: 'WOSB contracts' },
    ],
  },
  {
    heading: 'Learn',
    links: [
      { href: '/glossary', label: 'GovCon glossary' },
      { href: '/blog', label: 'Federal contracting blog' },
      { href: '/research', label: 'The Mindy Institute' },
      { href: '/free-resources', label: 'Free resources' },
    ],
  },
  {
    heading: 'Compare',
    links: [
      { href: '/compare', label: 'All comparisons' },
      { href: '/compare/govwin', label: 'GovWin alternative' },
      { href: '/compare/highergov', label: 'HigherGov alternative' },
      { href: '/compare/sam-gov', label: 'SAM.gov alternative' },
    ],
  },
  {
    heading: 'Mindy',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/about', label: 'About' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

/** Every href the footer advertises, flattened — used by the route tests. */
export const SITE_FOOTER_HREFS: string[] = SITE_LINK_GROUPS.flatMap((g) =>
  g.links.map((l) => l.href),
);

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The footer as a raw HTML string, for the hand-built route handlers
 * (`/today` and friends) that render HTML directly rather than through React.
 * React surfaces should map `SITE_LINK_GROUPS` into JSX instead.
 */
export function siteFooterHtml(): string {
  const groups = SITE_LINK_GROUPS.map(
    (g) => `<div>
      <h3>${escapeHtml(g.heading)}</h3>
      <ul>${g.links
        .map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`)
        .join('')}</ul>
    </div>`,
  ).join('');

  return `<footer class="sfoot">
  <div class="sfoot-g">${groups}</div>
  <div class="sfoot-b">Mindy — federal market intelligence built on SAM.gov, USASpending and agency forecast data.</div>
</footer>`;
}

/**
 * Listicle definitions for /top/[slug] pages.
 *
 * Each entry: the slug Google sees, the title, the description, and
 * a "kind" + filter value the page uses to pick the right BQ query.
 *
 * Slugs chosen based on real GSC query data (May 2026): "top federal
 * system integrators", "top government contractors", "largest federal
 * contractors", "top defense contractors", "top 8a contractors", etc.
 */

export type ListicleKind = 'all' | 'agency' | 'sub-agency' | 'naics' | 'set-aside' | 'state';

export interface ListicleSpec {
  slug: string;
  title: string;
  shortTitle: string; // for index card
  description: string; // ~155 char meta description
  intro: string; // 1-2 sentence H1 lead
  kind: ListicleKind;
  filter?: string;
  filterPatterns?: string[]; // for set-aside
  cohort: string; // displayed e.g. "317,135 contractors" / "Department of Defense"
}

export const LISTICLES: ListicleSpec[] = [
  // Hub spokes that match the most-searched terms in GSC
  {
    slug: 'government-contractors',
    title: 'Top 50 Government Contractors by Federal Spending',
    shortTitle: 'Top Government Contractors',
    description:
      'The largest federal contractors by total obligated dollars across all agencies, FY2016–FY2026. Live data from USAspending.gov, ranked by Mindy.',
    intro:
      'These are the 50 contractors that received the most federal contract dollars across all U.S. agencies between FY2016 and FY2026.',
    kind: 'all',
    cohort: 'across all federal agencies',
  },
  {
    slug: 'federal-system-integrators',
    title: 'Top 50 Federal Systems Integrators (NAICS 541512)',
    shortTitle: 'Federal System Integrators',
    description:
      'Largest federal systems integrators by NAICS 541512 (Computer Systems Design Services). Ranked by total obligated 2016–2026.',
    intro:
      'The largest federal systems integrators by NAICS 541512 (Computer Systems Design Services). Includes Booz Allen, Leidos, SAIC, CACI, ManTech, and the rest of the prime IT services tier.',
    kind: 'naics',
    filter: '541512',
    cohort: 'NAICS 541512 — Computer Systems Design Services',
  },
  {
    slug: 'defense-contractors',
    title: 'Top 50 Defense Contractors (DoD)',
    shortTitle: 'Top Defense Contractors',
    description:
      'Largest U.S. Department of Defense contractors by total obligated 2016–2026. Lockheed, Boeing, Raytheon, and the full DoD prime tier ranked.',
    intro:
      'The 50 largest contractors to the U.S. Department of Defense by total obligated dollars, FY2016–FY2026.',
    kind: 'agency',
    filter: 'Department of Defense',
    cohort: 'U.S. Department of Defense',
  },
  {
    slug: 'va-contractors',
    title: 'Top 50 VA Contractors (Department of Veterans Affairs)',
    shortTitle: 'Top VA Contractors',
    description:
      'Largest Department of Veterans Affairs (VA) contractors by total obligated 2016–2026, ranked from USAspending data.',
    intro:
      'The 50 largest contractors to the U.S. Department of Veterans Affairs by total obligated dollars, FY2016–FY2026.',
    kind: 'agency',
    filter: 'Department of Veterans Affairs',
    cohort: 'U.S. Department of Veterans Affairs',
  },
  {
    slug: 'dhs-contractors',
    title: 'Top 50 DHS Contractors (Department of Homeland Security)',
    shortTitle: 'Top DHS Contractors',
    description:
      'Largest Department of Homeland Security (DHS) contractors by total obligated 2016–2026. ICE, CBP, TSA, FEMA contractors ranked.',
    intro:
      'The 50 largest contractors to the U.S. Department of Homeland Security by total obligated dollars, FY2016–FY2026.',
    kind: 'agency',
    filter: 'Department of Homeland Security',
    cohort: 'U.S. Department of Homeland Security',
  },
  {
    slug: '8a-contractors',
    title: 'Top 50 8(a) Contractors by Federal Awards',
    shortTitle: 'Top 8(a) Contractors',
    description:
      'Largest SBA 8(a) Business Development Program contractors by total obligated 2016–2026 across both sole-source and competed awards.',
    intro:
      'The 50 largest 8(a) Business Development Program contractors by total federal obligated dollars (sole source + competed set-asides, FY2016–FY2026).',
    kind: 'set-aside',
    filterPatterns: ['8(A)%', '8A %', '%8(A)%'],
    cohort: 'SBA 8(a) Business Development Program participants',
  },
  {
    slug: 'sdvosb-contractors',
    title: 'Top 50 SDVOSB Contractors by Federal Awards',
    shortTitle: 'Top SDVOSB Contractors',
    description:
      'Largest Service-Disabled Veteran-Owned Small Business (SDVOSB) contractors by total obligated 2016–2026.',
    intro:
      'The 50 largest Service-Disabled Veteran-Owned Small Business (SDVOSB) contractors by total federal obligated dollars across all SDVOSB set-aside awards (FY2016–FY2026).',
    kind: 'set-aside',
    filterPatterns: [
      'SERVICE DISABLED VETERAN OWNED SMALL BUSINESS%',
      'SDVOSB%',
    ],
    cohort: 'Service-Disabled Veteran-Owned Small Business contractors',
  },
  {
    slug: 'hubzone-contractors',
    title: 'Top 50 HUBZone Contractors by Federal Awards',
    shortTitle: 'Top HUBZone Contractors',
    description:
      'Largest HUBZone-certified contractors by total obligated 2016–2026 across HUBZone set-aside awards.',
    intro:
      'The 50 largest HUBZone-certified contractors by total federal obligated dollars across HUBZone set-aside and sole-source awards (FY2016–FY2026).',
    kind: 'set-aside',
    filterPatterns: ['HUBZONE%'],
    cohort: 'SBA HUBZone-certified contractors',
  },
  // Military branch slices — GSC query "military awarded contractors" (3)
  // plus high-intent branch-specific queries that aren't yet competing.
  {
    slug: 'military-contractors',
    title: 'Top 50 U.S. Military Contractors',
    shortTitle: 'Top Military Contractors',
    description:
      'Largest contractors to the U.S. Army, Navy, Air Force, and Marines by total obligated 2016–2026. Live USAspending data.',
    intro:
      'The 50 largest U.S. military contractors by total obligated dollars across the Army, Navy, Air Force, and Marine Corps (FY2016–FY2026).',
    kind: 'sub-agency',
    filterPatterns: [
      'Department of the Army',
      'Department of the Navy',
      'Department of the Air Force',
      'Department of the Marines',
      'United States Marine Corps',
    ],
    cohort: 'U.S. military service branches (Army, Navy, Air Force, Marines)',
  },
  {
    slug: 'army-contractors',
    title: 'Top 50 U.S. Army Contractors',
    shortTitle: 'Top Army Contractors',
    description:
      'Largest U.S. Army contractors by total obligated 2016–2026. Department of the Army primes ranked from USAspending data.',
    intro:
      'The 50 largest contractors to the U.S. Department of the Army by total obligated dollars (FY2016–FY2026).',
    kind: 'sub-agency',
    filterPatterns: ['Department of the Army'],
    cohort: 'U.S. Department of the Army',
  },
  {
    slug: 'navy-contractors',
    title: 'Top 50 U.S. Navy Contractors',
    shortTitle: 'Top Navy Contractors',
    description:
      'Largest U.S. Navy contractors by total obligated 2016–2026. Includes Marine Corps awards routed through the Department of the Navy.',
    intro:
      'The 50 largest contractors to the U.S. Department of the Navy by total obligated dollars (FY2016–FY2026). Includes Marine Corps awards routed through the Navy.',
    kind: 'sub-agency',
    filterPatterns: ['Department of the Navy'],
    cohort: 'U.S. Department of the Navy',
  },
  {
    slug: 'air-force-contractors',
    title: 'Top 50 U.S. Air Force Contractors',
    shortTitle: 'Top Air Force Contractors',
    description:
      'Largest U.S. Air Force contractors by total obligated 2016–2026. Department of the Air Force primes ranked from USAspending.',
    intro:
      'The 50 largest contractors to the U.S. Department of the Air Force by total obligated dollars (FY2016–FY2026).',
    kind: 'sub-agency',
    filterPatterns: ['Department of the Air Force'],
    cohort: 'U.S. Department of the Air Force',
  },
  {
    slug: 'wosb-contractors',
    title: 'Top 50 WOSB Contractors by Federal Awards',
    shortTitle: 'Top WOSB Contractors',
    description:
      'Largest Women-Owned Small Business (WOSB) contractors by total obligated 2016–2026, including EDWOSB awards.',
    intro:
      'The 50 largest Women-Owned Small Business (WOSB) and Economically Disadvantaged WOSB contractors by total federal obligated dollars (FY2016–FY2026).',
    kind: 'set-aside',
    filterPatterns: [
      'WOMEN OWNED SMALL BUSINESS%',
      'ECONOMICALLY DISADVANTAGED WOMEN%',
    ],
    cohort: 'Women-Owned Small Business contractors',
  },
];

// State-based listicles. recipient_state is a 2-letter code in BQ.
// Adds 51 new listicle URLs (50 states + DC) like:
//   /top/contractors-in-virginia
//   /top/contractors-in-texas
// Geographic SEO is high-intent BD use case ("who's in my market").
// Auto-generated below so adding a state is one line in this map.
const US_STATES: Array<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

function stateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const STATE_LISTICLES: ListicleSpec[] = US_STATES.map(([code, name]) => {
  const slug = `contractors-in-${stateSlug(name)}`;
  return {
    slug,
    title: `Top 50 Federal Contractors in ${name}`,
    shortTitle: `Top Contractors in ${name}`,
    description: `Largest federal contractors headquartered in ${name} by total obligated FY2016–FY2026. Live USAspending data ranked by Mindy.`,
    intro: `The 50 largest federal contractors headquartered in ${name} by total obligated dollars (FY2016–FY2026), based on recipient state address from USAspending.gov.`,
    kind: 'state' as const,
    filter: code,
    cohort: `Contractors headquartered in ${name}`,
  };
});

// Push state listicles into the main LISTICLES array so they get
// picked up by the /top hub page, sitemap, and route handler.
LISTICLES.push(...STATE_LISTICLES);

export function getListicleBySlug(slug: string): ListicleSpec | undefined {
  return LISTICLES.find((l) => l.slug === slug);
}

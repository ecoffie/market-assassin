/**
 * Mindy's DEDICATED SBIR/STTR search is RETIRED (2026-09-26) — ONE notice for every surface that offered it:
 * the MCP tool `search_sbir`, the in-app SBIR panel, `/api/sbir`, the Opportunity Map's SBIR source
 * and `/api/market-scan`'s SBIR section.
 *
 * Why (tasks/sbir-reed-investigation-2026-09-26.md): none of those surfaces had a working source of
 * OPEN topics. The DoD topic cache has never received a row; the "multisite" slice is 42/42 NIH
 * RePORTER project pages (funded awards, whose close_date is the project END); NIH RePORTER itself is
 * an award index. Every "SBIR opportunity" Mindy showed was award history.
 *
 * Scope: Mindy's dedicated SBIR search only — NOT all SBIR-related discovery. The Grants panel (a
 * separate Grants.gov path) is left in place but is NOT recommended here: its health as a live SBIR/STTR
 * source is unverified (separate investigation). The notice points users to the official sites directly.
 * This file retires the SEARCH, not the data: `src/lib/sbir/*` libraries, the `dod_sbir_topics` and
 * `aggregated_opportunities` tables, their sync crons (parked feeds) and all logs are kept untouched.
 * To restore any SBIR surface you need a working open-topic source first (investigation record §7).
 */

export const SBIR_SEARCH_RETIRED = {
  code: 'sbir_search_retired' as const,
  retired_on: '2026-09-26',
  reason:
    'Mindy does not currently provide a reliable source of OPEN SBIR/STTR topics, so its dedicated SBIR/STTR search has been withdrawn rather than show award history in their place.',
  instead:
    'For open SBIR/STTR topics, deadlines and agency funding announcements, go directly to SBIR.gov (sbir.gov/topics), the DoD SBIR/STTR portal (DSIP) or Grants.gov.',
  links: [
    { label: 'SBIR.gov topics', url: 'https://www.sbir.gov/topics' },
    { label: 'DoD SBIR/STTR (DSIP)', url: 'https://www.dodsbirsttr.mil/topics-app/' },
    { label: 'Grants.gov', url: 'https://www.grants.gov/search-grants' },
  ],
};

/** The one sentence every surface shows. */
export function sbirSearchRetiredMessage(): string {
  const r = SBIR_SEARCH_RETIRED;
  return `Mindy's dedicated SBIR/STTR search was retired on ${r.retired_on} and is no longer available. ${r.reason} ${r.instead}`;
}

/** JSON body for a retired HTTP endpoint (served with 410 Gone). */
export function sbirSearchRetiredBody() {
  return {
    success: false,
    retired: true,
    code: SBIR_SEARCH_RETIRED.code,
    retired_on: SBIR_SEARCH_RETIRED.retired_on,
    message: sbirSearchRetiredMessage(),
    links: SBIR_SEARCH_RETIRED.links,
  };
}

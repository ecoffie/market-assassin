/**
 * SBIR/STTR search is RETIRED (2026-09-26) — ONE notice for every surface that used to offer it:
 * the MCP tool `search_sbir`, the in-app SBIR panel, `/api/sbir`, the Opportunity Map's SBIR source
 * and `/api/market-scan`'s SBIR section.
 *
 * Why (tasks/sbir-reed-investigation-2026-09-26.md): none of those surfaces had a working source of
 * OPEN topics. The DoD topic cache has never received a row; the "multisite" slice is 42/42 NIH
 * RePORTER project pages (funded awards, whose close_date is the project END); NIH RePORTER itself is
 * an award index. Every "SBIR opportunity" Mindy showed was award history.
 *
 * This file retires the SEARCH, not the data: `src/lib/sbir/*` libraries, the `dod_sbir_topics` and
 * `aggregated_opportunities` tables, their sync crons (parked feeds) and all logs are kept untouched.
 * To restore any SBIR surface you need a working open-topic source first (investigation record §7).
 */

export const SBIR_SEARCH_RETIRED = {
  code: 'sbir_search_retired' as const,
  retired_on: '2026-09-26',
  reason:
    'Mindy does not currently provide a reliable source of OPEN SBIR/STTR topics, so SBIR/STTR search has been withdrawn rather than show award history in their place.',
  instead:
    'For open SBIR/STTR topics and deadlines, use SBIR.gov (sbir.gov/topics) or the DoD SBIR/STTR portal (DSIP) directly. Agency SBIR/STTR funding announcements posted on Grants.gov remain searchable in Mindy\'s Grants panel.',
  links: [
    { label: 'SBIR.gov topics', url: 'https://www.sbir.gov/topics' },
    { label: 'DoD SBIR/STTR (DSIP)', url: 'https://www.dodsbirsttr.mil/topics-app/' },
  ],
};

/** The one sentence every surface shows. */
export function sbirSearchRetiredMessage(): string {
  const r = SBIR_SEARCH_RETIRED;
  return `SBIR/STTR search was retired on ${r.retired_on} and is no longer available. ${r.reason} ${r.instead}`;
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

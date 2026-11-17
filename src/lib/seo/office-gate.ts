/**
 * Thin-content + identity rules for the public DoD buying-office pages (/offices/[dodaac]).
 *
 * Pure functions only (no DB, no network) so the page, the sitemap and the unit test share ONE
 * definition. Two separate questions, deliberately not merged:
 *
 *   officeIndexable()      — may the PAGE carry `index`? (else robots noindex)
 *   officeSitemapEligible() — may the SITEMAP advertise it?
 *
 * The sitemap predicate is a strict SUBSET of the page predicate: a sitemap entry is a claim that
 * the URL deserves indexing, so it must never list a page that renders `noindex`. The sitemap can
 * only cheaply measure the notice side (one paged read of `sam_opportunities`); the contact roster
 * lives in a ~300K-row table we will not drain per sitemap build. So a roster-only office can be
 * indexed if Google finds it through a link, but it is not advertised.
 *
 * WHY THESE THRESHOLDS
 * --------------------
 * A page with one stale notice and no people is a doorway page, the exact class Google demoted
 * this domain for in July 2026. "Substance" = at least OFFICE_MIN_ACTIVE_NOTICES notices SAM
 * still marks active for this DoDAAC (open now or recently closed), OR at least
 * OFFICE_MIN_CONTACTS distinct government buyers named on this office's notices. 3 is the same
 * floor the in-app office-roster facet uses to call a roster "real" (federal-contacts route,
 * `list.length >= 3`), so the public page and the app agree on what an office with a roster is.
 *
 * UNKNOWN IS NOT ZERO
 * -------------------
 * Every count here is `number`, never `number | null`: the data layer throws
 * SeoTemporarilyUnavailableError when a count could not be established (Bug Prevention Rule #11),
 * so a failed read can never arrive here as 0 and quietly noindex a real office.
 */

export const OFFICE_MIN_ACTIVE_NOTICES = 3;
export const OFFICE_MIN_CONTACTS = 3;

export interface OfficeSubstance {
  /** sam_opportunities rows with active=true whose solicitation_number starts with the DoDAAC. */
  activeNotices: number;
  /** Distinct, usable government-buyer contacts named on this office's notices. */
  contacts: number;
}

/** May the office page be indexed? */
export function officeIndexable(s: OfficeSubstance): boolean {
  return s.activeNotices >= OFFICE_MIN_ACTIVE_NOTICES || s.contacts >= OFFICE_MIN_CONTACTS;
}

/**
 * May the sitemap list it? Notice-side only (see header) — every office this admits also passes
 * officeIndexable(), whatever its contact count.
 */
export function officeSitemapEligible(activeNotices: number): boolean {
  return activeNotices >= OFFICE_MIN_ACTIVE_NOTICES;
}

/**
 * DoD scope (owner decision: DoD first, civilian later). The DoDAAC directory is built from
 * FPDS awarding_agency / awarding_sub_agency, where the Army, Navy, Air Force, DLA, DHA, USACE and
 * every other component sit under "Department of Defense" (or carry "Defense"/a service name in the
 * sub-agency). Anything else — a civilian agency that also uses 6-char office codes — is out.
 */
export function isDodOffice(agency: string | null | undefined, subAgency?: string | null): boolean {
  const a = `${agency || ''} ${subAgency || ''}`;
  // An independent civilian board that merely has "Defense" in its name.
  if (/defense nuclear facilities safety board/i.test(a)) return false;
  return /\bdefen[cs]e\b|\b(army|navy|air force|marine corps|space force)\b/i.test(a);
}

/**
 * The 6-char prefix a raw solicitation number contributes to, mirroring the page's
 * `solicitation_number ILIKE '<DODAAC>%'` predicate exactly: case-insensitive, NO trimming or
 * de-dashing (ILIKE does neither), so the sitemap's per-office count equals the page's count.
 * Returns null for anything that is not a well-formed DoDAAC prefix.
 */
export function dodaacPrefixOf(solicitationNumber: string | null | undefined): string | null {
  if (!solicitationNumber) return null;
  const p = solicitationNumber.slice(0, 6).toUpperCase();
  return /^[A-Z][A-Z0-9]{5}$/.test(p) ? p : null;
}

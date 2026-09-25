/**
 * Is a LEGACY GovInfo `gao_high_risk` row current enough to serve as buyer intelligence?
 *
 * ⚠️ WHY THIS EXISTS (Strategic Evidence audit, 2026-09-25).
 * The 445 `agency_intelligence` rows of type `gao_high_risk` are GovInfo GAOREPORTS
 * testimonies published 1993-10-06 → 2000-09-27 — the collection is frozen. Every one
 * is stamped `fiscal_year = 2026`, because the fetcher wrote the FETCH year
 * (`fiscalYear = new Date().getFullYear()`), not the government's date. Through
 * `getUnifiedAgencyIntelligence()` they reached `understand_customer` as `gao_reports`
 * with no date at all, so a 1998 testimony read as a current GAO finding about the
 * buyer (28 for VA, 21 for DoD — and 27 attributed to DHS, which did not exist until
 * 2002).
 *
 * THE RULE: currency is judged ONLY from `publication_date` (the government's clock).
 * `fiscal_year` on these rows is Mindy's clock and is never read here. An UNDATED row
 * is not current: we cannot establish its age, and "unknown" must not render as "now".
 *
 * The rows are not deleted and not rewritten — they stay in the table for admin and
 * historical research (`includeHistoricalGao: true`). Living GAO comes from the
 * Institute (`institute_gao`, daily) through the shared sourced reader.
 */

/**
 * Oldest GAO testimony/report still served as current buyer intelligence.
 * GAO's High-Risk List is re-issued every two years and open recommendations are
 * tracked for roughly four, so five years is a generous ceiling: anything older is
 * history, not what the agency is working on now.
 */
export const LEGACY_GAO_MAX_AGE_YEARS = 5;

export interface LegacyGaoDated {
  intelligence_type?: string | null;
  publication_date?: string | null;
}

/** Parse a DATE / ISO string to a UTC day. Null when absent or unparseable. */
function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * True when a row may be served as CURRENT agency intelligence.
 * Non-GAO rows are out of scope and always pass — this rule is about GovInfo GAO only.
 */
export function isCurrentLegacyGao(row: LegacyGaoDated, now: Date = new Date()): boolean {
  if (row.intelligence_type !== 'gao_high_risk') return true;
  const published = parseDay(row.publication_date);
  if (!published) return false;
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - LEGACY_GAO_MAX_AGE_YEARS,
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  return published >= cutoff;
}

/** The government date shown beside a served legacy GAO title. */
export function legacyGaoDateLabel(row: LegacyGaoDated): string {
  const published = parseDay(row.publication_date);
  return published ? published.toISOString().slice(0, 10) : 'date unknown';
}

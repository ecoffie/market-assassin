/**
 * Recipient (contractor) queries — one function per page-section.
 *
 * Lookup model: pages route by slug, slug derives from recipient_name.
 * But the canonical key in BQ is recipient_uei. We need to handle:
 *   - Slug → UEI resolution (slug isn't unique if two contractors
 *     happen to share a normalized name)
 *   - Falling back to name search when UEI unknown
 *
 * Each function caches independently — top NAICS for Lockheed
 * doesn't have to recompute when only the awards list changed.
 */
import { BQ_TABLES } from './client';
import { queryCached } from './cache';

// Convert a display name into a URL-safe slug. Must exactly match
// slugifyContractorName() in src/lib/contractor-sales-history.ts so
// contractor URLs work identically whether the page was rendered
// from contractors.json (legacy) or BigQuery (new).
export function recipientSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export interface RecipientProfile {
  recipient_uei: string;
  recipient_name: string;
  parent_uei: string | null;
  parent_name: string | null;
  cage_code: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  total_obligated: number;
  award_count: number;
  transaction_count: number;
  first_action_date: string;
  last_action_date: string;
  distinct_agency_count: number;
  distinct_naics_count: number;
}

/**
 * Get the recipient summary by slug. Returns the highest-spending
 * match if multiple UEIs share the same normalized name (rare but
 * happens — e.g. parent/subsidiary with same brand name).
 *
 * SQL mirrors slugifyContractorName():
 *   1. replace & with " and "
 *   2. lowercase + replace non-alphanum runs with "-"
 *   3. trim leading/trailing dashes
 *   4. truncate at 120 chars
 */
export async function getRecipientBySlug(slug: string): Promise<RecipientProfile | null> {
  const rows = await queryCached<RecipientProfile>({
    cacheKey: `recipient:by-slug:${slug}:v2`,
    query: `
      WITH slugged AS (
        SELECT
          *,
          SUBSTR(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                LOWER(REPLACE(recipient_name, '&', ' and ')),
                r'[^a-z0-9]+',
                '-'
              ),
              r'^-+|-+$',
              ''
            ),
            1, 120
          ) AS computed_slug
        FROM ${BQ_TABLES.recipients}
      )
      SELECT
        * EXCEPT(computed_slug, first_action_date, last_action_date),
        CAST(first_action_date AS STRING) AS first_action_date,
        CAST(last_action_date AS STRING) AS last_action_date
      FROM slugged
      WHERE computed_slug = @slug
      ORDER BY total_obligated DESC
      LIMIT 1
    `,
    params: { slug },
  });
  return rows[0] ?? null;
}

export async function getRecipientByUei(uei: string): Promise<RecipientProfile | null> {
  const rows = await queryCached<RecipientProfile>({
    cacheKey: `recipient:by-uei:${uei}:v2`,
    query: `
      SELECT
        * EXCEPT(first_action_date, last_action_date),
        CAST(first_action_date AS STRING) AS first_action_date,
        CAST(last_action_date AS STRING) AS last_action_date
      FROM ${BQ_TABLES.recipients}
      WHERE recipient_uei = @uei
      LIMIT 1
    `,
    params: { uei },
  });
  return rows[0] ?? null;
}

export interface TopAgencyRow {
  awarding_agency: string;
  total_amount: number;
  award_count: number;
  pct_of_total: number;
}

export async function getTopAgenciesForRecipient(
  uei: string,
  limit = 10,
): Promise<TopAgencyRow[]> {
  return queryCached<TopAgencyRow>({
    cacheKey: `recipient:${uei}:top-agencies:${limit}`,
    query: `
      WITH totals AS (
        SELECT SUM(obligation_amount) AS grand_total
        FROM ${BQ_TABLES.awards}
        WHERE recipient_uei = @uei
      )
      SELECT
        awarding_agency,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count,
        SUM(obligation_amount) / (SELECT grand_total FROM totals) AS pct_of_total
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei = @uei AND awarding_agency IS NOT NULL
      GROUP BY awarding_agency
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { uei, limit },
  });
}

export interface TopNaicsRow {
  naics_code: string;
  naics_description: string;
  total_amount: number;
  award_count: number;
}

export async function getTopNaicsForRecipient(
  uei: string,
  limit = 10,
): Promise<TopNaicsRow[]> {
  return queryCached<TopNaicsRow>({
    cacheKey: `recipient:${uei}:top-naics:${limit}`,
    query: `
      SELECT
        naics_code,
        ANY_VALUE(naics_description) AS naics_description,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei = @uei AND naics_code IS NOT NULL
      GROUP BY naics_code
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { uei, limit },
  });
}

export interface RecentAwardRow {
  award_id: string;
  piid: string | null;
  awarding_agency: string | null;
  awarding_office: string | null;
  naics_code: string | null;
  naics_description: string | null;
  description: string | null;
  obligation_amount: number;
  action_date: string;
  pop_start_date: string | null;
  pop_end_date: string | null;
  pop_state: string | null;
  set_aside: string | null;
}

export async function getRecentAwardsForRecipient(
  uei: string,
  limit = 25,
): Promise<RecentAwardRow[]> {
  // CAST DATE columns to STRING so we get 'YYYY-MM-DD' strings back
  // instead of BigQuery's wrapper objects ({value: 'YYYY-MM-DD'}) which
  // break our formatDate(). Also filter to dollar-bearing transactions —
  // $0 modifications dominate the recent timeline but tell users nothing.
  return queryCached<RecentAwardRow>({
    cacheKey: `recipient:${uei}:recent-awards:${limit}:v2`,
    query: `
      SELECT
        award_id,
        piid,
        awarding_agency,
        awarding_office,
        naics_code,
        naics_description,
        description,
        obligation_amount,
        CAST(action_date AS STRING) AS action_date,
        CAST(pop_start_date AS STRING) AS pop_start_date,
        CAST(pop_end_date AS STRING) AS pop_end_date,
        pop_state,
        set_aside
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei = @uei
        AND obligation_amount > 0
      ORDER BY action_date DESC
      LIMIT @limit
    `,
    params: { uei, limit },
  });
}

export interface YearlyTotalRow {
  fiscal_year: number;
  total_obligated: number;
  award_count: number;
}

export async function getYearlyTotalsForRecipient(uei: string): Promise<YearlyTotalRow[]> {
  return queryCached<YearlyTotalRow>({
    cacheKey: `recipient:${uei}:yearly-totals`,
    query: `
      SELECT
        fiscal_year,
        SUM(obligation_amount) AS total_obligated,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei = @uei
      GROUP BY fiscal_year
      ORDER BY fiscal_year ASC
    `,
    params: { uei },
  });
}

export interface YearlyByAgencyRow {
  fiscal_year: number;
  awarding_agency: string;
  total_amount: number;
  award_count: number;
}

/**
 * Yearly obligations broken out by awarding agency, for stacked-bar
 * drilldown. Returns rows for every (FY, agency) pair where the
 * contractor had activity. Caller rolls up to "top N + Other".
 */
export async function getYearlyByAgencyForRecipient(
  uei: string,
): Promise<YearlyByAgencyRow[]> {
  return queryCached<YearlyByAgencyRow>({
    cacheKey: `recipient:${uei}:yearly-by-agency`,
    query: `
      SELECT
        fiscal_year,
        awarding_agency,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei = @uei
        AND awarding_agency IS NOT NULL
      GROUP BY fiscal_year, awarding_agency
      ORDER BY fiscal_year ASC, total_amount DESC
    `,
    params: { uei },
  });
}

export interface ExecutiveRow {
  exec_rank: number;
  exec_name: string;
  exec_amount: number;
  reported_at: string;
}

export async function getExecutivesForRecipient(uei: string): Promise<ExecutiveRow[]> {
  return queryCached<ExecutiveRow>({
    cacheKey: `recipient:${uei}:executives:v2`,
    query: `
      SELECT
        exec_rank,
        exec_name,
        exec_amount,
        CAST(reported_at AS STRING) AS reported_at
      FROM ${BQ_TABLES.recipientExecutives}
      WHERE recipient_uei = @uei
      ORDER BY exec_rank ASC
    `,
    params: { uei },
  });
}

/**
 * Find similar contractors (same top NAICS + similar size band).
 * Powers the "Related Contractors" section that HigherGov uses for
 * internal linking density.
 */
export interface SimilarRecipientRow {
  recipient_uei: string;
  recipient_name: string;
  total_obligated: number;
}

export async function getSimilarRecipients(
  uei: string,
  topNaicsCode: string,
  limit = 8,
): Promise<SimilarRecipientRow[]> {
  // Scope to the last 3 fiscal years so we only scan ~20% of the
  // awards partition. With clustering on recipient_uei + recipient_name
  // and partition-pruning on fiscal_year, this scans ~500MB instead
  // of 3GB. "Related" means actively competing — old contractors that
  // exited the NAICS aren't useful related links anyway.
  const currentYear = new Date().getFullYear();
  return queryCached<SimilarRecipientRow>({
    cacheKey: `recipient:${uei}:similar:${topNaicsCode}:${limit}`,
    query: `
      SELECT
        recipient_uei,
        ANY_VALUE(recipient_name) AS recipient_name,
        SUM(obligation_amount) AS total_obligated
      FROM ${BQ_TABLES.awards}
      WHERE naics_code = @naics
        AND recipient_uei != @uei
        AND recipient_uei IS NOT NULL
        AND fiscal_year BETWEEN @minYear AND @maxYear
      GROUP BY recipient_uei
      ORDER BY total_obligated DESC
      LIMIT @limit
    `,
    params: {
      uei,
      naics: topNaicsCode,
      limit,
      minYear: currentYear - 3,
      maxYear: currentYear,
    },
  });
}

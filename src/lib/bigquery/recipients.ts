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

// Queries that scan the full `awards` table filtered by recipient_uei
// can exceed the BQ client's 5 GiB default maximumBytesBilled for
// mega-primes (Lockheed/RTX/McKesson scan >5 GiB), which BigQuery
// rejects → the page 500s. GSC flagged ~94 such server errors. Raise
// the per-query cap to 20 GiB (matching awards.ts) for every
// recipient query that touches the awards table. Cache hits are free;
// this only governs the cold-miss query that actually scans.
const AWARDS_SCAN_MAX_BYTES = String(20 * 1024 * 1024 * 1024); // 20 GiB

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
  pct_of_total: number;
}

export async function getTopAgenciesForRecipient(
  uei: string,
  limit = 10,
): Promise<TopAgencyRow[]> {
  return queryCached<TopAgencyRow>({
    cacheKey: `recipient:${uei}:top-agencies:${limit}:v3`,
    // Single-pass, and deliberately NO COUNT(DISTINCT award_id): that
    // column is the widest read in the query and ~doubled the scan
    // (5.9→3.0 GiB on mega-primes). The agency breakdown shows $ + %
    // share; the contractor's total award count still comes from the
    // recipients row (free). pct_of_total = share across this
    // contractor's agencies, via window sum before the LIMIT.
    query: `
      WITH per_agency AS (
        SELECT
          awarding_agency,
          SUM(obligation_amount) AS total_amount
        FROM ${BQ_TABLES.awards}
        WHERE recipient_uei = @uei AND awarding_agency IS NOT NULL
        GROUP BY awarding_agency
      )
      SELECT
        awarding_agency,
        total_amount,
        SAFE_DIVIDE(total_amount, SUM(total_amount) OVER ()) AS pct_of_total
      FROM per_agency
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { uei, limit },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
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
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
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
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
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
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
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
/**
 * Paginated full awards list for a recipient — powers the
 * /contractors/[slug]/contracts/[page] SEO subpages.
 *
 * Pagination uses fixed page size + offset. BQ can fetch ~50 rows from
 * a clustered query in <500ms cold (KV-cached after that), and big
 * primes (Lockheed) produce ~100 paginated URLs which Google can crawl
 * over weeks.
 *
 * Skips $0 modifications — they're real records but the user-facing
 * value is "what money moved", not "which admin paperwork was filed".
 */
export async function getPaginatedAwardsForRecipient(
  uei: string,
  page: number,
  pageSize: number = 50,
): Promise<{ rows: RecentAwardRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const [rows, totalRows] = await Promise.all([
    queryCached<RecentAwardRow>({
      cacheKey: `recipient:${uei}:awards-page:${page}:${pageSize}`,
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
        LIMIT @pageSize
        OFFSET @offset
      `,
      params: { uei, pageSize, offset },
      maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
    }),
    queryCached<{ total: number }>({
      cacheKey: `recipient:${uei}:awards-total`,
      query: `
        SELECT COUNT(*) AS total
        FROM ${BQ_TABLES.awards}
        WHERE recipient_uei = @uei AND obligation_amount > 0
      `,
      params: { uei },
      maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
    }),
  ]);
  return { rows, total: Number(totalRows[0]?.total ?? 0) };
}

/**
 * Full NAICS breakdown for a recipient — used on /contractors/[slug]/naics.
 * Returns all NAICS the contractor has activity in, not just top N.
 */
export async function getAllNaicsForRecipient(uei: string): Promise<TopNaicsRow[]> {
  return queryCached<TopNaicsRow>({
    cacheKey: `recipient:${uei}:all-naics`,
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
    `,
    params: { uei },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
  });
}

/**
 * Full agency breakdown for a recipient — used on /contractors/[slug]/agencies.
 * Returns all agencies, not just top N. Caller can paginate display-side.
 */
export async function getAllAgenciesForRecipient(uei: string): Promise<TopAgencyRow[]> {
  return queryCached<TopAgencyRow>({
    cacheKey: `recipient:${uei}:all-agencies:v3`,
    // Heaviest query on the site (82% of daily BQ scan per
    // INFORMATION_SCHEMA). Two fixes vs. the original:
    //  1) removed the correlated `WITH totals` subquery that scanned
    //     the cluster a SECOND time for the grand total — now a window
    //     SUM() over the grouped rows.
    //  2) dropped COUNT(DISTINCT award_id) — that wide column ~doubled
    //     the scan (5.9→3.0 GiB on mega-primes). The breakdown shows
    //     $ + % share; the contractor's total award count comes from
    //     the recipients row (free).
    query: `
      WITH per_agency AS (
        SELECT
          awarding_agency,
          SUM(obligation_amount) AS total_amount
        FROM ${BQ_TABLES.awards}
        WHERE recipient_uei = @uei AND awarding_agency IS NOT NULL
        GROUP BY awarding_agency
      )
      SELECT
        awarding_agency,
        total_amount,
        SAFE_DIVIDE(total_amount, SUM(total_amount) OVER ()) AS pct_of_total
      FROM per_agency
      ORDER BY total_amount DESC
    `,
    params: { uei },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
  });
}

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
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
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

/**
 * Top recipients for the sitemap — name + spend, ordered by spend.
 *
 * The sitemap MUST source from the same table the pages query
 * (recipients), or it emits URLs that 404. The legacy contractors.json
 * source had ~529 names with no matching recipient row (parent/holding
 * companies whose awards land under subsidiary legal names), which
 * Googlebot crawled into thousands of 404s.
 *
 * Capped: Google allows 50k URLs per sitemap file. We emit 4 URLs per
 * contractor (overview + contracts/agencies/naics), so the cap keeps
 * the contractor block under 48k and leaves room for the other blocks.
 * Top-by-spend is also the right SEO call — the biggest primes are what
 * people brand-search for.
 */
export interface SitemapRecipientRow {
  recipient_name: string;
  total_obligated: number;
}

export async function getTopRecipientsForSitemap(
  limit = 12000,
): Promise<SitemapRecipientRow[]> {
  return queryCached<SitemapRecipientRow>({
    cacheKey: `sitemap:top-recipients:${limit}`,
    query: `
      SELECT recipient_name, total_obligated
      FROM ${BQ_TABLES.recipients}
      WHERE recipient_name IS NOT NULL AND recipient_name != ''
      ORDER BY total_obligated DESC
      LIMIT @limit
    `,
    params: { limit },
  });
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

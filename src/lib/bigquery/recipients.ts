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
 * Minimum distinct rows a contractor needs before its /agencies or /naics
 * sub-page is treated as substantive enough to index. Below this the table
 * is near-empty (1-4 rows); Google crawls it, sees almost no unique content,
 * and parks it as "Crawled - currently not indexed", wasting crawl budget.
 *
 * Single source of truth — imported by BOTH the sitemap (to decide which
 * sub-page URLs to emit) and the sub-pages themselves (to decide their
 * robots directive). These two MUST agree: the sitemap can omit a thin URL,
 * but Google still discovers it through the always-rendered tab nav, so the
 * page itself must also declare noindex or the gate leaks. /contracts is
 * never gated — every recipient has award rows and it's the core
 * brand-search SEO target.
 */
export const SUBPAGE_MIN_ROWS = 5;

/**
 * Parent-org rollup profile — the contractor pages' primary data shape.
 *
 * Backed by `recipients_rollup` (one row per COALESCE(parent_uei,
 * recipient_uei)). Where RecipientProfile describes a single UEI,
 * RollupProfile describes the whole parent organization, so a household-
 * name prime shows its full footprint instead of one scattered subsidiary
 * UEI. `child_ueis` is the parent's complete UEI set — detail queries
 * filter awards by `recipient_uei IN UNNEST(child_ueis)` (which preserves
 * the awards table's recipient_uei cluster pruning, unlike filtering on
 * parent_uei). `canonical_slug` is the slug of `rollup_name`.
 */
export interface RollupProfile {
  rollup_uei: string;
  rollup_name: string;
  canonical_slug: string;
  child_ueis: string[];
  child_count: number;
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

// Shared SQL fragment: the computed-slug expression mirrors recipientSlug()
// exactly (lowercase, & → " and ", non-alphanum → "-", trim, 120 cap). Used
// by both the rollup slug lookup and the sibling-redirect resolver.
const COMPUTED_SLUG_SQL = (col: string) => `
  SUBSTR(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        LOWER(REPLACE(${col}, '&', ' and ')),
        r'[^a-z0-9]+', '-'
      ),
      r'^-+|-+$', ''
    ),
    1, 120
  )`;

// Legal-suffix words stripped when normalizing a company name for the
// name-merge. MUST stay in sync with the regex in build-derived.sql's
// recipients_rollup_merged block, and with normalizeCompanyName() below.
const MERGE_SUFFIX_RE =
  /\b(corporation|corp|incorporated|inc|llc|l\.?l\.?c|company|co|ltd|limited|lp|l\.?p|plc|holdings|holding|group|the)\b/g;

// SQL form of the suffix-strip normalization (operates on a name column).
const NORMALIZED_NAME_SQL = (col: string) => `
  TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(
      LOWER(${col}),
      r'\\b(corporation|corp|incorporated|inc|llc|l\\.?l\\.?c|company|co|ltd|limited|lp|l\\.?p|plc|holdings|holding|group|the)\\b', ''
    ),
    r'[^a-z0-9]+', ' '
  ))`;

// JS form of the same normalization, applied to a slug (dashes → spaces first
// so word boundaries match). Used to normalize the REQUESTED slug before the
// name-merge resolver arm. Mirrors recipients_rollup_merged + NORMALIZED_NAME_SQL.
export function normalizeCompanyName(slugOrName: string): string {
  return slugOrName
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(MERGE_SUFFIX_RE, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolve a slug to its parent-org rollup. This is the contractor pages'
 * primary entry point (replaces getRecipientBySlug for the page render).
 *
 * Slugs aren't unique: same-name orphan UEIs (null/self parent) can produce
 * the same slug as the true parent rollup. We resolve to the highest-spend
 * match — the dominant rollup wins (e.g. the 167-child "Lockheed Martin
 * Corp" beats two single-UEI orphans of the same name). Tiny orphans then
 * canonical-tag back to this same URL, so Google dedupes them.
 */
export async function getRollupBySlug(slug: string): Promise<RollupProfile | null> {
  const rows = await queryCached<RollupProfile>({
    cacheKey: `rollup:by-slug:${slug}:v2-merged`,
    query: `
      WITH slugged AS (
        SELECT
          *,
          ${COMPUTED_SLUG_SQL('rollup_name')} AS computed_slug
        FROM ${BQ_TABLES.recipientsRollup}
        WHERE rollup_name IS NOT NULL
      )
      SELECT
        rollup_uei,
        rollup_name,
        computed_slug AS canonical_slug,
        child_ueis,
        child_count,
        cage_code, address, city, state, zip, country,
        total_obligated, award_count, transaction_count,
        CAST(first_action_date AS STRING) AS first_action_date,
        CAST(last_action_date AS STRING) AS last_action_date,
        distinct_agency_count, distinct_naics_count
      FROM slugged
      WHERE computed_slug = @slug
      ORDER BY total_obligated DESC
      LIMIT 1
    `,
    params: { slug },
  });
  return rows[0] ?? null;
}

/**
 * Sibling-redirect resolver. Given the slug actually requested, return the
 * canonical rollup slug it should 301/308 to — or null if the requested
 * slug IS already canonical (so the page renders without redirecting).
 *
 * "Canonical" = the slug of the highest-spend rollup that owns this slug.
 * A subsidiary whose own name slugifies differently from its parent's
 * rollup_name would 404 today (only the top-spend name per slug resolves);
 * this maps any child UEI's name-slug to the parent's canonical slug so old
 * inbound links land on the live parent page instead of a 404.
 */
export async function resolveCanonicalSlug(slug: string): Promise<string | null> {
  // Normalized (suffix-stripped) form of the requested slug, for the name-merge
  // arm — catches pre-merge ROLLUP-name variants (e.g. the slug
  // "general-dynamics-corporation" whose rollup got merged into
  // "general-dynamics-corp"; that variant is no longer a rollup name nor an
  // exact child recipient_name, so only the normalized form finds it).
  const normSlug = normalizeCompanyName(slug);
  const rows = await queryCached<{ canonical_slug: string }>({
    cacheKey: `rollup:canonical-of:${slug}:v3-merged`,
    query: `
      WITH rollups AS (
        SELECT
          ${COMPUTED_SLUG_SQL('rollup_name')} AS canonical_slug,
          ${NORMALIZED_NAME_SQL('rollup_name')} AS norm_name,
          rollup_uei, total_obligated, child_ueis
        FROM ${BQ_TABLES.recipientsRollup}
        WHERE rollup_name IS NOT NULL
      ),
      -- Direct hit: the slug matches a rollup name. Canonical = highest-spend.
      direct AS (
        SELECT canonical_slug, total_obligated, 0 AS tiebreak
        FROM rollups
        WHERE canonical_slug = @slug
      ),
      -- Indirect hit: the slug matches a CHILD UEI's recipient name. Map to
      -- the rollup that contains that child.
      child_match AS (
        SELECT r.canonical_slug, r.total_obligated, 1 AS tiebreak
        FROM ${BQ_TABLES.recipients} c
        JOIN rollups r ON c.recipient_uei IN UNNEST(r.child_ueis)
        WHERE c.recipient_name IS NOT NULL
          AND ${COMPUTED_SLUG_SQL('c.recipient_name')} = @slug
      ),
      -- Name-merge hit: the slug's normalized (suffix-stripped) form matches a
      -- merged rollup's normalized name. Catches legal-suffix variants that the
      -- merge collapsed (corp vs corporation). Lowest priority so an exact slug
      -- always wins over a normalized match.
      norm_match AS (
        SELECT canonical_slug, total_obligated, 2 AS tiebreak
        FROM rollups
        WHERE norm_name = @normSlug AND norm_name != ''
      )
      SELECT canonical_slug
      FROM (
        SELECT * FROM direct
        UNION ALL SELECT * FROM child_match
        UNION ALL SELECT * FROM norm_match
      )
      ORDER BY tiebreak ASC, total_obligated DESC
      LIMIT 1
    `,
    params: { slug, normSlug },
  });
  const canonical = rows[0]?.canonical_slug ?? null;
  // null when unknown slug; null when already canonical (no redirect needed).
  return canonical && canonical !== slug ? canonical : null;
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
  ueis: string[],
  rollupUei: string,
  limit = 10,
): Promise<TopAgencyRow[]> {
  return queryCached<TopAgencyRow>({
    cacheKey: `rollup:${rollupUei}:top-agencies:${limit}:v4-m`,
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
        WHERE recipient_uei IN UNNEST(@ueis) AND awarding_agency IS NOT NULL
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
    params: { ueis, limit },
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
  ueis: string[],
  rollupUei: string,
  limit = 10,
): Promise<TopNaicsRow[]> {
  return queryCached<TopNaicsRow>({
    cacheKey: `rollup:${rollupUei}:top-naics:${limit}:v2-m`,
    query: `
      SELECT
        naics_code,
        ANY_VALUE(naics_description) AS naics_description,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei IN UNNEST(@ueis) AND naics_code IS NOT NULL
      GROUP BY naics_code
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { ueis, limit },
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
  ueis: string[],
  rollupUei: string,
  limit = 25,
): Promise<RecentAwardRow[]> {
  // CAST DATE columns to STRING so we get 'YYYY-MM-DD' strings back
  // instead of BigQuery's wrapper objects ({value: 'YYYY-MM-DD'}) which
  // break our formatDate(). Also filter to dollar-bearing transactions —
  // $0 modifications dominate the recent timeline but tell users nothing.
  return queryCached<RecentAwardRow>({
    cacheKey: `rollup:${rollupUei}:recent-awards:${limit}:v3-m`,
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
      WHERE recipient_uei IN UNNEST(@ueis)
        AND obligation_amount > 0
      ORDER BY action_date DESC
      LIMIT @limit
    `,
    params: { ueis, limit },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
  });
}

export interface YearlyTotalRow {
  fiscal_year: number;
  total_obligated: number;
  award_count: number;
}

export async function getYearlyTotalsForRecipient(
  ueis: string[],
  rollupUei: string,
): Promise<YearlyTotalRow[]> {
  return queryCached<YearlyTotalRow>({
    cacheKey: `rollup:${rollupUei}:yearly-totals:v2-m`,
    query: `
      SELECT
        fiscal_year,
        SUM(obligation_amount) AS total_obligated,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei IN UNNEST(@ueis)
      GROUP BY fiscal_year
      ORDER BY fiscal_year ASC
    `,
    params: { ueis },
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
  ueis: string[],
  rollupUei: string,
  page: number,
  pageSize: number = 50,
): Promise<{ rows: RecentAwardRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const [rows, totalRows] = await Promise.all([
    queryCached<RecentAwardRow>({
      cacheKey: `rollup:${rollupUei}:awards-page:${page}:${pageSize}:v2-m`,
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
        WHERE recipient_uei IN UNNEST(@ueis)
          AND obligation_amount > 0
        ORDER BY action_date DESC
        LIMIT @pageSize
        OFFSET @offset
      `,
      params: { ueis, pageSize, offset },
      maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
    }),
    queryCached<{ total: number }>({
      cacheKey: `rollup:${rollupUei}:awards-total:v2-m`,
      query: `
        SELECT COUNT(*) AS total
        FROM ${BQ_TABLES.awards}
        WHERE recipient_uei IN UNNEST(@ueis) AND obligation_amount > 0
      `,
      params: { ueis },
      maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
    }),
  ]);
  return { rows, total: Number(totalRows[0]?.total ?? 0) };
}

/**
 * Full NAICS breakdown for a recipient — used on /contractors/[slug]/naics.
 * Returns all NAICS the contractor has activity in, not just top N.
 */
export async function getAllNaicsForRecipient(
  ueis: string[],
  rollupUei: string,
): Promise<TopNaicsRow[]> {
  return queryCached<TopNaicsRow>({
    cacheKey: `rollup:${rollupUei}:all-naics:v2-m`,
    query: `
      SELECT
        naics_code,
        ANY_VALUE(naics_description) AS naics_description,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei IN UNNEST(@ueis) AND naics_code IS NOT NULL
      GROUP BY naics_code
      ORDER BY total_amount DESC
    `,
    params: { ueis },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
  });
}

/**
 * Full agency breakdown for a recipient — used on /contractors/[slug]/agencies.
 * Returns all agencies, not just top N. Caller can paginate display-side.
 */
export async function getAllAgenciesForRecipient(
  ueis: string[],
  rollupUei: string,
): Promise<TopAgencyRow[]> {
  return queryCached<TopAgencyRow>({
    cacheKey: `rollup:${rollupUei}:all-agencies:v4-m`,
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
        WHERE recipient_uei IN UNNEST(@ueis) AND awarding_agency IS NOT NULL
        GROUP BY awarding_agency
      )
      SELECT
        awarding_agency,
        total_amount,
        SAFE_DIVIDE(total_amount, SUM(total_amount) OVER ()) AS pct_of_total
      FROM per_agency
      ORDER BY total_amount DESC
    `,
    params: { ueis },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
  });
}

export async function getYearlyByAgencyForRecipient(
  ueis: string[],
  rollupUei: string,
): Promise<YearlyByAgencyRow[]> {
  return queryCached<YearlyByAgencyRow>({
    cacheKey: `rollup:${rollupUei}:yearly-by-agency:v2-m`,
    query: `
      SELECT
        fiscal_year,
        awarding_agency,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE recipient_uei IN UNNEST(@ueis)
        AND awarding_agency IS NOT NULL
      GROUP BY fiscal_year, awarding_agency
      ORDER BY fiscal_year ASC, total_amount DESC
    `,
    params: { ueis },
    maximumBytesBilled: AWARDS_SCAN_MAX_BYTES,
  });
}

export interface ExecutiveRow {
  exec_rank: number;
  exec_name: string;
  exec_amount: number;
  reported_at: string;
}

export async function getExecutivesForRecipient(
  ueis: string[],
  rollupUei: string,
): Promise<ExecutiveRow[]> {
  return queryCached<ExecutiveRow>({
    cacheKey: `rollup:${rollupUei}:executives:v3-m`,
    // Executives are reported per-UEI in FFATA. For a parent rollup we take
    // the highest-ranked exec rows across the child set, then re-rank — the
    // canonical parent's officers dominate by award value. DISTINCT on name
    // collapses the same officer reported under multiple sibling UEIs.
    query: `
      SELECT
        ROW_NUMBER() OVER (ORDER BY exec_amount DESC) AS exec_rank,
        exec_name,
        exec_amount,
        reported_at
      FROM (
        SELECT
          exec_name,
          MAX(exec_amount) AS exec_amount,
          CAST(MAX(reported_at) AS STRING) AS reported_at
        FROM ${BQ_TABLES.recipientExecutives}
        WHERE recipient_uei IN UNNEST(@ueis)
        GROUP BY exec_name
      )
      ORDER BY exec_amount DESC
      LIMIT 5
    `,
    params: { ueis },
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
 * Top recipients for the sitemap — PARENT-ROLLUP name + spend, ordered by
 * spend.
 *
 * Sources from `recipients_rollup` (one row per parent org), NOT the per-UEI
 * `recipients` table. This is essential: the pages now resolve slugs to
 * rollups, so the sitemap must emit one URL per parent — emitting per-UEI
 * names would point at sibling-UEI slugs that 301 to the parent (wasted
 * crawl) or fragment link equity across near-duplicate names.
 *
 * Capped: Google allows 50k URLs per sitemap file. We emit up to 3 URLs per
 * contractor (overview + contracts, plus agencies/naics when substantive),
 * so the cap keeps the contractor block well under 48k. Top-by-spend is the
 * right SEO call — the biggest primes are what people brand-search for.
 */
export interface SitemapRecipientRow {
  // Field name kept as `recipient_name` for call-site compatibility, but the
  // value is the rollup (parent) name. recipientSlug() runs on it unchanged.
  recipient_name: string;
  total_obligated: number;
  // Gate thin sub-pages out of the sitemap (see SUBPAGE_MIN_ROWS). These are
  // now PARENT-level distinct counts, so primes like Lockheed (27 agencies)
  // correctly clear the gate instead of being suppressed by per-UEI scatter.
  distinct_agency_count: number;
  distinct_naics_count: number;
}

export async function getTopRecipientsForSitemap(
  limit = 12000,
): Promise<SitemapRecipientRow[]> {
  return queryCached<SitemapRecipientRow>({
    // :v4 — source switched to recipients_rollup_merged (one row per company).
    cacheKey: `sitemap:top-recipients:${limit}:v4`,
    query: `
      SELECT
        rollup_name AS recipient_name,
        total_obligated,
        distinct_agency_count,
        distinct_naics_count
      FROM ${BQ_TABLES.recipientsRollup}
      WHERE rollup_name IS NOT NULL AND rollup_name != ''
      ORDER BY total_obligated DESC
      LIMIT @limit
    `,
    params: { limit },
  });
}

export async function getSimilarRecipients(
  ueis: string[],
  rollupUei: string,
  topNaicsCode: string,
  limit = 8,
): Promise<SimilarRecipientRow[]> {
  // Scope to the last 3 fiscal years so we only scan ~20% of the
  // awards partition. With clustering on recipient_uei + recipient_name
  // and partition-pruning on fiscal_year, this scans ~500MB instead
  // of 3GB. "Related" means actively competing — old contractors that
  // exited the NAICS aren't useful related links anyway.
  //
  // Group results to the PARENT (COALESCE(parent_uei, recipient_uei)) so the
  // "Related Contractors" links point at parent pages, and exclude THIS
  // contractor's whole child set so a prime never lists its own subsidiaries
  // as competitors.
  const currentYear = new Date().getFullYear();
  return queryCached<SimilarRecipientRow>({
    cacheKey: `rollup:${rollupUei}:similar:${topNaicsCode}:${limit}:v2-m`,
    query: `
      SELECT
        COALESCE(parent_uei, recipient_uei) AS recipient_uei,
        ANY_VALUE(COALESCE(parent_name, recipient_name)) AS recipient_name,
        SUM(obligation_amount) AS total_obligated
      FROM ${BQ_TABLES.awards}
      WHERE naics_code = @naics
        AND recipient_uei IS NOT NULL
        AND recipient_uei NOT IN UNNEST(@ueis)
        AND fiscal_year BETWEEN @minYear AND @maxYear
      GROUP BY COALESCE(parent_uei, recipient_uei)
      ORDER BY total_obligated DESC
      LIMIT @limit
    `,
    params: {
      ueis,
      naics: topNaicsCode,
      limit,
      minYear: currentYear - 3,
      maxYear: currentYear,
    },
  });
}

export interface RecipientSearchRow {
  recipient_uei: string;
  recipient_name: string;
  city: string | null;
  state: string | null;
  total_obligated: number;
  award_count: number;
  distinct_agency_count: number;
  distinct_naics_count: number;
}

/**
 * Search award-winning federal contractors for the in-app Contractors panel
 * — replaces the static 2,768-row JSON with real BQ data (~317K recipients).
 *
 * QUOTA-AWARE (Eric 2026-06-04 — "keep the quota limit down"): BigQuery
 * bills by bytes scanned. Two paths, both cheap + cached:
 *   - No NAICS: query `recipients` (name/state search) — ~12-24 MB.
 *   - With NAICS: query the pre-aggregated `top_contractors_by_dimension`
 *     rollup (naics dimension) — ~6 MB. The naive alternative (EXISTS on the
 *     63M-row awards table) scanned ~1.2 GB — 200× worse. NEVER do that here.
 * Every query goes through queryCached, so repeats cost 0 bytes.
 */
export async function searchRecipients(opts: {
  search?: string;
  state?: string;
  naics?: string;
  sortBy?: 'total_obligated' | 'award_count' | 'recipient_name';
  limit?: number;
  offset?: number;
}): Promise<{ rows: RecipientSearchRow[]; total: number }> {
  const search = (opts.search || '').trim();
  const state = (opts.state || '').trim().toUpperCase();
  // Parse NAICS into a list of codes, PRESERVING separate codes (don't strip
  // commas — that turned "236,237,238" into "236237238" → 0 results). Each code
  // can be a 2-6 digit PREFIX (3-digit "236" should match all 236xxx in the
  // rollup, which is keyed by full 6-digit codes). Eric 2026-06-05.
  const naicsCodes = (opts.naics || '')
    .split(/[, ]+/)
    .map(c => c.replace(/[^0-9]/g, '').trim())
    .filter(Boolean);
  const sortBy = opts.sortBy || 'total_obligated';
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  // ── NAICS path: cheap pre-aggregated rollup (top contractors per NAICS) ──
  if (naicsCodes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rp: Record<string, any> = { limit, offset };
    // Match each code: exact when 6 digits, prefix (STARTS_WITH) when shorter.
    const naicsConds = naicsCodes.map((code, i) => {
      rp[`n${i}`] = code;
      return code.length >= 6
        ? `dimension_value = @n${i}`
        : `STARTS_WITH(dimension_value, @n${i})`;
    });
    const conds = ['dimension = "naics"', `(${naicsConds.join(' OR ')})`];
    if (search) { conds.push('LOWER(recipient_name) LIKE @search'); rp.search = `%${search.toLowerCase()}%`; }
    // rollup has total_amount/award_count/rank; no state/agency/naics counts.
    const orderCol = sortBy === 'recipient_name' ? 'recipient_name'
      : sortBy === 'award_count' ? 'award_count' : 'total_amount';
    const orderDir = sortBy === 'recipient_name' ? 'ASC' : 'DESC';
    // A recipient can appear under several NAICS in the list — aggregate to one
    // row (sum $ + awards) so the same firm isn't listed multiple times.
    const rolled = await queryCached<{
      recipient_uei: string; recipient_name: string; total_amount: number; award_count: number;
      distinct_agency_count: number; total_rows: number;
    }>({
      cacheKey: `recipient-search-naics:${naicsCodes.join('_')}:${search}:${sortBy}:${limit}:${offset}:v3`,
      query: `
        WITH matched AS (
          SELECT recipient_uei, ANY_VALUE(recipient_name) AS recipient_name,
            SUM(total_amount) AS total_amount, SUM(award_count) AS award_count
          FROM ${BQ_TABLES.topContractorsByDimension}
          WHERE ${conds.join(' AND ')}
          GROUP BY recipient_uei
        )
        -- Join the recipients table for agency breadth ("works with N agencies"),
        -- a strong capture signal — does this firm sell to many buyers or one?
        SELECT m.recipient_uei, m.recipient_name, m.total_amount, m.award_count,
          COALESCE(r.distinct_agency_count, 0) AS distinct_agency_count,
          COUNT(*) OVER() AS total_rows
        FROM matched m
        LEFT JOIN ${BQ_TABLES.recipients} r USING (recipient_uei)
        ORDER BY ${orderCol === 'recipient_name' ? 'm.recipient_name' : orderCol === 'award_count' ? 'm.award_count' : 'm.total_amount'} ${orderDir}
        LIMIT @limit OFFSET @offset
      `,
      params: rp,
    });
    const total = rolled.length ? Number(rolled[0].total_rows) : 0;
    return {
      total,
      // The NAICS rollup has no location columns — city/state are null here.
      rows: rolled.map(r => ({
        recipient_uei: r.recipient_uei,
        recipient_name: r.recipient_name,
        city: null,
        state: null,
        total_obligated: Number(r.total_amount || 0),
        award_count: Number(r.award_count || 0),
        distinct_agency_count: Number(r.distinct_agency_count || 0),
        distinct_naics_count: 0,
      })),
    };
  }

  // ── No-NAICS path: name/state search over recipients (cheap) ──
  const where: string[] = ['r.recipient_name IS NOT NULL'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, any> = { limit, offset };
  if (search) { where.push('LOWER(r.recipient_name) LIKE @search'); params.search = `%${search.toLowerCase()}%`; }
  if (state) { where.push('r.state = @state'); params.state = state; }

  const orderCol = sortBy === 'recipient_name' ? 'r.recipient_name'
    : sortBy === 'award_count' ? 'r.award_count'
    : 'r.total_obligated';
  const orderDir = sortBy === 'recipient_name' ? 'ASC' : 'DESC';

  const rows = await queryCached<RecipientSearchRow & { total_rows: number }>({
    cacheKey: `recipient-search:${search}:${state}:${sortBy}:${limit}:${offset}:v2`,
    query: `
      SELECT
        r.recipient_uei, r.recipient_name, r.city, r.state,
        r.total_obligated, r.award_count,
        r.distinct_agency_count, r.distinct_naics_count,
        COUNT(*) OVER() AS total_rows
      FROM ${BQ_TABLES.recipients} r
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderCol} ${orderDir}
      LIMIT @limit OFFSET @offset
    `,
    params,
  });

  const total = rows.length ? Number(rows[0].total_rows) : 0;
  return { rows: rows.map(({ total_rows, ...r }) => r), total };
}

/**
 * Build the in-app drawer's ContractorSalesHistory shape directly from BQ.
 * Used as the fallback when a contractor isn't in the static contractor DB
 * (i.e. most of the 317K BQ recipients). Resolves by UEI (exact) or slug.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getBqContractorHistory(opts: { uei?: string; slug?: string }): Promise<any | null> {
  const profile = opts.uei
    ? await getRecipientByUei(opts.uei)
    : opts.slug
    ? await getRecipientBySlug(opts.slug)
    : null;
  if (!profile) return null;
  const uei = profile.recipient_uei;
  // In-app drawer fallback is a single-UEI view (resolved by exact UEI or
  // slug). Pass the lone UEI as a one-element set; the detail fns key their
  // cache on this UEI. (The public contractor pages use the parent rollup
  // via getRollupBySlug; this surface intentionally stays per-UEI.)
  const ueiSet = [uei];
  // Distinct cache namespace from the parent-rollup pages: this is a single-
  // UEI result, but for a parent UEI the same key string would otherwise
  // collide with the page's full-child-set result. Prefix keeps them separate.
  const cacheKey = `single:${uei}`;

  const [yearly, agencies, naics, recent, yearlyByAgency] = await Promise.all([
    getYearlyTotalsForRecipient(ueiSet, cacheKey),
    getTopAgenciesForRecipient(ueiSet, cacheKey, 8),
    getTopNaicsForRecipient(ueiSet, cacheKey, 8),
    getRecentAwardsForRecipient(ueiSet, cacheKey, 25),
    getYearlyByAgencyForRecipient(ueiSet, cacheKey), // per-year agency split → chart drill-down
  ]);

  // Group the per-(year,agency) rows so each fiscal year carries its agency
  // breakdown — this is what the chart's click-to-drill-down renders.
  const byYear = new Map<number, Array<{ agency: string; amount: number; count: number }>>();
  for (const r of yearlyByAgency) {
    const arr = byYear.get(r.fiscal_year) || [];
    arr.push({ agency: r.awarding_agency, amount: Number(r.total_amount || 0), count: Number(r.award_count || 0) });
    byYear.set(r.fiscal_year, arr);
  }

  const series = yearly
    .sort((a, b) => a.fiscal_year - b.fiscal_year)
    .map(y => ({
      fiscalYear: y.fiscal_year,
      totalObligations: Number(y.total_obligated || 0),
      awardCount: Number(y.award_count || 0),
      agencyBreakdown: byYear.get(y.fiscal_year) || [],
    }));
  const latestFiscalYear = yearly.length ? Math.max(...yearly.map(y => y.fiscal_year)) : null;
  const topAgency = agencies[0]?.awarding_agency || null;
  const awardCount = Number(profile.award_count || 0);
  const totalObligations = Number(profile.total_obligated || 0);

  return {
    success: true,
    source: 'usaspending_cache',
    coverage: 'cached',
    lastUpdated: profile.last_action_date || null,
    contractor: {
      company: profile.recipient_name,
      slug: recipientSlug(profile.recipient_name),
      naics: naics.map(n => n.naics_code),
      agencies: agencies.map(a => a.awarding_agency),
      totalContractValue: totalObligations,
      contractCount: awardCount,
      hasContact: false, hasEmail: false, hasPhone: false,
    },
    match: { method: 'recipient_name', confidence: 'high', name: profile.recipient_name },
    summary: {
      totalObligations, awardCount, latestFiscalYear, topAgency,
      averageAwardSize: awardCount > 0 ? totalObligations / awardCount : 0,
    },
    series,
    topAgencies: agencies.map(a => ({ agency: a.awarding_agency, amount: Number(a.total_amount || 0), count: 0 })),
    topNaics: naics.map(n => ({ naics: n.naics_code, description: n.naics_description || null, amount: Number(n.total_amount || 0), count: Number(n.award_count || 0) })),
    recentAwards: recent.map(r => ({
      id: r.award_id,
      title: (r.description || r.piid || r.award_id || '').slice(0, 160),
      agency: r.awarding_agency || '—',
      subAgency: r.awarding_office || null,
      naics: r.naics_code || null,
      naicsDescription: r.naics_description || null,
      amount: Number(r.obligation_amount || 0),
      startDate: r.pop_start_date || null,
      endDate: r.pop_end_date || null,
      state: r.pop_state || null,
      url: r.piid ? `https://www.usaspending.gov/award/${r.award_id}` : null,
    })),
    gated: { fullHistory: false, contacts: false, workflowActions: false, exports: false },
  };
}

/**
 * BigQuery helpers for /top/[slug] listicle pages.
 *
 * Each function returns the top N contractors with the appropriate
 * filter (agency, set-aside, NAICS, etc.). All queries share the
 * same shape — recipient_uei, recipient_name, total $, award count —
 * so the page component can render them uniformly.
 *
 * Bumped maximumBytesBilled to 10 GiB because filters on
 * awarding_agency / set_aside / naics_code aren't in the cluster key
 * and scan full partitions (~5-8 GB).
 */
import { BQ_TABLES } from './client';
import { queryCached } from './cache';

export interface TopContractorRow {
  recipient_uei: string;
  recipient_name: string;
  total_amount: number;
  award_count: number;
  distinct_agency_count: number;
}

/**
 * Top contractors by total federal obligated dollars across ALL agencies.
 * Powers "/top/government-contractors", "/top/largest-federal-contractors".
 * Uses the pre-built `recipients` table for fast read — no partition scan.
 */
export async function getTopContractors(limit = 50): Promise<TopContractorRow[]> {
  return queryCached<TopContractorRow>({
    cacheKey: `top:all-contractors:${limit}`,
    query: `
      SELECT
        recipient_uei,
        recipient_name,
        total_obligated AS total_amount,
        award_count,
        distinct_agency_count
      FROM ${BQ_TABLES.recipients}
      ORDER BY total_obligated DESC
      LIMIT @limit
    `,
    params: { limit },
  });
}

/**
 * Top contractors filtered to a specific awarding agency.
 * Powers "/top/defense-contractors" (DoD), "/top/va-contractors", etc.
 * Rolled up by recipient_name to merge parent + subsidiary UEIs.
 */
export async function getTopContractorsByAgency(
  agencyName: string,
  limit = 50,
): Promise<TopContractorRow[]> {
  return queryCached<TopContractorRow>({
    cacheKey: `top:agency:${agencyName}:${limit}:v2`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      WITH per_uei AS (
        SELECT
          recipient_uei,
          recipient_name,
          SUM(obligation_amount) AS amount,
          COUNT(DISTINCT award_id) AS awards
        FROM ${BQ_TABLES.awards}
        WHERE awarding_agency = @agency
          AND recipient_uei IS NOT NULL
          AND recipient_name IS NOT NULL
        GROUP BY recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT
          recipient_name,
          SUM(amount) AS total_amount,
          SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS top_uei
        FROM per_uei
        GROUP BY recipient_name
      )
      SELECT
        top_uei AS recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM rolled
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { agency: agencyName, limit },
  });
}

/**
 * Top contractors filtered to a specific NAICS code.
 * Powers "/top/federal-system-integrators" (541512), "/top/aircraft-makers" (336411), etc.
 */
export async function getTopContractorsByNaics(
  naicsCode: string,
  limit = 50,
): Promise<TopContractorRow[]> {
  return queryCached<TopContractorRow>({
    cacheKey: `top:naics:${naicsCode}:${limit}:v2`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      WITH per_uei AS (
        SELECT
          recipient_uei,
          recipient_name,
          SUM(obligation_amount) AS amount,
          COUNT(DISTINCT award_id) AS awards
        FROM ${BQ_TABLES.awards}
        WHERE naics_code = @naics
          AND recipient_uei IS NOT NULL
          AND recipient_name IS NOT NULL
        GROUP BY recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT
          recipient_name,
          SUM(amount) AS total_amount,
          SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS top_uei
        FROM per_uei
        GROUP BY recipient_name
      )
      SELECT
        top_uei AS recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM rolled
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { naics: naicsCode, limit },
  });
}

/**
 * Top contractors filtered to a specific awarding SUB-agency.
 * Powers "/top/army-contractors" (Department of the Army),
 * "/top/navy-contractors", "/top/air-force-contractors".
 *
 * Accepts an array of sub-agency names because some cohorts (e.g.
 * "military") combine multiple sub-agencies.
 */
export async function getTopContractorsBySubAgency(
  subAgencyNames: string[],
  limit = 50,
): Promise<TopContractorRow[]> {
  const placeholders = subAgencyNames.map((_, i) => `@sub${i}`).join(', ');
  const params: Record<string, string | number> = { limit };
  subAgencyNames.forEach((n, i) => {
    params[`sub${i}`] = n;
  });

  return queryCached<TopContractorRow>({
    cacheKey: `top:sub-agency:${subAgencyNames.join('|')}:${limit}:v1`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      WITH per_uei AS (
        SELECT
          recipient_uei,
          recipient_name,
          SUM(obligation_amount) AS amount,
          COUNT(DISTINCT award_id) AS awards
        FROM ${BQ_TABLES.awards}
        WHERE awarding_sub_agency IN (${placeholders})
          AND recipient_uei IS NOT NULL
          AND recipient_name IS NOT NULL
        GROUP BY recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT
          recipient_name,
          SUM(amount) AS total_amount,
          SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS top_uei
        FROM per_uei
        GROUP BY recipient_name
      )
      SELECT
        top_uei AS recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM rolled
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params,
  });
}

/**
 * Top contractors filtered by recipient state (2-letter code).
 * Powers "/top/contractors-in-virginia", "/top/contractors-in-texas",
 * etc. Same rolled-up-by-name pattern as the others.
 *
 * recipient_state isn't in the cluster key — full partition scan
 * ~6-8 GB. Bumped cap. Each state has wildly different volume
 * (VA = 20K recipients, WY = 50ish) but the LIMIT 50 + cache means
 * the cost story is the same per-state.
 */
export async function getTopContractorsByState(
  stateCode: string,
  limit = 50,
): Promise<TopContractorRow[]> {
  return queryCached<TopContractorRow>({
    cacheKey: `top:state:${stateCode}:${limit}:v1`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      WITH per_uei AS (
        SELECT
          recipient_uei,
          recipient_name,
          SUM(obligation_amount) AS amount,
          COUNT(DISTINCT award_id) AS awards
        FROM ${BQ_TABLES.awards}
        WHERE recipient_state = @state
          AND recipient_uei IS NOT NULL
          AND recipient_name IS NOT NULL
        GROUP BY recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT
          recipient_name,
          SUM(amount) AS total_amount,
          SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS top_uei
        FROM per_uei
        GROUP BY recipient_name
      )
      SELECT
        top_uei AS recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM rolled
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { state: stateCode, limit },
  });
}

/**
 * Top contractors that win a specific set-aside category.
 * Powers "/top/8a-contractors", "/top/hubzone-contractors",
 * "/top/sdvosb-contractors", "/top/wosb-contractors".
 *
 * `setAsidePatterns` is an array of strings used in OR conditions
 * because USASpending stores set_aside as multiple variants:
 *   "8(A) SOLE SOURCE", "8A COMPETED", "8A SET ASIDE" (etc.)
 */
export async function getTopContractorsBySetAside(
  setAsidePatterns: string[],
  limit = 50,
): Promise<TopContractorRow[]> {
  // Build the WHERE clause from pattern array
  const orClauses = setAsidePatterns
    .map((_, i) => `set_aside LIKE @pattern${i}`)
    .join(' OR ');
  const params: Record<string, string | number> = { limit };
  setAsidePatterns.forEach((p, i) => {
    params[`pattern${i}`] = p;
  });

  return queryCached<TopContractorRow>({
    cacheKey: `top:set-aside:${setAsidePatterns.join('|')}:${limit}:v2`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      WITH per_uei AS (
        SELECT
          recipient_uei,
          recipient_name,
          SUM(obligation_amount) AS amount,
          COUNT(DISTINCT award_id) AS awards
        FROM ${BQ_TABLES.awards}
        WHERE (${orClauses})
          AND recipient_uei IS NOT NULL
          AND recipient_name IS NOT NULL
        GROUP BY recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT
          recipient_name,
          SUM(amount) AS total_amount,
          SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS top_uei
        FROM per_uei
        GROUP BY recipient_name
      )
      SELECT
        top_uei AS recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM rolled
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params,
  });
}

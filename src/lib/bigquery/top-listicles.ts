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
 * Generic reader over the pre-aggregated top_contractors_by_dimension
 * rollup (clustered by dimension, dimension_value). All the /top pages
 * now read a few MB from here instead of scanning the full awards table
 * — the BQ-quota fix. The rollup is rebuilt monthly
 * (scripts/bq-build-agency-rollups.sql). Supports multiple values per
 * call (sub-agency / set-aside cohorts) by OR-ing dimension_value.
 */
async function getTopFromRollup(
  dimension: 'agency' | 'naics' | 'sub_agency' | 'state' | 'set_aside',
  values: string[],
  cacheKey: string,
  limit: number,
): Promise<TopContractorRow[]> {
  const placeholders = values.map((_, i) => `@v${i}`).join(', ');
  const params: Record<string, string | number> = { dim: dimension, limit };
  values.forEach((v, i) => { params[`v${i}`] = v; });

  return queryCached<TopContractorRow>({
    cacheKey,
    query: `
      WITH merged AS (
        SELECT
          recipient_name,
          SUM(total_amount) AS total_amount,
          SUM(award_count) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY total_amount DESC LIMIT 1)[OFFSET(0)] AS recipient_uei
        FROM ${BQ_TABLES.topContractorsByDimension}
        WHERE dimension = @dim AND dimension_value IN (${placeholders})
        GROUP BY recipient_name
      )
      SELECT
        recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM merged
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params,
  });
}

/**
 * Top contractors filtered to a specific awarding agency.
 * Powers "/top/defense-contractors" (DoD), "/top/va-contractors", etc.
 */
export async function getTopContractorsByAgency(
  agencyName: string,
  limit = 50,
): Promise<TopContractorRow[]> {
  return getTopFromRollup('agency', [agencyName], `top:agency:${agencyName}:${limit}:rollup`, limit);
}

/**
 * Top contractors filtered to a specific NAICS code.
 * Powers "/top/federal-system-integrators" (541512), "/top/aircraft-makers" (336411), etc.
 */
export async function getTopContractorsByNaics(
  naicsCode: string,
  limit = 50,
): Promise<TopContractorRow[]> {
  return getTopFromRollup('naics', [naicsCode], `top:naics:${naicsCode}:${limit}:rollup`, limit);
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
  return getTopFromRollup('sub_agency', subAgencyNames, `top:sub-agency:${subAgencyNames.join('|')}:${limit}:rollup`, limit);
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
  return getTopFromRollup('state', [stateCode], `top:state:${stateCode}:${limit}:rollup`, limit);
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
  // set_aside is stored as many variants ("8(A) SOLE SOURCE", "8A
  // COMPETED", ...), so we LIKE-match the patterns against the rollup's
  // dimension_value (instead of scanning awards). Reads the dimension
  // rollup — a few MB.
  const likeClauses = setAsidePatterns
    .map((_, i) => `dimension_value LIKE @pattern${i}`)
    .join(' OR ');
  const params: Record<string, string | number> = { limit };
  setAsidePatterns.forEach((p, i) => { params[`pattern${i}`] = p; });

  return queryCached<TopContractorRow>({
    cacheKey: `top:set-aside:${setAsidePatterns.join('|')}:${limit}:rollup`,
    query: `
      WITH merged AS (
        SELECT
          recipient_name,
          SUM(total_amount) AS total_amount,
          SUM(award_count) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY total_amount DESC LIMIT 1)[OFFSET(0)] AS recipient_uei
        FROM ${BQ_TABLES.topContractorsByDimension}
        WHERE dimension = 'set_aside' AND (${likeClauses})
        GROUP BY recipient_name
      )
      SELECT
        recipient_uei,
        recipient_name,
        total_amount,
        award_count,
        CAST(NULL AS INT64) AS distinct_agency_count
      FROM merged
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params,
  });
}

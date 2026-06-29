/**
 * Subaward query helpers — powers the "Subawards Paid Out" and
 * "Subawards Received" sections on contractor profile pages.
 *
 * Data: usaspending.subawards (~940K rows, FY2016-FY2026, top 10
 * federal agencies). Partitioned by subaward_fy, clustered by
 * prime_uei + subawardee_uei so per-recipient queries are fast.
 *
 * Two rollup tables also available:
 *   subawards_by_prime       — one row per prime, aggregated
 *   subawards_by_subawardee  — one row per subawardee, aggregated
 */
import { BQ_TABLES } from './client';
import { queryCached } from './cache';
import { COMPUTED_SLUG_SQL } from './recipients';

const BQ_SUBAWARDS = '`market-assasin.usaspending.subawards`';
const BQ_SUB_BY_PRIME = '`market-assasin.usaspending.subawards_by_prime`';
const BQ_SUB_BY_SUBAWARDEE = '`market-assasin.usaspending.subawards_by_subawardee`';

// Subquery that maps a partner UEI to its rollup's canonical (resolvable)
// slug + name. LEFT JOIN against this so partners with a profile link to a
// URL that resolves, and partners without one render as plain text (no 404).
const ROLLUP_SLUG_SUBQUERY = `
  SELECT rollup_uei, rollup_name, ${COMPUTED_SLUG_SQL('rollup_name')} AS canonical_slug
  FROM ${BQ_TABLES.recipientsRollup}
  WHERE rollup_name IS NOT NULL
`;

export interface SubawardSummary {
  uei: string;
  name: string;
  count: number;
  partner_count: number;
  total_amount: number;
}

/**
 * Rollup: this contractor PAID OUT to X subs.
 * Used on contractor page as "Subawards Paid Out (as prime)" stat.
 */
export async function getSubawardsPaidOutSummary(primeUei: string): Promise<SubawardSummary | null> {
  const rows = await queryCached<{
    prime_uei: string;
    prime_name: string;
    subaward_count: number;
    distinct_subs: number;
    total_paid_out: number;
  }>({
    cacheKey: `subaward:paid-out:summary:${primeUei}`,
    query: `
      SELECT prime_uei, prime_name, subaward_count, distinct_subs, total_paid_out
      FROM ${BQ_SUB_BY_PRIME}
      WHERE prime_uei = @uei
      LIMIT 1
    `,
    params: { uei: primeUei },
  });
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    uei: r.prime_uei,
    name: r.prime_name,
    count: Number(r.subaward_count),
    partner_count: Number(r.distinct_subs),
    total_amount: Number(r.total_paid_out),
  };
}

/**
 * Rollup: this contractor RECEIVED subs from X primes.
 * Used on contractor page as "Subawards Received (as sub)" stat.
 */
export async function getSubawardsReceivedSummary(subawardeeUei: string): Promise<SubawardSummary | null> {
  const rows = await queryCached<{
    subawardee_uei: string;
    subawardee_name: string;
    subaward_count: number;
    distinct_primes: number;
    total_received: number;
  }>({
    cacheKey: `subaward:received:summary:${subawardeeUei}`,
    query: `
      SELECT subawardee_uei, subawardee_name, subaward_count, distinct_primes, total_received
      FROM ${BQ_SUB_BY_SUBAWARDEE}
      WHERE subawardee_uei = @uei
      LIMIT 1
    `,
    params: { uei: subawardeeUei },
  });
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    uei: r.subawardee_uei,
    name: r.subawardee_name,
    count: Number(r.subaward_count),
    partner_count: Number(r.distinct_primes),
    total_amount: Number(r.total_received),
  };
}

export interface SubawardPartnerRow {
  partner_uei: string;
  partner_name: string;
  total_amount: number;
  count: number;
  // Rollup's computed slug, or null when the partner has no contractor
  // profile. Non-null is guaranteed to resolve; the page links by it and
  // renders unmatched partners as plain text (no 404).
  canonical_slug: string | null;
}

/**
 * Top N subawardees this contractor (as prime) has paid.
 * Used in "Subawards Paid Out → Top Subawardees" table.
 */
export async function getTopSubawardeesForPrime(
  primeUei: string,
  limit = 20,
): Promise<SubawardPartnerRow[]> {
  return queryCached<SubawardPartnerRow>({
    cacheKey: `subaward:paid-out:top:${primeUei}:${limit}:v2-slug`,
    query: `
      WITH partners AS (
        SELECT
          subawardee_uei AS partner_uei,
          ANY_VALUE(subawardee_name) AS partner_name,
          SUM(subaward_amount) AS total_amount,
          COUNT(*) AS count
        FROM ${BQ_SUBAWARDS}
        WHERE prime_uei = @uei
        GROUP BY subawardee_uei
        ORDER BY total_amount DESC
        LIMIT @limit
      )
      SELECT
        p.partner_uei,
        COALESCE(r.rollup_name, p.partner_name) AS partner_name,
        p.total_amount,
        p.count,
        r.canonical_slug AS canonical_slug
      FROM partners p
      LEFT JOIN (${ROLLUP_SLUG_SUBQUERY}) r
        ON r.rollup_uei = p.partner_uei
      ORDER BY p.total_amount DESC
    `,
    params: { uei: primeUei, limit },
  });
}

/**
 * Top N primes that have paid subs to this contractor.
 * Used in "Subawards Received → Top Primes" table.
 */
export async function getTopPrimesForSubawardee(
  subawardeeUei: string,
  limit = 20,
): Promise<SubawardPartnerRow[]> {
  return queryCached<SubawardPartnerRow>({
    cacheKey: `subaward:received:top:${subawardeeUei}:${limit}:v2-slug`,
    query: `
      WITH partners AS (
        SELECT
          prime_uei AS partner_uei,
          ANY_VALUE(prime_name) AS partner_name,
          SUM(subaward_amount) AS total_amount,
          COUNT(*) AS count
        FROM ${BQ_SUBAWARDS}
        WHERE subawardee_uei = @uei
        GROUP BY prime_uei
        ORDER BY total_amount DESC
        LIMIT @limit
      )
      SELECT
        p.partner_uei,
        COALESCE(r.rollup_name, p.partner_name) AS partner_name,
        p.total_amount,
        p.count,
        r.canonical_slug AS canonical_slug
      FROM partners p
      LEFT JOIN (${ROLLUP_SLUG_SUBQUERY}) r
        ON r.rollup_uei = p.partner_uei
      ORDER BY p.total_amount DESC
    `,
    params: { uei: subawardeeUei, limit },
  });
}

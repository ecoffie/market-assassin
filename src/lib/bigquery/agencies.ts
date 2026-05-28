/**
 * Agency-level queries — powers /agencies/[slug] pages with BQ data.
 */
import { BQ_TABLES } from './client';
import { queryCached } from './cache';

export interface AgencyProfile {
  awarding_agency: string;
  total_obligated: number;
  recipient_count: number;
  naics_count: number;
  transaction_count: number;
}

export async function getAgencyProfile(agencyName: string): Promise<AgencyProfile | null> {
  const rows = await queryCached<AgencyProfile>({
    cacheKey: `agency:profile:${agencyName}`,
    query: `
      SELECT * FROM ${BQ_TABLES.agencySummary}
      WHERE awarding_agency = @agency LIMIT 1
    `,
    params: { agency: agencyName },
  });
  return rows[0] ?? null;
}

export interface TopRecipientForAgency {
  recipient_uei: string;
  recipient_name: string;
  total_amount: number;
  award_count: number;
}

export async function getTopRecipientsForAgency(
  agencyName: string,
  limit = 20,
): Promise<TopRecipientForAgency[]> {
  // awards table is partitioned by fiscal_year and clustered by
  // recipient_uei. awarding_agency is neither, so this scans the full
  // partition (~8 GB for DoD which has 137K recipients). Bump cap
  // from default 5 GiB to 10 GiB; still bounded by the project's
  // 5 TiB/day quota.
  //
  // Roll up by recipient_name (not UEI). The same brand can have
  // multiple UEIs (parent + subsidiary registrations) and showing
  // "Lockheed Martin Corporation" twice in the top 5 looks like a
  // data bug. Picks the highest-spending UEI as the canonical one
  // for the /contractors/[slug] link.
  return queryCached<TopRecipientForAgency>({
    cacheKey: `agency:${agencyName}:top-recipients-by-name:${limit}:v2`,
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
        award_count
      FROM rolled
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { agency: agencyName, limit },
  });
}

export interface TopNaicsForAgency {
  naics_code: string;
  naics_description: string;
  total_amount: number;
}

export async function getTopNaicsForAgency(
  agencyName: string,
  limit = 15,
): Promise<TopNaicsForAgency[]> {
  // Same partition-scan story as getTopRecipientsForAgency.
  return queryCached<TopNaicsForAgency>({
    cacheKey: `agency:${agencyName}:top-naics:${limit}`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      SELECT
        naics_code,
        ANY_VALUE(naics_description) AS naics_description,
        SUM(obligation_amount) AS total_amount
      FROM ${BQ_TABLES.awards}
      WHERE awarding_agency = @agency AND naics_code IS NOT NULL
      GROUP BY naics_code
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { agency: agencyName, limit },
  });
}

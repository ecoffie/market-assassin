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
  return queryCached<TopRecipientForAgency>({
    cacheKey: `agency:${agencyName}:top-recipients:${limit}`,
    query: `
      SELECT
        recipient_uei,
        ANY_VALUE(recipient_name) AS recipient_name,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE awarding_agency = @agency AND recipient_uei IS NOT NULL
      GROUP BY recipient_uei
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
  return queryCached<TopNaicsForAgency>({
    cacheKey: `agency:${agencyName}:top-naics:${limit}`,
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

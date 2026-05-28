/**
 * NAICS-level queries — powers /naics/[code] pages with real BQ data.
 *
 * Replaces the contractors.json-derived /naics/top100 with real
 * USASpending totals across all 1,000+ NAICS codes.
 */
import { BQ_TABLES } from './client';
import { queryCached } from './cache';

export interface NaicsProfile {
  naics_code: string;
  naics_description: string;
  total_obligated: number;
  recipient_count: number;
  agency_count: number;
  transaction_count: number;
}

export async function getNaicsProfile(code: string): Promise<NaicsProfile | null> {
  const rows = await queryCached<NaicsProfile>({
    cacheKey: `naics:profile:${code}`,
    query: `
      SELECT * FROM ${BQ_TABLES.naicsSummary}
      WHERE naics_code = @code LIMIT 1
    `,
    params: { code },
  });
  return rows[0] ?? null;
}

export interface TopRecipientForNaics {
  recipient_uei: string;
  recipient_name: string;
  total_amount: number;
  award_count: number;
}

export async function getTopRecipientsForNaics(
  code: string,
  limit = 25,
): Promise<TopRecipientForNaics[]> {
  // awards table is partitioned by fiscal_year and clustered by
  // recipient_uei + recipient_name. naics_code is neither — so this
  // query scans the full partition (~6 GB for popular NAICS like
  // 334515 electronic instrument manufacturing). The default 5 GiB
  // per-query cap rejects those. 10 GiB is plenty headroom and still
  // protected by the project-wide 5 TiB/day quota cap we set on the
  // service account.
  return queryCached<TopRecipientForNaics>({
    cacheKey: `naics:${code}:top-recipients:${limit}`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      SELECT
        recipient_uei,
        ANY_VALUE(recipient_name) AS recipient_name,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE naics_code = @code AND recipient_uei IS NOT NULL
      GROUP BY recipient_uei
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { code, limit },
  });
}

export interface TopAgencyForNaics {
  awarding_agency: string;
  total_amount: number;
  recipient_count: number;
}

export async function getTopAgenciesForNaics(
  code: string,
  limit = 10,
): Promise<TopAgencyForNaics[]> {
  // Same partition-scan story as getTopRecipientsForNaics — bump the
  // cap from default 5 GiB to 10 GiB for the large NAICS codes.
  return queryCached<TopAgencyForNaics>({
    cacheKey: `naics:${code}:top-agencies:${limit}`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      SELECT
        awarding_agency,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT recipient_uei) AS recipient_count
      FROM ${BQ_TABLES.awards}
      WHERE naics_code = @code AND awarding_agency IS NOT NULL
      GROUP BY awarding_agency
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { code, limit },
  });
}

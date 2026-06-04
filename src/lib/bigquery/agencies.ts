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
  // Reads the pre-aggregated agency_top_recipients rollup (clustered by
  // awarding_agency) — a few MB — instead of scanning the full ~10 GiB
  // awards table on every cold miss. This was the dominant BQ-quota
  // burner. Rollup is rebuilt monthly (scripts/bq-build-agency-rollups.sql).
  // Pre-rolled by recipient_name with the canonical (highest-spend) UEI.
  return queryCached<TopRecipientForAgency>({
    cacheKey: `agency:${agencyName}:top-recipients-rollup:${limit}:v1`,
    query: `
      SELECT recipient_uei, recipient_name, total_amount, award_count
      FROM ${BQ_TABLES.agencyTopRecipients}
      WHERE awarding_agency = @agency
      ORDER BY rank
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
  // Reads the agency_top_naics rollup (clustered by awarding_agency)
  // instead of scanning the full awards table. See getTopRecipientsForAgency.
  return queryCached<TopNaicsForAgency>({
    cacheKey: `agency:${agencyName}:top-naics-rollup:${limit}:v1`,
    query: `
      SELECT naics_code, naics_description, total_amount
      FROM ${BQ_TABLES.agencyTopNaics}
      WHERE awarding_agency = @agency
      ORDER BY rank
      LIMIT @limit
    `,
    params: { agency: agencyName, limit },
  });
}

export interface AgencyOfficeRow {
  awarding_office: string;
  awarding_office_code: string | null;
  total_amount: number;
  award_count: number;
}

/**
 * Contracting offices for an agency, from the agency_office_summary rollup
 * (top 100 per agency by spend). Powers the Decision Makers office drill-down
 * — SAM POC data has no office, but awards.awarding_office does. Cheap (~MB,
 * cached): the rollup is tiny. Matches by contains() because the rollup's
 * agency names (title-case "Department of Defense") differ from SAM's
 * ("DEPT OF DEFENSE") — caller passes whichever it has.
 */
export async function getOfficesForAgency(agencyName: string, limit = 100): Promise<AgencyOfficeRow[]> {
  const needle = (agencyName || '').trim().toLowerCase();
  if (!needle) return [];
  // Take the most distinctive word from the SAM agency name to contains-match
  // (e.g. "AGRICULTURE, DEPARTMENT OF" → "agriculture"). Avoids matching on
  // stopwords like "department"/"of" that appear in every agency.
  const STOP = new Set(['department', 'of', 'the', 'and', 'for', 'u.s.', 'us', 'office']);
  const key = needle.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)).sort((a, b) => b.length - a.length)[0] || needle;
  return queryCached<AgencyOfficeRow>({
    cacheKey: `agency-offices:${key}:${limit}:v1`,
    query: `
      SELECT awarding_office, awarding_office_code, total_amount, award_count
      FROM ${BQ_TABLES.agencyOfficeSummary}
      WHERE LOWER(awarding_agency) LIKE @needle
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { needle: `%${key}%`, limit },
  });
}

/**
 * Buyer-history lookup by awarding-office DoDAAC.
 *
 * search_past_contracts / USASpending spending_by_award cannot filter
 * awarding-office / DoDAAC — that is a recorded capability gap, not something
 * to emulate with keyword matching on "30 CONS".
 *
 * The awards warehouse DOES store awarding_office_code. That is the structured
 * predicate for FA4610 / 30 CONS buyer history.
 */
import { BQ_TABLES, bqJobOptions, bqQuery } from '@/lib/bigquery/client';

export interface OfficeAwardRow {
  piid: string;
  recipientName: string;
  recipientUei: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  awardingAgency: string;
  awardingSubAgency: string;
  awardingOffice: string;
  awardingOfficeCode: string;
  naicsCode: string;
  pscCode: string;
  popState: string;
  popCity: string;
  awardType: string;
  awardId: string;
  asOf: string | null;
}

export interface OfficeAwardLookupResult {
  ok: boolean;
  error?: string;
  asOf: string | null;
  rows: OfficeAwardRow[];
  query: Record<string, unknown>;
  retrievedAt: string;
}

export interface OfficeAwardQuery {
  officeCode: string;
  naics?: string;
  psc?: string;
  popState?: string;
  limit?: number;
}

export type OfficeAwardLookup = (q: OfficeAwardQuery) => Promise<OfficeAwardLookupResult>;

export async function queryAwardsByAwardingOffice(
  q: OfficeAwardQuery,
): Promise<OfficeAwardLookupResult> {
  const retrievedAt = new Date().toISOString();
  const officeCode = q.officeCode.trim().toUpperCase();
  const naics = q.naics?.trim() || '';
  const psc = q.psc?.trim().toUpperCase() || '';
  const popState = q.popState?.trim().toUpperCase() || '';
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
  const query = {
    awarding_office_code: officeCode,
    naics: naics || null,
    psc: psc || null,
    pop_state: popState || null,
    limit,
  };

  try {
    const rows = await bqQuery<{
      piid: string;
      recipient_name: string | null;
      recipient_uei: string | null;
      award_amount: number | string | null;
      description: string | null;
      start_date: string | null;
      end_date: string | null;
      awarding_agency: string | null;
      awarding_sub_agency: string | null;
      awarding_office: string | null;
      awarding_office_code: string | null;
      naics_code: string | null;
      psc_code: string | null;
      pop_state: string | null;
      pop_city: string | null;
      award_type: string | null;
      award_id: string | null;
      as_of: string | null;
    }>({
      query: `
        SELECT
          piid,
          ANY_VALUE(recipient_name) AS recipient_name,
          ANY_VALUE(recipient_uei) AS recipient_uei,
          MAX(COALESCE(potential_award_value, current_award_value, total_obligated, 0)) AS award_amount,
          ANY_VALUE(description) AS description,
          CAST(MIN(pop_start_date) AS STRING) AS start_date,
          CAST(MAX(pop_end_date) AS STRING) AS end_date,
          ANY_VALUE(awarding_agency) AS awarding_agency,
          ANY_VALUE(awarding_sub_agency) AS awarding_sub_agency,
          ANY_VALUE(awarding_office) AS awarding_office,
          ANY_VALUE(awarding_office_code) AS awarding_office_code,
          ANY_VALUE(naics_code) AS naics_code,
          ANY_VALUE(psc_code) AS psc_code,
          ANY_VALUE(pop_state) AS pop_state,
          ANY_VALUE(pop_city) AS pop_city,
          ANY_VALUE(contract_pricing_type) AS award_type,
          ANY_VALUE(award_id) AS award_id,
          CAST(MAX(action_date) AS STRING) AS as_of
        FROM ${BQ_TABLES.awards}
        WHERE awarding_office_code = @office
          AND (@naics = '' OR naics_code = @naics)
          AND (@psc = '' OR psc_code = @psc)
          AND (@popState = '' OR pop_state = @popState)
          AND piid IS NOT NULL AND TRIM(piid) != ''
        GROUP BY piid
        ORDER BY award_amount DESC
        LIMIT @limit
      `,
      params: { office: officeCode, naics, psc, popState, limit },
      ...bqJobOptions({
        feature: 'mrr',
        tool: 'office-awards',
        queryFamily: 'awarding-office-history',
        // awarding_office_code is not the awards clustering key; the scan
        // matches the 20 GiB awards-table ceiling used elsewhere, not the
        // 5 GiB runtime default. Failure still returns unknown, never a widen.
        maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
      }),
    });

    let asOf: string | null = null;
    const mapped: OfficeAwardRow[] = rows.map((r) => {
      if (r.as_of && (!asOf || r.as_of > asOf)) asOf = r.as_of;
      return {
        piid: String(r.piid || ''),
        recipientName: String(r.recipient_name || ''),
        recipientUei: String(r.recipient_uei || ''),
        awardAmount: Number(r.award_amount) || 0,
        description: String(r.description || ''),
        startDate: String(r.start_date || ''),
        endDate: String(r.end_date || ''),
        awardingAgency: String(r.awarding_agency || ''),
        awardingSubAgency: String(r.awarding_sub_agency || ''),
        awardingOffice: String(r.awarding_office || ''),
        awardingOfficeCode: String(r.awarding_office_code || officeCode),
        naicsCode: String(r.naics_code || ''),
        pscCode: String(r.psc_code || ''),
        popState: String(r.pop_state || ''),
        popCity: String(r.pop_city || ''),
        awardType: String(r.award_type || ''),
        awardId: String(r.award_id || ''),
        asOf: r.as_of,
      };
    });

    return { ok: true, asOf, rows: mapped, query, retrievedAt };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      asOf: null,
      rows: [],
      query,
      retrievedAt,
    };
  }
}

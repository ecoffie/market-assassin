/**
 * Agency-forecast query — a focused query for the MCP tool
 * (`get_agency_forecasts`) and any caller wanting raw forecast rows.
 *
 * Lifted from the core of src/app/api/forecasts/route.ts WITHOUT the route's
 * UI-only machinery (DoD early-signal injection, NAICS-vocabulary enrichment,
 * set-aside/agency aggregations, POC redaction, camelCase field renaming). Just
 * the filtered read of `agency_forecasts`, soonest-award first.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface ForecastQueryInput {
  /** NAICS code(s), comma-separated; ≤4 chars = prefix, else exact. */
  naics?: string;
  /** Source agency, case-insensitive partial (comma-separated OR). */
  agency?: string;
  /** Place-of-performance state (full name matches best; ILIKE on pop_state). */
  state?: string;
  /** Set-aside type, case-insensitive partial. */
  setAside?: string;
  /** Fiscal year — "FY2026" or "2026". */
  fiscalYear?: string;
  /** Free-text over title + description. */
  search?: string;
  limit?: number;
}

export interface ForecastRow {
  id: string;
  title: string;
  description: string | null;
  agency: string | null;
  department: string | null;
  office: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  fiscal_year: string | null;
  quarter: string | null;
  award_date: string | null;
  value_min: number | null;
  value_max: number | null;
  value_range: string | null;
  set_aside_type: string | null;
  contract_type: string | null;
  incumbent_name: string | null;
  pop_state: string | null;
  status: string | null;
}

export interface ForecastQueryResult {
  forecasts: ForecastRow[];
  total: number;
  degraded: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orForNaics(terms: string[]): string {
  return terms
    .map((t) => (t.length <= 4 ? `naics_code.ilike.${t}%` : `naics_code.eq.${t}`))
    .join(',');
}

export async function queryForecasts(input: ForecastQueryInput): Promise<ForecastQueryResult> {
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 200);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let q = supabase
    .from('agency_forecasts')
    .select(
      'id,title,description,source_agency,department,contracting_office,naics_code,naics_description,psc_code,fiscal_year,anticipated_quarter,anticipated_award_date,estimated_value_min,estimated_value_max,estimated_value_range,set_aside_type,contract_type,incumbent_name,pop_state,status',
      { count: 'exact' },
    );

  const naicsTerms = (input.naics || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (naicsTerms.length === 1) {
    const t = naicsTerms[0];
    q = t.length <= 4 ? q.ilike('naics_code', `${t}%`) : q.eq('naics_code', t);
  } else if (naicsTerms.length > 1) {
    q = q.or(orForNaics(naicsTerms));
  }

  const agencyTerms = (input.agency || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (agencyTerms.length === 1) {
    q = q.ilike('source_agency', `%${agencyTerms[0]}%`);
  } else if (agencyTerms.length > 1) {
    q = q.or(agencyTerms.map((a) => `source_agency.ilike.%${a}%`).join(','));
  }

  const state = (input.state || '').trim();
  if (state) q = q.ilike('pop_state', `%${state}%`);

  const setAside = (input.setAside || '').trim();
  if (setAside) q = q.ilike('set_aside_type', `%${setAside}%`);

  const fy = (input.fiscalYear || '').trim().replace(/^fy/i, '');
  if (fy) q = q.ilike('fiscal_year', `%${fy}%`);

  const search = (input.search || '').trim();
  if (search) q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  q = q.order('anticipated_award_date', { ascending: true, nullsFirst: false }).limit(limit);

  const { data, count, error } = await q;
  if (error) {
    console.error('[forecasts:query] supabase error:', error.message);
    return { forecasts: [], total: 0, degraded: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forecasts: ForecastRow[] = (data || []).map((r: any) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    agency: r.source_agency ?? null,
    department: r.department ?? null,
    office: r.contracting_office ?? null,
    naics_code: r.naics_code ?? null,
    naics_description: r.naics_description ?? null,
    psc_code: r.psc_code ?? null,
    fiscal_year: r.fiscal_year ?? null,
    quarter: r.anticipated_quarter ?? null,
    award_date: r.anticipated_award_date ?? null,
    value_min: r.estimated_value_min ?? null,
    value_max: r.estimated_value_max ?? null,
    value_range: r.estimated_value_range ?? null,
    set_aside_type: r.set_aside_type ?? null,
    contract_type: r.contract_type ?? null,
    incumbent_name: r.incumbent_name ?? null,
    pop_state: r.pop_state ?? null,
    status: r.status ?? null,
  }));

  return { forecasts, total: count ?? forecasts.length, degraded: false };
}

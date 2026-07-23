/**
 * Expiring-contract (recompete) query — a focused query for the MCP tool
 * (`get_expiring_contracts`). Reads the indexed Supabase `recompete_opportunities`
 * table directly (cheap — NOT BigQuery), soonest-expiring first.
 *
 * Deliberately LEAN vs src/app/api/recompete/route.ts: no parallel page-reads,
 * no multiple-award-IDIQ vehicle rollup, no snapshot resilience. Just "the top-N
 * contracts expiring within a window that match NAICS/agency/state/value".
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const COLUMNS =
  'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,naics_code,naics_description,psc_code,description,total_obligation,potential_total_value,period_of_performance_start,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,set_aside_type,competition_type,number_of_offers,estimated_recompete_date,lead_time_months,recompete_likelihood';

/**
 * Digits-only NAICS codes, deduped, order preserved. Accepts a comma/space-separated
 * string ("236220, 541512") or an array. Anything non-numeric is dropped — these
 * values are interpolated into a PostgREST `.or()` expression, so they MUST be
 * sanitized here.
 */
export function parseNaicsCodes(input?: string | string[] | null): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,\s]+/);
  const out: string[] = [];
  for (const r of raw) {
    const code = String(r ?? '').trim();
    if (/^\d{2,6}$/.test(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * PostgREST `.or()` expression OR-ing several NAICS codes, preserving the single-code
 * rule: <6 chars = PREFIX match (`236` → `236%`), 6 digits = exact.
 * Callers must pass codes through `parseNaicsCodes` first.
 */
export function naicsOrExpression(codes: string[]): string {
  return codes
    .map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`))
    .join(',');
}

export interface ExpiringContractsInput {
  /** NAICS code; ≤5 chars = prefix, 6 = exact. */
  naics?: string;
  /**
   * Multiple NAICS codes, OR'd together — same prefix/exact rule per code. A user
   * profile carries 3-5 codes; `naics` alone could only ever express the first one.
   * When present this takes precedence over `naics`; when absent `naics` behaves
   * exactly as before (backward compatible).
   */
  naicsCodes?: string[];
  /** Agency name, case-insensitive partial. */
  agency?: string;
  /** 2-letter place-of-performance state. */
  state?: string;
  /** Expiration window in months (default 18). */
  monthsWindow?: number;
  /** Obligation floor (dollars). */
  minValue?: number;
  /** Obligation ceiling (dollars). */
  maxValue?: number;
  likelihood?: 'high' | 'medium' | 'low';
  limit?: number;
  /**
   * Sort order. Default 'expiry' (soonest-first) — the panel + MCP rely on this. Pass
   * 'value' to get the BIGGEST across the whole window instead (so a caller showing a
   * teaser can span the window rather than only see the imminent ones).
   */
  orderBy?: 'expiry' | 'value';
}

export interface ExpiringContract {
  contract_id: string;
  piid: string | null;
  incumbent_name: string | null;
  incumbent_uei: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  description: string | null;
  total_obligation: number | null;
  potential_total_value: number | null;
  period_of_performance_start: string | null;
  period_of_performance_current_end: string | null;
  place_of_performance_state: string | null;
  place_of_performance_city: string | null;
  set_aside_type: string | null;
  competition_type: string | null;
  number_of_offers: number | null;
  estimated_recompete_date: string | null;
  lead_time_months: number | null;
  recompete_likelihood: string | null;
}

export interface ExpiringContractsResult {
  contracts: ExpiringContract[];
  total: number;
  degraded: boolean;
}

export async function queryExpiringContracts(input: ExpiringContractsInput): Promise<ExpiringContractsResult> {
  // Local recompete_opportunities table (not an external API), so a larger
  // default costs nothing. Every real caller passes an explicit limit; this
  // default only applies when omitted (the MCP get_expiring_contracts tool).
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const months = Math.min(Math.max(Number(input.monthsWindow) || 18, 1), 60);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + months);
  const maxStr = maxDate.toISOString().split('T')[0];

  const build = (withQuality: boolean) => {
    let q = supabase
      .from('recompete_opportunities')
      .select(COLUMNS, { count: 'exact' })
      .gt('period_of_performance_current_end', todayStr)
      .lte('period_of_performance_current_end', maxStr);
    if (withQuality) q = q.is('quality_flag', null);

    // NAICS: a sanitized `naicsCodes` list wins (OR across codes); otherwise the
    // legacy single `naics` string is applied byte-for-byte as it always was.
    const codes = parseNaicsCodes(input.naicsCodes);
    const naics = (input.naics || '').trim();
    if (codes.length > 1) {
      q = q.or(naicsOrExpression(codes));
    } else if (codes.length === 1) {
      const c = codes[0];
      q = c.length < 6 ? q.like('naics_code', `${c}%`) : q.eq('naics_code', c);
    } else if (naics) {
      q = naics.length < 6 ? q.like('naics_code', `${naics}%`) : q.eq('naics_code', naics);
    }
    const agency = (input.agency || '').trim();
    if (agency) q = q.ilike('awarding_agency', `%${agency}%`);
    const state = (input.state || '').trim().toUpperCase();
    if (state) q = q.eq('place_of_performance_state', state);
    if (Number.isFinite(input.minValue)) q = q.gte('total_obligation', Number(input.minValue));
    if (Number.isFinite(input.maxValue)) q = q.lte('total_obligation', Number(input.maxValue));
    if (input.likelihood && ['high', 'medium', 'low'].includes(input.likelihood)) {
      q = q.eq('recompete_likelihood', input.likelihood);
    }
    const ordered = input.orderBy === 'value'
      ? q.order('total_obligation', { ascending: false, nullsFirst: false })
      : q.order('period_of_performance_current_end', { ascending: true });
    return ordered.limit(limit);
  };

  let res = await build(true);
  // Self-heal: pre-20260619 environments have no quality_flag column → retry without it.
  if (res.error && /quality_flag/.test(res.error.message)) {
    res = await build(false);
  }
  if (res.error) {
    console.error('[recompete:query] supabase error:', res.error.message);
    return { contracts: [], total: 0, degraded: true };
  }

  const contracts = (res.data || []) as unknown as ExpiringContract[];
  return { contracts, total: res.count ?? contracts.length, degraded: false };
}

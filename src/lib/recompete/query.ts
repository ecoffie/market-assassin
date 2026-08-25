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
import { getNaics } from '@/lib/codes/lookup';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const COLUMNS =
  'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,naics_code,naics_description,psc_code,description,total_obligation,potential_total_value,period_of_performance_start,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,set_aside_type,set_aside_enriched,competition_type,number_of_offers,estimated_recompete_date,lead_time_months,recompete_likelihood';

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
  /**
   * Set-aside codes the caller is eligible for (from the Vault, via
   * eligibleSetAsides()). When present, results are narrowed to contracts
   * competed under one of these — plus every contract whose set-aside is
   * UNKNOWN.
   *
   * ⚠️ THE NULLs MUST BE KEPT. set_aside_type is only known for the 35% of rows
   * matched in the BQ awards backfill; NULL means "we don't know", never
   * "unrestricted". Excluding unknowns would drop ~65% of the board and quietly
   * shrink a user's pipeline while looking like a precise filter — the exact
   * failure this feature exists to prevent.
   */
  eligibleSetAsides?: string[];
  limit?: number;
  /**
   * Sort order. Default 'expiry' (soonest-first) — the panel + MCP rely on this. Pass
   * 'value' to get the BIGGEST across the whole window instead (so a caller showing a
   * teaser can span the window rather than only see the imminent ones).
   */
  orderBy?: 'expiry' | 'value';
  /**
   * ── NS-2: ANCHOR the result set to a company's own contract vehicles ──────────────────
   * PIID prefixes (typically 6-char DoDAACs) whose contracts must be REACHABLE regardless
   * of where they rank in the broader market.
   *
   * WHY (measured 2026-08-25): the chain asked for NAICS 236220 recompetes over 18 months
   * for NORTH STAR GOVERNMENT SERVICES. **6,864 contracts qualified; the tool returns 50,
   * ordered by soonest expiry.** North Star's OWN SABER task order `FA461025F0190` ranks
   * ~568 of 6,864 and was cut. So was the vehicle it sits on. The 50th row expired the
   * NEXT DAY — the window is so crowded the cut lands one day out.
   *
   * Nothing about the COMPANY entered retrieval, so its own vehicle could not surface, and
   * the decision layer never had the chance to reason about it. Same class as DEFECT-9B:
   * rank globally, then hope the relevant row survives the limit.
   *
   * Anchoring runs a SECOND scoped query and merges — it never widens the market filters,
   * so an anchored row still had to satisfy NAICS, window and eligibility on its own.
   */
  anchorPiidPrefixes?: string[];
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
  set_aside_enriched?: string | null; // backfilled from BQ awards.set_aside via PIID (2026-07-29); coalesced into set_aside_type below
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
    // MINDY-008 (Eric/QA 2026-07-30): the filter matched ONLY the top-tier department, so
    // agency="FEMA" returned 0 even though 9 FEMA rows sit under awarding_sub_agency while
    // awarding_agency="Homeland Security". Match EITHER column, and expand a small set of
    // common acronyms to their full sub-agency name so "FEMA"/"CBP"/"TSA" resolve. PostgREST
    // .or() needs the value inline — `agency` is user text, so escape commas/parens that would
    // break the .or() grammar (NAICS elsewhere is digit-sanitized; agency is free text).
    const agency = (input.agency || '').trim();
    if (agency) {
      const AGENCY_ACRONYMS: Record<string, string> = {
        FEMA: 'Federal Emergency Management', CBP: 'Customs and Border Protection',
        TSA: 'Transportation Security Administration', ICE: 'Immigration and Customs Enforcement',
        USCIS: 'Citizenship and Immigration Services', CISA: 'Cybersecurity and Infrastructure Security',
        USACE: 'Army Corps of Engineers', NAVSUP: 'Naval Supply', DLA: 'Defense Logistics Agency',
      };
      const expanded = AGENCY_ACRONYMS[agency.toUpperCase()];
      const terms = expanded ? [agency, expanded] : [agency];
      // Build an OR across both columns for each term. Escape PostgREST .or() metachars.
      const esc = (s: string) => s.replace(/([,()])/g, '');
      const clauses = terms.flatMap((t) => {
        const v = esc(t);
        return [`awarding_agency.ilike.%${v}%`, `awarding_sub_agency.ilike.%${v}%`];
      });
      q = q.or(clauses.join(','));
    }
    const state = (input.state || '').trim().toUpperCase();
    if (state) q = q.eq('place_of_performance_state', state);
    if (Number.isFinite(input.minValue)) q = q.gte('total_obligation', Number(input.minValue));
    if (Number.isFinite(input.maxValue)) q = q.lte('total_obligation', Number(input.maxValue));
    if (input.likelihood && ['high', 'medium', 'low'].includes(input.likelihood)) {
      q = q.eq('recompete_likelihood', input.likelihood);
    }
    // Eligibility narrowing. Matches on set_aside_enriched (the column the
    // backfill actually populated — set_aside_type is a coalesced VIEW of it in
    // toRow() below, so filtering on set_aside_type here would match nothing).
    // `.is.null` is deliberately part of the OR: unknown ≠ ineligible.
    const elig = (input.eligibleSetAsides || []).map((s) => s.trim()).filter(Boolean);
    if (elig.length) {
      const inList = elig.map((s) => `"${s.replace(/"/g, '')}"`).join(',');
      q = q.or(`set_aside_enriched.in.(${inList}),set_aside_enriched.is.null`);
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

  let rawContracts = (res.data || []) as unknown as ExpiringContract[];

  // ── NS-2: pull the company's OWN vehicles into reach ──────────────────────────────────
  // A second query under the SAME market filters, scoped to the anchor prefixes, merged
  // ahead of the general results. This changes what is RETRIEVABLE, never what is
  // ELIGIBLE — an anchored row satisfied NAICS, window and set-aside on its own.
  const anchors = (input.anchorPiidPrefixes || [])
    .map((p) => String(p || '').trim().toUpperCase())
    .filter((p) => /^[A-Z0-9]{4,10}$/.test(p));
  if (anchors.length) {
    const seen = new Set(rawContracts.map((c) => c.contract_id));
    for (const prefix of anchors.slice(0, 5)) {
      const scoped = await (async () => {
        let aq = supabase
          .from('recompete_opportunities')
          .select(COLUMNS)
          .gt('period_of_performance_current_end', todayStr)
          .lte('period_of_performance_current_end', maxStr)
          .like('piid', `${prefix}%`);
        const codes = parseNaicsCodes(input.naicsCodes);
        // Mirror the primary query's NAICS narrowing exactly — anchoring must not widen
        // eligibility, only reachability.
        const single = codes.length === 1 ? codes[0] : (input.naics || '').trim();
        if (single) {
          aq = single.length < 6 ? aq.like('naics_code', `${single}%`) : aq.eq('naics_code', single);
        }
        return aq.order('period_of_performance_current_end', { ascending: true }).limit(25);
      })();
      if (scoped.error) {
        // An anchor lookup that FAILS must not silently drop the company's own vehicle —
        // report degradation rather than returning a quietly thinner board.
        console.error('[recompete:query] anchor lookup failed:', scoped.error.message);
        continue;
      }
      for (const row of (scoped.data || []) as unknown as ExpiringContract[]) {
        if (!seen.has(row.contract_id)) { seen.add(row.contract_id); rawContracts.unshift(row); }
      }
    }
  }

  // FM-U06 (Eric/QA 2026-07-29): the stored estimated_recompete_date/lead_time_months were baked at
  // sync time as (pop_end − 12mo) and a static value — so for a near-term expiry they read as PAST
  // dates and lead_time_months=0 for every row. Recompute them LIVE from today vs the real PoP-end:
  //  • lead_time_months  = whole months from today until PoP-end (>=0)
  //  • estimated_recompete_date = when a solicitation typically posts — ~9mo before PoP-end, but never
  //    before today (if the window's already inside 9mo, "expect it now"). Forward-looking, never past.
  const now = Date.now();
  const MS_PER_MONTH = 30.4375 * 86_400_000;
  const contracts = rawContracts.map((c) => {
    // set_aside_type is NULL on every recompete row (the sync omits it); the backfill (2026-07-29)
    // recovered it into set_aside_enriched from BQ awards.set_aside. Coalesce so every downstream
    // consumer (map, drawer, MCP) sees the real value. Enriched wins; both null → stays null ("unknown",
    // never a guessed value). 'Full & Open' is a real recorded outcome, kept as-is.
    const set_aside_type = c.set_aside_enriched ?? c.set_aside_type;
    // MINDY-007 (Eric/QA 2026-07-30) — naics_description is NULL on every row because
    // USASpending's spending_by_award endpoint returns "NAICS Description" NULL even
    // when requested (like set-aside; verified live). It's DERIVABLE for free from the
    // naics_code we DO store, via the authoritative NAICS name map — so coalesce it
    // here (query time reaches the MCP tool + every consumer, no backfill). psc_code /
    // description are NOT derivable from what we store (they live on the per-award
    // detail endpoint) and stay null — an honest miss, never a guess.
    const naics_description = c.naics_description ?? (c.naics_code ? getNaics(c.naics_code)?.title ?? null : null);
    const end = c.period_of_performance_current_end ? new Date(c.period_of_performance_current_end).getTime() : null;
    if (!end || Number.isNaN(end)) return { ...c, set_aside_type, naics_description };
    const leadMonths = Math.max(0, Math.round((end - now) / MS_PER_MONTH));
    const solLead = 9 * MS_PER_MONTH; // typical months a recompete solicitation posts before PoP-end
    const estMs = Math.max(now, end - solLead); // never in the past
    return {
      ...c,
      set_aside_type,
      naics_description,
      lead_time_months: leadMonths,
      estimated_recompete_date: new Date(estMs).toISOString().slice(0, 10),
    };
  });
  return { contracts, total: res.count ?? contracts.length, degraded: false };
}

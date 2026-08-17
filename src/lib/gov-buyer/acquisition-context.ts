/**
 * Acquisition context — Procurement History + Market Signals for the
 * Market Research Workspace (`/gov/market-research`).
 *
 * PRD: tasks/PRD-market-research-workspace.md §6 Steps 4–5 (P2 + P3).
 *
 * ORCHESTRATION ONLY. This adds no new scoring, no new metric, and no new
 * table. It reads `recompete_opportunities` (the award record) and reuses
 * `queryFederalEvents` (the grounded SAM events read) and hands the page a
 * shape it can render directly.
 *
 * THE HONESTY CONTRACT (the reason this demo survives a KO's questions):
 * every field here is either a real measurement or an explicit null. A count
 * of zero rows is reported as `measured: true, count: 0` ONLY when the query
 * actually ran and came back empty; a query that failed reports
 * `measured: false` so the UI renders "Not measured" instead of a confident
 * zero. Those are different facts and the page must not blur them.
 *
 * VALUE-CORRUPTION GUARD: `recompete_opportunities` carries known-bad ceiling
 * values (the Carahsoft "$2.8 TRILLION" class of row — aggregate ceilings and
 * parse artifacts). Documented in docs/strategy/MINDY-DAY-LIVE-DEMO-MOMENT.md.
 * Rows above MAX_PLAUSIBLE_VALUE are excluded from the history list rather
 * than shown, because one absurd number on screen discredits every real one
 * next to it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { queryFederalEvents, type FederalEvent } from '@/lib/events/query';

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _supabase;
}

/**
 * Ceiling above which a recompete row is treated as a data artifact rather
 * than a contract. $50B is far above any single small-business-relevant
 * vehicle and comfortably below the aggregate-ceiling junk.
 */
const MAX_PLAUSIBLE_VALUE = 50_000_000_000;

export interface PriorContract {
  incumbent: string;
  piid: string | null;
  agency: string | null;
  subAgency: string | null;
  value: number | null;
  naics: string | null;
  pscDescription: string | null;
  state: string | null;
  periodEnd: string | null;
  estimatedRecompete: string | null;
  recompeteLikelihood: string | null;
  setAside: string | null;
  contractType: string | null;
}

export interface ProcurementHistory {
  /** false when the query itself failed — the UI must show "Not measured". */
  measured: boolean;
  /** Rows matching the scope (after the corruption guard). */
  contracts: PriorContract[];
  /** Total matching rows before the display limit. */
  totalMatching: number;
  /** Distinct incumbents across the matched set. */
  distinctIncumbents: number;
  /** Rows excluded by the value guard — disclosed, never silently dropped. */
  excludedImplausible: number;
  /** Sum of plausible ceilings; null when nothing measurable matched. */
  totalValue: number | null;
  /** Set-aside coverage — how many matched rows carry a set-aside at all. */
  setAsideCoverage: { withSetAside: number; total: number };
  note: string | null;
}

export interface MarketSignals {
  measured: boolean;
  events: FederalEvent[];
  samCount: number;
  /** Recompetes coming up inside the horizon — the "what's about to move" signal. */
  upcomingRecompetes: number | null;
  horizonMonths: number;
  note: string | null;
}

export interface AcquisitionContextParams {
  naics: string;
  agency?: string;
  state?: string;
  keyword?: string;
  /** Look-ahead for events + recompetes. Default 6 months. */
  horizonMonths?: number;
  limit?: number;
}

export interface AcquisitionContext {
  history: ProcurementHistory;
  signals: MarketSignals;
}

/** Agency match for the award record. Navy/Marine Corps roll up under DoD in
 *  `awarding_agency`, so match the sub-agency too rather than miss the row. */
function applyAgencyFilter<T>(q: T, agency: string): T {
  const a = agency.trim();
  // PostgREST `.or()` — awarding_agency OR awarding_sub_agency OR funding_agency.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (q as any).or(
    `awarding_agency.ilike.%${a}%,awarding_sub_agency.ilike.%${a}%,funding_agency.ilike.%${a}%`,
  );
}

/**
 * Procurement history for a requirement scope, from the award record.
 *
 * Matching is NAICS-first (the scope the workspace is keyed on), narrowed by
 * agency/state when supplied. Ordered by recompete date so the most
 * actionable rows surface first — a CO cares about what is coming up, not
 * what is largest.
 */
export async function getProcurementHistory(
  params: AcquisitionContextParams,
): Promise<ProcurementHistory> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const empty = (note: string): ProcurementHistory => ({
    measured: false, contracts: [], totalMatching: 0, distinctIncumbents: 0,
    excludedImplausible: 0, totalValue: null,
    setAsideCoverage: { withSetAside: 0, total: 0 }, note,
  });

  try {
    let q = db()
      .from('recompete_opportunities')
      .select(
        'incumbent_name,piid,awarding_agency,awarding_sub_agency,potential_total_value,' +
        'naics_code,psc_description,place_of_performance_state,' +
        'period_of_performance_current_end,estimated_recompete_date,recompete_likelihood,' +
        'set_aside_type,contract_type',
        { count: 'exact' },
      )
      .eq('naics_code', params.naics.trim());

    if (params.agency) q = applyAgencyFilter(q, params.agency);
    if (params.state) q = q.eq('place_of_performance_state', params.state.trim().toUpperCase());
    if (params.keyword) {
      const k = params.keyword.trim();
      q = q.or(`psc_description.ilike.%${k}%,naics_description.ilike.%${k}%`);
    }

    // Only contracts whose recompete is still ahead of us. A history section
    // that leads with a 2025 date reads as stale data to a CO — and an
    // already-expired recompete is not actionable acquisition planning.
    q = q.gte('estimated_recompete_date', new Date().toISOString().slice(0, 10));

    // Pull a wider slice than we display so the guard + aggregates are honest.
    const { data, error, count } = await q
      .order('estimated_recompete_date', { ascending: true })
      .limit(200);

    // ALWAYS check {error} — a PostgREST failure returns data:null with a
    // populated error, and treating that as "no results" is the silent-empty
    // bug class this codebase has been bitten by before.
    if (error) return empty(`Procurement history query failed: ${error.message}`);
    if (!data) return empty('Procurement history query returned no payload.');

    // Double assertion: the `.or()` chain widens PostgREST's inferred row type
    // to GenericStringError[], which does not overlap the real row shape.
    const rows = data as unknown as Record<string, unknown>[];
    const plausible = rows.filter((r) => {
      const v = r.potential_total_value as number | null;
      return v === null || v === undefined || v <= MAX_PLAUSIBLE_VALUE;
    });
    const excludedImplausible = rows.length - plausible.length;

    const contracts: PriorContract[] = plausible.slice(0, limit).map((r) => ({
      incumbent: (r.incumbent_name as string) || 'Not identified',
      piid: (r.piid as string) ?? null,
      agency: (r.awarding_agency as string) ?? null,
      subAgency: (r.awarding_sub_agency as string) ?? null,
      value: (r.potential_total_value as number) ?? null,
      naics: (r.naics_code as string) ?? null,
      pscDescription: (r.psc_description as string) ?? null,
      state: (r.place_of_performance_state as string) ?? null,
      periodEnd: (r.period_of_performance_current_end as string) ?? null,
      estimatedRecompete: (r.estimated_recompete_date as string) ?? null,
      recompeteLikelihood: (r.recompete_likelihood as string) ?? null,
      setAside: (r.set_aside_type as string) ?? null,
      contractType: (r.contract_type as string) ?? null,
    }));

    const distinctIncumbents = new Set(
      plausible.map((r) => (r.incumbent_name as string) || '').filter(Boolean),
    ).size;

    const valued = plausible
      .map((r) => r.potential_total_value as number | null)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const rawTotal = valued.length ? valued.reduce((a, b) => a + b, 0) : null;

    // AGGREGATE guard, distinct from the per-row one. Individually-plausible
    // ceilings can still sum to an absurd figure when the scope is broad
    // (a NAICS-only query summed to $3.8 TRILLION in testing). A number that
    // large is not a market size a CO recognizes — it is the aggregate-ceiling
    // artifact restated. Withhold rather than print it: "Not measured" costs
    // nothing, one absurd number discredits every real figure beside it.
    const MAX_PLAUSIBLE_TOTAL = 500_000_000_000;
    const totalImplausible = rawTotal !== null && rawTotal > MAX_PLAUSIBLE_TOTAL;
    const totalValue = totalImplausible ? null : rawTotal;

    const withSetAside = plausible.filter((r) => r.set_aside_type != null).length;

    return {
      measured: true,
      contracts,
      totalMatching: count ?? plausible.length,
      distinctIncumbents,
      excludedImplausible,
      totalValue,
      setAsideCoverage: { withSetAside, total: plausible.length },
      note: [
        excludedImplausible > 0
          ? `${excludedImplausible} row(s) excluded: ceiling value above $50B, which indicates an aggregate-ceiling or parse artifact rather than a single contract.`
          : null,
        totalImplausible
          ? 'Combined ceiling withheld: the summed value for this scope exceeds a plausible market size, which indicates aggregate-ceiling records in the award data. Narrow by agency or place of performance for a meaningful total.'
          : null,
      ].filter(Boolean).join(' ') || null,
    };
  } catch (err) {
    return empty(err instanceof Error ? err.message : 'Procurement history query failed.');
  }
}

/**
 * Market signals — industry days / sources sought / RFIs from the grounded
 * SAM events read, plus the count of recompetes landing inside the horizon.
 *
 * AI web discovery is deliberately NOT enabled here (`includeAiDiscovery`
 * defaults false): this surface is shown to contracting officers, and every
 * row on it should be a grounded SAM record, not a model's guess at a
 * conference. Confidence-scored AI rows have their place; an acquisition
 * planning document is not it.
 */
export async function getMarketSignals(
  params: AcquisitionContextParams,
): Promise<MarketSignals> {
  const horizonMonths = Math.min(Math.max(params.horizonMonths ?? 6, 1), 12);

  let events: FederalEvent[] = [];
  let samCount = 0;
  let eventsMeasured = false;
  let note: string | null = null;

  if (params.agency) {
    try {
      const res = await queryFederalEvents({
        agency: params.agency,
        monthsAhead: horizonMonths,
        includeAiDiscovery: false,
        currentYear: new Date().getFullYear(),
        limit: 25,
      });
      // `degraded` means the grounded read hard-failed — that is NOT "no events".
      eventsMeasured = !res.degraded;
      events = res.events;
      samCount = res.samCount;
      if (res.degraded) note = 'The SAM events read failed; engagement signals are not measured.';
    } catch (err) {
      note = err instanceof Error ? err.message : 'Events query failed.';
    }
  } else {
    note = 'Engagement events are matched by agency. Add an agency to the requirement to surface industry days, sources sought, and RFIs.';
  }

  // Recompetes inside the horizon — same scope as the history query.
  let upcomingRecompetes: number | null = null;
  try {
    const horizon = new Date();
    horizon.setMonth(horizon.getMonth() + horizonMonths);
    let q = db()
      .from('recompete_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('naics_code', params.naics.trim())
      .gt('estimated_recompete_date', new Date().toISOString().slice(0, 10))
      .lte('estimated_recompete_date', horizon.toISOString().slice(0, 10));
    if (params.agency) q = applyAgencyFilter(q, params.agency);
    if (params.state) q = q.eq('place_of_performance_state', params.state.trim().toUpperCase());

    const { count, error } = await q;
    if (!error) upcomingRecompetes = count ?? 0;
  } catch {
    // leave null — "not measured", never 0.
  }

  return {
    measured: eventsMeasured || upcomingRecompetes !== null,
    events,
    samCount,
    upcomingRecompetes,
    horizonMonths,
    note,
  };
}

/** Both halves of the acquisition context, in parallel. */
export async function getAcquisitionContext(
  params: AcquisitionContextParams,
): Promise<AcquisitionContext> {
  const [history, signals] = await Promise.all([
    getProcurementHistory(params),
    getMarketSignals(params),
  ]);
  return { history, signals };
}

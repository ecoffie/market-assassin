/**
 * find_opportunities — non-spatial Opportunity Map FIND composition.
 *
 * Composes three Maps horizons (Open now / Coming back / Coming soon) with
 * independent envelopes. One horizon failure never becomes a market-wide zero.
 * Does NOT change map viewport APIs. Cross-class dedupe is intentionally absent.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  applyMapFilters,
  parseMapFilters,
  parseStateList,
  naicsMatchConds,
  agencyOrExpr,
  multiAgency,
  NO_MATCH_SENTINEL,
} from '@/lib/opportunities/map-filters';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { resolveQueryIntent, setAsideOrExpr, pscToNaicsCodes } from '@/lib/search/query-intent';
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { currentFiscalYear } from '@/lib/forecasts/query';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type HorizonKey = 'open_now' | 'coming_back' | 'coming_soon';
export type HorizonStatus = 'grounded' | 'empty' | 'unavailable' | 'partial';

export type HandoffKey =
  | 'incumbent'
  | 'bid_fit'
  | 'dossier'
  | 'documents'
  | 'draft_response'
  | 'agency_intel'
  | 'contract_history'
  | 'recompete_planning'
  | 'market_intel'
  | 'prepare_positioning'
  | 'monitor_market'
  | 'monitor_notice';

export interface FindOpportunitiesInput {
  query: string;
  location?: string | null;
  agency?: string | null;
  set_aside?: string | null;
  timeframe?: {
    open_closing_days?: number | null;
    recompete_months?: number | null;
    forecast_include_past?: boolean | null;
  } | null;
  horizons?: Partial<Record<HorizonKey, boolean>> | null;
  limit_per_horizon?: number | null;
  advanced?: {
    naics?: string | null;
    psc?: string | null;
    keyword_exact?: string | null;
  } | null;
}

export interface FindNextAction {
  prompt: string;
  tool?: string;
  credits?: number;
  requires_confirmation: boolean;
  suggested_args?: Record<string, unknown>;
  missing_inputs?: string[];
}

export interface HorizonItemBase {
  horizon: HorizonKey;
  title: string;
  buyer: string | null;
  location_label: string | null;
  relevant_date: string | null;
  relevant_date_label: string;
  value_label: string | null;
  source: string;
  why_this_matched: string;
  identity: { kind: string; id: string };
}

export type HorizonItem = HorizonItemBase & Record<string, unknown>;

export interface HorizonResult {
  status: HorizonStatus;
  matched_count: number | null;
  returned_count: number;
  items: HorizonItem[];
  source: string;
  as_of: string | null;
  filters_consumed: string[];
  filters_unsupported: string[];
  unmapped_count: number | null;
  error: { class: string; message: string } | null;
  allowed_handoffs: HandoffKey[];
  semantics_note: string | null;
}

export interface FindOpportunitiesResult {
  query_summary: {
    query: string;
    location: string | null;
    agency: string | null;
    timeframe: FindOpportunitiesInput['timeframe'];
    set_aside: string | null;
    horizons_requested: HorizonKey[];
    interpreted_as: Record<HorizonKey, string>;
  };
  horizons: Record<HorizonKey, HorizonResult>;
  summary: {
    open_now: { status: HorizonStatus; matched_count: number | null };
    coming_back: { status: HorizonStatus; matched_count: number | null };
    coming_soon: { status: HorizonStatus; matched_count: number | null };
    headline: string;
    claim_hygiene: string;
  };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    composition: 'opportunity_map_horizons_v1';
    expansion_note: string;
    watch_coverage: Array<'open_now' | 'coming_soon'>;
    find_shape: 'specific' | 'broad';
  };
  _next: FindNextAction[];
}

const OPEN_HANDOFFS: HandoffKey[] = [
  'incumbent', 'bid_fit', 'dossier', 'documents', 'draft_response',
  'agency_intel', 'market_intel', 'prepare_positioning', 'monitor_market', 'monitor_notice',
];
const BACK_HANDOFFS: HandoffKey[] = [
  'incumbent', 'agency_intel', 'contract_history', 'recompete_planning',
  'market_intel', 'prepare_positioning', 'monitor_market',
];
const SOON_HANDOFFS: HandoffKey[] = [
  'agency_intel', 'market_intel', 'prepare_positioning', 'monitor_market',
];

const WATCH_COVERAGE = ['open_now', 'coming_soon'] as const;

function sb(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function clampLimit(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 5;
  return Math.min(Math.max(Math.floor(v), 1), 25);
}

function moneyLabel(n: unknown): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function locLabel(city: string | null | undefined, state: string | null | undefined): string | null {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (c && s) return `${c}, ${s}`;
  return s || c || null;
}

function unavailable(source: string, handoffs: HandoffKey[], message: string, unsupported: string[] = []): HorizonResult {
  return {
    status: 'unavailable',
    matched_count: null,
    returned_count: 0,
    items: [],
    source,
    as_of: null,
    filters_consumed: [],
    filters_unsupported: unsupported,
    unmapped_count: null,
    error: { class: 'query_failed', message },
    allowed_handoffs: handoffs,
    semantics_note: 'Source unavailable — do not treat as zero matches.',
  };
}

function emptyHorizon(
  source: string,
  handoffs: HandoffKey[],
  consumed: string[],
  unsupported: string[],
  asOf: string | null,
  note: string | null,
  unmapped: number | null = 0,
): HorizonResult {
  return {
    status: 'empty',
    matched_count: 0,
    returned_count: 0,
    items: [],
    source,
    as_of: asOf,
    filters_consumed: consumed,
    filters_unsupported: unsupported,
    unmapped_count: unmapped,
    error: null,
    allowed_handoffs: handoffs,
    semantics_note: note,
  };
}

async function tableAsOf(client: SupabaseClient, table: string, col: string): Promise<string | null> {
  try {
    const { data, error } = await client.from(table).select(col).order(col, { ascending: false }).limit(1);
    if (error || !data?.[0]) return null;
    const v = (data[0] as Record<string, unknown>)[col];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Resolve customer query into per-horizon filter bags (Maps search brain). */
function interpretQuery(input: FindOpportunitiesInput): {
  searchText: string;
  stateCode: string | null;
  agency: string;
  setAside: string;
  advancedNaics: string;
  advancedPsc: string;
  openClosingDays: number;
  recompeteMonths: number;
  forecastIncludePast: boolean;
  interpreted: Record<HorizonKey, string>;
} {
  const searchText = (input.advanced?.keyword_exact || input.query || '').trim();
  const stateRaw = (input.location || '').trim();
  const stateCode = stateRaw ? normalizeStateCode(stateRaw) : null;
  const agency = (input.agency || '').trim();
  const setAside = (input.set_aside || '').trim();
  const advancedNaics = (input.advanced?.naics || '').trim();
  const advancedPsc = (input.advanced?.psc || '').trim();
  const openClosingDays = Math.max(0, Number(input.timeframe?.open_closing_days) || 0);
  const recompeteMonths = Math.min(60, Math.max(1, Number(input.timeframe?.recompete_months) || 18));
  const forecastIncludePast = !!input.timeframe?.forecast_include_past;

  const intent = resolveQueryIntent(searchText);
  const toa = intent.kind === 'keyword' ? termOfArtNaicsCodes(searchText) : null;

  return {
    searchText,
    stateCode,
    agency,
    setAside,
    advancedNaics,
    advancedPsc,
    openClosingDays,
    recompeteMonths,
    forecastIncludePast,
    interpreted: {
      open_now:
        `SAM active notices; keyword via search brain (${intent.kind}); ` +
        `geo = place-of-performance OR buying-office state` +
        (stateCode ? ` (${stateCode})` : ''),
      coming_back:
        `Real future recompetes; keyword → ${toa?.length ? 'term-of-art NAICS' : intent.kind}; ` +
        `geo = place_of_performance_state only` +
        (stateCode ? ` (${stateCode})` : '') +
        `; window ≤${recompeteMonths}mo`,
      coming_soon:
        `agency_forecasts (Maps universe, exclude past FY` +
        `${forecastIncludePast ? ' DISABLED' : ''}); geo = pop_state only` +
        (stateCode ? ` (${stateCode})` : '') +
        `; no status=forecasted requirement`,
    },
  };
}

async function queryOpenNow(
  client: SupabaseClient,
  p: ReturnType<typeof interpretQuery>,
  limit: number,
): Promise<HorizonResult> {
  const source = 'sam_opportunities';
  const consumed: string[] = ['query', 'status=active'];
  const unsupported: string[] = [];
  const asOf = await tableAsOf(client, source, 'updated_at');

  try {
    const get = (k: string): string | null => {
      if (k === 'q' || k === 'search') return p.searchText || null;
      if (k === 'state') return p.stateCode || null;
      if (k === 'agency') return p.agency || null;
      if (k === 'setAside') return p.setAside || null;
      if (k === 'naics') return p.advancedNaics || null;
      if (k === 'psc') return p.advancedPsc || null;
      if (k === 'status') return 'active';
      if (k === 'closingDays') return p.openClosingDays > 0 ? String(p.openClosingDays) : null;
      return null;
    };
    const f = parseMapFilters(get);
    if (p.searchText) consumed.push('query→search_brain');
    if (p.stateCode) consumed.push('location→pop_or_office');
    if (p.agency) consumed.push('agency');
    if (p.setAside) consumed.push('set_aside');
    if (p.advancedNaics) consumed.push('advanced.naics');
    if (p.advancedPsc) consumed.push('advanced.psc');
    if (p.openClosingDays > 0) consumed.push('timeframe.open_closing_days');

    const COLS =
      'notice_id, title, department, sub_tier, naics_code, set_aside_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, pop_state, pop_city, office_address, map_lat, updated_at';

    let listQ = client.from(source).select(COLS, { count: 'exact' });
    listQ = applyMapFilters(listQ, f);
    const { data, count, error } = await listQ
      .order('response_deadline', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) return unavailable(source, OPEN_HANDOFFS, error.message, unsupported);

    let unmapped: number | null = null;
    {
      let uq = client.from(source).select('notice_id', { count: 'exact', head: true }).is('map_lat', null);
      uq = applyMapFilters(uq, f);
      const { count: uc, error: ue } = await uq;
      if (!ue) unmapped = uc ?? null;
    }

    const matched = count ?? null;
    const rows = (data || []) as Array<Record<string, unknown>>;
    if (!rows.length) {
      return emptyHorizon(
        source,
        OPEN_HANDOFFS,
        consumed,
        unsupported,
        asOf,
        'No matching open solicitations under these filters.',
        unmapped,
      );
    }

    const items: HorizonItem[] = rows.map((r) => {
      const office = r.office_address as { city?: string; state?: string } | null;
      const st = String(r.pop_state || office?.state || '');
      const city = String(r.pop_city || office?.city || '');
      return {
        horizon: 'open_now',
        title: String(r.title || 'Untitled opportunity'),
        buyer: String(r.department || r.sub_tier || '') || null,
        location_label: locLabel(city, st),
        relevant_date: (r.response_deadline as string) || null,
        relevant_date_label: 'response_deadline',
        value_label: null,
        source,
        why_this_matched: p.searchText
          ? `Matched open SAM notice for “${p.searchText}”`
          : 'Matched open SAM notice',
        identity: { kind: 'notice_id', id: String(r.notice_id || '') },
        notice_id: String(r.notice_id || ''),
        solicitation_number: String(r.solicitation_number || '') || null,
        response_deadline: (r.response_deadline as string) || null,
        set_aside: (r.set_aside_description as string) || (r.set_aside_code as string) || null,
        sam_url: (r.ui_link as string) || null,
        notice_type: (r.notice_type as string) || null,
        naics_code: (r.naics_code as string) || null,
        sub_agency: (r.sub_tier as string) || null,
      };
    });

    return {
      status: 'grounded',
      matched_count: matched,
      returned_count: items.length,
      items,
      source,
      as_of: asOf,
      filters_consumed: consumed,
      filters_unsupported: unsupported,
      unmapped_count: unmapped,
      error: null,
      allowed_handoffs: OPEN_HANDOFFS,
      semantics_note: 'Geography: place of performance OR buying-office state.',
    };
  } catch (e) {
    return unavailable(source, OPEN_HANDOFFS, (e as Error).message, unsupported);
  }
}

async function queryComingBack(
  client: SupabaseClient,
  p: ReturnType<typeof interpretQuery>,
  limit: number,
): Promise<HorizonResult> {
  const source = 'recompete_opportunities';
  const consumed: string[] = ['quality_flag=null', 'pop_end≥today'];
  const unsupported: string[] = [];
  const asOf = await tableAsOf(client, source, 'last_synced_at');
  const today = new Date().toISOString().slice(0, 10);
  const bound = new Date();
  bound.setMonth(bound.getMonth() + p.recompeteMonths);
  const maxEnd = bound.toISOString().slice(0, 10);

  try {
    let naics = p.advancedNaics;
    let qKeyword = '';
    let qSetAside = '';
    const q = p.searchText;

    if (q && !naics) {
      const intent = resolveQueryIntent(q);
      if (intent.kind === 'setAside' && intent.setAside) {
        qSetAside = setAsideOrExpr(intent.setAside, { textCols: ['set_aside_type'] }) || '';
        consumed.push('query→set_aside');
      } else if (intent.kind === 'naics' && intent.naics?.length) {
        naics = intent.naics.join(',');
        consumed.push('query→naics');
      } else if (intent.kind === 'psc' && intent.psc) {
        const xw = pscToNaicsCodes(intent.psc);
        if (xw.length) {
          naics = xw.join(',');
          consumed.push('query→psc→naics_crosswalk');
        } else {
          qKeyword = intent.psc;
          unsupported.push('psc (column ~empty; no NAICS crosswalk)');
          consumed.push('query→keyword_fallback');
        }
      } else {
        const toa = termOfArtNaicsCodes(q);
        if (toa?.length) {
          naics = toa.join(',');
          consumed.push('query→term_of_art_naics');
        } else {
          qKeyword = q;
          consumed.push('query→incumbent/naics_desc/agency');
        }
      }
    } else if (q) {
      consumed.push('query_ignored_advanced_naics_set');
    }

    if (p.advancedPsc) {
      unsupported.push('advanced.psc (recompete psc_code sparse — not applied)');
    }
    if (p.stateCode) consumed.push('location→place_of_performance_state');
    if (p.agency) consumed.push('agency→awarding_agency');
    if (p.setAside && !qSetAside) {
      // Free-text set-aside from dedicated field
      consumed.push('set_aside');
    }
    consumed.push(`timeframe.recompete_months=${p.recompeteMonths}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (query: any) => {
      query = query
        .is('quality_flag', null)
        .gte('period_of_performance_current_end', today)
        .lte('period_of_performance_current_end', maxEnd);
      if (p.agency) {
        const expr = agencyOrExpr('awarding_agency', multiAgency(p.agency));
        if (expr) query = query.or(expr);
      }
      if (naics) {
        const codes = naics.split(',').map((c) => c.trim()).filter(Boolean);
        const conds = naicsMatchConds(codes);
        if (conds.length) query = query.or(conds.join(','));
      }
      const states = parseStateList(p.stateCode);
      if (states) {
        if (states.length) query = query.or(states.map((st) => `place_of_performance_state.eq.${st}`).join(','));
        else query = query.eq('place_of_performance_state', NO_MATCH_SENTINEL);
      }
      if (qSetAside) query = query.or(qSetAside);
      else if (p.setAside) query = query.ilike('set_aside_type', `%${p.setAside.replace(/[%,()]/g, ' ')}%`);
      if (qKeyword) {
        const esc = qKeyword.replace(/[%,()]/g, ' ');
        query = query.or(
          `incumbent_name.ilike.%${esc}%,naics_description.ilike.%${esc}%,awarding_agency.ilike.%${esc}%`,
        );
      }
      return query;
    };

    const COLS =
      'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,naics_code,naics_description,potential_total_value,total_obligation,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,set_aside_type,recompete_likelihood,map_lat,last_synced_at';

    let listQ = apply(client.from(source).select(COLS, { count: 'exact' }));
    const { data, count, error } = await listQ
      .order('period_of_performance_current_end', { ascending: true })
      .limit(limit);

    if (error) return unavailable(source, BACK_HANDOFFS, error.message, unsupported);

    let unmapped: number | null = null;
    {
      let uq = apply(client.from(source).select('contract_id', { count: 'exact', head: true })).is('map_lat', null);
      const { count: uc, error: ue } = await uq;
      if (!ue) unmapped = uc ?? null;
    }

    const rows = (data || []) as Array<Record<string, unknown>>;
    if (!rows.length) {
      return emptyHorizon(
        source,
        BACK_HANDOFFS,
        consumed,
        unsupported,
        asOf,
        'No matching future recompetes under these filters.',
        unmapped,
      );
    }

    const items: HorizonItem[] = rows.map((r) => ({
      horizon: 'coming_back',
      title: String(r.naics_description || r.piid || 'Expiring contract'),
      buyer: String(r.awarding_agency || '') || null,
      location_label: locLabel(r.place_of_performance_city as string, r.place_of_performance_state as string),
      relevant_date: (r.period_of_performance_current_end as string) || null,
      relevant_date_label: 'current_end',
      value_label: moneyLabel(r.potential_total_value) || moneyLabel(r.total_obligation),
      source,
      why_this_matched: p.searchText
        ? `Matched recompete / expiring contract for “${p.searchText}”`
        : 'Matched recompete / expiring contract',
      identity: { kind: 'contract_id', id: String(r.contract_id || '') },
      contract_id: String(r.contract_id || ''),
      piid: String(r.piid || '') || null,
      incumbent_name: (r.incumbent_name as string) || null,
      incumbent_uei: (r.incumbent_uei as string) || null,
      current_end: (r.period_of_performance_current_end as string) || null,
      potential_total_value: r.potential_total_value ?? null,
      total_obligation: r.total_obligation ?? null,
      recompete_likelihood: (r.recompete_likelihood as string) || null,
      set_aside_type: (r.set_aside_type as string) || null,
      naics_code: (r.naics_code as string) || null,
      awarding_sub_agency: (r.awarding_sub_agency as string) || null,
    }));

    return {
      status: 'grounded',
      matched_count: count ?? null,
      returned_count: items.length,
      items,
      source,
      as_of: asOf,
      filters_consumed: consumed,
      filters_unsupported: unsupported,
      unmapped_count: unmapped,
      error: null,
      allowed_handoffs: BACK_HANDOFFS,
      semantics_note:
        'Geography: place of performance only (not buying-office). Not a live solicitation — do not draft a proposal as if an RFP exists. Watch/email for this horizon is not available yet.',
    };
  } catch (e) {
    return unavailable(source, BACK_HANDOFFS, (e as Error).message, unsupported);
  }
}

async function queryComingSoon(
  client: SupabaseClient,
  p: ReturnType<typeof interpretQuery>,
  limit: number,
): Promise<HorizonResult> {
  const source = 'agency_forecasts';
  const consumed: string[] = ['maps_universe', 'exclude_past_fy'];
  const unsupported: string[] = [];
  const asOf = await tableAsOf(client, source, 'last_synced_at');

  try {
    // Build search/naics the way Maps applyForecastFilters expects.
    let q = p.searchText;
    let naics = p.advancedNaics;
    if (p.advancedPsc && !naics) {
      const xw = pscToNaicsCodes(p.advancedPsc);
      if (xw.length) {
        naics = xw.join(',');
        consumed.push('advanced.psc→naics_crosswalk');
      } else unsupported.push('advanced.psc (no NAICS crosswalk)');
    }
    // If free-text is a term-of-art, also feed NAICS so sparse title misses still hit.
    if (q && !naics) {
      const intent = resolveQueryIntent(q);
      if (intent.kind === 'naics' && intent.naics?.length) {
        naics = intent.naics.join(',');
        q = '';
        consumed.push('query→naics');
      } else if (intent.kind === 'keyword') {
        const toa = termOfArtNaicsCodes(q);
        // Keep q for text match; Maps doesn't auto-NAICS on forecast for keyword —
        // but term-of-art enrichment helps recall without excluding text hits.
        if (toa?.length) {
          // Prefer text path (Maps); note enrichment in consumed only when we set naics filter.
          // Stick to Maps: applyForecastFilters uses q OR naics — if both, both apply (AND).
          // So for keyword we leave naics empty and use q only (Maps parity).
          consumed.push('query→forecast_text_brain');
        } else {
          consumed.push('query→forecast_text');
        }
      } else {
        consumed.push(`query→${intent.kind}`);
      }
    }

    if (p.stateCode) consumed.push('location→pop_state');
    if (p.agency) consumed.push('agency→source_agency_resolved');
    if (p.setAside) consumed.push('set_aside');
    if (p.forecastIncludePast) {
      consumed.push('timeframe.forecast_include_past');
      // strip exclude_past_fy marker
      const i = consumed.indexOf('exclude_past_fy');
      if (i >= 0) consumed.splice(i, 1);
    }

    const filters = {
      q: q || null,
      naics: naics || null,
      agency: p.agency || null,
      state: p.stateCode || null,
    };

    const COLS =
      'id, title, department, source_agency, naics_code, naics_description, set_aside_type, estimated_value_min, estimated_value_max, estimated_value_range, anticipated_quarter, fiscal_year, anticipated_award_date, solicitation_date, pop_state, pop_city, map_lat, status, last_synced_at, contracting_office, incumbent_name';

    let listQ = client.from(source).select(COLS, { count: 'exact' });
    listQ = applyForecastFilters(listQ, filters);

    // Past-FY exclusion — same whitelist as queryForecasts (Maps MCP path).
    if (!p.forecastIncludePast) {
      const thisFyNum = currentFiscalYear();
      const future: string[] = [];
      for (let y = thisFyNum; y <= thisFyNum + 15; y++) future.push(`fiscal_year.ilike.%${y}%`);
      listQ = listQ.or(`fiscal_year.is.null,${future.join(',')}`);
    }

    if (p.setAside) {
      listQ = listQ.ilike('set_aside_type', `%${p.setAside.replace(/[%,()]/g, ' ')}%`);
    }

    // Over-fetch then sort by anticipated_award_date like map pins.
    const { data, count, error } = await listQ.limit(Math.max(limit, 200));
    if (error) return unavailable(source, SOON_HANDOFFS, error.message, unsupported);

    let unmapped: number | null = null;
    {
      let uq = client.from(source).select('id', { count: 'exact', head: true }).is('map_lat', null);
      uq = applyForecastFilters(uq, filters);
      if (!p.forecastIncludePast) {
        const thisFyNum = currentFiscalYear();
        const future: string[] = [];
        for (let y = thisFyNum; y <= thisFyNum + 15; y++) future.push(`fiscal_year.ilike.%${y}%`);
        uq = uq.or(`fiscal_year.is.null,${future.join(',')}`);
      }
      if (p.setAside) uq = uq.ilike('set_aside_type', `%${p.setAside.replace(/[%,()]/g, ' ')}%`);
      const { count: uc, error: ue } = await uq;
      if (!ue) unmapped = uc ?? null;
    }

    type Row = Record<string, unknown>;
    let rows = (data || []) as Row[];
    rows.sort((a, b) => {
      const da = String(a.anticipated_award_date || '');
      const db = String(b.anticipated_award_date || '');
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
    rows = rows.slice(0, limit);

    if (!rows.length) {
      return emptyHorizon(
        source,
        SOON_HANDOFFS,
        consumed,
        unsupported,
        asOf,
        'No matching forecasts under these filters (past FY excluded unless opted in).',
        unmapped,
      );
    }

    const items: HorizonItem[] = rows.map((r) => {
      const lo = moneyLabel(r.estimated_value_min);
      const hi = moneyLabel(r.estimated_value_max);
      const value =
        (r.estimated_value_range as string) ||
        (lo && hi ? (lo === hi ? hi : `${lo}–${hi}`) : hi || lo);
      return {
        horizon: 'coming_soon',
        title: String(r.title || 'Forecast opportunity'),
        buyer: String(r.department || r.source_agency || '') || null,
        location_label: locLabel(r.pop_city as string, r.pop_state as string),
        relevant_date: (r.anticipated_award_date as string) || null,
        relevant_date_label: 'anticipated_award_date',
        value_label: value || null,
        source,
        why_this_matched: p.searchText
          ? `Matched agency forecast for “${p.searchText}”`
          : 'Matched agency forecast',
        identity: { kind: 'forecast_id', id: String(r.id || '') },
        forecast_id: String(r.id || ''),
        anticipated_award_date: (r.anticipated_award_date as string) || null,
        solicitation_date: (r.solicitation_date as string) || null,
        fiscal_year: (r.fiscal_year as string) || null,
        anticipated_quarter: (r.anticipated_quarter as string) || null,
        acquisition_status: (r.status as string) || null,
        forecast_source_agency: (r.source_agency as string) || null,
        set_aside_type: (r.set_aside_type as string) || null,
        naics_code: (r.naics_code as string) || null,
        incumbent_name: (r.incumbent_name as string) || null,
        contracting_office: (r.contracting_office as string) || null,
      };
    });

    return {
      status: 'grounded',
      matched_count: count ?? null,
      returned_count: items.length,
      items,
      source,
      as_of: asOf,
      filters_consumed: consumed,
      filters_unsupported: unsupported,
      unmapped_count: unmapped,
      error: null,
      allowed_handoffs: SOON_HANDOFFS,
      semantics_note:
        'Maps forecast universe (no status=forecasted gate). Past fiscal years excluded by default. Geography: pop_state only; many forecasts have no location.',
    };
  } catch (e) {
    return unavailable(source, SOON_HANDOFFS, (e as Error).message, unsupported);
  }
}

function closesWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const delta = t - Date.now();
  return delta >= 0 && delta <= days * 86400_000;
}

/**
 * SPECIFIC = useful named open target → UNDERSTAND journey.
 * BROAD = market-shaped → monitor (with watch_coverage honesty).
 */
export function classifyFindShape(horizons: Record<HorizonKey, HorizonResult>): 'specific' | 'broad' {
  const open = horizons.open_now;
  if (open.status === 'grounded' && open.items.length > 0) {
    const top = open.items[0];
    const matched = open.matched_count;
    // Narrow open set or imminent deadline → UNDERSTAND journey.
    if (closesWithinDays(top.relevant_date, 30)) return 'specific';
    if (typeof matched === 'number' && matched > 0 && matched <= 8) return 'specific';
  }
  return 'broad';
}

export function buildFindNext(
  shape: 'specific' | 'broad',
  horizons: Record<HorizonKey, HorizonResult>,
): FindNextAction[] {
  if (shape === 'specific') {
    const top = horizons.open_now.items[0];
    const primary: FindNextAction = {
      prompt: 'Want me to show you what this customer cares about and what you should say to them?',
      tool: 'get_agency_intel',
      credits: 5,
      requires_confirmation: true,
      suggested_args: top?.buyer ? { agency: top.buyer } : {},
      missing_inputs: top?.buyer ? [] : ['agency'],
    };
    const secondary: FindNextAction = {
      prompt:
        'Want me to monitor this market for new and upcoming opportunities? ' +
        '(Watch covers Open now + Coming soon — Coming back / recompetes are not emailed yet.)',
      tool: 'schedule_market_search',
      credits: 0,
      requires_confirmation: true,
      suggested_args: { watch_coverage: [...WATCH_COVERAGE] },
    };
    return [primary, secondary];
  }

  return [
    {
      prompt:
        'Want me to monitor this market for new and upcoming opportunities? ' +
        '(Watch covers Open now + Coming soon — Coming back / recompetes are not emailed yet.)',
      tool: 'schedule_market_search',
      credits: 0,
      requires_confirmation: true,
      suggested_args: { watch_coverage: [...WATCH_COVERAGE] },
    },
  ];
}

function headlineFor(horizons: Record<HorizonKey, HorizonResult>): string {
  const part = (key: HorizonKey, label: string) => {
    const h = horizons[key];
    if (h.status === 'unavailable') return `${label} unavailable`;
    if (h.status === 'empty') return `0 ${label}`;
    const n = h.matched_count;
    if (n == null) return `${label} count unknown`;
    return `${n.toLocaleString()} ${label}`;
  };
  return [
    part('open_now', 'open now'),
    part('coming_back', 'coming back'),
    part('coming_soon', 'coming soon'),
  ].join(' · ');
}

export async function findOpportunities(input: FindOpportunitiesInput): Promise<FindOpportunitiesResult> {
  const query = String(input.query || '').trim();
  if (!query && !input.advanced?.naics && !input.advanced?.keyword_exact) {
    const empty = (source: string, handoffs: HandoffKey[]): HorizonResult =>
      unavailable(source, handoffs, 'query_required');
    const horizons: Record<HorizonKey, HorizonResult> = {
      open_now: empty('sam_opportunities', OPEN_HANDOFFS),
      coming_back: empty('recompete_opportunities', BACK_HANDOFFS),
      coming_soon: empty('agency_forecasts', SOON_HANDOFFS),
    };
    // Validation failure is not a market zero — mark as degraded empty compose.
    for (const k of Object.keys(horizons) as HorizonKey[]) {
      horizons[k] = {
        ...horizons[k],
        status: 'unavailable',
        error: { class: 'validation_error', message: 'query is required' },
        semantics_note: 'Pass a plain-English query (what you sell / what to find).',
      };
    }
    return {
      query_summary: {
        query: '',
        location: null,
        agency: null,
        timeframe: input.timeframe ?? null,
        set_aside: null,
        horizons_requested: ['open_now', 'coming_back', 'coming_soon'],
        interpreted_as: {
          open_now: 'n/a',
          coming_back: 'n/a',
          coming_soon: 'n/a',
        },
      },
      horizons,
      summary: {
        open_now: { status: 'unavailable', matched_count: null },
        coming_back: { status: 'unavailable', matched_count: null },
        coming_soon: { status: 'unavailable', matched_count: null },
        headline: 'query required',
        claim_hygiene:
          'Counts are per-horizon matches under this query — not unique procurements across horizons.',
      },
      _meta: {
        grounded: false,
        degraded: true,
        composition: 'opportunity_map_horizons_v1',
        expansion_note: 'Cross-class deduplicated procurement identity is unknown.',
        watch_coverage: [...WATCH_COVERAGE],
        find_shape: 'broad',
      },
      _next: [],
    };
  }

  const hz = input.horizons || {};
  const requested: HorizonKey[] = (
    ['open_now', 'coming_back', 'coming_soon'] as HorizonKey[]
  ).filter((k) => hz[k] !== false);

  const limit = clampLimit(input.limit_per_horizon);
  const interpreted = interpretQuery({ ...input, query: query || String(input.advanced?.keyword_exact || '') });
  const client = sb();

  const run = async (key: HorizonKey): Promise<HorizonResult> => {
    if (!requested.includes(key)) {
      return emptyHorizon(
        key === 'open_now' ? 'sam_opportunities' : key === 'coming_back' ? 'recompete_opportunities' : 'agency_forecasts',
        key === 'open_now' ? OPEN_HANDOFFS : key === 'coming_back' ? BACK_HANDOFFS : SOON_HANDOFFS,
        ['horizon_disabled'],
        [],
        null,
        'Horizon not requested.',
        null,
      );
    }
    if (key === 'open_now') return queryOpenNow(client, interpreted, limit);
    if (key === 'coming_back') return queryComingBack(client, interpreted, limit);
    return queryComingSoon(client, interpreted, limit);
  };

  const [open_now, coming_back, coming_soon] = await Promise.all([
    run('open_now'),
    run('coming_back'),
    run('coming_soon'),
  ]);

  const horizons = { open_now, coming_back, coming_soon };
  const shape = classifyFindShape(horizons);
  const grounded = Object.values(horizons).some((h) => h.status === 'grounded');
  const degraded = Object.values(horizons).some((h) => h.status === 'unavailable' || h.status === 'partial');

  return {
    query_summary: {
      query: interpreted.searchText,
      location: interpreted.stateCode,
      agency: interpreted.agency || null,
      timeframe: {
        open_closing_days: interpreted.openClosingDays || null,
        recompete_months: interpreted.recompeteMonths,
        forecast_include_past: interpreted.forecastIncludePast,
      },
      set_aside: interpreted.setAside || null,
      horizons_requested: requested,
      interpreted_as: interpreted.interpreted,
    },
    horizons,
    summary: {
      open_now: { status: open_now.status, matched_count: open_now.matched_count },
      coming_back: { status: coming_back.status, matched_count: coming_back.matched_count },
      coming_soon: { status: coming_soon.status, matched_count: coming_soon.matched_count },
      headline: headlineFor(horizons),
      claim_hygiene:
        'Counts are per-horizon matches under this query — not unique procurements across horizons. Do not call combined raw rows unique opportunities.',
    },
    _meta: {
      grounded,
      degraded,
      composition: 'opportunity_map_horizons_v1',
      expansion_note: 'Cross-class deduplicated procurement identity is unknown.',
      watch_coverage: [...WATCH_COVERAGE],
      find_shape: shape,
    },
    _next: grounded ? buildFindNext(shape, horizons) : [],
  };
}

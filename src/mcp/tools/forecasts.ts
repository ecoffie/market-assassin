/**
 * MCP tool: get_agency_forecasts — upcoming federal procurement forecasts
 * (6-18 months before a solicitation posts). The "get in early" signal.
 *
 * Wraps src/lib/forecasts/query.ts (Supabase `agency_forecasts`, ~33,000 rows,
 * commodity, metered). credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { queryForecastsWithFallback, type ForecastRow, type ForecastSourceFreshness } from '@/lib/forecasts/query';
import { mcpFlags } from '@/lib/mcp/flags';

export interface ForecastsToolInput {
  naics?: string;
  agency?: string;
  state?: string;
  set_aside?: string;
  fiscal_year?: string;
  keyword?: string;
  limit?: number;
}

export interface ForecastsToolResult {
  queried: Record<string, string>;
  forecasts: ForecastRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    total: number;
    /** Freshness per agency among the returned rows (stalest first). Each row also carries as_of + source_url, scoped by source_link_scope: no publisher gives a per-forecast URL, so it is a listing page, a whole-feed file, a related solicitation, or null — never the record. */
    sources: ForecastSourceFreshness[];
    /** Agencies whose newest returned row is older than 45 days (or of unknown age). */
    stale_sources: string[];
    /** 'live', or 'last_good' when the live query errored and a dated snapshot was served. */
    served_from: 'live' | 'last_good' | 'error';
    snapshot_at: string | null;
    /** Set when a dated saved answer was served: free, because the live source failed. */
    billing_outcome?: 'nonbillable_system_failure';
  };
}

export async function agencyForecasts(input: ForecastsToolInput): Promise<ForecastsToolResult> {
  const res = await queryForecastsWithFallback({
    naics: input.naics,
    agency: input.agency,
    state: input.state,
    setAside: input.set_aside,
    fiscalYear: input.fiscal_year,
    search: input.keyword,
    limit: input.limit,
  });
  const grounded = res.forecasts.length > 0;
  const queried: Record<string, string> = {};
  for (const [k, v] of Object.entries({ naics: input.naics, agency: input.agency, state: input.state, set_aside: input.set_aside, fiscal_year: input.fiscal_year, keyword: input.keyword })) {
    if (v) queried[k] = v;
  }
  const result: ForecastsToolResult = {
    queried,
    forecasts: res.forecasts,
    _meta: {
      grounded,
      degraded: res.degraded,
      count: res.forecasts.length,
      total: res.total,
      sources: res.sources ?? [],
      stale_sources: (res.sources ?? []).filter((s) => s.stale).map((s) => s.agency),
      served_from: res.served_from ?? (res.degraded ? 'error' : 'live'),
      snapshot_at: res.snapshot_at ?? null,
      ...(res.served_from === 'last_good' ? { billing_outcome: 'nonbillable_system_failure' as const } : {}),
    },
  };
  if (mcpFlags.aiHint) {
    const top = res.forecasts[0];
    result._ai_hint = {
      summary: res.served_from === 'last_good'
        ? `Live forecast lookup errored; these ${res.forecasts.length} results are a saved answer from ${res.snapshot_at}. Say so; do not present them as current.`
        : res.degraded
        ? 'Forecast lookup errored — retry; do not state there are no forecasts.'
        : grounded
        ? `${res.forecasts.length} forecast(s) of ~${res.total} matching, soonest-award first. Top: ${top.title} (${top.agency ?? 'agency n/a'}, FY${top.fiscal_year ?? '?'}, ${top.quarter ?? 'quarter TBD'}).`
        : 'No forecasts matched. Broaden the NAICS prefix or drop filters.',
      how_to_use: grounded
        ? 'Forecasts precede solicitations by 6-18 months — use award_date/quarter to time outreach and incumbent_name to scout the current holder. A forecast is a PLAN, not a posted opportunity; dates slip.'
        : 'No grounded forecasts; say none matched rather than inventing one.',
      key_caveats: [
        'Forecast dates and values are agency estimates that frequently change or cancel.',
        'Each row carries as_of only when as_of_basis is last_synced_at (when Mindy last synced that row). as_of_basis unavailable means the sync clock is missing; row_updated_at is the database clock and is not a source sync. Name any agency in _meta.stale_sources as possibly out of date.',
        'Coverage is ~12 agencies, not government-wide — an empty result may be a coverage gap, not absence of demand.',
      ],
    };
  }
  return result;
}

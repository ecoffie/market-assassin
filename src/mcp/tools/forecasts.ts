/**
 * MCP tool: get_agency_forecasts — upcoming federal procurement forecasts
 * (6-18 months before a solicitation posts). The "get in early" signal.
 *
 * Wraps src/lib/forecasts/query.ts (Supabase `agency_forecasts`, ~33,000 rows,
 * commodity, metered). credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { queryForecastsWithFallback, type ForecastRow, type ForecastSourceFreshness } from '@/lib/forecasts/query';
import { mcpFlags } from '@/lib/mcp/flags';
import { resolveForecastAgencies } from '@/lib/forecasts/agency-identity';
import type { ForecastCoverage, ForecastCoverageGap } from '@/lib/discovery/plan';

/**
 * Forecast publisher coverage for the requested agency — the same rule find_opportunities' Coming soon
 * horizon uses (discovery plan). Ask Mindy Backend Spec (Nov 21 2026): "state plainly that coverage
 * doesn't exist" rather than answer "no forecasts matched".
 *   ok            — no agency asked, or every recognised agency resolves to forecast rows we hold.
 *   partial       — some requested agencies are covered, some are not (named in gaps).
 *   unestablished — none is covered: the answer is UNAVAILABLE, never a zero.
 * A recognised agency with no feed (DLA, FAA …) carries the parent that does publish and why.
 */
export function forecastAgencyCoverage(agency: string | undefined): { coverage: ForecastCoverage; gaps: ForecastCoverageGap[] } {
  const r = resolveForecastAgencies(agency ?? '');
  if (r.empty) return { coverage: 'ok', gaps: [] };
  const gaps: ForecastCoverageGap[] = [
    ...r.identities.filter((id) => id.codes.length === 0).map((id) => ({
      requested: id.label, reason: 'publisher_without_forecasts' as const, label: id.label,
      ...(id.parentWithData ? { parentWithData: id.parentWithData } : {}), ...(id.note ? { note: id.note } : {}),
    })),
    ...r.unresolved.map((u) => ({ requested: u, reason: 'unresolved_publisher' as const })),
  ];
  const covered = r.codes.length > 0 || r.children.length > 0;
  return { coverage: !gaps.length ? 'ok' : covered ? 'partial' : 'unestablished', gaps };
}

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
    /** Matching forecasts. null = not measured (the requested agency has no forecast coverage). */
    total: number | null;
    /** Whether the requested agency is a forecast publisher we hold (see forecastAgencyCoverage). */
    coverage: ForecastCoverage;
    /** Every requested agency the forecast data cannot answer for, with the reason. Never counted as zero. */
    coverage_gaps?: ForecastCoverageGap[];
    result_state?: 'unavailable';
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
  const queried: Record<string, string> = {};
  for (const [k, v] of Object.entries({ naics: input.naics, agency: input.agency, state: input.state, set_aside: input.set_aside, fiscal_year: input.fiscal_year, keyword: input.keyword })) {
    if (v) queried[k] = v;
  }
  const { coverage, gaps } = forecastAgencyCoverage(input.agency);
  if (coverage === 'unestablished') {
    // No requested agency publishes forecasts we hold. Running the query could only return a zero that
    // measures nothing (or another publisher's rows via the text fallback), so it is not run.
    const result: ForecastsToolResult = {
      queried,
      forecasts: [],
      _meta: {
        grounded: false, degraded: false, count: 0, total: null, sources: [], stale_sources: [],
        served_from: 'live', snapshot_at: null, coverage, coverage_gaps: gaps, result_state: 'unavailable',
      },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: `Mindy holds no agency forecast data for ${gaps.map((g) => g.label ?? g.requested).join(', ')}. This is a coverage gap, not "no planned buys".`,
        how_to_use: 'Say plainly that forecast coverage does not exist for this agency. Where a gap names parentWithData, offer that parent\'s forecasts; where its note names another dataset (e.g. DIBBS for DLA), offer that instead.',
        key_caveats: gaps.map((g) => g.note ?? `${g.requested}: no matching forecast publisher.`),
      };
    }
    return result;
  }
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
      coverage,
      ...(gaps.length ? { coverage_gaps: gaps } : {}),
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

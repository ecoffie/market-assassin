/**
 * MCP tool: get_agency_forecasts — upcoming federal procurement forecasts
 * (6-18 months before a solicitation posts). The "get in early" signal.
 *
 * Wraps src/lib/forecasts/query.ts (Supabase `agency_forecasts`, ~7,700 rows,
 * commodity, metered). credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { queryForecasts, type ForecastRow } from '@/lib/forecasts/query';
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
  _meta: { grounded: boolean; degraded: boolean; count: number; total: number };
}

export async function agencyForecasts(input: ForecastsToolInput): Promise<ForecastsToolResult> {
  const res = await queryForecasts({
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
    _meta: { grounded, degraded: res.degraded, count: res.forecasts.length, total: res.total },
  };
  if (mcpFlags.aiHint) {
    const top = res.forecasts[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'Forecast lookup errored — retry; do not state there are no forecasts.'
        : grounded
        ? `${res.forecasts.length} forecast(s) of ~${res.total} matching, soonest-award first. Top: ${top.title} (${top.agency ?? 'agency n/a'}, FY${top.fiscal_year ?? '?'}, ${top.quarter ?? 'quarter TBD'}).`
        : 'No forecasts matched. Broaden the NAICS prefix or drop filters.',
      how_to_use: grounded
        ? 'Forecasts precede solicitations by 6-18 months — use award_date/quarter to time outreach and incumbent_name to scout the current holder. A forecast is a PLAN, not a posted opportunity; dates slip.'
        : 'No grounded forecasts; say none matched rather than inventing one.',
      key_caveats: [
        'Forecast dates and values are agency estimates that frequently change or cancel.',
        'Coverage is ~12 agencies, not government-wide — an empty result may be a coverage gap, not absence of demand.',
      ],
    };
  }
  return result;
}

/**
 * MCP tool: get_naics_spending_by_year — an industry's (NAICS) federal contract spending
 * PER FISCAL YEAR, with the dollars and % SMALL BUSINESSES won and the dollars and % that
 * went through small-business SET-ASIDES.
 *
 * Fills the gap hosts kept hitting: "rank these industries by spending and small-business
 * wins, by year." Agency-level SB share and company-level annual obligations already
 * existed; industry-by-year did not, so answers were stitched together and labelled
 * "directional". See src/lib/usaspending/naics-spending-by-year.ts for the data rules.
 *
 * credits: 5 (three live USASpending calls, cached 12h). `_meta` always ships;
 * `_ai_hint` OFF by default.
 */
import { getNaicsSpendingByYear, type NaicsFiscalYearRow } from '@/lib/usaspending/naics-spending-by-year';
import { withCache } from '@/lib/mcp/external-cache';
import { mcpFlags } from '@/lib/mcp/flags';

export interface NaicsSpendingToolInput {
  naics: string | string[];
  from_fy?: number;
  to_fy?: number;
  state?: string;
}

export interface NaicsSpendingToolResult {
  naics: string[];
  invalid_naics: string[];
  state: string | null;
  from_fy: number;
  to_fy: number;
  years: NaicsFiscalYearRow[];
  totals: {
    total_obligated: number | null;
    small_business_won: number | null;
    small_business_won_pct: number | null;
    sb_set_aside_obligated: number | null;
    sb_set_aside_pct: number | null;
  };
  basis: {
    measure: string;
    small_business_won: string;
    sb_set_aside: string;
    naics_match: string;
    location: string;
    source: string;
  };
  validation_error?: string;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    from_cache: boolean;
    fiscal_years: number;
    failed_series: string[];
  };
}

function usd(n: number): string {
  return n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
}

export async function naicsSpendingByYear(input: NaicsSpendingToolInput): Promise<NaicsSpendingToolResult> {
  const params = {
    naics: Array.isArray(input.naics) ? input.naics.join(',') : String(input.naics ?? ''),
    from_fy: input.from_fy ?? null,
    to_fy: input.to_fy ?? null,
    state: input.state ?? null,
    v: 1,
  };
  let fromCache = false;
  let r;
  try {
    const cached = await withCache('usaspending_naics_fy', params, 12 * 3600, async () => {
      const fresh = await getNaicsSpendingByYear(input);
      // Never cache a degraded/invalid answer — return it, but let the next call retry.
      if (fresh.validation_error || fresh.failed.length) throw Object.assign(new Error('nocache'), { fresh });
      return fresh;
    });
    r = cached.value;
    fromCache = cached.fromCache;
  } catch (e) {
    const fresh = (e as { fresh?: Awaited<ReturnType<typeof getNaicsSpendingByYear>> }).fresh;
    r = fresh ?? (await getNaicsSpendingByYear(input));
  }

  if (r.trace.length) console.error('[naics-spending-by-year]', r.trace.join(' | '));

  const grounded = !r.validation_error && r.years.some((y) => (y.total_obligated ?? 0) > 0);
  const degraded = r.failed.length > 0;

  const result: NaicsSpendingToolResult = {
    naics: r.naics,
    invalid_naics: r.invalid_naics,
    state: r.state,
    from_fy: r.from_fy,
    to_fy: r.to_fy,
    years: r.years,
    totals: r.totals,
    basis: {
      measure: 'Federal prime-contract obligations (award types A/B/C/D) per fiscal year (Oct 1 – Sep 30). Obligations in that year, not lifetime award values.',
      small_business_won: 'Dollars obligated to recipients USASpending classifies as small business at award time — includes small firms winning full-and-open work. Closest public proxy to SBA goaling achievement; NOT the official SBA Scorecard figure.',
      sb_set_aside: 'Dollars awarded through a small-business set-aside code (SB, 8(a), SDVOSB, WOSB/EDWOSB, HUBZone). Always <= small_business_won in practice.',
      naics_match: r.naics.some((c) => c.length < 6)
        ? 'Codes shorter than 6 digits include every NAICS beneath them; 6-digit codes are exact.'
        : '6-digit NAICS matched exactly (no subsector sweep).',
      location: r.state ? `Place of performance in ${r.state}.` : 'Nationwide.',
      source: 'USASpending.gov spending_over_time (live).',
    },
    _meta: {
      grounded,
      degraded,
      from_cache: fromCache,
      fiscal_years: r.years.length,
      failed_series: r.failed,
    },
  };
  if (r.validation_error) result.validation_error = r.validation_error;

  if (mcpFlags.aiHint) {
    const t = r.totals;
    result._ai_hint = degraded
      ? {
          summary: `USASpending did not answer for: ${r.failed.join(', ')}. Those columns are null (unknown), not $0.`,
          how_to_use: 'Retry shortly. Do not report missing columns as zero.',
          key_caveats: ['Null means the source failed, not that nothing was spent.'],
        }
      : grounded
        ? {
            summary: `NAICS ${r.naics.join(', ')}${r.state ? ` in ${r.state}` : ''}, FY${r.from_fy}–FY${r.to_fy}: ${usd(t.total_obligated ?? 0)} obligated; small businesses won ${t.small_business_won_pct ?? 0}% (${usd(t.small_business_won ?? 0)}); ${t.sb_set_aside_pct ?? 0}% via set-asides.`,
            how_to_use: 'Compare industries with one call per NAICS (or pass several codes to combine them). Use years[] for the trend.',
            key_caveats: ['Small-business share is not the official SBA Scorecard number.', 'Current FY (if included) is partial.'],
          }
        : {
            summary: r.validation_error ?? 'No contract obligations found for this NAICS and range.',
            how_to_use: 'Check the NAICS code. Do NOT invent figures.',
            key_caveats: ['An empty result is not proof the market does not exist — the code may be wrong.'],
          };
  }
  return result;
}

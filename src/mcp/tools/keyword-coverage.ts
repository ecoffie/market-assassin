/**
 * MCP tool: get_keyword_coverage — the "NAICS is the wrong primary key" lesson as
 * data. For a product/service keyword (e.g. "drones"), returns the TOTAL federal
 * market, EVERY NAICS that bought it (ranked), the smallest NAICS set covering ~90%,
 * and the top PSCs ("what was actually bought"). The insight: a single obvious NAICS
 * is often ~28% of the market → searching it alone MISSES 72%.
 *
 * Wraps src/lib/market/keyword-coverage.ts (USASpending spending-by-category, free
 * upstream, commodity, metered). credits: 1. `_meta` always ships; `_ai_hint` OFF by
 * default.
 */
import { keywordCoverage, type KeywordCoverage } from '@/lib/market/keyword-coverage';
import { mcpFlags } from '@/lib/mcp/flags';

export interface KeywordCoverageToolInput {
  keyword: string;
  /** Fraction of the market the returned NAICS set should cover (default 0.9). */
  coverage_target?: number;
}

export interface KeywordCoverageToolResult {
  queried: { keyword: string; coverage_target: number };
  coverage: KeywordCoverage | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; naics_count: number; total_market: number };
}

export async function getKeywordCoverage(input: KeywordCoverageToolInput): Promise<KeywordCoverageToolResult> {
  const keyword = (input.keyword || '').trim();
  const target = Number.isFinite(input.coverage_target)
    ? Math.min(Math.max(Number(input.coverage_target), 0.5), 0.99)
    : 0.9;

  let coverage: KeywordCoverage | null = null;
  let degraded = false;
  try {
    coverage = keyword ? await keywordCoverage(keyword, target) : null;
  } catch (err) {
    console.error('[mcp:keyword-coverage] failed:', err);
    degraded = true;
  }

  const grounded = !!coverage && coverage.naicsCount > 0;
  const result: KeywordCoverageToolResult = {
    queried: { keyword, coverage_target: target },
    coverage,
    _meta: {
      grounded,
      degraded,
      naics_count: coverage?.naicsCount ?? 0,
      total_market: coverage?.totalMarket ?? 0,
    },
  };

  if (mcpFlags.aiHint) {
    const topPct = coverage ? Math.round(coverage.topCodePct * 100) : 0;
    result._ai_hint = {
      summary: degraded
        ? 'Keyword-coverage lookup errored — retry; do not state the market size.'
        : grounded
        ? `"${keyword}" = ~$${(coverage!.totalMarket / 1e6).toFixed(0)}M across ${coverage!.naicsCount} NAICS. The single biggest code is only ${topPct}% — searching it alone misses the rest. Cover ~${Math.round(coverage!.coveragePct * 100)}% with ${coverage!.coverageCodes.length} codes: ${coverage!.coverageCodes.join(', ')}. Top PSC (what was bought): ${coverage!.topPsc ? `${coverage!.topPsc.code} ${coverage!.topPsc.name}` : 'n/a'}.`
        : `No federal spending matched "${keyword}". Try a broader or differently-worded term.`,
      how_to_use: grounded
        ? 'Use coverageCodes as the NAICS set for alerts/searches (not just the top code). PSC = what was literally bought (the product); NAICS = who the seller is (size/set-aside eligibility). topPscList shows the real sub-markets a single keyword spans.'
        : 'No grounded coverage; say nothing matched rather than inventing a market size.',
      key_caveats: [
        'USASpending keyword search is EXACT-PHRASE — a long phrase may match nothing; single significant terms work best.',
        'totalMarket is historical obligations, not a forecast of future demand.',
      ],
    };
  }
  return result;
}

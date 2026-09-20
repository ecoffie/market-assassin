/**
 * MCP tool: get_keyword_coverage — the "NAICS is the wrong primary key" lesson as
 * data. For a product/service keyword (e.g. "drones"), returns the TOTAL federal
 * market, EVERY NAICS that bought it (ranked), the smallest NAICS set covering ~90%,
 * and the top PSCs ("what was actually bought"). The insight: a single obvious NAICS
 * is often ~28% of the market → searching it alone MISSES 72%.
 *
 * Wraps src/lib/market/keyword-coverage.ts (BigQuery usaspending.awards description
 * match, latest complete FY, SUM(obligation_amount)). credits: 5. No LLM, no scraper,
 * no live USASpending fallback. `_meta` always ships; `_ai_hint` OFF by default.
 */
import {
  queryKeywordCoverage,
  type CoverageEvidenceStatus,
  type KeywordCoverage,
} from '@/lib/market/keyword-coverage';
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
  _meta: {
    grounded: boolean;
    degraded: boolean;
        evidence_status?: CoverageEvidenceStatus;
        naics_identity_status?: 'NOT_ESTABLISHED';
        naics_count: number | null;
    total_market: number | null;
    transaction_count?: number | null;
    unique_award_count?: number | null;
    fiscal_year?: number | null;
    source?: string | null;
  };
}

export async function getKeywordCoverage(input: KeywordCoverageToolInput): Promise<KeywordCoverageToolResult> {
  const keyword = (input.keyword || '').trim();
  const target = Number.isFinite(input.coverage_target)
    ? Math.min(Math.max(Number(input.coverage_target), 0.5), 0.99)
    : 0.9;

  // A NAICS code (or comma list) is not a discovery keyword — text-searching the
  // literal number matches nothing meaningful (and ballooned "236220" into related
  // codes / NASA in the app). Don't run coverage on it; tell the agent to use the
  // number as a NAICS directly. Mirrors the app-route guard. Eric, Jul 15 2026.
  const kwTokens = keyword ? keyword.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) : [];
  const keywordIsNaics = kwTokens.length > 0 && kwTokens.every((t) => /^\d{2,6}$/.test(t));

  let coverage: KeywordCoverage | null = null;
  let evidenceStatus: CoverageEvidenceStatus = 'NO_MATCHES_MEASURED';
  let degraded = false;
  let reason: string | undefined;

  if (keyword && !keywordIsNaics) {
    try {
      const result = await queryKeywordCoverage(keyword, target);
      coverage = result.coverage;
      evidenceStatus = result.status;
      degraded = result.degraded;
      reason = result.reason;
    } catch (err) {
      // Deadline/abort is unknown, not zero. Do not throw a 500 that an agent
      // could misread as an empty market.
      coverage = null;
      evidenceStatus = 'NOT_ESTABLISHED';
      degraded = true;
      reason = err instanceof Error ? err.message : String(err);
    }
  }

  const grounded = evidenceStatus === 'MARKET_EVIDENCE_FOUND' && !!coverage && coverage.naicsCount > 0;
  const result: KeywordCoverageToolResult = {
    queried: { keyword, coverage_target: target },
    coverage,
    _meta: {
      grounded,
      degraded,
      evidence_status: evidenceStatus,
      naics_identity_status: grounded ? coverage!.naicsIdentityStatus : undefined,
      naics_count: grounded ? coverage!.naicsCount : null,
      total_market: grounded ? coverage!.totalMarket : null,
      transaction_count: grounded ? coverage!.transactionCount : null,
      unique_award_count: grounded ? coverage!.uniqueAwardCount : null,
      fiscal_year: grounded ? coverage!.fiscalYear : null,
      source: grounded ? coverage!.source : (degraded ? null : 'bigquery_usaspending_awards'),
    },
  };

  if (mcpFlags.aiHint) {
    const topPct = coverage ? Math.round(coverage.topCodePct * 100) : 0;
    result._ai_hint = {
      summary: degraded
        ? `Keyword coverage is not established${reason ? ` (${reason})` : ''}. Do not state a market size or treat this as zero spend.`
        : keywordIsNaics
        ? `"${keyword}" is a NAICS code, not a discovery keyword. This tool expects a product/service term (e.g. "drones"). Use ${kwTokens.join(', ')} directly as a NAICS filter instead.`
        : grounded
        ? `"${keyword}" = ~$${(coverage!.totalMarket / 1e6).toFixed(0)}M across ${coverage!.naicsCount} NAICS (FY${coverage!.fiscalYear} description match). The single biggest code is only ${topPct}% — searching it alone misses the rest. Cover ~${Math.round(coverage!.coveragePct * 100)}% with ${coverage!.coverageCodes.length} codes: ${coverage!.coverageCodes.join(', ')}. Top PSC (what was bought): ${coverage!.topPsc ? `${coverage!.topPsc.code} ${coverage!.topPsc.name}` : 'n/a'}.`
        : `No federal contract actions in the latest complete FY had "${keyword}" in the award description. Try a broader or differently-worded term.`,
      how_to_use: grounded
        ? 'Report the measured NAICS/PSC distribution. Do not treat the lead code as the user\'s market. Market identity is not established by this tool.'
        : degraded
        ? 'Coverage is unknown, not empty. Retry; do not invent a market size and do not treat this as zero.'
        : 'No grounded coverage; say nothing matched rather than inventing a market size.',
      key_caveats: [
        'Primary market is description match on BigQuery usaspending.awards (latest complete FY), not NAICS/PSC titles.',
        'Dollars are SUM(obligation_amount) at transaction grain, including deobligations.',
        'NAICS percentages are a measured distribution of description-matched FY dollars, not the user\'s market identity. Do not collapse the keyword to the lead NAICS.',
        'totalMarket is historical obligations, not a forecast of future demand.',
        'Do not fall back to the live USASpending API if this warehouse query failed.',
      ],
    };
  }
  return result;
}

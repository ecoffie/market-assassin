/**
 * THE canonical federal-spend query — one source of truth for "what does this market
 * look like", shared by every surface that answers it.
 *
 * Why this exists: the filter + fetch used to live INSIDE the route handlers, so each
 * surface re-derived "what is this market" on its own. That is exactly how TMR and the
 * FPDS leaderboards drifted apart until their agency totals couldn't be reconciled and
 * the Spending-by-Agency chart had to be deleted (PR #245, "the numbers don't match").
 * A one-shot market report computing its OWN answer would have re-created that split —
 * this time between two Mindy surfaces, which is far harder to defend to a customer
 * than a delta against a competitor.
 *
 * Anything that ranks/aggregates a market MUST resolve its scope here.
 *
 * The canonical filter (per CLAUDE.md, so dollars reconcile across surfaces):
 *   - contracts only          → award_type_codes A/B/C/D
 *   - the fixed 3-FY window   → MARKET_SPEND_WINDOW
 *   - a 6-digit NAICS is EXACT → expandNAICSCodes(codes, false) (never sweep the
 *     3-digit subsector — that inflated "Relevant spending" 7×)
 */
import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
import {
  buildMarketFilter,
  keywordCoverage,
  marketFilterToUsaspending,
  type KeywordCoverage,
  type MarketFilter,
} from '@/lib/market/keyword-coverage';
import { MARKET_SPEND_WINDOW } from '@/lib/utils/usaspending-helpers';

export const USASPENDING_CATEGORY_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_category';

/** Contracts only — NOT grants/loans/IDVs. The canonical award scope. */
export const CONTRACT_AWARD_TYPE_CODES = ['A', 'B', 'C', 'D'];

export type SpendCategory = 'awarding_agency' | 'awarding_subagency' | 'recipient' | 'funding_agency' | 'naics' | 'psc';

export interface SpendRow {
  name: string;
  /** The raw category code when USASpending supplies one (e.g. the NAICS/PSC code, or an
   *  agency code). For naics/psc, `name` is the TITLE and this is the code — keep both. */
  code: string | null;
  amount: number;
  count: number;
  rank: number;
}

interface CategoryResult {
  results?: Array<{ name?: string; code?: string | null; amount?: number | null }>;
  category?: string;
  messages?: string[];
}

/**
 * How a market's scope was decided — carried onto every surface so a report/panel can
 * SAY what it measured. An unlabelled number always loses the "your data is wrong"
 * argument, even when it's the more accurate one.
 */
export type MarketBasis = 'keyword' | 'keyword_psc' | 'psc' | 'naics';

export interface MarketScope {
  basis: MarketBasis;
  /** Set for keyword/PSC ranking; null when the dominant-NAICS path took over. */
  marketFilter: MarketFilter | null;
  /** Set for NAICS ranking (explicit code, or the dominant keyword's coverage set). */
  naicsCodes: string[];
  /** Present for keyword scopes — the coverage lesson (total market, all NAICS, PSC). */
  coverage: KeywordCoverage | null;
  /** True when a keyword's market concentrates in its lead code → ranked by NAICS. */
  rankedByDominantNaics: boolean;
  /** Human-readable, for the UI/report ("keyword \"drones\"" / "NAICS 561612 (99% …)"). */
  label: string;
}

/**
 * Resolve WHAT market we're measuring — the single decision every surface must share.
 *
 * keyword → keyword/PSC ranking, UNLESS the market concentrates in the keyword's lead
 * code (DOMINANT_NAICS_SHARE), in which case that market effectively IS that code and
 * we rank by the ~90% coverage set instead.
 *
 * ⚠️ The dominant path returns naicsCodes — it is NOT an error. fpds-top-n used to
 * treat buildMarketFilter()'s null as "no market" and 404 with
 * `No federal market found for keyword "security guard"` — for a $6B market. The
 * gate's contract always said callers "fall through to their NAICS path"; nobody
 * implemented the fall-through. This is that fall-through.
 */
export async function resolveMarketScope(opts: {
  keyword?: string;
  naics?: string;
  pscCode?: string;
  /** Inject an already-computed coverage to avoid a second keywordCoverage() call. */
  coverage?: KeywordCoverage | null;
}): Promise<MarketScope | null> {
  const keyword = (opts.keyword || '').trim();
  const naics = (opts.naics || '').trim();
  const pscCode = (opts.pscCode || '').trim().toUpperCase();

  if (keyword) {
    const coverage = opts.coverage ?? (await keywordCoverage(keyword));
    if (!coverage) return null;

    const marketFilter = buildMarketFilter({ coverage, keyword, pscCode: pscCode || undefined });
    if (marketFilter) {
      return {
        basis: marketFilter.mode === 'keyword_psc' ? 'keyword_psc' : 'keyword',
        marketFilter,
        naicsCodes: [],
        coverage,
        rankedByDominantNaics: false,
        label: marketFilter.rankingLabel || `keyword "${keyword}"`,
      };
    }

    // Dominant-NAICS fall-through: this market effectively IS the lead code, so rank
    // by THAT CODE — not by keyword text, and NOT by the whole ~90% coverage set.
    //
    // ⚠️ The coverage set is WRONG here, measurably. "roofing" is dominated by 238160
    // Roofing Contractors (78%), but its coverage set also carries 236220 General
    // Building Construction — where roofing is a $79M sliver of a $60B+ code. Filtering
    // on the set stops measuring roofing and starts measuring ALL federal building
    // construction: top-3 agencies $77.7B (DoD $60.9B) vs $1.34B (DoD $1.1B) for the
    // lead code alone, against a $578M keyword market. Same reading as the gate's own
    // rationale ("rank by the code") and TMR's dominantNaicsCode label. For a
    // single-code market (security guard, janitorial) the two are identical anyway.
    const lead = coverage.allNaics?.[0];
    if (!lead?.code) return null;
    return {
      basis: 'naics',
      marketFilter: null,
      naicsCodes: expandNAICSCodes([lead.code], false),
      coverage,
      rankedByDominantNaics: true,
      label: `NAICS ${lead.code} (${Math.round(coverage.leadCodePct * 100)}% of this market)`,
    };
  }

  if (pscCode) {
    const marketFilter = buildMarketFilter({ pscCode });
    if (!marketFilter) return null;
    return { basis: 'psc', marketFilter, naicsCodes: [], coverage: null, rankedByDominantNaics: false, label: `PSC ${pscCode}` };
  }

  if (naics) {
    return {
      basis: 'naics',
      marketFilter: null,
      naicsCodes: expandNAICSCodes([naics], false),
      coverage: null,
      rankedByDominantNaics: false,
      label: `NAICS ${naics}`,
    };
  }

  return null;
}

/**
 * Build the USASpending filter for a resolved scope. Keyword/PSC ranks by what was
 * BOUGHT; NAICS ranks by the seller's code.
 */
export function buildSpendingFilters(opts: {
  naicsCodes?: string[];
  marketFilter?: MarketFilter | null;
  state?: string;
}): Record<string, unknown> {
  // The SAME canonical 3-FY window as the rest of Market Research (find-agencies, TMR)
  // so the leaderboard totals reconcile with the headline "Relevant spending". This was
  // once a single fiscal year — why "Tracked total $1.5B" looked tiny next to "$97.2B".
  let filters: Record<string, unknown> = {
    award_type_codes: CONTRACT_AWARD_TYPE_CODES,
    time_period: [{ start_date: MARKET_SPEND_WINDOW.start_date, end_date: MARKET_SPEND_WINDOW.end_date }],
  };

  if (opts.marketFilter) {
    // marketFilterToUsaspending RETURNS a merged object; it does NOT mutate in place.
    // Ignoring the return value silently dropped the keyword/PSC constraint → every
    // keyword search queried ALL federal spend (drones once showed $2.1T).
    filters = marketFilterToUsaspending(opts.marketFilter, filters);
  } else if (opts.naicsCodes?.length) {
    filters.naics_codes = opts.naicsCodes;
  }

  if (opts.state) {
    filters.place_of_performance_locations = [{ country: 'USA', state: opts.state }];
  }

  return filters;
}

/** Filters for a resolved scope — the common case. */
export function filtersForScope(scope: MarketScope, state?: string): Record<string, unknown> {
  return buildSpendingFilters({
    naicsCodes: scope.naicsCodes.length ? scope.naicsCodes : undefined,
    marketFilter: scope.marketFilter,
    state,
  });
}

/**
 * One spending_by_category aggregation. Degrades to [] on any upstream failure — a
 * dead category must never take down the surface that asked for it (callers surface
 * the emptiness honestly rather than inventing rows).
 *
 * USAspending is rate-limited ~1 req/sec; 4 in parallel is empirically fine (the limit
 * appears to be per-IP per-minute, not strict per-second).
 */
export async function fetchSpendingCategory(
  category: SpendCategory,
  filters: Record<string, unknown>,
  limit: number,
  tag = 'spend-query',
): Promise<SpendRow[]> {
  let response: Response;
  try {
    response = await fetch(USASPENDING_CATEGORY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, filters, limit, page: 1, subawards: false }),
      // USAspending occasionally hangs on very-broad queries; 25s matches Vercel's
      // default function-timeout buffer.
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.warn(`[${tag}] ${category} fetch failed:`, err);
    return [];
  }

  if (!response.ok) {
    console.warn(`[${tag}] ${category} HTTP ${response.status}`);
    return [];
  }

  const payload = (await response.json().catch(() => null)) as CategoryResult | null;
  if (!payload?.results) return [];

  return payload.results.slice(0, limit).map((row, idx) => ({
    name: row.name || row.code || `Unknown ${category}`,
    code: row.code ?? null,
    amount: typeof row.amount === 'number' ? row.amount : 0,
    // USAspending category results don't always include a count — 0 means "unknown",
    // and the UI shows "—" rather than claiming zero awards.
    count: 0,
    rank: idx + 1,
  }));
}

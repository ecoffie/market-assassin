/**
 * MCP tool: get_pricing_intel — promote the existing GSA CALC labor-rate client
 * (`src/lib/utils/calc-rates.ts`) to the MCP surface.
 *
 * WHY THIS IS A PROMOTION, NOT A BUILD: the GSA CALC+ API client already exists
 * (fetchPricingIntel / fetchPricingIntelByKeywords, ~240K records, daily refresh,
 * no auth). It powers /api/app/pricing-intel and the PricingIntelPanel. This tool
 * wraps those same functions so an MCP agent can price-to-win a labor category
 * without a web UI. (PRD: tasks/PRD-mindy-mcp-server.md §4a — CALC is one of the
 * already-built-but-unexposed capabilities; §5a ranked it low-effort because it's
 * already done.)
 *
 * Transport-agnostic pure function — same pattern as winning-playbook.ts. The
 * stdio entrypoint (src/mcp/server.ts) AND the hosted HTTP edge
 * (src/lib/mcp/tool-registry.ts) both wrap this function (zero rework).
 *
 * Data-first (Eric, 2026-07-12): the raw grounded DATA is the moat. `_meta`
 * (grounded/degraded/counts) ALWAYS ships so the edge/agent can branch without
 * narration. The pre-narrated `_ai_hint` is OPTIONAL and TOGGLED OFF by default
 * (mcpFlags.aiHint / MCP_ENABLE_AI_HINT) — nothing narrated ships until explicitly
 * enabled. When enabled, every `_ai_hint` fact traces to the real returned data
 * (no LLM guess). It CANNOT claim a commercial-rate spread — there is no commercial
 * field in CalcRateRecord (the /api route's 402 teaser mentions "GSA vs commercial"
 * as marketing copy, not data). Inventing one would be a hallucinated "intelligence"
 * (PRD §9 R3 — _ai_hint accuracy is the whole moat).
 *
 * credits: 5 (Phase-1 debit marker — free upstream API, but multi-call; warm cache
 * hits cost us ~nothing).
 */
import { fetchPricingIntel, fetchPricingIntelByKeywords, PricingIntelData } from '@/lib/utils/calc-rates';
import { withCache } from '@/lib/mcp/external-cache';
import { mcpFlags } from '@/lib/mcp/flags';

const CACHE_TTL_SECONDS = 12 * 60 * 60; // 12h — CALC refreshes upstream daily; cache saves the 20-180-call fan-out
// v2: payload gained priceToWinBasis + titleMedian (Ask Mindy R7); a v1 cache row lacks them.
const CACHE_API_TYPE = 'calc:pricing:v2';

export interface PricingIntelInput {
  /** NAICS code, e.g. "541512". Mutually exclusive with keyword. */
  naics?: string;
  /** Labor-category keyword(s), e.g. "Software Engineer, Project Manager". Mutually exclusive with naics. */
  keyword?: string;
}

export interface PricingIntelResult {
  /** The mode actually used to answer. */
  queried: { naics?: string; keyword?: string };
  /** The full CALC pricing intel (pass-through so the agent can cite sub-fields). */
  pricing: PricingIntelData | null;
  /**
   * Ask Mindy R7: every rate with its population and n, the explicit ordering, and a statement
   * that names all three price points. Additive; absent when there are no rates.
   */
  rate_summary?: RateSummary;
  /**
   * Pre-narrated conclusion the agent can quote verbatim. OPTIONAL and TOGGLED OFF
   * by default (mcpFlags.aiHint) — the data layer + `_meta` signals ship first;
   * narration is opt-in. Absent when the toggle is off.
   */
  _ai_hint?: {
    summary: string;
    how_to_use: string;
    key_caveats: string[];
  };
  /** Provenance / trust. ALWAYS ships (machine-readable; the edge branches on this). */
  _meta: {
    grounded: boolean; // at least one labor category returned
    degraded: boolean; // upstream fetch ERRORED — NOT a genuine empty result
    records_analyzed: number;
    categories: number;
    vendors: number;
    from_cache: boolean;
    /** Present only on input-validation failures (no/both inputs). Machine-readable. */
    validation_error?: string;
    /** Present when a non-services NAICS was requested — CALC prices labor, not products (FM-U02). */
    not_applicable?: string;
  };
}

export interface RateSummaryRate {
  label: 'aggressive' | 'competitive' | 'premium';
  /** Alternative name for the same figure (competitive IS the market median). */
  also_called?: string;
  percentile: 25 | 50 | 75;
  hourly: number;
  population: string;
  n: number;
}

export interface RateSummary {
  unit: string;
  ordering: string;
  ordering_holds: boolean;
  population: { description: string; search_term: string | null; source: string; n: number };
  rates: RateSummaryRate[];
  market_median: { hourly: number; percentile: 50; same_as: 'competitive'; n: number };
  by_business_size: {
    small: { median: number; n: number; population: string };
    other_than_small: { median: number; n: number; population: string };
  };
  /** Per-title medians: a DIFFERENT, smaller population than the market rates above. */
  per_title_medians: Array<{ title: string; title_median: number; p25: number; p75: number; n: number; population: string }>;
  /** One sentence stating every price point in order; safe to quote. */
  statement: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Build the labelled rate block from CALC data. Pure; exported for tests. */
export function buildRateSummary(data: PricingIntelData): RateSummary {
  const ptw = data.priceToWinGuidance;
  const basis = data.priceToWinBasis ?? {
    source: 'calc_server_aggregation' as const,
    searchTerm: data.searchTermsUsed[0] ?? null,
    n: data.totalRecordsAnalyzed,
  };
  const term = basis.searchTerm;
  const popDesc =
    basis.source === 'calc_server_aggregation'
      ? `All GSA CALC+ awarded labor-category records matching "${term}" (percentiles computed by CALC over the full match set)`
      : `The GSA CALC+ records fetched for "${term}" (CALC aggregation unavailable; computed locally)`;
  const popShort = `all CALC records matching "${term}"`;
  const n = basis.n;
  const rates: RateSummaryRate[] = [
    { label: 'aggressive', percentile: 25, hourly: r2(ptw.aggressiveRate), population: popShort, n },
    { label: 'competitive', also_called: 'market median', percentile: 50, hourly: r2(ptw.competitiveRate), population: popShort, n },
    { label: 'premium', percentile: 75, hourly: r2(ptw.premiumRate), population: popShort, n },
  ];
  const holds = ptw.aggressiveRate <= ptw.competitiveRate && ptw.competitiveRate <= ptw.premiumRate;
  const biz = data.businessSizeComparison;
  const lead = data.searchTermsUsed[0] ?? term;
  return {
    unit: 'USD per hour, GSA Schedule ceiling rate',
    ordering: 'aggressive <= competitive (market median) <= premium',
    ordering_holds: holds,
    population: { description: popDesc, search_term: term, source: basis.source, n },
    rates,
    market_median: { hourly: r2(ptw.competitiveRate), percentile: 50, same_as: 'competitive', n },
    by_business_size: {
      small: { median: r2(biz.smallBusiness.median), n: biz.smallBusiness.count, population: `CALC records matching "${lead}" with business_size = small` },
      other_than_small: { median: r2(biz.largeBusiness.median), n: biz.largeBusiness.count, population: `CALC records matching "${lead}" with business_size = other than small` },
    },
    per_title_medians: data.laborCategories.slice(0, 10).map((c) => ({
      title: c.category,
      title_median: r2(c.titleMedian ?? c.median),
      p25: r2(c.percentile25),
      p75: r2(c.percentile75),
      n: c.recordCount,
      population: `fetched records whose labor_category is exactly "${c.category}" (a subset; not the market rate population)`,
    })),
    statement:
      `GSA CALC+ ceiling rates for "${term}" (n=${n} records): ` +
      `aggressive (25th percentile) $${rates[0].hourly.toFixed(2)}/hr; ` +
      `competitive (market median, 50th percentile) $${rates[1].hourly.toFixed(2)}/hr; ` +
      `premium (75th percentile) $${rates[2].hourly.toFixed(2)}/hr. ` +
      `Ordering: aggressive <= competitive <= premium${holds ? '' : ' (NOT satisfied by this data; report the figures as-is)'}.`,
  };
}

function fmtRate(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `$${n.toFixed(2)}/hr`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** The three-way narration (degraded → grounded → else). Only attached when mcpFlags.aiHint. */
function buildHint(
  degraded: boolean,
  grounded: boolean,
  data: PricingIntelData | null,
  scope: string,
): PricingIntelResult['_ai_hint'] {
  const records = data?.totalRecordsAnalyzed ?? 0;
  const categories = data?.laborCategories.length ?? 0;
  const vendors = data?.topVendors.length ?? 0;
  const ptw = data?.priceToWinGuidance;
  const biz = data?.businessSizeComparison;
  const topCat = data?.laborCategories[0];

  if (degraded) {
    return {
      summary:
        `GSA CALC could not be reached (upstream error) for ${scope}. This is a TEMPORARY SYSTEM ISSUE — NOT a sign no rates exist. Tell the user pricing data is briefly unavailable and to retry; do NOT state that no rates were found or invent figures.`,
      how_to_use:
        'Upstream error — tell the user pricing data is temporarily unavailable and to retry; do NOT claim no rates exist or generate rate figures.',
      key_caveats: ['CALC was unreachable (system error) — this is NOT a real no-match; do not conclude no rates exist.'],
    };
  }
  if (grounded && data) {
    return {
      summary:
        `Market median GSA rate (50th percentile of ${data.priceToWinBasis?.n ?? records} CALC records matching "${data.priceToWinBasis?.searchTerm ?? scope}") is ${fmtRate(ptw?.competitiveRate)}; it is the competitive rate, not the median of any single title${topCat ? ` (the largest title, "${topCat.category}", has its own median ${fmtRate(topCat.titleMedian ?? topCat.median)} over n=${topCat.recordCount})` : ''}. Price-to-win: aggressive ${fmtRate(ptw?.aggressiveRate)} / competitive ${fmtRate(ptw?.competitiveRate)} / premium ${fmtRate(ptw?.premiumRate)}. Based on ${records} awarded records across ${categories} labor categories. Small vs large business gap ${fmtPct(biz?.gapPercent)} (small ${fmtRate(biz?.smallBusiness?.median)} vs large ${fmtRate(biz?.largeBusiness?.median)}).${vendors ? ` Top vendor: ${data.topVendors[0].name} (avg ${fmtRate(data.topVendors[0].avgRate)}, ${data.topVendors[0].businessSize === 'S' ? 'small' : 'large'} biz).` : ''}`,
      how_to_use:
        `Quote the three price-to-win targets as the bid-rate ceiling: lead with competitive (${fmtRate(ptw?.competitiveRate)}) as the defensible target; aggressive (${fmtRate(ptw?.aggressiveRate)}) to undercut on price; premium (${fmtRate(ptw?.premiumRate)}) for differentiated value. The top vendors are the likely competitor rate card.`,
      key_caveats: [
        'GSA Schedule rates only (not commercial market rates) — no commercial spread is available, do not claim one.',
        `${records} is the server-computed count over all CALC records for these search terms; the locally paginated slice may underweight expensive categories.`,
        "Verify against the solicitation's LPTA vs best-value evaluation basis before bidding to the percentile.",
      ],
    };
  }
  return {
    summary:
      `No GSA CALC rates found for ${scope}. Do not invent a price-to-win — tell the user Mindy has no CALC data for this exact ${scope.includes('NAICS') ? 'NAICS code' : 'keyword'} and suggest a broader or sibling term (e.g. 541512 → 541511, or "Engineer" instead of "Senior Systems Engineer III").`,
    how_to_use: 'No grounded rates returned; state that plainly rather than generating figures.',
    key_caveats: ['Zero CALC matches — any rate here would be ungrounded.'],
  };
}

/**
 * Run the pricing-intel lookup. Pure function — no transport, no auth.
 * Never fabricates: empty result → grounded=false, the agent must say "no rates
 * found, try a broader term" (mirroring the /api route's 404 guidance).
 */
export async function getPricingIntel(input: PricingIntelInput): Promise<PricingIntelResult> {
  const naics = input.naics?.trim();
  const keyword = input.keyword?.trim();
  const queried = { naics: naics || undefined, keyword: keyword || undefined };

  // Exactly-one-required validation mirrors the /api route (route.ts:26).
  if (!naics && !keyword) {
    return {
      queried,
      pricing: null,
      _meta: {
        grounded: false,
        degraded: false,
        records_analyzed: 0,
        categories: 0,
        vendors: 0,
        from_cache: false,
        validation_error: 'no_input',
      },
    };
  }
  if (naics && keyword) {
    return {
      queried,
      pricing: null,
      _meta: {
        grounded: false,
        degraded: false,
        records_analyzed: 0,
        categories: 0,
        vendors: 0,
        from_cache: false,
        validation_error: 'both_inputs',
      },
    };
  }

  let data: PricingIntelData | null = null;
  let fetchErrored = false;
  let fromCache = false;
  try {
    const params = naics ? { naics } : { keyword };
    const { value, fromCache: hit } = await withCache<PricingIntelData | null>(
      CACHE_API_TYPE,
      params,
      CACHE_TTL_SECONDS,
      () => (naics
        ? fetchPricingIntel(naics, { throwOnUpstreamError: true })
        : fetchPricingIntelByKeywords(keyword!, { throwOnUpstreamError: true })),
    );
    data = value;
    fromCache = hit;
  } catch (err) {
    fetchErrored = true;
    console.error('[mcp:get_pricing_intel] CALC fetch failed:', err);
  }

  // FM-U02 (Eric/QA 2026-07-29): GSA CALC prices SERVICES LABOR, not products. A manufacturing /
  // wholesale / retail NAICS has no meaningful labor category, so CALC's keyword-split on the title
  // (e.g. 332994 "Small Arms Ordnance Mfg" → 'small','arms','ordnance') returns IRRELEVANT rates
  // (Small Engine Mechanic, movers) that read as real when grounded=true. Detect a non-services NAICS
  // and refuse to ground it — the pricing is not applicable, not merely empty.
  const sector = (naics || '').replace(/\D/g, '').slice(0, 2);
  const NON_SERVICE_SECTORS = new Set(['11', '21', '23', '31', '32', '33', '42', '44', '45', '48', '49']);
  /**
   * What each excluded sector ACTUALLY is. The refusal was right; the reason
   * was not: NAICS 236220 (sector 23) was explained to customers as a
   * "manufacturing/product/wholesale code" — 23 is CONSTRUCTION. A factually
   * wrong explanation inside a correct refusal is still a wrong statement, and
   * a contractor reading it learns something false about their own industry.
   */
  const SECTOR_LABELS: Record<string, string> = {
    '11': 'Agriculture, Forestry, Fishing and Hunting',
    '21': 'Mining, Quarrying, and Oil and Gas Extraction',
    '23': 'Construction',
    '31': 'Manufacturing',
    '32': 'Manufacturing',
    '33': 'Manufacturing',
    '42': 'Wholesale Trade',
    '44': 'Retail Trade',
    '45': 'Retail Trade',
    '48': 'Transportation and Warehousing',
    '49': 'Transportation and Warehousing',
  };
  const naicsNotPriceable = Boolean(naics) && NON_SERVICE_SECTORS.has(sector);

  const grounded = !naicsNotPriceable && !!data && data.laborCategories.length > 0;
  const degraded = fetchErrored && !grounded;
  const scope = naics ? `NAICS ${naics}` : `keyword "${keyword}"`;

  const result: PricingIntelResult = {
    queried,
    pricing: naicsNotPriceable ? null : data,
    ...(grounded && data ? { rate_summary: buildRateSummary(data) } : {}),
    _meta: {
      grounded,
      degraded,
      records_analyzed: naicsNotPriceable ? 0 : (data?.totalRecordsAnalyzed ?? 0),
      categories: naicsNotPriceable ? 0 : (data?.laborCategories.length ?? 0),
      vendors: naicsNotPriceable ? 0 : (data?.topVendors.length ?? 0),
      from_cache: fromCache,
      ...(naicsNotPriceable
        ? {
            not_applicable:
              `GSA CALC prices SERVICES labor rates. NAICS ${naics} is sector ${sector} ` +
              `(${SECTOR_LABELS[sector] ?? 'a non-services sector'}), which CALC does not cover, ` +
              `so no defensible labor rate applies here. ` +
              (sector === '23'
                ? 'For construction, price from the wage determination in the solicitation ' +
                  '(Davis-Bacon) and comparable awarded contracts, not CALC labor rates. '
                : '') +
              'Search by a labor-category keyword instead, or use a services NAICS.',
          }
        : {}),
    },
  };

  // NARRATION LAYER — toggled OFF by default (data-first). Only when explicitly
  // enabled do we attach the pre-narrated hint. Even then, every fact traces to
  // the real returned data (no LLM guess).
  if (mcpFlags.aiHint) {
    result._ai_hint = buildHint(degraded, grounded, data, scope);
  }

  return result;
}
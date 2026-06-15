/**
 * Keyword → market coverage (the "drones live in 70+ NAICS" fix).
 *
 * Eric's insight: NAICS is the WRONG primary key — "drones" sprawls across 70+
 * codes ($245M, only 28% in the obvious one). Worse, NAICS 336411 alone is BOTH
 * over-broad (all aircraft) AND incomplete (misses drones in other codes).
 * Keyword search is precise AND complete. So: keyword is primary; NAICS is
 * AUTO-DERIVED behind the scenes (only for set-aside/size eligibility), never
 * something the user manages.
 *
 * This returns, for a keyword: the full ranked NAICS list, the total market, and
 * the smallest code set that covers ~90% of the spend (for eligibility filtering).
 */
import { fiscalYearTimePeriod } from '@/lib/utils/fiscal-year';

const BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_category';

/** How agency rankings + discovery filter USAspending — keyword/PSC, never NAICS. */
export type MarketFilterMode = 'keyword' | 'keyword_psc' | 'psc' | 'naics';

export interface MarketFilter {
  keywords?: string[];
  psc_codes?: string[];
  mode: MarketFilterMode;
  /** Human label for UI — e.g. 'keyword "demolition" + PSC P500' */
  rankingLabel: string;
}

/** PSC names that are too generic to tighten rankings (engineering support, etc.). */
const GENERIC_PSC_PATTERNS = [
  /support-\s*professional/i,
  /engineering\/tech/i,
  /managed health/i,
  /professional:\s*engineering/i,
  /services?\s*-\s*general/i,
  /miscellaneous/i,
  /other\s*services/i,
  /research\s+and\s+development/i,
];

export function isGenericPsc(name: string | undefined | null): boolean {
  if (!name) return true;
  return GENERIC_PSC_PATTERNS.some((p) => p.test(name));
}

/** PSC must literally describe the user's product — not just a related category. */
export function pscLiteralProduct(keyword: string, pscName: string): boolean {
  const kw = keyword.toLowerCase().trim();
  const psc = pscName.toLowerCase();
  if (!kw || !psc) return false;
  if (psc.includes(kw)) return true;
  // Significant keyword token appears in PSC title (≥4 chars)
  const tokens = kw.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  if (tokens.some((t) => psc.includes(t))) return true;
  return false;
}

/**
 * Single source of truth for ranking + agency discovery filters.
 * Keyword = default; add top PSC when the market concentrates on one product code.
 * NAICS is never returned here — it is eligibility-only (set-aside / pain points).
 */
export function buildMarketFilter(opts: {
  coverage?: KeywordCoverage | null;
  pscCode?: string;
  keyword?: string;
}): MarketFilter | null {
  const { coverage, pscCode } = opts;

  if (coverage?.keyword) {
    const kw = coverage.keyword;
    const pscIsSpecific = Boolean(
      coverage.topPsc?.code
      && coverage.topPscPct >= 0.40
      && !isGenericPsc(coverage.topPsc.name)
      && pscLiteralProduct(kw, coverage.topPsc.name),
    );
    if (pscIsSpecific && coverage.topPsc) {
      return {
        keywords: [kw],
        psc_codes: [coverage.topPsc.code],
        mode: 'keyword_psc',
        rankingLabel: `keyword "${kw}" + PSC ${coverage.topPsc.code} (${coverage.topPsc.name})`,
      };
    }
    return {
      keywords: [kw],
      mode: 'keyword',
      rankingLabel: `keyword "${kw}"`,
    };
  }

  const psc = (pscCode || '').trim().toUpperCase();
  if (psc) {
    return {
      psc_codes: [psc],
      mode: 'psc',
      rankingLabel: `PSC ${psc}`,
    };
  }

  return null;
}

/** Merge a MarketFilter into USAspending filter fields (no NAICS). */
export function marketFilterToUsaspending(
  marketFilter: MarketFilter,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const out = { ...base };
  if (marketFilter.keywords?.length) out.keywords = marketFilter.keywords;
  if (marketFilter.psc_codes?.length) out.psc_codes = marketFilter.psc_codes;
  return out;
}

export interface KeywordCoverage {
  keyword: string;
  totalMarket: number;            // $ total across all codes that bought this
  naicsCount: number;             // distinct NAICS that bought it
  allNaics: { code: string; name: string; amount: number; pct: number }[];
  coverageCodes: string[];        // smallest NAICS set covering ~coverageTarget
  coveragePct: number;            // what the coverageCodes actually capture (~0.9)
  topCodePct: number;             // % the single biggest NAICS is (the "you'd miss the rest")
  // PSC view (the GovCon-expert lesson: PSC = what was BOUGHT, NAICS = who the
  // seller IS — PSC's top code is usually the literal product, e.g. "Unmanned
  // Aircraft" vs NAICS "Aircraft Manufacturing"). Surfaced to TEACH the user.
  pscCount: number;
  topPsc: { code: string; name: string } | null;
  topPscPct: number;
}

/**
 * Resolve a keyword to its market coverage. coverageTarget = the spend fraction
 * the derived code set should capture (default 0.9 = 90%).
 */
// Stopwords stripped when reducing a phrase/sentence to its core term.
const STOP = new Set(['we', 'provide', 'offer', 'and', 'or', 'the', 'a', 'an', 'for', 'of', 'to', 'in', 'our', 'with', 'services', 'service', 'support', 'solutions', 'consulting', 'company', 'federal', 'government', 'agencies',
  // Business-entity / generic nouns that aren't capabilities — "demolition firm"
  // was leaking "firm" as a keyword. These describe the org, not what it does.
  'firm', 'llc', 'inc', 'corp', 'corporation', 'business', 'group', 'enterprise', 'enterprises', 'contractor', 'contractors', 'provider', 'providers', 'specialist', 'specialists', 'professional', 'professionals']);

/**
 * USASpending keyword search is EXACT-PHRASE (QA: "cybersecurity consulting"
 * returned nothing → LLM fallback). So build candidate keywords from most- to
 * least-specific: the full phrase, then significant bigrams, then the single
 * most-meaningful word. Return the first that yields real award data.
 */
function keywordCandidates(input: string): string[] {
  const kw = input.trim();
  const out: string[] = [kw];
  const words = kw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  // significant single words, longest first (longest ≈ most specific industry term)
  for (const w of [...new Set(words)].sort((a, b) => b.length - a.length)) {
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, 4);
}

const DERIVE_KW_STOP = new Set([
  'and', 'or', 'the', 'of', 'for', 'all', 'other', 'nec', 'services', 'service',
  'manufacturing', 'except', 'related', 'activities', 'professional', 'scientific',
  'technical', 'instruments', 'equipment', 'general', 'misc', 'miscellaneous',
]);

/**
 * Search terms grounded in real award data — user keyword + top PSC product name +
 * signal words from top buying NAICS titles. Powers alerts AND agency discovery.
 */
export function deriveCoverageKeywords(coverage: KeywordCoverage): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.toLowerCase().trim();
    if (t.length >= 3 && !seen.has(t)) { seen.add(t); out.push(t); }
  };
  add(coverage.keyword);
  if (coverage.topPsc?.name) add(coverage.topPsc.name.toLowerCase());
  for (const n of (coverage.allNaics || []).slice(0, 6)) {
    const words = (n.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 4 && !DERIVE_KW_STOP.has(w));
    const best = [...words].sort((a, b) => b.length - a.length)[0];
    if (best) add(best);
  }
  return out.slice(0, 10);
}

/** Union of coverage-derived + profile keywords for find-agencies keyword passes. */
export function buildSearchKeywords(opts: {
  keyword?: string;
  coverage?: KeywordCoverage | null;
  profileKeywords?: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.length >= 3 && !seen.has(t)) { seen.add(t); out.push(t); }
  };
  if (opts.coverage) {
    for (const k of deriveCoverageKeywords(opts.coverage)) add(k);
  } else if (opts.keyword?.trim()) {
    add(opts.keyword);
  }
  for (const k of opts.profileKeywords || []) add(k);
  return out.slice(0, 6);
}

export async function keywordCoverage(keyword: string, coverageTarget = 0.9): Promise<KeywordCoverage | null> {
  const raw = (keyword || '').trim();
  if (raw.length < 2) return null;

  const fetchCat = async (kw: string, cat: 'naics' | 'psc') => {
    try {
      const res = await fetch(`${BASE}/${cat}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { keywords: [kw], time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
          category: cat, limit: 100,
        }),
      });
      if (!res.ok) return [];
      const j = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (j.results || []).filter((r: any) => r.code && (r.amount || 0) > 0)
        .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
    } catch { return []; }
  };
  try {
    // Try candidates most→least specific until one yields real data (phrase
    // resilience — onboarding sends sentences, not single words).
    let rows: { code: string; name?: string; amount: number }[] = [];
    let pscRows: { code: string; name?: string; amount: number }[] = [];
    let kw = raw;
    for (const cand of keywordCandidates(raw)) {
      const [n, p] = await Promise.all([fetchCat(cand, 'naics'), fetchCat(cand, 'psc')]);
      if (n.length > 0) { rows = n; pscRows = p; kw = cand; break; }
    }
    if (rows.length === 0) return null;

    const total = rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allNaics = rows.map((r: any) => ({ code: r.code, name: r.name || r.code, amount: r.amount, pct: r.amount / total }));

    // Smallest code set that captures coverageTarget of the spend.
    const coverageCodes: string[] = [];
    let cum = 0;
    for (const r of allNaics) {
      coverageCodes.push(r.code);
      cum += r.pct;
      if (cum >= coverageTarget) break;
    }

    // PSC view — "what was bought" (the expert's point). Top PSC is usually the
    // literal product (e.g. 1550 Unmanned Aircraft) vs NAICS's vendor catch-all.
    const pscTotal = pscRows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    const topPsc = pscRows[0] ? { code: pscRows[0].code, name: pscRows[0].name || pscRows[0].code } : null;

    return {
      keyword: kw,
      totalMarket: total,
      naicsCount: rows.length,
      allNaics,
      coverageCodes,
      coveragePct: cum,
      topCodePct: allNaics[0].pct,
      pscCount: pscRows.length,
      topPsc,
      topPscPct: pscTotal > 0 && pscRows[0] ? pscRows[0].amount / pscTotal : 0,
    };
  } catch {
    return null;
  }
}

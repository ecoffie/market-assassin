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
import { sectorSubTradeKeywords } from './sector-expansions';

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
  // Top PSCs with dollars — "what was actually BOUGHT", ranked. Lets the UI show
  // the real sub-markets a single keyword spans (e.g. "demolition" = Demolition of
  // Structures $491M vs Ammunition Facilities $66M — building work vs ordnance work,
  // which NAICS lumps together but PSC separates cleanly).
  topPscList: { code: string; name: string; amount: number; pct: number }[];
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

// In-memory cache (10-min TTL). keywordCoverage is called 3× on a single onboarding
// confirm screen (profile-from-text, market-overview, code suggestions), each doing
// several USASpending round-trips. Dedupe so calls 2-3 are instant and we don't
// triple the live-API flake surface during a demo. USASpending data is slow-moving,
// so a short per-instance cache is safe.
const _covCache = new Map<string, { at: number; val: KeywordCoverage | null }>();
const COV_TTL_MS = 10 * 60 * 1000;

export async function keywordCoverage(keyword: string, coverageTarget = 0.9): Promise<KeywordCoverage | null> {
  const cacheKey = `${(keyword || '').trim().toLowerCase()}|${coverageTarget}`;
  const hit = _covCache.get(cacheKey);
  if (hit && Date.now() - hit.at < COV_TTL_MS) return hit.val;
  const val = await keywordCoverageUncached(keyword, coverageTarget);
  _covCache.set(cacheKey, { at: Date.now(), val });
  return val;
}

async function keywordCoverageUncached(keyword: string, coverageTarget = 0.9): Promise<KeywordCoverage | null> {
  const raw = (keyword || '').trim();
  if (raw.length < 2) return null;

  // kw can be a single phrase OR an array (USASpending ORs the array) — the array
  // form grounds a sector's specialty sub-trades in one call.
  const fetchCat = async (kw: string | string[], cat: 'naics' | 'psc') => {
    try {
      const res = await fetch(`${BASE}/${cat}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { keywords: Array.isArray(kw) ? kw : [kw], time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
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
    // Resolve the keyword to the market a user would SEE if they fact-checked on
    // USASpending. USASpending keyword search is EXACT-PHRASE, so "Demolition
    // Services" returns only the 6 NAICS / $8M where that literal bigram appears,
    // while the core term "demolition" returns the real 68-NAICS / $1.4B market.
    // The old loop stopped at the first candidate with ANY data → it locked onto
    // the narrow phrase and under-reported the market by ~170× (Eric QC, demolition).
    //
    // Fix: try candidates most→least specific, but PREFER the candidate that
    // surfaces the larger market when a broader term materially beats the phrase.
    // "Materially" = ≥3× the running-best total (a core term that captures the
    // whole industry, not just a sibling phrase). This keeps genuine distinct
    // products (where the phrase IS the market) while unburying the real number.
    let rows: { code: string; name?: string; amount: number }[] = [];
    let pscRows: { code: string; name?: string; amount: number }[] = [];
    let kw = raw;
    let bestTotal = 0;
    const sumAmt = (rs: { amount: number }[]) => rs.reduce((s, r) => s + (r.amount || 0), 0);
    for (const cand of keywordCandidates(raw)) {
      const [n, p] = await Promise.all([fetchCat(cand, 'naics'), fetchCat(cand, 'psc')]);
      if (n.length === 0) continue;
      const candTotal = sumAmt(n);
      // First non-empty candidate seeds the result; a later (broader) candidate
      // only wins if it captures ≥3× the market the current best does.
      if (rows.length === 0 || candTotal >= bestTotal * 3) {
        rows = n; pscRows = p; kw = cand; bestTotal = candTotal;
      }
    }
    if (rows.length === 0) return null;

    // Sector expansion (Eric, Jun 22 2026) — a literal keyword like "construction"
    // can't reach the 238xxx specialty trades (their awards say "electrical" /
    // "plumbing", not "construction"). When the term hits a broad sector, also
    // ground its sub-trade keywords and merge the NAICS in, so the auto-derived
    // coverage set includes the specialty trades. Still award-backed real $;
    // deduped by code (keep the larger amount when a code appears in both passes).
    const subTrades = sectorSubTradeKeywords(raw);
    if (subTrades) {
      const subRows = await fetchCat(subTrades, 'naics');
      if (subRows.length) {
        const byCode = new Map<string, { code: string; name?: string; amount: number }>();
        for (const r of [...rows, ...subRows]) {
          const ex = byCode.get(r.code);
          if (!ex || (r.amount || 0) > (ex.amount || 0)) byCode.set(r.code, r);
        }
        rows = Array.from(byCode.values()).sort((a, b) => (b.amount || 0) - (a.amount || 0));
      }
    }

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
    const topPscList = pscRows.slice(0, 5).map((r) => ({
      code: r.code,
      name: r.name || r.code,
      amount: r.amount,
      pct: pscTotal > 0 ? r.amount / pscTotal : 0,
    }));

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
      topPscList,
    };
  } catch {
    return null;
  }
}

/**
 * Market size for an EXACT PSC and/or NAICS — no keyword broadening.
 *
 * Use this when the caller already knows the precise code(s) they're researching
 * (e.g. an MRR where the CO supplies PSC + NAICS). `keywordCoverage()` is built
 * for vague DISCOVERY ("ship repair" → broadens to the whole naval market on
 * purpose); that broadening is wrong when the requirement is pinned to a code.
 * For "Non-Nuclear Ship Repair" (PSC J998) the keyword path returns $84B "Combat
 * Ships"; this returns the actual J998 repair-services market.
 *
 * PSC is the more precise axis ("what was bought") — prefer it when both given.
 * Returns null on any failure → caller falls back to the keyword figure or omits.
 */
export async function codeMarketSize(opts: {
  psc?: string;
  naics?: string;
}): Promise<{ totalMarket: number; topPsc: { code: string; name: string } | null; basis: 'psc' | 'naics' } | null> {
  const psc = (opts.psc || '').trim();
  const naics = (opts.naics || '').trim();
  if (!psc && !naics) return null;

  // Prefer PSC (literal product bought); fall back to NAICS (vendor industry).
  const basis: 'psc' | 'naics' = psc ? 'psc' : 'naics';
  const filters: Record<string, unknown> = {
    time_period: [fiscalYearTimePeriod()],
    award_type_codes: ['A', 'B', 'C', 'D'],
  };
  if (basis === 'psc') filters.psc_codes = [psc];
  else filters.naics_codes = [naics];

  const fetchCat = async (cat: 'psc' | 'naics') => {
    try {
      const res = await fetch(`${BASE}/${cat}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, category: cat, limit: 100 }),
      });
      if (!res.ok) return [];
      const j = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (j.results || []).filter((r: any) => r.code && (r.amount || 0) > 0)
        .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
    } catch { return []; }
  };

  try {
    const [naicsRows, pscRows] = await Promise.all([fetchCat('naics'), fetchCat('psc')]);
    const rows = basis === 'psc' && pscRows.length ? pscRows : naicsRows;
    if (rows.length === 0) return null;
    const total = rows.reduce((s: number, r: { amount: number }) => s + (r.amount || 0), 0);
    const topPsc = pscRows[0] ? { code: pscRows[0].code, name: pscRows[0].name || pscRows[0].code } : null;
    return { totalMarket: total, topPsc, basis };
  } catch {
    return null;
  }
}

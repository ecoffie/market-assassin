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
import { fiscalYearTimePeriod, latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';
import { termOfArtSynonyms } from './sector-expansions';
import {
  KEYWORD_COVERAGE_PRIMARY_SENSE,
  KEYWORD_COVERAGE_SOURCE,
  KeywordCoverageNotEstablishedError,
  descriptionMatchPattern,
  runKeywordCoverageBq,
  type CoverageEvidenceStatus,
  type KeywordCoverageBqRow,
} from './keyword-coverage-bq';

const BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_category';

/**
 * Thrown when a caller AbortSignal aborts keywordCoverage mid-flight.
 * Distinct from "no market found" (null) — a timeout is NOT evidence of zero spend.
 */
export class CoverageDeadlineError extends Error {
  readonly code = 'deadline_exceeded' as const;
  constructor(message = 'keywordCoverage deadline exceeded') {
    super(message);
    this.name = 'CoverageDeadlineError';
  }
}

export interface KeywordCoverageOptions {
  /** Abort in-flight warehouse work. Do not cache aborted results as empty markets. */
  signal?: AbortSignal;
  /** Per-request ceiling (ms). Combined with `signal` via AbortSignal.any when available. */
  perFetchMs?: number;
  /** Audit only — do not use in product default. Filters award_id prefix (e.g. CONT_AWD_). */
  awardIdPrefix?: string;
}

export {
  KEYWORD_COVERAGE_PRIMARY_SENSE,
  KEYWORD_COVERAGE_SENSES_AVAILABLE,
  KEYWORD_COVERAGE_SOURCE,
  KeywordCoverageNotEstablishedError,
  type CoverageEvidenceStatus,
} from './keyword-coverage-bq';

export interface KeywordCoverageQueryResult {
  status: CoverageEvidenceStatus;
  coverage: KeywordCoverage | null;
  degraded: boolean;
  reason?: string;
}

const DEFAULT_PER_FETCH_MS = 12_000;

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CoverageDeadlineError();
}

function isAbortLike(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === 'AbortError' || err.message === 'aborted');
}

function fetchSignal(opts?: KeywordCoverageOptions): AbortSignal | undefined {
  const parent = opts?.signal;
  const per = opts?.perFetchMs ?? DEFAULT_PER_FETCH_MS;
  const timed = AbortSignal.timeout(per);
  if (!parent) return timed;
  // Node 20+: abort when either the tool deadline or the per-fetch ceiling fires.
  const any = (AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  return any ? any([parent, timed]) : parent;
}

/** How agency rankings + discovery filter USAspending — keyword/PSC, never NAICS. */
export type MarketFilterMode = 'keyword' | 'keyword_psc' | 'keyword_naics' | 'psc' | 'naics';

export interface MarketFilter {
  keywords?: string[];
  psc_codes?: string[];
  /**
   * NAICS the market is pinned to while STILL keyword-constrained ('keyword_naics').
   * USASpending ANDs its filters, so this narrows to "awards in this code whose text
   * says the keyword" — not the whole code.
   */
  naics_codes?: string[];
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
 * Historical 40% concentration threshold. Kept exported so old tests can name it.
 * It is NOT used to collapse a keyword into a NAICS (or to treat BQ work-text
 * leadCodePct as the user's market). Measurement ≠ identity.
 */
export const DOMINANT_NAICS_SHARE = 0.40;

/** Coverage never establishes NAICS identity. Senses v2 will own interpretation. */
export const NAICS_IDENTITY_NOT_ESTABLISHED = 'NOT_ESTABLISHED' as const;
export type NaicsIdentityStatus = typeof NAICS_IDENTITY_NOT_ESTABLISHED;

/**
 * Single source of truth for ranking + agency discovery filters.
 * Keyword = default. Curated term-of-art PSC pins still apply. Coverage
 * NAICS/PSC percentages never change the mode — they are measured shares.
 */
/**
 * The keyword set the SECTIONS should measure — the literal term plus its term-of-art
 * synonyms when one is curated.
 *
 * The synonyms already drove code DISCOVERY (which NAICS/PSC a market buys through),
 * but the filter handed to agencies/contractors/recompetes carried only the literal
 * word, so those sections measured a narrower market than the one the report had just
 * discovered. Hypersonics is the clearest case: the literal term finds the program
 * offices that spell it out, while the surrounding work is bought as scramjet / ramjet
 * / boost-glide / CPS and never says "hypersonic".
 *
 * USASpending ORs a keywords array, so this widens WITHIN the market rather than
 * escaping it. Every expansion set is curated and live-verified per term — see
 * TERM_OF_ART_EXPANSIONS.
 */
export function marketKeywords(keyword: string): string[] {
  const syn = termOfArtSynonyms(keyword);
  if (!syn?.length) return [keyword];
  // Literal first (it is what the user typed and what labels read back), then the
  // curated expansion, deduped case-insensitively.
  const seen = new Set([keyword.toLowerCase()]);
  const out = [keyword];
  for (const t of syn) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function buildMarketFilter(opts: {
  coverage?: KeywordCoverage | null;
  pscCode?: string;
  keyword?: string;
}): MarketFilter | null {
  const { coverage, pscCode } = opts;

  if (coverage?.keyword) {
    // TERM-OF-ART PSC PIN (FM-10) — curated product knowledge, not a BQ share.
    // EOD → 1385/1386 even when Facilities Support holds the description-matched $.
    if (coverage.pinnedPscCodes?.length) {
      return {
        keywords: [coverage.keyword],
        psc_codes: coverage.pinnedPscCodes,
        mode: 'keyword_psc',
        rankingLabel: `keyword "${coverage.keyword}" + PSC ${coverage.pinnedPscCodes.join('/')} (term of art)`,
      };
    }
    // BQ work-text coverage MEASURES NAICS/PSC shares. It does not identify the
    // user's market. Do not collapse to leadCodePct / topPscPct (HVAC≠236220,
    // drones≠336411, patrol≠shipbuilding). Senses v2 owns interpretation.
    const kw = coverage.keyword;
    const expanded = marketKeywords(kw);
    return {
      keywords: expanded,
      mode: 'keyword',
      rankingLabel: expanded.length > 1
        ? `keyword "${kw}" + ${expanded.length - 1} term-of-art synonyms`
        : `keyword "${kw}"`,
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
  // 'keyword_naics': keyword AND code. USASpending ANDs filters, so the market stays
  // inside the keyword while ranking by the dominant code.
  if (marketFilter.naics_codes?.length) out.naics_codes = marketFilter.naics_codes;
  return out;
}

export interface KeywordCoverage {
  keyword: string;
  totalMarket: number;            // $ total: SUM(obligation_amount) on description-matched FY actions
  naicsCount: number;             // distinct NAICS that bought it
  // Dollar-sorted. v1 lead = biggest by action obligations in the description-matched
  // set. Vocab/title promotion is HOLD (Senses v2) so a NAICS title containing the
  // keyword cannot become the lead without matching work text.
  allNaics: { code: string; name: string; amount: number; pct: number }[];
  coverageCodes: string[];        // smallest NAICS set covering ~coverageTarget (amount-ranked)
  coveragePct: number;            // what the coverageCodes actually capture (~0.9)
  /**
   * % of the measured description-matched set held by the single biggest NAICS.
   * Teaching stat only. Not market identity.
   */
  topCodePct: number;
  /**
   * % held by allNaics[0] (v1 = dollar leader). Measured share, not identity.
   */
  leadCodePct: number;
  /**
   * Always NOT_ESTABLISHED for BQ work-text coverage. Downstream must not treat
   * leadCodePct / topCodePct as "this keyword IS this NAICS".
   */
  naicsIdentityStatus: NaicsIdentityStatus;
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
  /**
   * Set when this keyword is a TERM OF ART pinned to specific PSC codes (e.g. "explosive ordnance
   * disposal" → PSC 1385/1386). v1 description-match does not PSC-pin; always null until Senses v2.
   */
  pinnedPscCodes: string[] | null;
  transactionCount: number;
  uniqueAwardCount: number;
  fiscalYear: number;
  source: typeof KEYWORD_COVERAGE_SOURCE;
  sourceMaxActionDate: string | null;
  allAgencies: { name: string; amount: number; pct: number }[];
  primarySense: typeof KEYWORD_COVERAGE_PRIMARY_SENSE;
  evidenceStatus: 'MARKET_EVIDENCE_FOUND';
}

/** Always false: get_keyword_coverage reports measured shares, not market identity. */
export function coverageEstablishesNaicsIdentity(
  _coverage?: KeywordCoverage | null,
): false {
  return false;
}

// keywordCandidates() moved to @/lib/market/keyword-sanitize (single source of
// truth — it used to be copy-pasted here AND in suggest-codes and the two diverged).

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
// confirm screen (profile-from-text, market-overview, code suggestions). Dedupe so
// calls 2-3 skip a warehouse round-trip. Cache HEALTHY payloads only (FOUND and
// genuine NO_MATCHES). Never cache abort or NOT_ESTABLISHED as an empty market.
const _covCache = new Map<string, { at: number; val: KeywordCoverage | null }>();
const COV_TTL_MS = 10 * 60 * 1000;

function coverageCacheKey(keyword: string, coverageTarget: number, awardIdPrefix?: string): string {
  return `${keyword.trim().toLowerCase()}|${coverageTarget}|${awardIdPrefix || 'all'}`;
}

function rowToCoverage(row: KeywordCoverageBqRow, coverageTarget: number): KeywordCoverage {
  const total = row.totalMarket;
  const codes = row.naics
    .filter((n) => n.code)
    .map((n) => ({
      code: n.code,
      name: n.name,
      amount: n.amount,
      pct: total > 0 ? n.amount / total : 0,
    }));
  const coverage: string[] = [];
  let captured = 0;
  for (const c of codes) {
    if (captured >= coverageTarget) break;
    coverage.push(c.code);
    captured += c.pct;
  }
  const coveragePct = coverage.reduce((s, code) => {
    const hit = codes.find((c) => c.code === code);
    return s + (hit?.pct ?? 0);
  }, 0);
  const biggestPct = codes[0]?.pct ?? 0;
  const pscs = row.pscs.map((p) => ({
    code: p.code,
    name: p.name,
    amount: p.amount,
    pct: total > 0 ? p.amount / total : 0,
  }));
  const agencies = row.agencies.map((a) => ({
    name: a.name,
    amount: a.amount,
    pct: total > 0 ? a.amount / total : 0,
  }));
  return {
    keyword: row.keyword,
    totalMarket: total,
    naicsCount: row.naicsCount,
    allNaics: codes,
    coverageCodes: coverage,
    coveragePct,
    topCodePct: biggestPct,
    leadCodePct: biggestPct,
    pscCount: row.pscCount,
    topPsc: pscs[0] ? { code: pscs[0].code, name: pscs[0].name } : null,
    topPscPct: pscs[0]?.pct ?? 0,
    topPscList: pscs,
    pinnedPscCodes: null,
    transactionCount: row.transactionCount,
    uniqueAwardCount: row.uniqueAwardCount,
    fiscalYear: row.fiscalYear,
    source: KEYWORD_COVERAGE_SOURCE,
    sourceMaxActionDate: row.maxActionDate,
    allAgencies: agencies,
    primarySense: KEYWORD_COVERAGE_PRIMARY_SENSE,
    evidenceStatus: 'MARKET_EVIDENCE_FOUND',
    naicsIdentityStatus: NAICS_IDENTITY_NOT_ESTABLISHED,
  };
}

/**
 * Resolve a keyword to its market coverage. coverageTarget = the spend fraction
 * the derived code set should capture (default 0.9 = 90%).
 *
 * Primary market = BigQuery usaspending.awards description match, latest complete
 * FY, SUM(obligation_amount). Live USASpending is not used as primary or fallback.
 *
 * Pass `opts.signal` from capability_market_match (or any budgeted caller). On abort
 * this throws CoverageDeadlineError — never caches null as "no market".
 * Warehouse failure throws KeywordCoverageNotEstablishedError (not null).
 */
export async function keywordCoverage(
  keyword: string,
  coverageTarget = 0.9,
  opts?: KeywordCoverageOptions,
): Promise<KeywordCoverage | null> {
  const result = await queryKeywordCoverage(keyword, coverageTarget, opts);
  if (result.status === 'NOT_ESTABLISHED') {
    throw new KeywordCoverageNotEstablishedError(result.reason || 'warehouse query failed');
  }
  return result.coverage;
}

/**
 * Honest coverage query: FOUND | NO_MATCHES_MEASURED | NOT_ESTABLISHED.
 * MCP/HTTP should map this — never coerce NOT_ESTABLISHED to $0 or empty.
 */
export async function queryKeywordCoverage(
  keyword: string,
  coverageTarget = 0.9,
  opts?: KeywordCoverageOptions,
): Promise<KeywordCoverageQueryResult> {
  assertNotAborted(opts?.signal);
  const raw = (keyword || '').trim();
  if (raw.length < 2) {
    return { status: 'NO_MATCHES_MEASURED', coverage: null, degraded: false };
  }

  const cacheKey = coverageCacheKey(raw, coverageTarget, opts?.awardIdPrefix);
  const hit = _covCache.get(cacheKey);
  if (hit && Date.now() - hit.at < COV_TTL_MS) {
    return hit.val
      ? { status: 'MARKET_EVIDENCE_FOUND', coverage: hit.val, degraded: false }
      : { status: 'NO_MATCHES_MEASURED', coverage: null, degraded: false };
  }

  const signal = fetchSignal(opts);
  try {
    const row = await runKeywordCoverageBq({
      keyword: raw,
      fiscalYear: latestCompleteFiscalYear(),
      awardIdPrefix: opts?.awardIdPrefix,
      signal,
    });
    // Net-zero obligations with real actions is still a measured market.
    if (row.transactionCount === 0) {
      if (!opts?.signal?.aborted && !signal?.aborted) {
        _covCache.set(cacheKey, { at: Date.now(), val: null });
      }
      return { status: 'NO_MATCHES_MEASURED', coverage: null, degraded: false };
    }
    const coverage = rowToCoverage(row, coverageTarget);
    if (!opts?.signal?.aborted && !signal?.aborted) {
      _covCache.set(cacheKey, { at: Date.now(), val: coverage });
    }
    return { status: 'MARKET_EVIDENCE_FOUND', coverage, degraded: false };
  } catch (err) {
    if (err instanceof CoverageDeadlineError) throw err;
    if (isAbortLike(err, opts?.signal) || isAbortLike(err, signal)) {
      throw new CoverageDeadlineError();
    }
    const reason = err instanceof Error ? err.message : String(err);
    return {
      status: 'NOT_ESTABLISHED',
      coverage: null,
      degraded: true,
      reason: reason.slice(0, 400),
    };
  }
}

/** Exported for tests — never cache from callers. */
export function __resetKeywordCoverageCacheForTests(): void {
  _covCache.clear();
}

export { descriptionMatchPattern };

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
  signal?: AbortSignal;
  perFetchMs?: number;
}): Promise<{ totalMarket: number; topPsc: { code: string; name: string } | null; basis: 'psc' | 'naics'; leadName?: string } | null> {
  const psc = (opts.psc || '').trim();
  const naics = (opts.naics || '').trim();
  if (!psc && !naics) return null;
  assertNotAborted(opts.signal);

  // Prefer PSC (literal product bought); fall back to NAICS (vendor industry).
  const basis: 'psc' | 'naics' = psc ? 'psc' : 'naics';
  const filters: Record<string, unknown> = {
    time_period: [fiscalYearTimePeriod()],
    award_type_codes: ['A', 'B', 'C', 'D'],
  };
  if (basis === 'psc') filters.psc_codes = [psc];
  else filters.naics_codes = [naics];

  const covOpts: KeywordCoverageOptions = { signal: opts.signal, perFetchMs: opts.perFetchMs };
  const fetchCat = async (cat: 'psc' | 'naics') => {
    try {
      assertNotAborted(opts.signal);
      const res = await fetch(`${BASE}/${cat}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, category: cat, limit: 100 }),
        signal: fetchSignal(covOpts),
      });
      if (!res.ok) return [];
      const j = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (j.results || []).filter((r: any) => r.code && (r.amount || 0) > 0)
        .sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
    } catch (err) {
      if (err instanceof CoverageDeadlineError) throw err;
      if (opts.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        throw new CoverageDeadlineError();
      }
      return [];
    }
  };

  try {
    const [naicsRows, pscRows] = await Promise.all([fetchCat('naics'), fetchCat('psc')]);
    const rows = basis === 'psc' && pscRows.length ? pscRows : naicsRows;
    if (rows.length === 0) return null;
    const total = rows.reduce((s: number, r: { amount: number }) => s + (r.amount || 0), 0);
    const topPsc = pscRows[0] ? { code: pscRows[0].code, name: pscRows[0].name || pscRows[0].code } : null;
    // When queried by a single NAICS, the matching row carries that code's Census
    // title — surfaced so callers (lead injection) can label the code, not guess.
    const leadName = basis === 'naics'
      ? (naicsRows.find((r: { code: string; name?: string }) => r.code === naics)?.name || undefined)
      : undefined;
    return { totalMarket: total, topPsc, basis, leadName };
  } catch (err) {
    if (err instanceof CoverageDeadlineError) throw err;
    if (opts.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new CoverageDeadlineError();
    }
    return null;
  }
}

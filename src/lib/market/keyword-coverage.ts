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
import { sectorSubTradeKeywords, termOfArtSynonyms, termOfArtPscCodes } from './sector-expansions';
import { isDistinctiveKeyword, keywordCandidates } from './keyword-sanitize';
import { codesForTerm } from './vocabulary';

const BASE = 'https://api.usaspending.gov/api/v2/search/spending_by_category';

// Vocabulary synonym expansion — a SMALL set of ubiquitous abbreviations/aliases
// that federal award text spells out in full, so the naics_vocabulary table keys
// them by the long form. Without this, "IT support" and "help desk" find no vocab
// row (the table has "information technology" → 541512/541519, never "it"). We
// EXPAND to the real vocab term (which then resolves to real codes) — not a
// hardcoded code map, so the lead still comes from actual buyer data. Keep this
// list tiny and only for aliases the vocab genuinely lacks; the vocab is primary.
const VOCAB_SYNONYMS: Record<string, string> = {
  'it': 'information technology',
  'it support': 'information technology',
  // Route help/service-desk to "information technology" (reaches 541512/541513/
  // 541519 — real IT service codes). NOT "technical support": that vocab term is
  // dominated by 541620 Environmental Consulting (a false friend), which would
  // mislead the lead. Verified against naics_vocabulary.
  'help desk': 'information technology',
  'helpdesk': 'information technology',
  'service desk': 'information technology',
};

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
 * A keyword whose market is THIS concentrated in a single NAICS is treated as
 * that NAICS: rank agencies by the code (authoritative spending_by_category),
 * not the keyword/PSC award text. Below this share the keyword genuinely sprawls
 * across many codes (memory: "drones" top code ~28%, $243M across 70+ codes) and
 * keyword/PSC ranking wins. Matches the 0.40 "dominant" convention already used
 * for topPscPct below.
 */
export const DOMINANT_NAICS_SHARE = 0.40;

/**
 * Single source of truth for ranking + agency discovery filters.
 * Keyword = default; add top PSC when the market concentrates on one product code.
 * NAICS is never returned here — it is eligibility-only (set-aside / pain points).
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
    // TERM-OF-ART PSC PIN (FM-10, Eric/QA 2026-07-28) — checked BEFORE the dominant-NAICS gate.
    // When the keyword is pinned to specific PSCs (EOD → 1385/1386), the market IS those PSCs; the
    // dominant NAICS is a red herring (EOD services sit under 561210 Facilities Support, whose $37.1B
    // has nothing to do with EOD tools). Force keyword_psc scope on the pinned codes so the report's
    // total + agency ranking match the (correctly PSC-pinned) market_size section instead of blowing
    // out to the facilities-support denominator.
    if (coverage.pinnedPscCodes?.length) {
      return {
        // PSC-pinned terms deliberately keep the LITERAL keyword: the pinned PSCs are
        // already the authoritative market, and re-adding synonyms re-pollutes it (the
        // EOD → ammunition-MFG case documented below).
        keywords: [coverage.keyword],
        psc_codes: coverage.pinnedPscCodes,
        mode: 'keyword_psc',
        rankingLabel: `keyword "${coverage.keyword}" + PSC ${coverage.pinnedPscCodes.join('/')} (term of art)`,
      };
    }
    // DOMINANT-NAICS GUARD (Eric, Jul 15 2026): when one NAICS is the majority of
    // the whole market, that market effectively IS that NAICS — rank by the code,
    // not the keyword. A keyword search for "commercial & institutional building
    // construction" concentrates in 236220 (~majority); ranking it by the derived
    // airfield-structures PSC / award text surfaced NASA over DOD/USACE. Returning
    // null makes the callers (target-market-research, fpds-top-n) fall through to
    // their NAICS path and rank by the derived 90%-coverage set. A cross-cutting
    // keyword like "drones" (lead code ~28% < 0.40) keeps keyword/PSC ranking.
    //
    // ⚠️ Reads leadCodePct (the SEMANTICALLY-RIGHT code's share), NOT topCodePct (the
    // biggest by $). The question this gate asks is "is the code this keyword MEANS
    // dominant?" — not "is some code dominant?". They differ when the right-lead logic
    // promotes a code: "hvac" leads 238220 Plumbing/HVAC Contractors (20.5%, the
    // specialty trade Eric wants) while 236220 General Building holds 55.6% because big
    // building contracts merely mention HVAC. Gating on the biggest would push hvac into
    // NAICS ranking led by GENERAL CONSTRUCTION — surfacing general contractors for an
    // HVAC search, the exact thing the lead promotion exists to prevent.
    // When the lead code IS the market, RANK by that code — but stay inside the
    // keyword. Returning null here used to drop the keyword constraint entirely, and
    // every section (agencies, contractors, recompetes, headline $) silently widened
    // to the WHOLE NAICS.
    //
    // Measured 2026-08-15 on "hypersonic": leadCodePct 59.8% (332993 Ammunition Mfg)
    // tripped this gate, so a $543M keyword market was reported against the full
    // 332993 + 541715 R&D universe — a $46.3B headline nobody computed, mixing in
    // unrelated R&D. The report could not be reconciled with its own supporting
    // tables because the tables answered a different question than the headline.
    //
    // Ranking basis and SCOPE are different decisions. leadCodePct decides the
    // former; it must never silently widen the latter. Same class of bug as the
    // scar below ("ignoring the return value silently dropped the keyword/PSC
    // constraint → drones once showed $2.1T").
    if (coverage.leadCodePct >= DOMINANT_NAICS_SHARE) {
      const leadCode = coverage.allNaics?.[0]?.code;
      if (!leadCode) return null; // no code to pin — callers fall through as before
      // A term-of-art market spans codes BY DEFINITION — scramjet propulsion and
      // boost-glide bodies are not bought under the ammunition code that happens to
      // dominate the literal keyword. Pinning the lead code there would AND away the
      // very expansion that finds the rest of the market (measured: pin + expansion =
      // $953M / Air Force only, vs $1.81B across Air Force / Navy / MDA / DARPA / Army
      // without the pin). So when a curated expansion exists, scope by the expanded
      // KEYWORDS and let the curated naicsCodes — not the single dominant code —
      // define the industry.
      const expanded = marketKeywords(coverage.keyword);
      if (expanded.length > 1) {
        return {
          keywords: expanded,
          mode: 'keyword',
          rankingLabel: `keyword "${coverage.keyword}" + ${expanded.length - 1} term-of-art synonyms`,
        };
      }
      return {
        keywords: expanded,
        naics_codes: [leadCode],
        mode: 'keyword_naics',
        rankingLabel: `keyword "${coverage.keyword}" in NAICS ${leadCode} (dominant code)`,
      };
    }
    const kw = coverage.keyword;
    const pscIsSpecific = Boolean(
      coverage.topPsc?.code
      && coverage.topPscPct >= 0.40
      && !isGenericPsc(coverage.topPsc.name)
      && pscLiteralProduct(kw, coverage.topPsc.name),
    );
    if (pscIsSpecific && coverage.topPsc) {
      return {
        // Literal only: a DERIVED PSC is already narrow, and widening the text against
        // it would measure a different market than the one the PSC defines.
        keywords: [kw],
        psc_codes: [coverage.topPsc.code],
        mode: 'keyword_psc',
        rankingLabel: `keyword "${kw}" + PSC ${coverage.topPsc.code} (${coverage.topPsc.name})`,
      };
    }
    // Plain keyword ranking — expand to the curated term-of-art set so the sections
    // measure the market the coverage step already discovered (drones' real market is
    // in UAS/UAV/unmanned aircraft, not the literal word).
    return {
      keywords: marketKeywords(kw),
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
  // 'keyword_naics': keyword AND code. USASpending ANDs filters, so the market stays
  // inside the keyword while ranking by the dominant code.
  if (marketFilter.naics_codes?.length) out.naics_codes = marketFilter.naics_codes;
  return out;
}

export interface KeywordCoverage {
  keyword: string;
  totalMarket: number;            // $ total across all codes that bought this
  naicsCount: number;             // distinct NAICS that bought it
  // NOTE: allNaics is NOT purely amount-sorted — the "right lead" logic promotes the
  // semantically-correct code to the head (e.g. "hvac" leads 238220 Plumbing/HVAC
  // Contractors, the specialty trade, even though 236220 General Building has more $).
  // So allNaics[0] is the LEAD, not the biggest. Read the two pcts below deliberately.
  allNaics: { code: string; name: string; amount: number; pct: number }[];
  coverageCodes: string[];        // smallest NAICS set covering ~coverageTarget (amount-ranked)
  coveragePct: number;            // what the coverageCodes actually capture (~0.9)
  /**
   * % of the market held by the single BIGGEST NAICS by dollars — the displayed
   * "the obvious code is only 28%, you'd miss the other 72%" teaching stat.
   * ⚠️ Do NOT use this for the dominant-NAICS ranking gate — use leadCodePct.
   */
  topCodePct: number;
  /**
   * % held by the LEAD code (allNaics[0] — the semantically-right code after
   * promotion). This is the ranking gate's input: "is the code this keyword actually
   * MEANS dominant enough to trust NAICS ranking?" Splitting these two fixed a real
   * bug — they were one field, so the report/banner showed "biggest code = only 0%"
   * for drones (reading the promoted 0.2% sliver 339930 instead of 336411's 28.4%).
   */
  leadCodePct: number;
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
   * disposal" → PSC 1385/1386). When present, the WHOLE report — total, agency ranking, everything —
   * must stay scoped to these PSCs, NOT fall through to the dominant NAICS. EOD services concentrate
   * under NAICS 561210 (Facilities Support Services), so the dominant-NAICS path measured all $37.1B
   * of facilities support (DOE $65.9B top buyer) instead of the ~$79M EOD-tools slice — a headline
   * and buyer list both wrong inside a payload whose market_size section was correctly $79M (FM-10,
   * Eric/QA 2026-07-28). null for ordinary keywords.
   */
  pinnedPscCodes: string[] | null;
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
// confirm screen (profile-from-text, market-overview, code suggestions), each doing
// several USASpending round-trips. Dedupe so calls 2-3 are instant and we don't
// triple the live-API flake surface during a demo. USASpending data is slow-moving,
// so a short per-instance cache is safe.
const _covCache = new Map<string, { at: number; val: KeywordCoverage | null }>();
const COV_TTL_MS = 10 * 60 * 1000;

/**
 * Resolve a keyword to its market coverage. coverageTarget = the spend fraction
 * the derived code set should capture (default 0.9 = 90%).
 */
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
  //
  // PAGINATION: spending_by_category is hard-capped at limit:100 PER PAGE. A single
  // page silently truncated the market to the top-100 codes — so a broad term like
  // "hvac" reported exactly naicsCount=100 (a fake, cap-shaped number) and undercut
  // totalMarket by dropping everything past rank 100. We now follow page_metadata
  // .hasNext up to MAX_PAGES so the count + $ are REAL, not cap-artifacts. Bounded
  // at 5 pages (500 codes) to keep cold-cache latency sane; the 10-min coverage
  // cache absorbs the extra calls. (Eric, Jul 11 2026 — "found 100 NAICS" wasn't true.)
  const MAX_COVERAGE_PAGES = 5;
  const fetchCat = async (kw: string | string[], cat: 'naics' | 'psc') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    try {
      for (let page = 1; page <= MAX_COVERAGE_PAGES; page++) {
        const res = await fetch(`${BASE}/${cat}/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: { keywords: Array.isArray(kw) ? kw : [kw], time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
            category: cat, limit: 100, page,
          }),
        });
        if (!res.ok) break;
        const j = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (j.results || []).filter((r: any) => r.code && (r.amount || 0) > 0);
        all.push(...rows);
        if (!j.page_metadata?.hasNext) break;
      }
    } catch { /* return what we have so far */ }
    return all.sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
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
    let bestDistinctive = false;
    const sumAmt = (rs: { amount: number }[]) => rs.reduce((s, r) => s + (r.amount || 0), 0);

    // PSC-PINNED terms of art (Eric, Jul 28 2026) — for a term whose KEYWORD is fundamentally polluted
    // (EOD keyword-matches the ammunition MANUFACTURERS, not the EOD-tools market), measure the market
    // by "what was BOUGHT" (the authoritative PSC codes), NOT the keyword's NAICS. We fetch the NAICS
    // breakdown WITHIN the pinned PSCs (spending_by_category/naics filtered by psc_codes) → the honest
    // market. Verified live: EOD → PSC 1385+1386 = ~$212M of real EOD equipment, vs the keyword's
    // misleading $2.81B. This SKIPS the polluted keyword-candidate loop entirely for pinned terms.
    const pinnedPsc = termOfArtPscCodes(raw);
    if (pinnedPsc) {
      const fetchByPsc = async (cat: 'naics' | 'psc') => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all: any[] = [];
        try {
          for (let page = 1; page <= MAX_COVERAGE_PAGES; page++) {
            const res = await fetch(`${BASE}/${cat}/`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filters: { psc_codes: pinnedPsc, time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
                category: cat, limit: 100, page,
              }),
            });
            if (!res.ok) break;
            const j = await res.json();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = (j.results || []).filter((x: any) => x.code && (x.amount || 0) > 0);
            all.push(...r);
            if (!j.page_metadata?.hasNext) break;
          }
        } catch { /* return what we have */ }
        return all.sort((a: { amount: number }, b: { amount: number }) => b.amount - a.amount);
      };
      const [pnNaics, pnPsc] = await Promise.all([fetchByPsc('naics'), fetchByPsc('psc')]);
      if (pnNaics.length) {
        rows = pnNaics; pscRows = pnPsc; kw = raw;
      }
      // If the pinned PSC fetch yielded nothing (rare), fall through to the keyword path below.
    }

    // Count of CONTENT words in the raw phrase. keywordCandidates() already drops
    // generic tails (STOPWORDS: "services"/"support"/…) and GEO terms when it emits
    // the single-word candidates, so the number of SINGLE-word candidates it returns
    // IS the content-word count. "demolition services" → candidates
    // ["demolition services","demolition"] → 1 content word; "market research" →
    // ["market research","market","research"] → 2. Drives the multi-word guard below.
    const rawCandidates = keywordCandidates(raw);
    const rawContentCount = rawCandidates.filter((c) => !c.includes(' ')).length;

    let bestKw = raw;
    if (rows.length === 0) for (const cand of rawCandidates) {
      const [n, p] = await Promise.all([fetchCat(cand, 'naics'), fetchCat(cand, 'psc')]);
      if (n.length === 0) continue;
      const candTotal = sumAmt(n);
      const candDistinctive = cand.includes(' ') || isDistinctiveKeyword(cand);
      // First non-empty candidate seeds the result; a later (broader) candidate
      // only wins if it captures ≥3× the market the current best does — this
      // unburies "demolition" from "demolition services" (×170 more market).
      // BUT a GENERIC word (not distinctive: "production", "management") must NOT
      // hijack a DISTINCTIVE one on size alone — "production" ($36B defense mfg)
      // was overriding "video" ($1B, the real market) and dropping the user's own
      // code (Candice / Whitty-CAP, Jul 8 2026). So the ≥3× override is only
      // allowed when the challenger is at least as distinctive as the incumbent.
      let canOverride = candTotal >= bestTotal * 3 && (candDistinctive || !bestDistinctive);
      // MINDY-005 (Eric/QA 2026-07-30) — a SINGLE component WORD must not hijack a
      // TWO-CONTENT-WORD phrase on size alone. "market research" (2 content words,
      // $913M, top 541910 Marketing Research) was overridden by the lone word
      // "market" ($15.9B — aftermarket/stock-market pollution in Software Publishers
      // + Petroleum), which then led NAICS ranking with an unrelated 424210 pharma
      // sliver. Dropping EITHER content word of a 2-word phrase changes the market,
      // so no bare word from inside it may override. "demolition services" is safe:
      // "services" is a generic tail (STOPWORD) → 1 content word → "demolition" may
      // still override. Only blocks a lone word overriding the multi-content phrase
      // it came from — a genuinely different single term is unaffected.
      if (canOverride && rawContentCount >= 2 && !cand.includes(' ') && bestKw === raw) {
        canOverride = false;
      }
      if (rows.length === 0 || canOverride) {
        rows = n; pscRows = p; kw = cand; bestTotal = candTotal; bestDistinctive = candDistinctive;
        bestKw = cand;
      }
    }
    // TERM-OF-ART expansion (Eric, Jul 28 2026 real-run feedback) — BEFORE the null-check, because
    // for an acronym term the WHOLE market may live under the synonyms (drones' real market is in
    // UAS/UAV/unmanned aircraft; the literal "drones" returned only ~$243M). OR-query the aliases and
    // MERGE both NAICS and PSC (EOD → PSC 1385 matters as much as the NAICS), deduped by code keeping
    // the larger amount. Real USASpending $, never invented — same merge shape as sub-trades below.
    // Skip the keyword-alias merge for PSC-PINNED terms — the pinned PSC path above already measured
    // the honest market; re-adding the keyword synonyms (EOD/explosive…) would re-pollute it with the
    // ammunition-MFG NAICS we deliberately excluded.
    const aliases = pinnedPsc ? null : termOfArtSynonyms(raw);
    if (aliases) {
      const [aNaics, aPsc] = await Promise.all([fetchCat(aliases, 'naics'), fetchCat(aliases, 'psc')]);
      const mergeByCode = (
        base: { code: string; name?: string; amount: number }[],
        add: { code: string; name?: string; amount: number }[],
      ) => {
        const byCode = new Map<string, { code: string; name?: string; amount: number }>();
        for (const r of [...base, ...add]) {
          const ex = byCode.get(r.code);
          if (!ex || (r.amount || 0) > (ex.amount || 0)) byCode.set(r.code, r);
        }
        return Array.from(byCode.values()).sort((a, b) => (b.amount || 0) - (a.amount || 0));
      };
      if (aNaics.length) rows = mergeByCode(rows, aNaics);
      if (aPsc.length) pscRows = mergeByCode(pscRows, aPsc);
    }

    if (rows.length === 0) return null;

    // Sector expansion (Eric, Jun 22 2026) — a literal keyword like "construction"
    // can't reach the 238xxx specialty trades (their awards say "electrical" /
    // "plumbing", not "construction"). When the term hits a broad sector, also
    // ground its sub-trade keywords and merge the NAICS in, so the auto-derived
    // coverage set includes the specialty trades. Still award-backed real $;
    // deduped by code (keep the larger amount when a code appears in both passes).
    const subTrades = pinnedPsc ? null : sectorSubTradeKeywords(raw);
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

    // LEAD PROMOTION / INJECTION (the "236220-over-238220" fix, Jul 11 2026).
    // Keyword search ranks by how AGENCIES coded their awards, which surfaces the
    // big mislabeled catch-all, not the code that literally describes the work:
    //   "landscaping" → #1 562119 "Other Waste" ($2.3B) over 561730 "Landscaping
    //                   Services" ($656M) — agencies bury grounds work under waste primes.
    //   "welding"     → #1 336611 "Ship Building" over the welding trade code.
    //   "security guard" → USASpending never floats 561612 into the head at all.
    // The naics_vocabulary table (real buyer words → code, TF-IDF ranked) is the
    // AUTHORITATIVE lead signal; USASpending stays authoritative for the dollars.
    // We (a) reorder when the right code is already in the set, and (b) INJECT it
    // (with its real award $, fetched from USASpending) when it was buried below
    // the cutoff. Title-match is the fallback for terms not yet in the vocabulary.
    //
    // sigWords: significant words in the query. A word normally dropped as generic
    // English ("support", "help", "guard") is KEPT when it's real buyer vocabulary
    // — "IT support" / "help desk" are exactly the defining words for 5415xx, so
    // pre-filtering them left the promotion block with nothing to work on (the
    // whole-industry '—' misses: it-support, security-guard). Validated against the
    // vocabulary table, not a hand-list.
    const rawWords = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length >= 2);
    // Query TERMS to look up in the vocabulary = each word PLUS each adjacent word
    // pair (bigram). Bigrams matter: the backfill stored "pest control" → 561710,
    // "grounds maintenance" → 561730, "information technology" → 541513/541512 as
    // BIGRAM rows that no single word reproduces ("control" alone is ambiguous;
    // "pest control" is not). Single-word-only lookup was the whole miss for these.
    const bigrams: string[] = [];
    for (let i = 0; i < rawWords.length - 1; i++) bigrams.push(`${rawWords[i]} ${rawWords[i + 1]}`);
    // Expand known abbreviations to their spelled-out vocab term ("it" →
    // "information technology", "help desk" → "technical support"). The expansion
    // is looked up like any other term, so its codes come from real award data.
    const synExpansions = [...bigrams, ...rawWords]
      .map((t) => VOCAB_SYNONYMS[t])
      .filter((t): t is string => Boolean(t));
    const lookupTerms = Array.from(new Set([...synExpansions, ...bigrams, ...rawWords])).slice(0, 14);
    // Vocabulary lookup per term (best-effort, one parallel pass; reused below for
    // both keeping generic-but-real words AND choosing/injecting the lead code).
    const termVocab = new Map<string, { code: string; weight: number }[]>();
    try {
      const lists = await Promise.all(lookupTerms.map((t) => codesForTerm(t, { limit: 15 })));
      lookupTerms.forEach((t, i) => termVocab.set(t, lists[i]));
    } catch { /* vocab unavailable — fall back to distinctiveness + title-match */ }
    const hasVocab = (t: string) => (termVocab.get(t)?.length ?? 0) > 0;
    // Significant words: distinctive-by-English OR real buyer vocabulary. A word
    // dropped as generic English ("support", "guard") is KEPT when the vocab knows
    // it, so "IT support" / "security guard" aren't left with nothing to match.
    const sigWords = rawWords.filter(
      (w) => (w.length >= 4 && isDistinctiveKeyword(w)) || hasVocab(w),
    );
    const titleMatches = (name: string | undefined) => {
      const n = (name || '').toLowerCase();
      return sigWords.some((w) => w.length >= 4 && n.includes(w));
    };
    // Skip vocab lead-promotion for a PSC-PINNED term — its NAICS set came from the authoritative PSC
    // ("what was bought"), so re-ranking/injecting by the polluted keyword would undo the pin.
    if (!pinnedPsc && rows.length > 0 && (sigWords.length || bigrams.some(hasVocab) || synExpansions.some(hasVocab))) {
      // AGGREGATE vocab weight per code across ALL terms, bigrams weighted higher
      // (2×) — they're the specific signal. A code that several query terms agree on
      // rises above a single word's misleading top hit: "welding" alone points at
      // 333992 (welding-MACHINERY mfg), but "fabrication" + "metal" reinforce 332710
      // (the machine-shop TRADE code), which is the right lead. This is the fix for
      // the weight-of-one-word class (welding/metal) — real data, cross-confirmed.
      const codeScore = new Map<string, number>();
      // Track WHICH terms scored each code + whether any was a specific (multi-word /
      // bigram / alias) signal. A code surfaced ONLY by a single lone word is weakly
      // grounded — that lone word may be ambiguous (MINDY-005: the bare word "market"
      // maps to 424210 pharma in the vocabulary, so "market research" wrongly certified
      // pharma as the right lead). Corroboration = a bigram/alias hit OR ≥2 distinct
      // query words agreeing on the code.
      const codeTerms = new Map<string, Set<string>>();
      const codeSpecific = new Set<string>();
      const scoreTerm = (t: string, mult: number) => {
        const specific = mult >= 2; // synExpansions + bigrams pass mult=2
        for (const c of termVocab.get(t) || []) {
          codeScore.set(c.code, (codeScore.get(c.code) || 0) + c.weight * mult);
          if (!codeTerms.has(c.code)) codeTerms.set(c.code, new Set());
          codeTerms.get(c.code)!.add(t);
          if (specific) codeSpecific.add(c.code);
        }
      };
      for (const s of synExpansions) scoreTerm(s, 2); // alias expansions = specific
      for (const b of bigrams) scoreTerm(b, 2);
      for (const w of sigWords) scoreTerm(w, 1);
      const vocabRanked = Array.from(codeScore.entries())
        .map(([code, score]) => ({ code, score }))
        .sort((a, b) => b.score - a.score);
      const vocabCodes = new Set(vocabRanked.map((c) => c.code));
      // Corroboration ONLY matters for a MULTI-content-word query. For a single-word
      // query ("hvac") the lone word IS the query, so its dominant vocab hit (238220)
      // is exactly what the user asked — trust it. Only when the query has ≥2 content
      // words ("market research") is a code surfaced by just ONE of those words weakly
      // grounded: that word may be the ambiguous fragment ("market" → 424210 pharma).
      // Then require a specific (bigram/alias) hit OR ≥2 distinct query words agreeing.
      // (MINDY-005, Eric/QA 2026-07-30.)
      const needsCorroboration = rawContentCount >= 2;
      const corroborated = (code: string) =>
        !needsCorroboration ||
        codeSpecific.has(code) ||
        (codeTerms.get(code)?.size ?? 0) >= 2;
      const isRightLead = (r: { code: string; name?: string }) =>
        (vocabCodes.has(r.code) && (corroborated(r.code) || titleMatches(r.name))) ||
        titleMatches(r.name);

      // Only CORROBORATED vocab codes may drive promotion/injection (MINDY-005) —
      // a lone ambiguous word ("market" → 424210 pharma) must not lead. A code still
      // qualifies if its title matches a query word even without corroboration.
      const promotable = (code: string, name?: string) =>
        corroborated(code) || titleMatches(name);

      if (rows.length > 1 && !isRightLead(rows[0])) {
        // (a) Reorder: the right code is already in the set, just not at the head.
        // Prefer the HIGHEST-scoring PROMOTABLE vocab code that's present.
        let idx = -1;
        for (const v of vocabRanked) {
          if (!promotable(v.code, rows.find((r) => r.code === v.code)?.name)) continue;
          const i = rows.findIndex((r) => r.code === v.code);
          if (i > 0) { idx = i; break; }
          if (i === 0) { idx = 0; break; } // already lead → stop, nothing to do
        }
        if (idx < 0) idx = rows.findIndex((r) => titleMatches(r.name));
        if (idx > 0) {
          const [promoted] = rows.splice(idx, 1);
          rows.unshift(promoted);
        }
      }

      // (b) Inject: the vocab's top code isn't in the set at all (USASpending buried
      // it below the keyword-ranking cutoff — e.g. "security guard" never floats
      // 561612 into the head). Pull that code's REAL award $ by querying its NAICS
      // directly, and lead with it. Both the code (vocabulary) and its dollars
      // (USASpending) are real — nothing fabricated. Single best PROMOTABLE vocab
      // code only (skip an uncorroborated lone-word hit — MINDY-005).
      const topVocab = vocabRanked.find((v) => promotable(v.code))?.code;
      if (topVocab && !rows.some((r) => r.code === topVocab)) {
        try {
          const sized = await codeMarketSize({ naics: topVocab });
          const amount = sized?.totalMarket || 0;
          if (amount > 0) {
            // codeMarketSize's NAICS query returns the code's own Census name as
            // the first row — carry it so the lead card reads a real title, not a code.
            rows.unshift({ code: topVocab, name: sized?.leadName || topVocab, amount });
          }
        } catch { /* injection is best-effort; the set without it is still valid */ }
      }
    }

    const total = rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allNaics = rows.map((r: any) => ({ code: r.code, name: r.name || r.code, amount: r.amount, pct: r.amount / total }));

    // SMALLEST code set that captures coverageTarget of the spend — so it must walk
    // the codes by DOLLARS, not by allNaics' display order (whose head is the promoted
    // semantic lead, not the biggest). Walking display order spent a slot on a 0.2%
    // sliver for "drones" and needed 10 codes where 9 reach 90%.
    const byAmount = [...allNaics].sort((a, b) => b.amount - a.amount);
    const coverageCodes: string[] = [];
    let cum = 0;
    for (const r of byAmount) {
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
      // Biggest by DOLLARS (the displayed stat) vs the promoted LEAD (the gate's input).
      topCodePct: byAmount[0]?.pct ?? 0,
      leadCodePct: allNaics[0].pct,
      pscCount: pscRows.length,
      topPsc,
      topPscPct: pscTotal > 0 && pscRows[0] ? pscRows[0].amount / pscTotal : 0,
      topPscList,
      pinnedPscCodes: pinnedPsc ?? null,
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
}): Promise<{ totalMarket: number; topPsc: { code: string; name: string } | null; basis: 'psc' | 'naics'; leadName?: string } | null> {
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
    // When queried by a single NAICS, the matching row carries that code's Census
    // title — surfaced so callers (lead injection) can label the code, not guess.
    const leadName = basis === 'naics'
      ? (naicsRows.find((r: { code: string; name?: string }) => r.code === naics)?.name || undefined)
      : undefined;
    return { totalMarket: total, topPsc, basis, leadName };
  } catch {
    return null;
  }
}

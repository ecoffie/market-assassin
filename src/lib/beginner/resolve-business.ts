/**
 * Input translation: plain-English business description → existing tool params.
 *
 * Contract mismatch vs the original spec: `derive_company_keywords` returns
 * KEYWORD PHRASES, not NAICS/PSC. Codes come from `get_keyword_coverage` after
 * a keyword is chosen (same composition as MRR section 5). Beginners have no
 * KO-supplied keyword, so we take the first derived phrase that coverage can
 * ground. USASpending coverage is exact-phrase — the chosen phrase is recorded.
 *
 * SAM search is keyword-first. We do NOT AND `naics` into
 * search_sam_opportunities: that tool's naics filter is exact-match and would
 * starve beginner recall. Resolved NAICS/PSC stay on the resolution object
 * for provenance / Fix #2.
 *
 * A failed tool never becomes `[]` / `0` via `??`.
 */

import { distinctiveKeywords, isDistinctiveKeyword, keywordCandidates } from '@/lib/market/keyword-sanitize';
import { deriveCompanyKeywords, type CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import { getKeywordCoverage, type KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';
import { dedupeStrings } from './labels';
import {
  FOLLOW_UP_PROMPT,
  type KnownList,
  type ResolvedBusiness,
  type ResolvedPsc,
} from './types';

export const BEGINNER_KEYWORD_RULE =
  "Use the first distinctive coverage candidate that get_keyword_coverage grounds with a usable (not diffuse) NAICS set. First-person sentences and generic singles are skipped. If derivation or coverage cannot establish codes, search a distinctive user phrase and label the results 'Based on your description'. The selected coverage phrase is recorded because USASpending is exact-phrase.";

/** Coverage with this many NAICS is a phrase that matched the whole federal catalog, not a market. */
export const DIFFUSE_COVERAGE_NAICS = 400;

function gerund(word: string): string | null {
  const w = word.toLowerCase().trim();
  if (w.length < 4 || w.length > 8) return null;
  if (!isDistinctiveKeyword(w)) return null;
  if (w.endsWith('ing') || w.endsWith('ed') || w.endsWith('s') || w.endsWith('e')) return null;
  return `${w}ing`;
}

function isFirstPersonSentence(phrase: string): boolean {
  return /^(i|we|my|our)\b/i.test(phrase.trim());
}

/** Exported for tests — the phrases we actually send to get_keyword_coverage. */
export function beginnerCoverageCandidates(text: string, derived: readonly string[]): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const gerunds = words.map(gerund).filter((g): g is string => !!g);
  const derivedDistinct = distinctiveKeywords([...derived]).filter((k) => !isFirstPersonSentence(k));
  const fromText = keywordCandidates(text).filter((k) => !isFirstPersonSentence(k));
  return dedupeStrings([...gerunds, ...derivedDistinct, ...fromText]);
}

export interface ResolveBusinessInput {
  description: string;
  /** Answer to FOLLOW_UP_PROMPT. Presence means this is the retry. */
  followUp?: string;
}

export interface ResolveBusinessDeps {
  deriveKeywords: (input: { description: string; limit?: number }) => Promise<CompanyKeywordsToolResult>;
  getCoverage: (input: { keyword: string }) => Promise<KeywordCoverageToolResult>;
}

const defaultDeps: ResolveBusinessDeps = {
  deriveKeywords: (input) => deriveCompanyKeywords(input),
  getCoverage: (input) => getKeywordCoverage(input),
};

function known<T>(items: T[]): KnownList<T> {
  return { status: 'known', items };
}
function unknownList<T>(reason: string): KnownList<T> {
  return { status: 'unknown', reason };
}

function base(original: string, followUpUsed: string | null): Omit<ResolvedBusiness, 'state' | 'searchKeyword' | 'contextLabel' | 'keywords' | 'naicsCodes' | 'primaryNaics' | 'psc' | 'coverageKeyword' | 'confidence' | 'followUpPrompt'> {
  return { original, followUpUsed, provenance: {} };
}

export async function resolveBusiness(
  input: ResolveBusinessInput,
  deps: Partial<ResolveBusinessDeps> = {},
): Promise<ResolvedBusiness> {
  const derive = deps.deriveKeywords ?? defaultDeps.deriveKeywords;
  const coverageFn = deps.getCoverage ?? defaultDeps.getCoverage;
  const original = (input.description || '').trim();
  const followUpUsed = input.followUp?.trim() ? input.followUp.trim() : null;
  const combined = followUpUsed ? `${original}\n${followUpUsed}`.trim() : original;
  const seed = base(original, followUpUsed);

  if (!combined) {
    return {
      ...seed,
      state: 'need_followup',
      searchKeyword: null,
      contextLabel: null,
      keywords: known([]),
      naicsCodes: known([]),
      primaryNaics: null,
      psc: null,
      coverageKeyword: null,
      confidence: 'none',
      followUpPrompt: FOLLOW_UP_PROMPT,
    };
  }

  let deriveResult: CompanyKeywordsToolResult;
  try {
    deriveResult = await derive({ description: combined, limit: 12 });
  } catch (err) {
    return {
      ...seed,
      state: 'unavailable',
      searchKeyword: null,
      contextLabel: null,
      keywords: unknownList(err instanceof Error ? err.message : 'derive_company_keywords threw'),
      naicsCodes: unknownList('not attempted — keyword derivation unavailable'),
      primaryNaics: null,
      psc: null,
      coverageKeyword: null,
      confidence: 'none',
      followUpPrompt: null,
      provenance: { derive: { error: err instanceof Error ? err.message : String(err) } },
    };
  }

  seed.provenance = { ...seed.provenance, derive: deriveResult };

  if (deriveResult._meta.degraded) {
    return {
      ...seed,
      state: 'unavailable',
      searchKeyword: null,
      contextLabel: null,
      keywords: unknownList('derive_company_keywords degraded'),
      naicsCodes: unknownList('not attempted — keyword derivation degraded'),
      primaryNaics: null,
      psc: null,
      coverageKeyword: null,
      confidence: 'none',
      followUpPrompt: null,
    };
  }

  const derivedKeywords = deriveResult._meta.grounded
    ? dedupeStrings(deriveResult.keywords)
    : deriveResult.keywords; // grounded false → established empty, not unknown

  if (!deriveResult._meta.grounded || derivedKeywords.length === 0) {
    if (!followUpUsed) {
      return {
        ...seed,
        state: 'need_followup',
        searchKeyword: null,
        contextLabel: null,
        keywords: known([]),
        naicsCodes: known([]),
        primaryNaics: null,
        psc: null,
        coverageKeyword: null,
        confidence: 'none',
        followUpPrompt: FOLLOW_UP_PROMPT,
      };
    }
    return {
      ...seed,
      state: 'keyword_fallback',
      searchKeyword: combined,
      contextLabel: 'Based on your description',
      keywords: known([]),
      naicsCodes: known([]),
      primaryNaics: null,
      psc: null,
      coverageKeyword: null,
      confidence: 'low',
      followUpPrompt: null,
    };
  }

  const keywords = known(derivedKeywords);
  const candidates = beginnerCoverageCandidates(combined, derivedKeywords);
  const fallbackSearch = candidates[0] ?? derivedKeywords[0] ?? combined;

  let coverageResult: KeywordCoverageToolResult | undefined;
  let coverageKeyword: string | null = null;
  let coverageDegraded = false;
  for (const phrase of candidates.slice(0, 5)) {
    try {
      coverageResult = await coverageFn({ keyword: phrase });
    } catch (err) {
      coverageDegraded = true;
      seed.provenance = {
        ...seed.provenance,
        coverage: { error: err instanceof Error ? err.message : String(err), keyword: phrase },
      };
      break;
    }
    seed.provenance = { ...seed.provenance, coverage: coverageResult };
    if (coverageResult._meta.degraded) {
      coverageDegraded = true;
      break;
    }
    if (!coverageResult._meta.grounded || !coverageResult.coverage) continue;
    // Diffuse exact-phrase hits (500 NAICS for "clean office buildings") are not a market.
    if (coverageResult.coverage.naicsCount >= DIFFUSE_COVERAGE_NAICS) continue;
    coverageKeyword = phrase;
    break;
  }

  if (coverageDegraded) {
    // Coverage down ≠ "couldn't classify" for search purposes — we still have
    // keywords. Do not pretend NAICS succeeded.
    return {
      ...seed,
      state: 'keyword_fallback',
      searchKeyword: fallbackSearch,
      contextLabel: 'Based on your description',
      keywords,
      naicsCodes: unknownList('get_keyword_coverage degraded'),
      primaryNaics: null,
      psc: null,
      coverageKeyword: null,
      confidence: 'low',
      followUpPrompt: null,
    };
  }

  if (coverageKeyword && coverageResult?.coverage) {
    const cov = coverageResult.coverage;
    const naics = dedupeStrings(cov.coverageCodes.length ? cov.coverageCodes : cov.allNaics.map((n) => n.code));
    const primary = cov.allNaics[0]?.code ?? naics[0] ?? null;
    let psc: ResolvedPsc | null = null;
    if (cov.topPsc?.code && cov.topPsc.name && cov.topPsc.name.trim()) {
      psc = { code: cov.topPsc.code, name: cov.topPsc.name.trim() };
    }
    return {
      ...seed,
      state: 'structured',
      searchKeyword: coverageKeyword,
      contextLabel: null,
      keywords,
      naicsCodes: known(naics),
      primaryNaics: primary,
      psc,
      coverageKeyword,
      confidence: 'high',
      followUpPrompt: null,
    };
  }

  // Keywords exist; coverage found no usable market. Search a distinctive phrase,
  // honestly labeled — do not invent NAICS.
  return {
    ...seed,
    state: 'keyword_fallback',
    searchKeyword: fallbackSearch,
    contextLabel: 'Based on your description',
    keywords,
    naicsCodes: known([]),
    primaryNaics: null,
    psc: null,
    coverageKeyword: null,
    confidence: 'low',
    followUpPrompt: null,
  };
}

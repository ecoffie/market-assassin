/**
 * MCP tool: derive_company_keywords — turn a company's OWN words (what they do, past
 * performance) into the search keywords buyers actually use, ranked BY MEANING. The
 * point (Eric): NAICS is the wrong discovery key; a company's real vocabulary — pulled
 * from its scope descriptions + capabilities — finds the market its codes miss.
 *
 * Ask Mindy R6 (2026-11): keywords used to be n-grams of the INPUT ranked against the same
 * input, so the company name and the city won ("superb staffing", "memphis") and the job
 * titles a staffing buyer writes could never appear. Now (MCP/chat dispatch,
 * include_market_terms=true):
 *   - place names and distinctive brand tokens are removed before candidates are cut;
 *   - candidates also come from grounded sources: naics_vocabulary for the given/inferred
 *     NAICS, GSA CALC+ awarded labor-category titles, and occupational phrases in real SAM
 *     solicitation text; every keyword carries keyword_sources naming where it came from.
 * Direct library callers (capability_market_match, the beginner resolver) keep the
 * input-only path unless they opt in, so their outputs do not shift under them.
 *
 * grounded=false = not enough input text — do NOT invent keywords. tier: metered, credits: 5.
 * `_meta` always ships; `_ai_hint` OFF by default.
 */
import { createClient } from '@supabase/supabase-js';
import { deriveSemanticKeywords, candidatePhrases, STOP } from '@/lib/market/semantic-keywords';
import { embedTexts, cosineSimilarity } from '@/lib/market/embeddings';
import { codesForTerm, getVocabulary, type VocabTerm } from '@/lib/market/vocabulary';
import { withCache } from '@/lib/mcp/external-cache';
import { mcpFlags } from '@/lib/mcp/flags';
import naicsData from '@/data/naics-codes.json';
import {
  dedupeTitles,
  detectLocations,
  roundRobinBySegment,
  cleanInputText,
  distinctiveBrandTokens,
  containsBlockedToken,
  mergeCalcTitles,
  extractOccupations,
  interleave,
  type KeywordSource,
  type CalcTitleCount,
  type LocationMatch,
} from '@/lib/market/company-keyword-sources';

const NAICS_TITLES = (naicsData as { codes: Record<string, { title: string }> }).codes;

export interface CompanyKeywordsToolInput {
  /** What the company does — one-liner / elevator pitch / capability summary. */
  description?: string;
  /** Past-performance scope descriptions (the richest signal — what they've actually done). */
  past_performance?: string[];
  /** Capability statements / service descriptions. */
  capabilities?: string[];
  /** NAICS/PSC title text the caller already knows (optional enrichment). */
  code_titles?: string[];
  /** Max keywords (default 12, max 25). */
  limit?: number;
  /**
   * MINDY-004: the subject's OWN company name / brand / proper nouns. Each phrase is removed
   * from the input before keywords are cut from it, and any brand token that is distinctive
   * to the brand (not used elsewhere in the input, not a market term) is kept out of every
   * keyword. "Superb Staffing" strips "superb" and keeps "staffing".
   */
  brand_exclude?: string[];
  /** NAICS codes to draw market vocabulary / solicitation text from. Inferred when omitted. */
  naics?: string[];
  /**
   * Add grounded market terms (naics_vocabulary, GSA CALC labor categories, SAM solicitation
   * text) to the candidates the input text yields. Defaults to FALSE for direct library
   * callers; the MCP/chat tool dispatch defaults it to TRUE.
   */
  include_market_terms?: boolean;
}

export interface KeywordWithSource {
  keyword: string;
  kind: 'capability' | 'occupation';
  sources: KeywordSource[];
  /** Cosine similarity to the cleaned company description (absent on the lexical fallback). */
  relevance?: number;
}

export interface CompanyKeywordsToolResult {
  keywords: string[];
  /** One entry per keyword, same order: where each keyword came from. Additive. */
  keyword_sources?: KeywordWithSource[];
  /** Ranked job titles buyers price and staff (CALC labor categories + solicitation text). Additive. */
  occupational_titles?: KeywordWithSource[];
  /** What was kept OUT of every keyword, so the caller can see it was deliberate. Additive. */
  excluded_terms?: { locations: string[]; brand: string[] };
  /** NAICS used for market sources, and how each was chosen. Additive. */
  naics_used?: Array<{ code: string; title: string | null; via: string }>;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    ranked: boolean; // true = semantically ranked; false = lexical fallback (embeddings unavailable)
    keyword_count: number;
    input_chars: number;
    /** Per-source outcome: ok / none (ran, nothing) / error (source failed — NOT none) / skipped. */
    source_status?: Record<string, 'ok' | 'none' | 'error' | 'skipped'>;
  };
}

/** Injectable data access (tests pass fakes; production uses the live sources). */
export interface CompanyKeywordsDeps {
  embed: (texts: string[]) => Promise<number[][]>;
  codesForTerm: (term: string) => Promise<{ code: string; weight: number }[]>;
  getVocabulary: (code: string) => Promise<VocabTerm[]>;
  /** null = the source errored (distinct from [] = ran, nothing found). */
  calcTitles: (term: string) => Promise<CalcTitleCount[] | null>;
  /** null = the source errored. */
  solicitationTexts: (codes: string[], terms: string[]) => Promise<Array<{ id: string; text: string }> | null>;
}

const CALC_API = 'https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/';

async function liveCalcTitles(term: string): Promise<CalcTitleCount[] | null> {
  try {
    const { value } = await withCache<CalcTitleCount[]>('calc:labor_titles', { term }, 12 * 60 * 60, async () => {
      const url = `${CALC_API}?keyword=${encodeURIComponent(term)}&page_size=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`CALC+ ${res.status}`);
      const j = await res.json();
      return mergeCalcTitles(j?.aggregations?.labor_category?.buckets ?? []);
    });
    return value;
  } catch (e) {
    console.error('[derive_company_keywords] CALC titles failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function liveSolicitationTexts(codes: string[], terms: string[]): Promise<Array<{ id: string; text: string }> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const safe = terms.map((t) => t.replace(/[^a-z]/gi, '')).filter((t) => t.length >= 4);
  if (!codes.length || !safe.length) return [];
  try {
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from('sam_opportunities')
      .select('notice_id, sow_text, description')
      .in('naics_code', codes)
      .or(safe.map((t) => `sow_text.ilike.%${t}%`).join(','))
      .limit(60);
    if (error) throw new Error(error.message);
    return ((data || []) as Array<{ notice_id: string; sow_text: string | null; description: string | null }>).map((r) => ({
      id: r.notice_id,
      text: `${(r.sow_text || '').slice(0, 200_000)} ${r.description || ''}`,
    }));
  } catch (e) {
    console.error('[derive_company_keywords] solicitation text failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

const defaultDeps: CompanyKeywordsDeps = {
  embed: embedTexts,
  codesForTerm: (t) => codesForTerm(t, { limit: 3 }),
  getVocabulary: (c) => getVocabulary(c, { limit: 40 }),
  calcTitles: liveCalcTitles,
  solicitationTexts: liveSolicitationTexts,
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function deriveCompanyKeywords(
  input: CompanyKeywordsToolInput,
  depsOverride: Partial<CompanyKeywordsDeps> = {},
): Promise<CompanyKeywordsToolResult> {
  const deps: CompanyKeywordsDeps = { ...defaultDeps, ...depsOverride };
  const description = (input.description || '').trim();
  const pastPerf = (input.past_performance || []).filter((s) => typeof s === 'string' && s.trim());
  const capabilities = (input.capabilities || []).filter((s) => typeof s === 'string' && s.trim());
  const codeTitles = (input.code_titles || []).filter((s) => typeof s === 'string' && s.trim());
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 25);
  const brandPhrases = (input.brand_exclude || []).map((b) => String(b || '').trim()).filter((b) => b.length >= 2);

  const inputChars =
    description.length + pastPerf.join(' ').length + capabilities.join(' ').length + codeTitles.join(' ').length;

  if (inputChars < 12) {
    return {
      keywords: [],
      _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: inputChars },
    };
  }

  // 1. Remove places and brand phrases from the input BEFORE cutting candidates from it.
  const allLocs: LocationMatch[] = [];
  const clean = (t: string) => {
    const locs = detectLocations(t);
    allLocs.push(...locs);
    return cleanInputText(t, brandPhrases, locs);
  };
  const cDescription = description ? clean(description) : '';
  const cPast = pastPerf.map(clean);
  const cCaps = capabilities.map(clean);
  const cTitles = codeTitles.map((t) => cleanInputText(t, brandPhrases, []));
  const cleanedBlob = [cDescription, ...cCaps, ...cTitles, ...cPast].filter(Boolean).join('. ');
  const locationNames = [...new Set(allLocs.map((l) => l.place))];
  const locTokens = new Set(locationNames.filter((p) => !p.includes(' ')));
  const locPhrases = locationNames.filter((p) => p.includes(' '));
  const blockedByLocation = (k: string) =>
    containsBlockedToken(k, locTokens) || locPhrases.some((p) => new RegExp(`\\b${escapeRe(p)}\\b`, 'i').test(k));

  // ── Input-only path (direct library callers): previous behaviour on the cleaned text. ──
  if (!input.include_market_terms) {
    let keywords: string[] = [];
    let degraded = false;
    try {
      keywords = await deriveSemanticKeywords(
        {
          oneLiner: cDescription || null,
          capabilities: cCaps,
          scopeDescriptions: cPast,
          naicsDescriptions: cTitles,
          meaningText: cDescription || undefined,
        },
        limit,
        0.6, // trim the off-topic tail
      );
    } catch (e) {
      degraded = true;
      console.error('[derive_company_keywords] failed:', e instanceof Error ? e.message : String(e));
    }
    const brandBlock = distinctiveBrandTokens(brandPhrases, cleanedBlob, new Set());
    keywords = keywords
      .map((k) => k.split(/\s+/).filter((w) => !brandBlock.has(w.toLowerCase())).join(' ').trim())
      .filter((k) => k.length >= 3 && !blockedByLocation(k))
      .filter((k, i, arr) => arr.indexOf(k) === i);
    return finish({
      keywords,
      keyword_sources: keywords.map((k) => ({ keyword: k, kind: 'capability', sources: [{ type: 'input_text', detail: 'your description' }] })),
      excluded_terms: { locations: locationNames, brand: [...brandBlock] },
      _meta: { grounded: keywords.length > 0, degraded, ranked: !degraded, keyword_count: keywords.length, input_chars: inputChars },
    });
  }

  // ── Grounded path ──────────────────────────────────────────────────────────────
  const status: Record<string, 'ok' | 'none' | 'error' | 'skipped'> = {
    naics_inference: 'skipped', market_vocabulary: 'skipped', calc_labor_category: 'skipped', solicitation_text: 'skipped',
  };
  const meaningText = cDescription || cleanedBlob;

  // Capability words of the cleaned input: what the external sources are queried with.
  const capWords = [...new Set(cleanedBlob.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/))]
    .filter((w) => w.length >= 4 && !STOP.has(w) && !locTokens.has(w))
    .slice(0, 6);

  // 2. NAICS: the caller's codes, else inferred from the capability words via naics_vocabulary.
  let naicsUsed: Array<{ code: string; title: string | null; via: string }> = [];
  const callerCodes = (input.naics || []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)).slice(0, 4);
  if (callerCodes.length) {
    naicsUsed = callerCodes.map((c) => ({ code: c, title: NAICS_TITLES[c]?.title ?? null, via: 'caller' }));
  } else if (capWords.length) {
    try {
      const best = new Map<string, { weight: number; via: string }>();
      const per = await Promise.all(capWords.map(async (w) => ({ w, codes: await deps.codesForTerm(w) })));
      for (const { w, codes } of per) {
        const top = codes[0];
        if (!top) continue;
        const ex = best.get(top.code);
        if (!ex || top.weight > ex.weight) best.set(top.code, { weight: top.weight, via: `naics_vocabulary top code for "${w}"` });
      }
      let inferred = [...best.entries()].map(([code, v]) => ({ code, title: NAICS_TITLES[code]?.title ?? null, ...v, sim: 0 }));
      // Keep only codes whose title means what the company does: a capability word can be
      // the top term of an unrelated code ("industrial" leads 325320 pesticide manufacturing).
      if (inferred.length > 1) {
        try {
          const vecs = await deps.embed([meaningText, ...inferred.map((c) => c.title || c.code)]);
          inferred = inferred.map((c, i) => ({ ...c, sim: cosineSimilarity(vecs[0], vecs[i + 1]) }));
          const top = Math.max(...inferred.map((c) => c.sim));
          inferred = inferred.filter((c) => c.sim >= top * 0.8).sort((a, b) => b.sim - a.sim);
        } catch {
          inferred.sort((a, b) => b.weight - a.weight);
        }
      }
      naicsUsed = inferred.slice(0, 3).map((c) => ({ code: c.code, title: c.title, via: c.via }));
      status.naics_inference = naicsUsed.length ? 'ok' : 'none';
    } catch {
      status.naics_inference = 'error';
    }
  }
  const codes = naicsUsed.map((n) => n.code);

  // 3. External sources in parallel.
  const [vocabRes, calcRes, solRes] = await Promise.all([
    codes.length
      ? Promise.all(codes.map(async (c) => ({ c, terms: await deps.getVocabulary(c).catch(() => null) })))
      : Promise.resolve(null),
    capWords.length
      ? Promise.all(capWords.slice(0, 5).map(async (w) => ({ w, titles: await deps.calcTitles(w) })))
      : Promise.resolve(null),
    codes.length && capWords.length ? deps.solicitationTexts(codes, capWords) : Promise.resolve(undefined),
  ]);

  type Cand = { kind: 'capability' | 'occupation'; sources: KeywordSource[] };
  const cands = new Map<string, Cand>();
  const addCand = (kw: string, kind: Cand['kind'], src: KeywordSource) => {
    const k = kw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (k.length < 3) return;
    const ex = cands.get(k);
    if (ex) {
      if (kind === 'occupation') ex.kind = 'occupation';
      if (!ex.sources.some((s) => s.type === src.type && s.detail === src.detail)) ex.sources.push(src);
    } else cands.set(k, { kind, sources: [src] });
  };

  for (const p of candidatePhrases(cleanedBlob).filter((c) => c.length >= 4).slice(0, 60)) {
    addCand(p, 'capability', { type: 'input_text', detail: 'your description' });
  }
  if (vocabRes) {
    let any = false;
    let err = false;
    for (const { c, terms } of vocabRes) {
      if (terms === null) { err = true; continue; }
      for (const t of terms.slice(0, 30)) {
        any = true;
        addCand(t.term, 'capability', { type: 'market_vocabulary', detail: `naics_vocabulary ${c} (award descriptions)`, n: t.df });
      }
    }
    status.market_vocabulary = any ? 'ok' : err ? 'error' : 'none';
  }
  if (calcRes) {
    let any = false;
    let err = false;
    for (const { w, titles } of calcRes) {
      if (titles === null) { err = true; continue; }
      for (const t of titles.slice(0, 15)) {
        any = true;
        addCand(t.title, 'occupation', { type: 'calc_labor_category', detail: `GSA CALC+ labor categories matching "${w}"`, n: t.n });
      }
    }
    status.calc_labor_category = any ? 'ok' : err ? 'error' : 'none';
  }
  if (solRes !== undefined) {
    if (solRes === null) status.solicitation_text = 'error';
    else {
      // Read only notices about the same work: at least two of the capability words (one when
      // there is only one). A clinical-staffing SOW matches "staffing" alone and would bring
      // nurse/cook titles to a warehouse staffing firm.
      const need = Math.min(2, capWords.length);
      const onTopic = solRes.filter((r) => {
        const t = r.text.toLowerCase();
        return capWords.filter((w) => new RegExp(`\\b${escapeRe(w)}`).test(t)).length >= need;
      });
      const occ = extractOccupations(onTopic, 2).slice(0, 30);
      for (const o of occ) {
        addCand(o.phrase, 'occupation', {
          type: 'solicitation_text',
          detail: `SAM solicitation text, NAICS ${codes.join('/')} (${onTopic.length} on-topic notices read)`,
          n: o.notices,
        });
      }
      status.solicitation_text = occ.length ? 'ok' : 'none';
    }
  }

  // A solicitation-only 3-word title whose last two words are also a candidate is the same job
  // with a stray leading word ("leadership warehouse supervisor", "personnel forklift driver").
  for (const [k, c] of [...cands]) {
    const w = k.split(' ');
    if (c.kind === 'occupation' && w.length === 3 && c.sources.every((x) => x.type === 'solicitation_text') && cands.has(w.slice(1).join(' '))) {
      cands.delete(k);
    }
  }

  // 4. Block places and distinctive brand tokens from every candidate, whatever its source.
  const externalTokens = new Set<string>();
  for (const [k, c] of cands) {
    if (c.sources.some((s) => s.type !== 'input_text')) for (const t of k.split(/[^a-z0-9]+/)) if (t) externalTokens.add(t);
  }
  const brandBlock = distinctiveBrandTokens(brandPhrases, cleanedBlob, externalTokens);
  for (const k of [...cands.keys()]) {
    if (blockedByLocation(k) || containsBlockedToken(k, brandBlock)) cands.delete(k);
  }

  // 5. Rank each kind by meaning; a relative cutoff trims the off-topic tail.
  const keys = [...cands.keys()];
  const scores = new Map<string, number>();
  const vecByKey = new Map<string, number[]>();
  let ranked = true;
  try {
    if (keys.length) {
      const vecs = await deps.embed([meaningText, ...keys]);
      keys.forEach((k, i) => {
        vecByKey.set(k, vecs[i + 1]);
        scores.set(k, cosineSimilarity(vecs[0], vecs[i + 1]));
      });
    }
  } catch (e) {
    ranked = false;
    console.error('[derive_company_keywords] ranking failed:', e instanceof Error ? e.message : String(e));
  }
  const rankKind = (kind: Cand['kind'], cut: number) => {
    const list = keys.filter((k) => cands.get(k)!.kind === kind);
    if (!ranked) {
      // Lexical fallback: input phrases first (insertion order), external terms by their own count.
      const n = (k: string) => Math.max(0, ...cands.get(k)!.sources.map((s) => s.n ?? 0));
      return list.sort((a, b) => n(a) === 0 && n(b) === 0 ? 0 : n(b) - n(a));
    }
    const sorted = list.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
    const top = scores.get(sorted[0]) ?? 0;
    return sorted.filter((k) => (scores.get(k) ?? 0) >= top * cut);
  };
  const capRanked = rankKind('capability', 0.6);

  // Occupations are ranked against the company's SEGMENTS, not the whole description: a
  // job title is short, and its similarity to a long sentence is dominated by shared words
  // ("staffing specialist" beat "forklift operator" for a staffing firm). Each segment is a
  // capability phrase from the input ("light industrial", "clerical", "warehouse"), phrased
  // as "jobs in <segment>"; an occupation scores its best segment match, plus a lift when the
  // buyer's own solicitation text attests it. The final order round-robins across segments so
  // one segment (clerical has dozens of CALC variants) cannot fill every slot.
  let occRanked: string[];
  const occKeys = keys.filter((k) => cands.get(k)!.kind === 'occupation');
  const segOf = new Map<string, number>();
  const segments = capRanked.filter((k) => cands.get(k)!.sources.some((s) => s.type === 'input_text')).slice(0, 8);
  if (ranked && segments.length && occKeys.length) {
    try {
      const segVecs = await deps.embed(segments.map((g) => `jobs in ${g}`));
      for (const k of occKeys) {
        const v = vecByKey.get(k)!;
        const sims = segVecs.map((sv) => cosineSimilarity(sv, v));
        const best = Math.max(...sims);
        segOf.set(k, sims.indexOf(best));
        // Solicitation text is the buyer's own wording; CALC is the vendor rate card. A title
        // the buyer writes gets a small lift, and one both sources attest a little more.
        const types = new Set(cands.get(k)!.sources.map((s) => s.type));
        scores.set(k, best + (types.has('solicitation_text') ? 0.06 : 0) + (types.has('solicitation_text') && types.has('calc_labor_category') ? 0.02 : 0));
      }
    } catch (e) {
      console.error('[derive_company_keywords] segment ranking failed:', e instanceof Error ? e.message : String(e));
    }
    const sorted = dedupeTitles(occKeys.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)));
    const top = scores.get(sorted[0]) ?? 0;
    occRanked = roundRobinBySegment(sorted.filter((k) => (scores.get(k) ?? 0) >= top * 0.75), segOf);
  } else {
    occRanked = rankKind('occupation', 0.75);
  }

  const keywords = interleave(capRanked, occRanked, limit);
  const describe = (k: string): KeywordWithSource => ({
    keyword: k,
    kind: cands.get(k)!.kind,
    sources: cands.get(k)!.sources,
    ...(scores.has(k) ? { relevance: Math.round(scores.get(k)! * 1000) / 1000 } : {}),
  });

  return finish({
    keywords,
    keyword_sources: keywords.map(describe),
    occupational_titles: occRanked.slice(0, 15).map(describe),
    excluded_terms: { locations: locationNames, brand: [...brandBlock] },
    naics_used: naicsUsed,
    _meta: {
      grounded: keywords.length > 0,
      degraded: keywords.length === 0 && Object.values(status).includes('error'),
      ranked,
      keyword_count: keywords.length,
      input_chars: inputChars,
      source_status: status,
    },
  });
}

function finish(result: CompanyKeywordsToolResult): CompanyKeywordsToolResult {
  if (mcpFlags.aiHint) {
    const { keywords, _meta } = result;
    result._ai_hint = {
      summary: !_meta.grounded
        ? _meta.degraded
          ? 'Keyword derivation errored (a source was unavailable) — try again shortly; do not invent keywords.'
          : 'Not enough company text to derive keywords — pass a description and/or past-performance scope descriptions.'
        : `${keywords.length} keyword(s)${_meta.ranked ? ', semantically ranked' : ' (lexical fallback — embeddings were unavailable)'}: ${keywords.slice(0, 6).join(', ')}${keywords.length > 6 ? ', …' : ''}.`,
      how_to_use:
        'Use these as opportunity-search terms. keyword_sources names where each one came from (your description, naics_vocabulary, GSA CALC+ labor categories, or SAM solicitation text); cite it when presenting them.',
      key_caveats: [
        'Place names and the company name are excluded on purpose (excluded_terms); they are not search terms.',
        'These are inferred search terms, not an official classification; review before using them to gate alerts.',
      ],
    };
  }
  return result;
}

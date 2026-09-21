/**
 * NAICS/PSC vocabulary — the shared read interface over the naics_vocabulary
 * table (the real words federal buyers use, keyed by code, mined from award text
 * and cleaned by cross-NAICS TF-IDF). ONE lib so every Mindy surface uses the same
 * ground-truth vocabulary:
 *   - onboarding: rank/validate a user's keywords against real buyer language
 *   - expiring contracts / forecasts: enrich a code with its true search terms
 *   - SOW/PWS relevance: score a document's words against a code's vocabulary
 *   - alerts: expand a NAICS profile to the terms opportunities actually use
 *
 * Backed by scripts/build-naics-vocabulary.ts (the backfill). Reads are cached
 * in-process (the vocabulary changes only when the backfill re-runs). Fails soft:
 * an empty result never throws — callers degrade to their prior behavior.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface VocabTerm {
  term: string;
  kind: 'word' | 'bigram' | 'trigram';
  weight: number;   // TF-IDF (higher = more distinctive to this code)
  df: number;       // # of awards the term appeared in
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _sb = createClient(url, key);
  return _sb;
}

// In-process cache — vocabulary is static between backfills. Keyed by
// `${code_type}:${code}`. TTL long (an hour) since it rarely changes.
const CACHE = new Map<string, { at: number; terms: VocabTerm[] }>();
const TTL_MS = 60 * 60 * 1000;

/**
 * Get the vocabulary for a single code, best (most distinctive) terms first.
 * Returns [] on any miss/error (caller degrades gracefully).
 */
export async function getVocabulary(
  code: string,
  opts: { codeType?: 'naics' | 'psc'; limit?: number } = {},
): Promise<VocabTerm[]> {
  const codeType = opts.codeType ?? 'naics';
  const limit = opts.limit ?? 40;
  const c = (code || '').trim();
  if (!c) return [];
  const cacheKey = `${codeType}:${c}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.terms.slice(0, limit);

  const client = sb();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('naics_vocabulary')
      .select('term, kind, weight, df')
      .eq('code_type', codeType)
      .eq('code', c)
      .order('weight', { ascending: false })
      .limit(200);
    if (error || !data) return [];
    const terms = data as VocabTerm[];
    CACHE.set(cacheKey, { at: Date.now(), terms });
    return terms.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Get the merged vocabulary across several codes (a user's whole NAICS set),
 * deduped by term keeping the highest weight. Best terms first.
 */
export async function getVocabularyForCodes(
  codes: string[],
  opts: { codeType?: 'naics' | 'psc'; limit?: number } = {},
): Promise<VocabTerm[]> {
  const uniq = Array.from(new Set((codes || []).map((c) => (c || '').trim()).filter(Boolean)));
  if (uniq.length === 0) return [];
  const per = await Promise.all(uniq.map((c) => getVocabulary(c, { codeType: opts.codeType, limit: 60 })));
  const byTerm = new Map<string, VocabTerm>();
  for (const list of per) {
    for (const t of list) {
      const ex = byTerm.get(t.term);
      if (!ex || t.weight > ex.weight) byTerm.set(t.term, t);
    }
  }
  return Array.from(byTerm.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, opts.limit ?? 60);
}

/**
 * Reverse lookup: which codes use a given term? For SOW/PWS → NAICS inference
 * ("this document says 'chiller' and 'boiler' → 238220"). Returns codes ranked by
 * the term's weight in each.
 */
export async function codesForTerm(
  term: string,
  opts: { codeType?: 'naics' | 'psc'; limit?: number } = {},
): Promise<{ code: string; weight: number }[]> {
  const t = (term || '').trim().toLowerCase();
  if (!t) return [];
  const client = sb();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('naics_vocabulary')
      .select('code, weight')
      .eq('code_type', opts.codeType ?? 'naics')
      .eq('term', t)
      .order('weight', { ascending: false })
      .limit(opts.limit ?? 20);
    if (error || !data) return [];
    return data as { code: string; weight: number }[];
  } catch {
    return [];
  }
}

/**
 * True if a term is real federal-buyer vocabulary for a code (present in its
 * vocabulary). Used to VALIDATE a user's keyword against how buyers actually
 * describe the work — the onboarding "are these keywords right?" check.
 */
export async function isKnownTermForCode(
  code: string,
  term: string,
  opts: { codeType?: 'naics' | 'psc' } = {},
): Promise<boolean> {
  const vocab = await getVocabulary(code, { codeType: opts.codeType, limit: 200 });
  const t = (term || '').trim().toLowerCase();
  return vocab.some((v) => v.term === t || v.term.includes(t) || t.includes(v.term));
}

/**
 * Semantic keyword derivation — turn a company's UEI-imported identity into the
 * keywords buyers actually use for their work, ranked BY MEANING (not just NAICS
 * title-word splitting).
 *
 * Reuses the live embedding engine (embedText + cosineSimilarity — same one that
 * powers recompete SOW match, JSONB + in-app cosine, no pgvector). The richest
 * source is the contractor's OWN words: past-performance scope descriptions +
 * NAICS/PSC titles + the AI capability summary.
 *
 * Method:
 *   1. Build a "company meaning" vector from the whole identity blob.
 *   2. Pull candidate phrases from the same text (noun-ish multi-word + strong
 *      single terms), deduped + stop-filtered.
 *   3. Embed each candidate; keep the ones most cosine-similar to the company
 *      meaning (semantically central to what they do), dropping generic noise.
 *
 * Fails soft: if OpenAI is unavailable, returns the lexical candidates unranked so
 * the caller still gets usable keywords.
 */
import { embedText, cosineSimilarity } from './embeddings';

// Words that carry no search signal in GovCon scope text.
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'shall', 'will', 'are', 'was', 'has',
  'have', 'all', 'any', 'other', 'including', 'such', 'per', 'each', 'from', 'into',
  'their', 'these', 'those', 'which', 'under', 'over', 'within', 'between', 'provide',
  'provides', 'providing', 'support', 'services', 'service', 'contractor', 'contract',
  'government', 'federal', 'agency', 'department', 'office', 'requirements', 'requirement',
  'work', 'performance', 'statement', 'task', 'tasks', 'order', 'orders', 'period',
  'company', 'firm', 'business', 'inc', 'llc', 'corp', 'corporation', 'solutions',
  'group', 'team', 'national', 'united', 'states', 'general', 'various', 'related',
  'management', 'system', 'systems', 'program', 'project', 'projects', 'based',
]);

function clean(s: string): string {
  // Strip dangling hyphens (PSC titles like "MEDICAL- NURSING" leak "medical-").
  return (s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s-+|-+\s/g, ' ').replace(/\s+/g, ' ').trim();
}

// A phrase whose first OR last token is a stopword reads as a fragment
// ("hvac installation and", "buildings hvac repair" is fine but "and hvac" isn't).
// Reject phrases with a filler word on either EDGE — the signal must anchor the ends.
function edgesAreSignal(tokens: string[]): boolean {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  return !STOP.has(first) && !STOP.has(last);
}

/** Extract candidate keyword phrases (1-3 word, signal-bearing) from text. */
function candidatePhrases(text: string): string[] {
  const words = clean(text).split(' ').filter(Boolean);
  const out = new Set<string>();

  // Single strong terms.
  for (const w of words) {
    if (w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  // Bigrams / trigrams where at least one token is signal-bearing AND neither edge
  // is a stopword (drops "hvac installation and" / "staffing for va" fragments).
  for (let i = 0; i < words.length - 1; i++) {
    const bi = [words[i], words[i + 1]];
    if (bi.every((w) => w.length >= 3) && bi.some((w) => !STOP.has(w) && w.length >= 4) && edgesAreSignal(bi)) {
      out.add(bi.join(' '));
    }
    if (i < words.length - 2) {
      const tri = [words[i], words[i + 1], words[i + 2]];
      if (tri.every((w) => w.length >= 3) && tri.filter((w) => !STOP.has(w)).length >= 2 && edgesAreSignal(tri)) {
        out.add(tri.join(' '));
      }
    }
  }
  return [...out];
}

export interface CompanyKeywordInput {
  oneLiner?: string | null;
  elevatorPitch?: string | null;
  capabilities?: string[];            // capability_name + description joined
  naicsDescriptions?: string[];       // NAICS title text
  pscDescriptions?: string[];         // PSC title text
  scopeDescriptions?: string[];       // past-perf scope_description (the gold)
  // The CLEAN text that defines what the company means. When set, the company
  // meaning-vector is built from THIS alone (not the whole blob), so candidates
  // pulled from broad grounding data (coverage-NAICS signal words, PSC titles) are
  // scored against precise meaning and off-topic ones drop. Without it, the vector
  // is the whole blob (original behavior). Use for the onboarding path where the
  // grounding sources are broad and would otherwise pollute the meaning vector
  // ("missile", "biotechnology" leaking onto a drone-imaging profile).
  meaningText?: string | null;
}

/**
 * Derive up to `limit` keywords, semantically ranked to the company's meaning.
 * Returns lowercased, deduped, ordered most→least central.
 *
 * `minRelScore` (0-1) drops the off-topic tail: a candidate is kept only if its
 * cosine similarity is at least `minRelScore × (top candidate's score)`. 0 = keep
 * up to `limit` regardless (original behavior). ~0.7 trims junk while keeping the
 * on-topic set.
 */
export async function deriveSemanticKeywords(
  input: CompanyKeywordInput,
  limit = 12,
  minRelScore = 0,
): Promise<string[]> {
  const blobParts = [
    input.oneLiner,
    input.elevatorPitch,
    ...(input.capabilities || []),
    ...(input.naicsDescriptions || []),
    ...(input.pscDescriptions || []),
    ...(input.scopeDescriptions || []),
  ].filter(Boolean) as string[];

  const blob = blobParts.join('. ').slice(0, 8000);
  if (!blob.trim()) return [];

  // The meaning vector defaults to the whole blob, but a caller can pin it to a
  // CLEAN subset (meaningText) so broad grounding data doesn't pollute it.
  const meaningBlob = (input.meaningText || '').trim() || blob;

  // Candidate phrases come from the company's OWN words (scope + capabilities +
  // NAICS/PSC titles weighted in by appearing in the blob).
  const candidates = Array.from(
    new Set(
      [...candidatePhrases(blob)]
        // Prefer phrases that read like work, drop ultra-generic singletons handled by STOP.
        .filter((c) => c.length >= 4),
    ),
  ).slice(0, 80); // cap embedding calls

  if (candidates.length === 0) return [];

  // Semantic ranking — embed the company meaning + each candidate, keep the most
  // central. Fail soft to lexical order if embeddings are unavailable.
  try {
    const companyVec = await embedText(meaningBlob);
    const scored: { kw: string; score: number }[] = [];
    for (const c of candidates) {
      try {
        const v = await embedText(c);
        scored.push({ kw: c, score: cosineSimilarity(companyVec, v) });
      } catch {
        /* skip this candidate */
      }
    }
    if (scored.length === 0) return candidates.slice(0, limit);

    // Rank, then dedupe near-duplicates (e.g. "audiovisual" vs "audio visual").
    const rankedScored = scored.sort((a, b) => b.score - a.score);
    // Relative-similarity cutoff — drop the off-topic tail (candidates far below the
    // best match). Skipped when minRelScore is 0.
    const topScore = rankedScored[0]?.score ?? 0;
    const cutoff = minRelScore > 0 ? topScore * minRelScore : -Infinity;
    const ranked = rankedScored.filter((s) => s.score >= cutoff).map((s) => s.kw);
    const kept: string[] = [];
    for (const kw of ranked) {
      const collapsed = kw.replace(/[\s-]/g, '');
      if (kept.some((k) => k.replace(/[\s-]/g, '') === collapsed)) continue;
      kept.push(kw);
      if (kept.length >= limit) break;
    }
    return kept;
  } catch {
    // OpenAI down → return lexical candidates so the user still gets keywords.
    return candidates.slice(0, limit);
  }
}

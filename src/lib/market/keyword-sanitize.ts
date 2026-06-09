/**
 * Keyword sanitizer (#61) — encodes the "abbreviations are noise" lesson ONCE,
 * platform-wide. Eric caught it on the vehicle chips: searching "OTA" matched
 * pOTAble / rOTA / tOTAl (262 garbage rows), while the spelled-out phrase "other
 * transaction" matched 11 real ones. Short ambiguous substrings produce false
 * positives in any title/description ilike search.
 *
 * Rule: drop terms shorter than 3 chars (and 3-char terms) UNLESS they are a
 * KNOWN real federal abbreviation that we've verified yields clean results
 * (IDIQ, BAA, CSO, BPA, SBIR…). Everything else must be >= 4 chars. Multi-word
 * phrases pass (they're specific). Stopwords stripped.
 *
 * Used wherever a keyword is injected into a SAM/opportunity text search:
 * /api/app/opportunities, briefings sam-gov, keyword-coverage.
 */

// Real, verified-clean federal abbreviations that ARE safe to text-search even
// though they're short (they appear as distinct tokens, not noise substrings).
const SAFE_ABBREVIATIONS = new Set([
  'idiq', 'baa', 'cso', 'bpa', 'sbir', 'sttr', 'rfp', 'rfq', 'rfi', 'gsa',
  'gwac', 'macc', 'fss',
]);
// NOTE: 'OTA' is deliberately NOT here — our own data showed "OTA" as a bare token
// is noise (matches pOTAble / rOTA / tOTAl). Callers that mean Other Transaction
// must pass the phrase "other transaction" (which IS searchable). Same for any
// 2-3 char string that collides with common words.

const STOPWORDS = new Set([
  'we', 'provide', 'offer', 'and', 'or', 'the', 'a', 'an', 'for', 'of', 'to', 'in',
  'on', 'our', 'with', 'services', 'service', 'support', 'solutions', 'company',
  'federal', 'government', 'agencies', 'inc', 'llc', 'corp', 'all', 'any', 'new',
]);

// A "word" with no vowels or absurd consonant runs is keyboard mash (zxcvbnm,
// asdfqwer), not a real industry term. Cheap heuristic to keep gibberish out.
function looksLikeRealWord(w: string): boolean {
  if (/[aeiouy]/.test(w) === false) return false;          // no vowel → mash
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(w)) return false;   // 5+ consonants in a row
  return true;
}

/** True if a single keyword is specific enough to text-search without noise. */
export function isSearchableKeyword(term: string): boolean {
  const t = (term || '').trim().toLowerCase();
  if (!t) return false;
  if (STOPWORDS.has(t)) return false;
  if (t.includes(' ')) return true;                 // multi-word phrase = specific
  if (SAFE_ABBREVIATIONS.has(t)) return true;       // known clean abbreviation
  const word = t.replace(/[^a-z0-9]/g, '');
  if (word.length < 4) return false;                // single word must be 4+ chars
  return looksLikeRealWord(word);                   // …and not keyboard mash
}

/**
 * Filter a list of keywords to the ones safe to inject into a text search —
 * drops short/ambiguous abbreviations and stopwords that would yield noise.
 */
export function sanitizeKeywords(keywords: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords) {
    const t = (raw || '').trim();
    if (!t || !isSearchableKeyword(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

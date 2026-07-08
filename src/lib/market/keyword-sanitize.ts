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
  'consulting', // org/service descriptor, not a capability ("cybersecurity consulting" → "cybersecurity")
  'federal', 'government', 'agencies', 'inc', 'llc', 'corp', 'all', 'any', 'new',
  // Business-entity / generic nouns that describe the ORG, not the capability —
  // "demolition firm" was leaking "firm" as a keyword.
  'firm', 'business', 'corporation', 'group', 'enterprise', 'enterprises',
  'contractor', 'contractors', 'provider', 'providers', 'specialist',
  'specialists', 'professional', 'professionals',
]);

// Geography is a PLACE OF PERFORMANCE, not a capability — "construction Caribbean"
// must not leak "caribbean" as a keyword (it'd match unrelated titles that merely
// mention the region). Locations are captured separately as states/territories.
// Covers single-word US state names, territories, regions, scope words, and common
// continents/oceans. (Eric, Jun 23 2026 — "distinguish what they DO from WHERE.")
const GEO_TERMS = new Set([
  // US states (single-word) + territories
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois',
  'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana',
  'nebraska', 'nevada', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'tennessee',
  'texas', 'utah', 'vermont', 'virginia', 'washington', 'wisconsin', 'wyoming',
  'hampshire', 'jersey', 'mexico', 'york', 'carolina', 'dakota', 'island',
  'guam', 'samoa', 'mariana', 'rico', 'puerto',
  // Regions / scope / direction
  'caribbean', 'nationwide', 'worldwide', 'domestic', 'overseas', 'international',
  'national', 'regional', 'global', 'conus', 'oconus', 'continental',
  'northeast', 'southeast', 'northwest', 'southwest', 'midwest',
  // Continents / oceans
  'africa', 'asia', 'europe', 'america', 'americas', 'pacific', 'atlantic',
  // Common multi-word geographies (only matched when a phrase comes through whole)
  'middle east', 'new york', 'new jersey', 'new mexico', 'puerto rico',
  'north carolina', 'south carolina', 'north dakota', 'south dakota',
  'rhode island', 'west virginia', 'new hampshire',
]);

// GENERIC single words: real English, pass basic sanitization, but so common in
// federal titles that a LONE one is not a precise signal — "management" matches
// 254 active notices, "program" 282, while the phrase "program management" matches
// 15 (measured Jul 7 2026). These are fine INSIDE a phrase ("program management")
// but must NOT count as a strong keyword match on their own, or the profile floods
// with noise (Blue Heron: 5 generic words → 443 matches → a "Worldwide PM" card).
// A single generic word is allowed as a WEAK signal (kept in search) but never a
// STRONG/distinctive match. See isDistinctiveKeyword.
const GENERIC_SINGLE_WORDS = new Set([
  'program', 'management', 'manage', 'managed', 'technical', 'technology', 'tech',
  'acquisition', 'writing', 'services', 'service', 'support', 'solution', 'solutions',
  'system', 'systems', 'engineering', 'engineer', 'operations', 'operational',
  'analysis', 'analyst', 'analytics', 'consulting', 'consultant', 'development',
  'design', 'planning', 'training', 'logistics', 'maintenance', 'administrative',
  'administration', 'general', 'professional', 'research', 'data', 'information',
  'project', 'projects', 'quality', 'assurance', 'assessment', 'strategic',
  'strategy', 'integration', 'installation', 'construction', 'equipment', 'supplies',
  'supply', 'materials', 'products', 'testing', 'inspection', 'repair', 'facility',
  'facilities', 'security', 'personnel', 'staffing', 'labor', 'work', 'field',
  // Descriptor adjectives that LOOK distinctive but are federal-search wildcards:
  // "custom" alone matches 66 active notices (custom software / weapons / aircraft)
  // vs "custom cabinetry" 0 — it dragged Navy/Missile-Defense buyers onto a millwork
  // shop's Target List (measured Jul 7 2026). These belong in a PHRASE, never alone.
  'custom', 'commercial', 'industrial', 'mobile', 'advanced', 'standard', 'modular',
  'portable', 'specialized', 'comprehensive', 'integrated', 'automated',
  // "production" alone is a federal-search wildcard that names a $36B defense-
  // MANUFACTURING market (missiles/aircraft/ammunition). A video company's
  // "video production" was reduced to lone "production" and matched to defense
  // engineering/R&D codes (Candice / Whitty-CAP, Jul 8 2026). Belongs in a phrase
  // ("video production", "production management"), never alone. Same for these
  // process/output nouns that read distinctive but match everything.
  'production', 'produce', 'operation', 'process', 'processing', 'delivery',
  'performance', 'programs', 'consulting',
]);

/**
 * A "distinctive" keyword is precise enough to be a STRONG match signal: a
 * multi-word phrase ("program management", "cyber threat hunting") or a single
 * word that is NOT in the generic-federal-noise set. A lone generic word
 * ("management") passes isSearchableKeyword (it's a real 4+ char word) but is
 * NOT distinctive — matching on it alone floods the profile.
 *
 * Use this for precision surfaces (the "hot right now" card, top-ranked matches).
 * Use isSearchableKeyword for the broad/inclusive search where volume is fine.
 */
export function isDistinctiveKeyword(term: string): boolean {
  const t = (term || '').trim().toLowerCase();
  if (!t || !isSearchableKeyword(t)) return false;
  if (t.includes(' ')) return true;                 // phrase → always distinctive
  if (SAFE_ABBREVIATIONS.has(t)) return true;       // known clean abbreviation
  return !GENERIC_SINGLE_WORDS.has(t);              // lone word: distinctive iff not generic
}

/** The distinctive subset of a keyword list (phrases + non-generic single words). */
export function distinctiveKeywords(keywords: (string | null | undefined)[]): string[] {
  return sanitizeKeywords(keywords).filter((k) => isDistinctiveKeyword(k));
}

/**
 * CANONICAL phrase→candidate reducer. USASpending keyword search is EXACT-PHRASE
 * ("cybersecurity consulting" returns nothing), so to stay grounded we try the full
 * phrase first, then fall back to single words most→least meaningful. Callers try
 * each candidate against USASpending and take the first (or best) that returns data.
 *
 * Ordering is by DISTINCTIVENESS, not length. "longest ≈ most specific" is backwards:
 * "video production" → the longer word "production" is a generic federal wildcard
 * ($36B defense mfg) while the shorter "video" is the real industry term. Longest-first
 * + a "bigger market wins" tiebreak told a video company to add engineering/R&D codes
 * (Candice / Whitty-CAP, Jul 8 2026). So: distinctive words (not in the generic-noise
 * set) first; among equally-distinctive, longer (≈ more specific) first.
 *
 * ONE source of truth — this logic used to be copy-pasted into keyword-coverage.ts
 * AND suggest-codes/route.ts and the two diverged (only one got fixed). Both now import
 * this. Guarded by keyword-sanitize.unit.test.ts so longest-first can't sneak back.
 */
export function keywordCandidates(input: string, max = 4): string[] {
  const kw = (input || '').trim();
  if (!kw) return [];
  const out: string[] = [kw];
  const words = kw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !GEO_TERMS.has(w));
  const rank = (w: string) => (isDistinctiveKeyword(w) ? 0 : 1);
  for (const w of [...new Set(words)].sort((a, b) => rank(a) - rank(b) || b.length - a.length)) {
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, max);
}

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
  if (GEO_TERMS.has(t)) return false;               // location, not a capability
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

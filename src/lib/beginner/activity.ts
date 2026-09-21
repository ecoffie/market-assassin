/**
 * Business-activity extraction for /try.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * The beginner search keyword used to be "the first content word the user
 * typed" (`keywordCandidates` ranks by position: *people lead with what they
 * do*). That is true of the EXPERT phrasing it was tuned on ("commercial
 * ROOFING and building envelope repair") and false of beginner prose, which
 * leads with who you are:
 *
 *   measured 2026-09-21, keyword actually searched
 *     "can a 2 person garbage company do government contracts" → "person"
 *     "we do IT support for small offices"                      → "small"
 *     "we install commercial roofing"                           → "install"
 *     "physical security guard services"                        → "physical"
 *     "staffing agency"                                         → "agency"
 *
 * "person" is why the screenshot returned a personnel-security platform, a
 * PERSONAL alert device and PERSONAL services contractors: three markets that
 * share one substring and nothing else.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * A business description has two kinds of word. ACTIVITY words name what is
 * sold (garbage, roofing, cater, guard). CONTEXT words describe the company,
 * the customer or the act of contracting (person, company, business,
 * government, contracts, help, small). Only activity words may establish a
 * market. Context words are removed before anything is searched or scored —
 * they can neither pick the keyword nor justify a match.
 *
 * ── Why the ladder, and not a score ───────────────────────────────────────
 * Summing per-token scores prefers LONGER phrases, which then fail to match a
 * SAM title at all ("clean office" → 0 rows where "clean" → 40). So the picker
 * is a ladder, most-specific-that-still-matches first:
 *
 *   1. a distinctive single activity noun          garbage · roofing · clean
 *   2. an anchored phrase, when no single survives "it support"
 *   3. a typed-but-generic activity word           staffing · construction
 *   4. nothing → ask a clarifying question         "I help businesses"
 *
 * ── Rejected, with evidence ───────────────────────────────────────────────
 * Ranking candidates by `naics_vocabulary` (25,252 buyer terms mined from
 * award text) was measured on 2026-09-21 and is NOT a usable activity signal:
 *   physical → 621340 (w1481) outranks guard → 561612 (w1206)
 *   window   → 114119 (agriculture)
 *   garbage  → 561440 Collection Agencies, df=5
 * It would have made "physical" beat "guard". Extraction stays pure, sync and
 * deterministic — no network, no DB, testable without fixtures.
 */

import {
  isDistinctiveKeyword,
  isSearchableKeyword,
  keywordCandidates,
} from '@/lib/market/keyword-sanitize';

/**
 * Words that describe the COMPANY, the CUSTOMER, or the ACT OF CONTRACTING.
 * They are stripped before search and score ZERO as relevance evidence.
 *
 * This is deliberately a beginner-scoped list rather than an addition to
 * `GENERIC_SINGLE_WORDS`: that set is platform-wide and feeds alerts, profile
 * keywords and market research. Widening it to catch "person" would change
 * what thousands of existing profiles match.
 */
export const CONTEXT_TERMS: ReadonlySet<string> = new Set([
  // headcount / people-as-company-size
  'person', 'persons', 'people', 'employee', 'employees', 'headcount',
  'owner', 'owners', 'founder', 'founders', 'crew', 'guy', 'guys', 'staff',
  'man', 'men', 'woman', 'women',
  // the organisation itself
  'company', 'companies', 'business', 'businesses', 'firm', 'firms',
  'organization', 'organisation', 'agency', 'agencies', 'outfit', 'llc', 'inc',
  'corp', 'corporation', 'startup', 'shop',
  // the act of contracting
  'government', 'federal', 'govt', 'contract', 'contracts', 'contracting',
  'contractor', 'contractors', 'subcontract', 'subcontracting', 'bid', 'bids',
  'bidding', 'procurement', 'award', 'awards', 'qualify', 'qualifies',
  'qualified', 'eligible', 'eligibility', 'register', 'registered',
  // HOW A BEGINNER INTRODUCES THEMSELVES. Found by the adversarial pass
  // 2026-09-21: "woman owned small business that does catering" searched
  // `owned` and returned nine GOCO/Government-Owned fuel-depot contracts,
  // with `catering` sitting unused in `terms`. "X-owned small business" is
  // the single most common beginner self-description, and `owned` was a
  // "distinctive noun" that won on word order — `person` again, new word.
  // These describe WHO YOU ARE. Certification status is read from the
  // NOTICE's own set-aside field, never from the user's sentence.
  'own', 'owned', 'operated', 'minority', 'veteran', 'veterans',
  'disadvantaged', 'disabled', 'certified', 'certification', 'sole',
  'proprietor', 'proprietorship', 'hubzone', 'wosb', 'edwosb', 'sdvosb',
  'vosb', 'native', 'tribally',
  // filler intent verbs / nouns
  'help', 'helps', 'helping', 'want', 'wants', 'need', 'needs', 'looking',
  'start', 'starting', 'started', 'stuff', 'things', 'thing', 'whatever',
  'something', 'anything', 'work', 'works', 'job', 'jobs', 'customers',
  'customer', 'clients', 'client', 'able', 'can', 'could', 'should', 'would',
]);

/**
 * Attributive modifiers. Legitimate INSIDE a phrase ("physical security",
 * "small business"), never the market on their own. Kept in the token stream
 * so phrases can use them; barred from the single-word ladder rung.
 *
 * `commercial`, `mobile`, `custom`, `industrial` etc. are already on the
 * platform generic list for exactly this reason — these are the ones it misses.
 */
export const MODIFIER_TERMS: ReadonlySet<string> = new Set([
  'small', 'large', 'big', 'tiny', 'local', 'nearby', 'physical', 'personal',
  'private', 'family', 'licensed', 'insured', 'bonded', 'experienced',
  'reliable', 'affordable', 'full', 'part', 'time', 'office', 'offices',
  'site', 'sites', 'area', 'areas', 'location', 'locations', 'space',
]);

/**
 * Verbs that describe DOING the work. Demoted only when some other activity
 * word survives — "fix doors" must still search doors, but "I do remodeling"
 * must not fall through to nothing.
 */
export const ACTIVITY_VERBS: ReadonlySet<string> = new Set([
  'fix', 'fixes', 'repair', 'repairs', 'replace', 'replaces', 'install',
  'installs', 'restore', 'restores', 'refinish', 'rebuild', 'build', 'builds',
  'construct', 'constructs', 'remodel', 'remodels', 'renovate', 'renovates',
  'provide', 'provides', 'perform', 'performs', 'handle', 'handles', 'run',
  'runs', 'operate', 'operates', 'manage', 'manages', 'offer', 'offers',
  'sell', 'sells', 'supply', 'supplies', 'deliver', 'delivers', 'make',
  'makes', 'does', 'doing',
  // FOUND IN THE BROWSER, 2026-09-21: the follow-up "I collect garbage and
  // haul it away" searched "collect" and returned "Collect and Plant Willow
  // Cuttings" and "The Data COUNTS (Collect Data Once…)". Same shape as
  // "install" — a leading verb that reads distinctive and names no market.
  // Each is demoted only while another activity word survives, so "I haul
  // things away" still searches "haul".
  'collect', 'collects', 'haul', 'hauls', 'pick', 'picks', 'remove',
  'removes', 'dispose', 'disposes', 'transport', 'transports', 'maintain',
  'maintains',
  // ⚠️ VERBS THAT ARE ALSO NOUNS — the dangerous ones. Measured live
  // 2026-09-21, each searched the HARDWARE sense and buried the trade:
  //   "we drive trucks"   → `drive`   → DISK DRIVE, QUAD TAPE DRIVE, AC DRIVE (26 cards, 0 trucking)
  //   "we rent cranes"    → `rent`    → "Market Rent Study" (a real-estate study)
  //   "we monitor alarms" → `monitor` → MONITOR,FLAT PANEL · defibrillator monitors
  //   "we survey land"    → `survey`  → "Market Survey for Image Intensifier Assembly"
  // Demoted only while another activity word survives, so "I do surveying"
  // and "storage company" still work.
  'drive', 'drives', 'rent', 'rents', 'survey', 'surveys', 'monitor',
  'monitors', 'train', 'trains', 'store', 'stores', 'stock', 'stocks',
  'scan', 'scans', 'print', 'prints', 'wash', 'washes', 'move', 'moves',
  'tow', 'tows', 'mow', 'mows',
]);

/**
 * Two-letter domain names a beginner really types. `isSearchableKeyword`
 * rejects anything under 4 chars (correctly — "OTA" matched pOTAble), so an
 * "IT support" business had no activity word at all. Kept tiny and explicit:
 * these only ever qualify INSIDE a phrase, never as a lone search term.
 */
export const SHORT_DOMAIN_TOKENS: ReadonlySet<string> = new Set(['it', 'hr', 'ai', 'qa']);

/**
 * Words so broad that searching one alone cannot produce a defensible result.
 * Reaching this rung means we have no market — ask instead of guessing.
 */
const TOO_GENERIC_TO_SEARCH: ReadonlySet<string> = new Set([
  'support', 'services', 'service', 'solutions', 'solution', 'management',
  'system', 'systems', 'program', 'programs', 'project', 'projects',
  'operations', 'general', 'professional', 'quality', 'performance',
  'information', 'data', 'technology', 'tech', 'equipment', 'supplies',
  'products', 'materials', 'development', 'process', 'processing',
  'production', 'integration', 'administration', 'commercial', 'industrial',
  // VENUE words. `keyword-sanitize` already measured "building" as a federal
  // wildcard that "belongs in a PHRASE, never alone" — it is why a roofing
  // company once grounded on SHIP BUILDING, and why "Dale Carnegie Building a
  // Stronger Team" matched a cleaner. A venue is where the work happens, never
  // the work. `construction` is deliberately absent: that IS a trade.
  'building', 'buildings', 'facility', 'facilities', 'structure', 'structures',
  'property', 'properties', 'premises', 'grounds',
]);

const SENTENCE_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'to', 'in', 'on', 'at',
  'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'i',
  'we', 'my', 'our', 'us', 'you', 'they', 'that', 'this', 'these', 'those',
  'do', 'did', 'have', 'has', 'had', 'also', 'like', 'some', 'all', 'any',
  'other', 'than', 'then', 'about', 'into', 'over', 'out', 'up', 'away',
  'around', 'off',
  // ⚠️ 'it' is deliberately ABSENT: in this domain it is the noun IT
  // (information technology), and dropping it costs us "IT support"
  // entirely. The pronoun sense is handled in isAnchoredPhrase instead.
]);

/**
 * The noun the GOVERNMENT writes for a service verb.
 *
 * Demoting a verb (above) hands the head to its object, and for a SERVICE
 * business that inverts the sentence: measured 2026-09-21, "we rent cranes"
 * searched `cranes` and returned three crane PURCHASES while "W. Kerr Scott
 * Crane Rental" sat in the adjacent group; "we tow vehicles" returned vehicle
 * purchases while seven real towing notices were never fetched. The company
 * sells the verb, not the object.
 *
 * So a verb+object pair also yields the compound the buyer actually writes.
 * Same idea as `repairBuyingPhrases` ("fix doors" → "door repair"), which has
 * been in this file since the beginner seam shipped — this generalises it past
 * the repair verbs. Only verbs with an unambiguous nominal are listed; a guess
 * here would be a fabricated search term.
 */
export const SERVICE_NOMINALS: Readonly<Record<string, string>> = {
  rent: 'rental',
  lease: 'lease',
  tow: 'towing',
  mow: 'mowing',
  monitor: 'monitoring',
  survey: 'survey',
  wash: 'washing',
  store: 'storage',
  haul: 'hauling',
  move: 'moving',
  drive: 'driving',
  transport: 'transportation',
};
// ⚠️ ONLY verbs where the VERB IS THE SERVICE. Deliberately absent:
// install · repair · replace · remove · collect · dispose · maintain · clean.
// For those trades the OBJECT already names the work the way the government
// writes it — "Window Replacement", "Trash Removal", "Interior Cleaning" — and
// forcing a compound narrows it to almost nothing: "we install windows" went
// from 36 live window notices to one ("window installation"). Measured
// 2026-09-21. `repairBuyingPhrases` already covers the repair family, and it
// keeps the object too.

/** "cranes" → "crane", "boxes" → "box". NOT "cran"/"vehicl". */
function singularObject(word: string): string {
  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * "<object> <nominal>" for every service verb the user paired with an object,
 * inside one segment. "we rent cranes" → "crane rental".
 */
/**
 * The repair family does NOT get a compound HEAD (the object already names the
 * work), but the compound is strong EVIDENCE. "we install windows" searching
 * `window` legitimately returns "Windows 11 Laptops" and "WINDOW,DIAL" beside
 * "Bldg 13 Window Replacement" — one word, three markets. Emitting
 * "window replacement" / "window installation" as terms gives the phrase-anchor
 * rule something to anchor on, and the product senses drop to adjacent.
 */
const WORK_NOMINALS = ['repair', 'replacement', 'installation', 'maintenance'] as const;
const WORK_VERBS = new Set([
  'fix', 'fixes', 'repair', 'repairs', 'replace', 'replaces', 'install',
  'installs', 'restore', 'restores', 'rebuild', 'service', 'services',
]);

export function workCompounds(segments: readonly string[][]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    if (!seg.some((w) => WORK_VERBS.has(w))) continue;
    for (const word of seg) {
      if (WORK_VERBS.has(word) || MODIFIER_TERMS.has(word) || word.length < 4) continue;
      if (!isSingleActivityWord(word)) continue;
      const obj = singularObject(word);
      for (const nominal of WORK_NOMINALS) {
        const phrase = `${obj} ${nominal}`;
        if (!out.includes(phrase)) out.push(phrase);
      }
      break;
    }
  }
  return out;
}

export function serviceCompounds(segments: readonly string[][]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) {
      // Only for a verb the ladder actually demotes. `clean` has a nominal but
      // is NOT demoted (it is the cleaning trade's own word), and building a
      // compound for it hijacked "I clean office buildings" into "building
      // cleaning" — 21 real cleaning matches down to 5, plus GSA office leases.
      if (!ACTIVITY_VERBS.has(seg[i])) continue;
      const nominal = SERVICE_NOMINALS[seg[i]];
      if (!nominal) continue;
      for (let j = i + 1; j < seg.length; j += 1) {
        const obj = seg[j];
        if (MODIFIER_TERMS.has(obj) || ACTIVITY_VERBS.has(obj) || obj.length < 4) continue;
        const phrase = `${singularObject(obj)} ${nominal}`;
        if (!out.includes(phrase)) out.push(phrase);
        break; // the nearest object, not every later word
      }
    }
  }
  return out;
}

export interface BusinessActivity {
  /** What we search — the single best activity term. */
  head: string | null;
  /**
   * Every surviving activity term, head first. These are the ONLY strings
   * allowed to establish that an opportunity matches what the user described.
   */
  terms: string[];
  /** Words recognised as company/meta context and deliberately discarded. */
  context: string[];
  /**
   * high = a distinctive activity noun or anchored phrase.
   * low  = only a typed-but-generic activity word survived (rung 3).
   * none = nothing but context — ask a clarifying question.
   */
  confidence: 'high' | 'low' | 'none';
  /** Which rung produced `head`. Surfaced for debugging, never rendered. */
  rung: 'single' | 'phrase' | 'generic' | 'none';
}

export function isContextWord(word: string): boolean {
  return CONTEXT_TERMS.has(normalizeWord(word));
}

function normalizeWord(word: string): string {
  return String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Drop context words, bare numerals and sentence glue. Modifiers survive. */
export function activityStream(text: string): string[] {
  const out: string[] = [];
  for (const raw of tokenize(text)) {
    if (/^\d+$/.test(raw)) continue;
    if (SENTENCE_STOPWORDS.has(raw)) continue;
    if (CONTEXT_TERMS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** Remove context words from an already-derived phrase, keeping word order. */
export function stripContext(phrase: string): string {
  return tokenize(phrase)
    .filter((w) => !/^\d+$/.test(w) && !SENTENCE_STOPWORDS.has(w) && !CONTEXT_TERMS.has(w))
    .join(' ')
    .trim();
}

function isSingleActivityWord(word: string): boolean {
  if (CONTEXT_TERMS.has(word) || MODIFIER_TERMS.has(word) || ACTIVITY_VERBS.has(word)) return false;
  return isDistinctiveKeyword(word);
}

/** Rung 3: the user typed it, it is a real word, it just happens to be broad. */
function isTypedGenericActivity(word: string): boolean {
  if (CONTEXT_TERMS.has(word) || MODIFIER_TERMS.has(word) || ACTIVITY_VERBS.has(word)) return false;
  if (TOO_GENERIC_TO_SEARCH.has(word)) return false;
  if (word.length < 5) return false;
  return isSearchableKeyword(word);
}

/**
 * A phrase exists to rescue the case where the signal lives ONLY in the
 * combination — "IT support", where `it` is too short to search and `support`
 * is a federal wildcard. So it must be anchored by a genuine activity word or
 * a short domain token. A modifier + a broad word ("small construction") adds
 * nothing over the broad word alone and must NOT outrank it, or "I run a small
 * construction company" searches "small construction" (0 rows) instead of
 * "construction" (many).
 */
function isAnchoredPhrase(tokens: readonly string[]): boolean {
  if (tokens.length < 2 || tokens.length > 3) return false;
  if (tokens.some((t) => CONTEXT_TERMS.has(t))) return false;
  if (tokens.some(isSingleActivityWord)) return true;
  // A short domain token only anchors when it LEADS: "IT support" is a market,
  // "haul it" (out of "haul it away") is a pronoun.
  if (SHORT_DOMAIN_TOKENS.has(tokens[0])) return true;
  // TWO broad words can name one precise market. "medical staffing" searched
  // the wildcard `medical` alone and returned 40/40 wrong cards (Medical Waste
  // Disposal, VA Medical Center elevator inspection) — the exact collapse
  // keyword-sanitize already documents. Neither word anchors alone, both are
  // real words the user typed, and the pair IS the market. A modifier or a
  // venue still cannot participate, so "small construction" is unaffected.
  return tokens.length === 2 && tokens.every(isTypedGenericActivity);
}

/**
 * Phrases are built inside SEGMENTS, never across a dropped word. Removing
 * stopwords first makes "commercial cleaning AND small construction" look like
 * the adjacent pair "cleaning small" — a phrase the user never wrote, which
 * would then be searched and scored as if they had.
 */
export function activitySegments(text: string): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];
  for (const raw of tokenize(text)) {
    const isBreak =
      /^\d+$/.test(raw) || SENTENCE_STOPWORDS.has(raw) || CONTEXT_TERMS.has(raw);
    if (isBreak) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(raw);
  }
  if (current.length) segments.push(current);
  return segments;
}

function contiguousPhrases(segments: readonly string[][]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i += 1) {
      const two = seg.slice(i, i + 2);
      if (isAnchoredPhrase(two)) out.push(two.join(' '));
    }
    for (let i = 0; i < seg.length - 2; i += 1) {
      const three = seg.slice(i, i + 3);
      if (isAnchoredPhrase(three)) out.push(three.join(' '));
    }
  }
  return out;
}

/** Do the user's own words contain these tokens, in order, inside one segment? */
function appearsContiguously(segments: readonly string[][], tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  return segments.some((seg) => {
    for (let i = 0; i + tokens.length <= seg.length; i += 1) {
      if (tokens.every((t, j) => seg[i + j] === t)) return true;
    }
    return false;
  });
}

/** Same word, one entry. "door" and "doors" are not two pieces of evidence. */
function termKey(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map(singularObject)
    .join(' ');
}

function pushUnique(into: string[], value: string, max: number): void {
  const v = value.trim();
  if (!v || into.length >= max) return;
  const key = termKey(v);
  if (into.some((x) => termKey(x) === key)) return;
  into.push(v);
}

const MAX_TERMS = 7;

/**
 * @param text     the user's own words (description + follow-up)
 * @param derived  `derive_company_keywords` output — already ranked BY MEANING
 *                 (OpenAI embeddings), so it is the tiebreak when several
 *                 activity words survive. Never the gate: it happily returns
 *                 "person garbage" and "contracts".
 */
export function extractBusinessActivity(
  text: string,
  derived: readonly string[] = [],
): BusinessActivity {
  const raw = String(text || '');
  const segments = activitySegments(raw);
  const stream = segments.flat();
  const context = tokenize(raw).filter((w) => CONTEXT_TERMS.has(w));

  // ── rung 1: distinctive single activity nouns ───────────────────────────
  // Ordered by the user's own word order, NOT by the semantic ranker. Position
  // is a safe tiebreak once context words are gone (it was only dangerous
  // because "2 person" used to be a candidate); the ranker meanwhile puts
  // "drones" ahead of "lidar" for "work with lidar for uas drones", which
  // searches the category instead of the capability.
  const singles = [...new Set(stream.filter(isSingleActivityWord))];
  singles.sort((a, b) => stream.indexOf(a) - stream.indexOf(b));

  // ── rung 2: anchored phrases (user's contiguous words, then derived) ────
  const compounds = serviceCompounds(segments);
  const phrases: string[] = [];
  for (const p of contiguousPhrases(segments)) pushUnique(phrases, p, 8);
  for (const d of derived) {
    const tokens = tokenize(stripContext(d));
    // The semantic ranker stitches adjacent-after-cleaning tokens, so it emits
    // pairs the user never wrote ("cleaning small" out of "commercial cleaning
    // AND small construction"). Only keep a derived phrase the user's own words
    // actually contain, in order, inside one segment.
    if (isAnchoredPhrase(tokens) && appearsContiguously(segments, tokens)) {
      pushUnique(phrases, tokens.join(' '), 8);
    }
  }
  // Shorter phrases match a SAM title far more often; 2 words before 3.
  phrases.sort((a, b) => a.split(' ').length - b.split(' ').length);

  // ── rung 3: a typed-but-generic activity word ───────────────────────────
  const generics = [...new Set(stream.filter(isTypedGenericActivity))].filter(
    (w) => !singles.includes(w),
  );
  generics.sort((a, b) => stream.indexOf(a) - stream.indexOf(b));

  let head: string | null = null;
  let rung: BusinessActivity['rung'] = 'none';
  let confidence: BusinessActivity['confidence'] = 'none';

  // A service compound outranks the bare object noun: the object alone buys
  // the thing ("cranes" → crane procurements) where the compound hires the
  // work ("crane rental"). `search_sam_opportunities` already falls back to
  // the narrower token when a phrase returns nothing, so recall is preserved.
  if (compounds.length > 0) {
    head = compounds[0];
    rung = 'phrase';
    confidence = 'high';
  } else if (singles.length > 0) {
    head = singles[0];
    rung = 'single';
    confidence = 'high';
  } else if (phrases.length > 0) {
    head = phrases[0];
    rung = 'phrase';
    confidence = 'high';
  } else if (generics.length > 0) {
    head = generics[0];
    rung = 'generic';
    confidence = 'low';
  } else {
    // Last resort: the user gave us only a verb ("I haul things away",
    // "I do remodeling"). Searching the verb beats asking a question the user
    // has already answered. 4 chars so "haul" survives; "fix" (3) does not,
    // and "fix" alone is genuinely too vague to search.
    const verb = stream.find((w) => ACTIVITY_VERBS.has(w) && isDistinctiveKeyword(w) && w.length >= 4);
    if (verb) {
      head = verb;
      rung = 'generic';
      confidence = 'low';
    }
  }

  // ⚠️ SEARCH THE SINGULAR. `search_sam_opportunities` is an ILIKE substring
  // on the title, so "%fences%" misses "Fence", "Fencing" and "Fence Repair" —
  // 14 live fence notices reduced to 2. The singular is a substring of both,
  // and `matchTerm` resolves plurals in either direction, so evidence is
  // unaffected. Beginner prose is plural far more often than expert prose.
  if (head && !head.includes(' ')) {
    const sing = singularObject(head);
    if (sing.length >= 4) head = sing;
  }

  const terms: string[] = [];
  if (head) pushUnique(terms, head, MAX_TERMS);
  for (const c of compounds) pushUnique(terms, c, MAX_TERMS);
  for (const w of workCompounds(segments)) pushUnique(terms, w, MAX_TERMS);
  for (const p of phrases) pushUnique(terms, p, MAX_TERMS);
  // ⚠️ When a compound decided the market, the bare OBJECT is not the market.
  // Keeping "land" beside "land survey" let "Instrument Landing System" in
  // (land + `+ing` is a different lemma, and no general rule separates it from
  // roof/roofing). Dropping the object is the honest version of the decision
  // we already made: they sell the surveying, not the land.
  if (compounds.length === 0) {
    for (const s of singles) pushUnique(terms, s, MAX_TERMS);
    for (const g of generics) pushUnique(terms, g, MAX_TERMS);
  }

  return { head, terms, context: [...new Set(context)], confidence, rung };
}

/**
 * Back-compat helper for callers that only have the user's raw sentence and no
 * derived keywords (the live oracle script). Same ladder, no semantic tiebreak.
 */
export function activityHeadFromText(text: string): string | null {
  const direct = extractBusinessActivity(text);
  if (direct.head) return direct.head;
  // Nothing survived the ladder; fall back to the platform candidate list so a
  // caller that must search something still searches the user's own words.
  const fallback = keywordCandidates(text).find((k) => !k.includes(' ') && isDistinctiveKeyword(k));
  return fallback ?? null;
}

/**
 * Grounded candidate sources + input cleaning for derive_company_keywords.
 *
 * The defect this closes (Ask Mindy R6): keywords were n-grams of the INPUT ranked by
 * similarity to the SAME input, so the company name and the city scored highest
 * ("superb staffing", "memphis") and nothing the buyer actually writes (the job titles a
 * staffing contract prices) could ever appear, because the input never contained it.
 *
 * Now:
 *   1. Location names (US states, US cities from src/data/us-city-coords.json) and the
 *      caller's brand tokens are removed from the input BEFORE candidates are cut from it.
 *   2. Candidates also come from three grounded external sources, each named on every
 *      keyword it produced:
 *        market_vocabulary    naics_vocabulary terms for the given/inferred NAICS
 *        calc_labor_category  GSA CALC+ awarded labor-category titles for the capability words
 *        solicitation_text    occupational phrases in real SAM solicitation/SOW text for those NAICS
 *   3. Nothing is added from a list in this file: every external keyword is a string that
 *      appeared in one of those sources, with its count.
 */
import { CITY_COORDS } from '@/lib/geo/city-geocode';
import { US_STATE_NAMES } from '@/lib/utils/us-states';

export type KeywordSourceType = 'input_text' | 'market_vocabulary' | 'calc_labor_category' | 'solicitation_text';

export interface KeywordSource {
  type: KeywordSourceType;
  /** Human-readable provenance, e.g. 'naics_vocabulary 493110' or 'GSA CALC+ keyword "warehouse"'. */
  detail: string;
  /** Count behind it: awards (vocabulary df), CALC records, or distinct solicitations. */
  n?: number;
}

// ── Location detection ──────────────────────────────────────────────────────────────

let _cityNames: Set<string> | null = null;
function cityNames(): Set<string> {
  if (_cityNames) return _cityNames;
  const s = new Set<string>();
  for (const key of Object.keys(CITY_COORDS)) {
    const name = key.split('|')[0]?.trim().toLowerCase();
    if (name) s.add(name);
  }
  _cityNames = s;
  return s;
}
const STATE_NAME_SET = new Set(Object.values(US_STATE_NAMES).map((n) => n.toLowerCase()));
const STATE_CODE_SET = new Set(Object.keys(US_STATE_NAMES));

function isPlaceName(phrase: string): boolean {
  const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
  return !!p && (cityNames().has(p) || STATE_NAME_SET.has(p));
}

/** Words that introduce a place ("a firm in Memphis", "based in Dallas", "serving Ohio"). */
const LOCATION_CUE = /\b(?:in|near|around|based\s+in|located\s+in|headquartered\s+in|serving|throughout|across|from)\s+$/i;

export interface LocationMatch {
  /** The place as written in the input. */
  text: string;
  /** Lowercased place name. */
  place: string;
  /** Character range in the input. */
  start: number;
  end: number;
}

/**
 * Find US place names in free text. A word sequence counts as a place only when it is a
 * known US city or state name AND the text marks it as a place: a location cue right
 * before it ("in Memphis", "based in dallas"), a ", ST" state code right after it, or it
 * is a capitalized proper noun that is not the first word of a sentence. Multi-word places
 * ("San Antonio", "North Carolina") count whenever capitalized. This keeps capability words
 * that happen to be town names ("industrial", "commerce" at the start of a sentence) intact.
 */
export function detectLocations(text: string): LocationMatch[] {
  const src = String(text || '');
  const out: LocationMatch[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
  const words = [...src.matchAll(/[A-Za-z][A-Za-z.'-]*/g)].map((m) => ({ w: m[0].replace(/[.'-]+$/, ''), start: m.index!, end: m.index! + m[0].replace(/[.'-]+$/, '').length }));
  for (let i = 0; i < words.length; i++) {
    for (let len = 3; len >= 1; len--) {
      if (i + len > words.length) continue;
      const seq = words.slice(i, i + len);
      const start = seq[0].start;
      const end = seq[seq.length - 1].end;
      if (overlaps(start, end)) continue;
      const phrase = seq.map((x) => x.w).join(' ');
      // A phrase must be contiguous (single spaces/hyphens between words in the source).
      if (!/^[A-Za-z.' -]+$/.test(src.slice(start, end))) continue;
      if (!isPlaceName(phrase)) continue;
      const before = src.slice(Math.max(0, start - 30), start);
      const after = src.slice(end, end + 6);
      const cue = LOCATION_CUE.test(before);
      const stateAfter = /^,?\s*([A-Z]{2})\b/.exec(after);
      const followedByState = !!stateAfter && STATE_CODE_SET.has(stateAfter[1]);
      const capitalized = seq.every((x) => /^[A-Z]/.test(x.w));
      const prefix = src.slice(0, start).trimEnd();
      const sentenceStart = prefix === '' || /[.!?:;]$/.test(prefix);
      const ok = cue || followedByState || (capitalized && (len > 1 || !sentenceStart));
      if (!ok) continue;
      out.push({ text: src.slice(start, end), place: phrase.toLowerCase(), start, end });
      taken.push([start, end]);
      break;
    }
  }
  // Two-letter state codes after a comma ("Memphis, TN") are part of the place too.
  for (const m of src.matchAll(/,\s*([A-Z]{2})\b/g)) {
    if (!STATE_CODE_SET.has(m[1])) continue;
    const start = m.index! + m[0].indexOf(m[1]);
    const end = start + 2;
    const prevPlace = out.some((o) => o.end <= start && start - o.end <= 3);
    if (prevPlace && !overlaps(start, end)) {
      out.push({ text: m[1], place: m[1].toLowerCase(), start, end });
      taken.push([start, end]);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ── Brand stripping ─────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove brand phrases and detected places from the input text, replacing each with a
 * sentence break so no n-gram can span the gap. A place's leading cue ("in", "based in")
 * goes with it.
 */
export function cleanInputText(text: string, brandPhrases: string[], locations: LocationMatch[]): string {
  let s = String(text || '');
  // Places first, right to left so ranges stay valid.
  for (const loc of [...locations].sort((a, b) => b.start - a.start)) {
    const before = s.slice(0, loc.start);
    const cue = /\b(?:in|near|around|based\s+in|located\s+in|headquartered\s+in|serving|throughout|across|from)\s+$/i.exec(before);
    const cut = cue ? loc.start - cue[0].length : loc.start;
    s = `${s.slice(0, cut)} . ${s.slice(loc.end)}`;
  }
  for (const b of brandPhrases) {
    const phrase = b.trim();
    if (phrase.length < 2) continue;
    s = s.replace(new RegExp(`\\b${escapeRe(phrase)}\\b`, 'gi'), ' . ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Brand tokens that must not appear in ANY keyword. A token is stripped only when it is
 * distinctive to the brand: it does not appear anywhere in the input outside the brand
 * phrase, and it is not a term the external market sources use (so "Superb Staffing"
 * strips "superb" but keeps "staffing", which is market vocabulary). The old behaviour
 * stripped every brand token, so a brand containing a capability word erased that
 * capability from every keyword.
 */
export function distinctiveBrandTokens(brandPhrases: string[], cleanedInput: string, protectedTokens: Set<string>): Set<string> {
  const remaining = new Set(cleanedInput.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const out = new Set<string>();
  for (const b of brandPhrases) {
    for (const t of String(b || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length < 2) continue;
      if (remaining.has(t) || protectedTokens.has(t)) continue;
      out.add(t);
    }
  }
  return out;
}

/** True when a candidate contains any blocked token as a whole word. */
export function containsBlockedToken(candidate: string, blocked: Set<string>): boolean {
  if (!blocked.size) return false;
  return candidate.toLowerCase().split(/[^a-z0-9]+/).some((t) => blocked.has(t));
}

// ── GSA CALC labor-category titles ──────────────────────────────────────────────────

/**
 * Normalize a CALC labor-category title to the occupation: drop asterisks, level markers
 * (I/II/III, 1/2/3, "- CW10", "(C1)"), and seniority words, lowercase. Returns '' for a
 * title that is a code, not an occupation.
 */
export function normalizeCalcTitle(title: string): string {
  let s = String(title || '').replace(/\*/g, ' ').replace(/\([^)]*\)/g, ' ');
  s = s.replace(/\s+-\s+[A-Z]{1,4}\d+\b.*$/i, ' '); // "Clerical/Word Processing - CW10"
  s = s.replace(/[^A-Za-z/&' -]/g, ' ');
  let toks = s.split(/\s+/).filter(Boolean);
  const LEVEL = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
  const SENIORITY = new Set(['senior', 'sr', 'junior', 'jr', 'entry', 'level', 'journeyman', 'apprentice']);
  while (toks.length && (LEVEL.test(toks[toks.length - 1]) || SENIORITY.has(toks[toks.length - 1].toLowerCase()))) toks.pop();
  while (toks.length && SENIORITY.has(toks[0].toLowerCase())) toks.shift();
  toks = toks.filter((t) => t !== '-');
  const out = toks.join(' ').toLowerCase().replace(/\s*\/\s*/g, '/').trim();
  if (out.length < 4 || toks.length > 5) return '';
  return out;
}

export interface CalcTitleCount { title: string; n: number }

/** Merge CALC labor_category buckets into normalized occupation titles with record counts. */
export function mergeCalcTitles(buckets: Array<{ key: string; doc_count: number }>): CalcTitleCount[] {
  const m = new Map<string, number>();
  for (const b of buckets || []) {
    const t = normalizeCalcTitle(b.key);
    if (!t) continue;
    m.set(t, (m.get(t) || 0) + (b.doc_count || 0));
  }
  return [...m.entries()].map(([title, n]) => ({ title, n })).sort((a, b) => b.n - a.n);
}

// ── Occupational phrases in solicitation text ───────────────────────────────────────

/**
 * Head nouns that end an occupation title in English ("material HANDLER", "order FILLER",
 * "forklift OPERATOR", "general CLERK"). This is a grammar rule for recognising a job
 * title in running text, not a list of answers: the modifier word(s) always come from the
 * solicitation text itself.
 */
const OCCUPATION_HEADS = new Set([
  'handler', 'filler', 'operator', 'clerk', 'laborer', 'labourer', 'worker', 'specialist',
  'driver', 'packer', 'picker', 'loader', 'technician', 'assistant', 'coordinator',
  'supervisor', 'mechanic', 'helper', 'attendant', 'aide', 'custodian', 'janitor',
  'receptionist', 'secretary', 'typist', 'dispatcher', 'inspector', 'stocker', 'sorter',
  'shipper', 'receiver', 'warehouseman', 'housekeeper', 'cook', 'guard', 'porter',
]);
const PLURALS: Record<string, string> = { handlers: 'handler', fillers: 'filler', operators: 'operator', clerks: 'clerk', laborers: 'laborer', labourers: 'labourer', workers: 'worker', specialists: 'specialist', drivers: 'driver', packers: 'packer', pickers: 'picker', loaders: 'loader', technicians: 'technician', assistants: 'assistant', coordinators: 'coordinator', supervisors: 'supervisor', mechanics: 'mechanic', helpers: 'helper', attendants: 'attendant', aides: 'aide', custodians: 'custodian', janitors: 'janitor', receptionists: 'receptionist', secretaries: 'secretary', typists: 'typist', dispatchers: 'dispatcher', inspectors: 'inspector', stockers: 'stocker', sorters: 'sorter', shippers: 'shipper', receivers: 'receiver', housekeepers: 'housekeeper', cooks: 'cook', guards: 'guard', porters: 'porter' };

/**
 * Words that can precede a job title but are not part of it: articles, conjunctions,
 * quantity/qualification adjectives, and the government's own roles (contracting officer,
 * contract specialist are the BUYER, never the work).
 */
const MODIFIER_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as',
  'any', 'all', 'each', 'every', 'our', 'his', 'her', 'their', 'its', 'this', 'that', 'these', 'those',
  'which', 'who', 'shall', 'will', 'must', 'may', 'can', 'be', 'is', 'are', 'was', 'per', 'one', 'two',
  'licensed', 'certified', 'approved', 'qualified', 'trained', 'sufficient', 'assigned', 'contracted',
  'valid', 'lead', 'senior', 'junior', 'chief', 'head', 'other', 'such', 'additional', 'experienced',
  'contract', 'contracting', 'contractor', 'contractors', 'government', 'federal', 'state', 'cor',
  'perform', 'performing', 'provide', 'providing', 'ensure', 'earning', 'hold', 'either', 'new', 'no',
]);

export interface OccupationCount { phrase: string; notices: number }

/**
 * Extract occupation phrases ("material handler", "forklift operator") from solicitation
 * texts, counted by DISTINCT notices. Bigram = modifier + head; a trigram is kept when both
 * modifiers are content words and it recurs. Requires >= minNotices distinct notices so a
 * one-off phrase cannot surface.
 */
export function extractOccupations(texts: Array<{ id: string; text: string }>, minNotices = 2): OccupationCount[] {
  const df = new Map<string, Set<string>>();
  const add = (p: string, id: string) => {
    if (!df.has(p)) df.set(p, new Set());
    df.get(p)!.add(id);
  };
  for (const { id, text } of texts) {
    const toks = String(text || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 1; i < toks.length; i++) {
      const head = PLURALS[toks[i]] ?? toks[i];
      if (!OCCUPATION_HEADS.has(head)) continue;
      const m1 = toks[i - 1];
      if (!m1 || MODIFIER_STOP.has(m1) || m1.length < 3 || !/^[a-z][a-z-]*$/.test(m1) || OCCUPATION_HEADS.has(PLURALS[m1] ?? m1)) continue;
      add(`${m1} ${head}`, id);
      const m0 = toks[i - 2];
      if (m0 && !MODIFIER_STOP.has(m0) && m0.length >= 3 && /^[a-z][a-z-]*$/.test(m0)) add(`${m0} ${m1} ${head}`, id);
    }
  }
  const out: OccupationCount[] = [];
  for (const [phrase, ids] of df) if (ids.size >= minNotices) out.push({ phrase, notices: ids.size });
  return out.sort((a, b) => b.notices - a.notices);
}

/**
 * Drop near-duplicate titles, keeping the first (best-ranked): titles whose words reduce to
 * the same set when each word is cut to its first five letters and "/" is a word break
 * ("administrative/clerical", "administrative clerical", "admin/clerical",
 * "administration/clerical" are one title).
 */
export function dedupeTitles(ranked: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of ranked) {
    const key = [...new Set(t.toLowerCase().split(/[\s/&-]+/).filter(Boolean).map((w) => w.slice(0, 5)))].sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Re-order a score-ranked list so each segment contributes in turn: segment of the first
 * item, then the next segment's best, and so on. Items without a segment go last. Keeps the
 * within-segment order.
 */
export function roundRobinBySegment(ranked: string[], segmentOf: Map<string, number>): string[] {
  const groups = new Map<number, string[]>();
  const order: number[] = [];
  const rest: string[] = [];
  for (const k of ranked) {
    const g = segmentOf.get(k);
    if (g === undefined) { rest.push(k); continue; }
    if (!groups.has(g)) { groups.set(g, []); order.push(g); }
    groups.get(g)!.push(k);
  }
  const out: string[] = [];
  for (let i = 0; out.length < ranked.length - rest.length; i++) {
    for (const g of order) {
      const item = groups.get(g)![i];
      if (item !== undefined) out.push(item);
    }
  }
  return [...out, ...rest];
}

// ── Merging ─────────────────────────────────────────────────────────────────────────

/** Alternate two ranked lists (capability phrases, occupations), deduped, up to limit. */
export function interleave(a: string[], b: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const key = (s: string) => s.replace(/[\s/-]/g, '');
  let i = 0;
  let j = 0;
  while (out.length < limit && (i < a.length || j < b.length)) {
    for (const pick of [a[i++], b[j++]]) {
      if (pick === undefined || out.length >= limit) continue;
      if (seen.has(key(pick))) continue;
      seen.add(key(pick));
      out.push(pick);
    }
  }
  return out;
}

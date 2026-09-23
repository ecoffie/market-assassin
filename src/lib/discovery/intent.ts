/**
 * Stage 1 of Canonical Discovery — STRUCTURED INTENT EXTRACTION (server-side, the only parser).
 *
 *   raw input → extractStructuredIntent → { agencies, states, set-asides, NAICS, PSC, exclusions,
 *                                           horizon hint, residual text } → concept classification …
 *
 * Replaces Maps' client-only `parseSearchIntent` as the semantic authority (Eric, 2026-09-22).
 * Why: saved searches stored raw sentences ("Show me USDA opportunities") that bypassed the client
 * parser, so the server tokenized them — `%me%` matched 5,333 notices; word-bounded AND then matched
 * 0. The intent was an agency filter all along.
 *
 * AGENCY EXTRACTION IS A VETTED LEXICON, NOT THE ALIAS TABLE. agency-aliases.json has 457 keys and
 * many are plain English capability words (CYBERSECURITY→CISA, LOGISTICS→DLA, HEALTH, ENERGY, STATE,
 * SPACE, ICE, USA). Extracting those from free text would turn the query "cybersecurity" into an
 * agency filter. So free text only yields a buyer from: Maps' shipping curated list, unambiguous
 * acronyms, and full proper names ("national oceanic and atmospheric administration"). Each hit is
 * then resolved through MCP's resolveBuyerIdentity — the alias table is used to NORMALIZE a buyer
 * once recognized, never to recognize one.
 *
 * Whole-token matching throughout (space-padded), never substrings.
 */
import aliasData from '@/data/agency-aliases.json';
import { SET_ASIDE_SYNONYMS, type SetAsideKey } from '@/lib/search/query-intent';
import { US_STATE_NAMES } from '@/lib/utils/us-states';

export interface AgencyMention { mention: string; resolveAs: string }
export interface Exclusion { term: string }

export interface StructuredIntent {
  agencies: AgencyMention[];
  states: string[];
  setAsides: SetAsideKey[];
  naics: string[];
  psc: string[];
  exclusions: Exclusion[];
  horizonHint: 'recompete' | 'forecast' | null;
  /** Wrapper / filler / routing words removed (audit trail). */
  stripped: string[];
  /** What remains for lexical concept classification. */
  residual: string;
}

// ── Lexicons ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps' curated agency phrases (route.ts SEARCH_PANEL_JS `_AGENCY_NEEDLES`, shipping since
 * 2026-08-03), each mapped to the alias key MCP's resolveBuyerIdentity normalizes.
 */
const MAPS_AGENCY_PHRASES: Array<{ resolveAs: string; phrases: string[] }> = [
  { resolveAs: 'ARMY', phrases: ['army', 'us army', 'u s army', 'department of the army'] },
  { resolveAs: 'NAVY', phrases: ['navy', 'us navy', 'u s navy', 'department of the navy'] },
  { resolveAs: 'AIR FORCE', phrases: ['air force', 'airforce', 'usaf', 'department of the air force'] },
  { resolveAs: 'USMC', phrases: ['marine corps', 'marines', 'usmc'] },
  { resolveAs: 'COAST GUARD', phrases: ['coast guard', 'coastguard', 'uscg'] },
  { resolveAs: 'DOD', phrases: ['dod', 'department of defense', 'defense department'] },
  { resolveAs: 'VA', phrases: ['va', 'veterans affairs', 'dept of veterans', 'department of veterans', 'department of veterans affairs'] },
  { resolveAs: 'DHS', phrases: ['dhs', 'homeland security'] },
  { resolveAs: 'HHS', phrases: ['hhs', 'health and human services'] },
  { resolveAs: 'USDA', phrases: ['usda', 'dept of agriculture', 'department of agriculture'] },
  { resolveAs: 'DOE', phrases: ['doe', 'department of energy', 'energy department'] },
  { resolveAs: 'DOJ', phrases: ['doj', 'department of justice', 'justice department'] },
  { resolveAs: 'DOS', phrases: ['department of state', 'state department'] },
  { resolveAs: 'DOI', phrases: ['department of the interior', 'interior department'] },
  { resolveAs: 'DOT', phrases: ['department of transportation', 'transportation department'] },
  { resolveAs: 'TREASURY', phrases: ['department of the treasury'] },
  { resolveAs: 'NASA', phrases: ['nasa'] },
  { resolveAs: 'GSA', phrases: ['gsa', 'general services administration'] },
  { resolveAs: 'EPA', phrases: ['epa', 'environmental protection agency'] },
  { resolveAs: 'USACE', phrases: ['army corps', 'army corps of engineers', 'corps of engineers', 'usace'] },
  { resolveAs: 'NSF', phrases: ['nsf', 'national science foundation'] },
];

/**
 * Acronyms that name exactly one federal buyer and are not English words. Vetted by hand from
 * agency-aliases.json keys — `ICE`, `USA`, `AF`, `AG`, `ED`, `VET`, `CG`, `DOT`, `DOS` are
 * deliberately ABSENT (words / ambiguous) and reachable only through full names above.
 */
const UNAMBIGUOUS_ACRONYMS = [
  'dla', 'disa', 'dha', 'fema', 'noaa', 'nih', 'cdc', 'fda', 'cms', 'irs', 'usps', 'cisa', 'darpa',
  'socom', 'ussocom', 'navfac', 'navsea', 'navair', 'navwar', 'navsup', 'niwc', 'afmc', 'aflcmc',
  'hud', 'dol', 'doi', 'sba', 'ssa', 'opm', 'fbi', 'dea', 'atf', 'cbp', 'tsa', 'uscis', 'fda',
  'vha', 'vba', 'usaid', 'nrc', 'dtra', 'mda', 'nga', 'dcma', 'dcaa', 'dfas', 'usgs', 'blm', 'nps',
  'fws', 'bia', 'faa', 'fhwa', 'fta', 'nist', 'census', 'uspto', 'ihs', 'hrsa', 'samhsa', 'aphis',
];

function fold(s: string): string {
  return String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ALIASES = ((aliasData as { aliases?: Record<string, string> }).aliases || {}) as Record<string, string>;
const ALIAS_KEYS_FOLDED = new Map<string, string>(Object.keys(ALIASES).map((k) => [fold(k), k]));

/** Full proper names (≥3 words) from the alias table's canonical values — unambiguous by construction. */
const FULL_NAMES: Array<{ phrase: string; resolveAs: string }> = [...new Set(Object.values(ALIASES))]
  .map((v) => ({ phrase: fold(v), resolveAs: v }))
  .filter((x) => x.phrase.split(' ').length >= 3);

/** Every recognizable agency surface form, longest first (so "army corps of engineers" beats "army"). */
export const AGENCY_LEXICON: Array<{ phrase: string; resolveAs: string }> = (() => {
  const out = new Map<string, string>();
  for (const a of MAPS_AGENCY_PHRASES) for (const p of a.phrases) out.set(fold(p), a.resolveAs);
  for (const a of UNAMBIGUOUS_ACRONYMS) {
    const key = ALIAS_KEYS_FOLDED.get(a);
    out.set(a, key || a.toUpperCase());
  }
  for (const f of FULL_NAMES) if (!out.has(f.phrase)) out.set(f.phrase, f.resolveAs);
  return [...out.entries()].map(([phrase, resolveAs]) => ({ phrase, resolveAs })).sort((x, y) => y.phrase.length - x.phrase.length);
})();

const STATE_PHRASES: Array<{ phrase: string; code: string }> = (() => {
  const out: Array<{ phrase: string; code: string }> = [];
  for (const [code, name] of Object.entries(US_STATE_NAMES as Record<string, string>)) {
    out.push({ phrase: fold(name), code });
    if (name.startsWith('U.S. ')) out.push({ phrase: fold(name.slice(5)), code });
  }
  return out.sort((a, b) => b.phrase.length - a.phrase.length);
})();

const SET_ASIDE_PHRASES: Array<{ phrase: string; key: SetAsideKey }> = [
  ...SET_ASIDE_SYNONYMS.flatMap((s) => s.phrases.map((p) => ({ phrase: fold(p), key: s.key }))),
  { phrase: 'service disabled veteran owned small business', key: 'sdvosb' as SetAsideKey },
  { phrase: 'woman owned small business', key: 'wosb' as SetAsideKey },
].sort((a, b) => b.phrase.length - a.phrase.length);

/** Leading imperative wrappers — only at the START of the query. */
const WRAPPERS = ['show me', 'show', 'find me', 'find', 'get me', 'give me', 'list', 'search for', 'search', 'looking for', 'i want', 'i need', 'what are', 'are there any', 'any'];
/** Opportunity nouns — never a capability. */
const OPP_NOUNS = ['opportunities', 'opportunity', 'opps', 'opp', 'solicitations', 'solicitation', 'bids', 'rfps', 'rfp', 'rfqs', 'rfq', 'notices'];
/** "contract(s)" routes to opportunities only when another structured intent was found (Maps rule). */
const CONTRACT_NOUNS = ['contracts', 'contract'];
const LIFECYCLE: Array<{ hint: 'recompete' | 'forecast'; phrases: string[] }> = [
  { hint: 'recompete', phrases: ['recompetes', 'recompete', 'expiring', 'expiration', 'expire'] },
  { hint: 'forecast', phrases: ['forecasts', 'forecast', 'planned', 'upcoming'] },
];
/** Sort/routing words for the Players map — never an opportunity capability. */
const ROUTING = ['biggest', 'largest', 'top'];
/** Connective filler left over after extraction. */
const FILLER = ['in', 'for', 'from', 'by', 'with', 'at', 'near', 'the', 'me', 'my', 'of', 'to', 'on', 'within'];

// ── Extraction ───────────────────────────────────────────────────────────────────────────

const NAICS_SECTORS = new Set(['11', '21', '22', '23', '31', '32', '33', '42', '44', '45', '48', '49', '51', '52', '53', '54', '55', '56', '61', '62', '71', '72', '81', '92']);

/** Whole-token phrase removal (space-padded — never a substring of a longer word). */
function takePhrase(padded: string, phrase: string): { hit: boolean; rest: string } {
  const t = ` ${phrase} `;
  let rest = padded;
  let hit = false;
  while (rest.includes(t)) { rest = rest.replace(t, ' '); hit = true; }
  return { hit, rest };
}

export function extractStructuredIntent(raw: string): StructuredIntent {
  const out: StructuredIntent = { agencies: [], states: [], setAsides: [], naics: [], psc: [], exclusions: [], horizonHint: null, stripped: [], residual: '' };

  // Exclusions first, from the RAW text (normalization would fold '-' into a space).
  let text = String(raw || '').replace(/(^|\s)-([^\s-][^\s]*)/g, (_m, lead: string, word: string) => {
    const t = fold(word);
    if (t) out.exclusions.push({ term: t });
    return lead;
  });

  // Hyphenated compounds ("follow-on") are remembered and re-joined in the RESIDUAL only, so
  // structured phrases still see plain words ("service-disabled veteran owned" → one SDVOSB).
  const compounds = [...String(text).matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/gi)].map((m) => fold(m[0])).filter((c) => c.includes(' '));
  // `,` and `;` are ALTERNATIVE separators (decision 2) — kept as tokens so the matcher can split on them.
  let p = ` ${String(text).toLowerCase().replace(/\([^)]*\)/g, (m) => ` ${m.slice(1, -1)} `).replace(/[,;]/g, ' , ').replace(/[^a-z0-9,\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;

  // Codes embedded in a sentence: NAICS (valid sector prefix, 4–6 digits — a 2-digit number in prose
  // is a count, "33 dorms") and PSC (4 chars, letter+digit). A bare whole-query code never reaches
  // here; resolveQueryIntent owns it (2–6 digits), as today.
  p = p.replace(/ (\d{4,6})(?= )/g, (m, code: string) => {
    if (NAICS_SECTORS.has(code.slice(0, 2))) { out.naics.push(code); return ' '; }
    return m;
  });
  p = p.replace(/ ([a-z][a-z0-9]{3})(?= )/g, (m, code: string) => {
    if (/\d/.test(code) && code.length === 4) { out.psc.push(code.toUpperCase()); return ' '; }
    return m;
  });

  // Leading wrapper.
  let wrapped = false;
  for (const w of WRAPPERS) {
    if (p.startsWith(` ${w} `)) { out.stripped.push(w); p = ` ${p.slice(w.length + 2)}`; wrapped = true; break; }
  }
  // A leading "<word> me <opportunity noun>" is an imperative addressed to the user WHATEVER the verb —
  // "shoe me opportunities in the Virgin Islands" is a request, not a search for shoes (saved search
  // c3f908e3, 2026-09-23: "shoe" became a required concept ∧ VI → 0 while VI had live notices).
  // STRUCTURAL, not fuzzy: the clause shape decides and the word is never compared to a spelling list.
  // Contract (Eric, 2026-09-23): only when no known wrapper matched, the very next token is an
  // opportunity noun, AND the remainder resolves to STRUCTURED intent (state / agency / set-aside / code).
  // Otherwise the word is restored below and stays a lexical concept, exactly as before.
  let clauseWord: string | null = null;
  if (!wrapped) {
    const clause = new RegExp(`^ ([a-z]+) me (?=(?:${[...OPP_NOUNS, ...CONTRACT_NOUNS].join('|')}) )`);
    const m = p.match(clause);
    if (m) { clauseWord = m[1]; p = ` me ${p.slice(m[0].length)}`; }
  }

  // Set-asides (longest phrase first), then states, then agencies (longest first).
  for (const s of SET_ASIDE_PHRASES) {
    const r = takePhrase(p, s.phrase);
    if (r.hit) { p = r.rest; if (!out.setAsides.includes(s.key)) out.setAsides.push(s.key); }
  }
  // "in XX" with a 2-letter code is a LOCATION ("janitorial in va"); a bare "va" stays an agency.
  p = p.replace(/ in ([a-z]{2})(?= )/g, (m, code: string) => {
    const c = code.toUpperCase();
    if ((US_STATE_NAMES as Record<string, string>)[c]) { if (!out.states.includes(c)) out.states.push(c); return ' '; }
    return m;
  });
  for (const s of STATE_PHRASES) {
    const r = takePhrase(p, s.phrase);
    if (r.hit) { p = r.rest; if (!out.states.includes(s.code)) out.states.push(s.code); }
  }
  for (const a of AGENCY_LEXICON) {
    const r = takePhrase(p, a.phrase);
    if (r.hit) { p = r.rest; if (!out.agencies.some((x) => x.resolveAs === a.resolveAs)) out.agencies.push({ mention: a.phrase, resolveAs: a.resolveAs }); }
  }
  for (const l of LIFECYCLE) for (const ph of l.phrases) {
    const r = takePhrase(p, ph);
    if (r.hit) { p = r.rest; out.horizonHint = out.horizonHint || l.hint; out.stripped.push(ph); }
  }
  for (const w of [...OPP_NOUNS, ...ROUTING]) {
    const r = takePhrase(p, w);
    if (r.hit) { p = r.rest; out.stripped.push(w); }
  }
  const structured = out.agencies.length + out.states.length + out.setAsides.length + out.naics.length + out.psc.length > 0 || out.horizonHint;
  if (clauseWord) {
    if (structured) out.stripped.unshift(`${clauseWord} me`);
    else p = ` ${clauseWord}${p}`; // no structured remainder → the word is a search term again (pre-rule behaviour)
  }
  if (structured) {
    for (const w of CONTRACT_NOUNS) { const r = takePhrase(p, w); if (r.hit) { p = r.rest; out.stripped.push(w); } }
  }
  // Connective filler is only noise once something structured or a wrapper was pulled out;
  // on a plain phrase the shared stop-word list already handles it.
  if (structured || out.stripped.length) {
    for (const w of FILLER) { const r = takePhrase(p, w); if (r.hit) { p = r.rest; } }
  }

  for (const c of compounds) if (p.includes(` ${c} `)) p = p.replace(` ${c} `, ` ${c.replace(/ /g, '-')} `);
  out.residual = p.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').replace(/(\s*,\s*)+/g, ', ').trim();
  return out;
}

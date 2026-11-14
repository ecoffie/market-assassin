/**
 * Stage 2–3 of Canonical Discovery — CONCEPT CLASSIFICATION and LEXICAL ELIGIBILITY.
 *
 *   residual text (after structured intent) → concepts → classified (distinctive | generic)
 *   → eligibility (who may be admitted) + rank-only concepts (who may only score)
 *
 * Decisions (Eric, 2026-09-22):
 *   - Lexical, token-aware: a concept matches WORDS (Postgres `\m…\M`), never substrings.
 *     `%ai%` matched m-AI-ntenance / rep-AI-r / rem-AI-ns / AI-r — 5,078 notices vs 10 real.
 *   - Three semantic classes:
 *       distinctive — names the work (janitorial, audio, governance, cyber)
 *       qualifier   — broad but MEANINGFUL (medical, research, installation, network, market)
 *       supporting  — a modifier / context word that never names the market (pro, premium, small)
 *   - Short conceptual query (≤3 MEANINGFUL concepts = distinctive ∪ qualifier): all of them required;
 *     supporting words rank only. "medical billing" requires both; "Pro Audio" requires audio.
 *   - Capability list (≥4 meaningful concepts): ANY distinctive concept establishes eligibility;
 *     qualifiers and supporting words rank only (breadth ranks).
 *   - A query with no meaningful concept means its supporting words; it never widens.
 *   - Explicit commas / "or" are alternatives (OR of independently-evaluated blocks).
 *   - Importance is SEMANTIC classification, never character length. `pro` is generic because it is
 *     a quality modifier; `pam` is distinctive because it is not.
 *
 * Every horizon builds its predicate from the same TextMatcher; only the column list differs.
 */
import { termOfArtSynonyms } from '@/lib/market/sector-expansions';
import { GENERIC_SINGLE_WORDS, looksLikeRealWord } from '@/lib/market/keyword-sanitize';
import { COMMON_TERM_WEIGHT, queryWords } from '@/lib/mi-dashboard/search';
import { SHORT_DOMAIN_TOKENS, MODIFIER_TERMS, CONTEXT_TERMS } from '@/lib/beginner/activity';
import corpusWordDf from './corpus-word-df.json';

export type ConceptClass = 'distinctive' | 'qualifier' | 'supporting';
export type Inflect = 'none' | 'plural' | 'full';

export interface Concept {
  label: string;
  cls: ConceptClass;
  /** Why it got that class (audit trail — the golden file shows it). */
  basis: string;
  /** Surface forms; a multi-word form matches as an adjacent phrase (space or hyphen). */
  forms: string[];
  /** Term-of-art aliases that also satisfy this concept. */
  aliases: string[];
  inflect: Inflect;
  /**
   * ACRONYM forms, matched CASE-SENSITIVELY in upper case (PostgREST `match`, i.e. `~`). An acronym
   * typed in lower case ("it", "ai") is still the acronym; a pronoun in the corpus is not. Measured
   * 2026-09-22: Virginia forecast descriptions match `\mit\M` 118× case-insensitively vs `\mIT\M`
   * 68× — ~50 hits were the pronoun "it". Explicit, never inferred from length.
   */
  acronyms?: string[];
  /** Rank weight when matched (distinctive 1; generic from the corpus-measured table). */
  weight: number;
  unrecognized?: boolean;
  /**
   * Words that ALL appearing anywhere in the record also establish this concept — the query's
   * plain-word meaning, kept so recognizing a concept only ever ADDS forms (never narrows).
   */
  cooccur?: Concept[];
}

export interface Alternative {
  shape: 'concept_query' | 'capability_list';
  /** 'all' = every eligible concept required; 'any' = one eligible concept admits. */
  eligibility: 'all' | 'any';
  eligible: Concept[];
  rankOnly: Concept[];
  /**
   * Capability lists only: labels of eligible concepts that may NOT admit a record on their own. Each needs a
   * second concept from this list in the same record (a rare eligible concept still admits alone). See
   * `capabilityListTiers`. Absent = every eligible concept admits on its own (the previous behaviour).
   */
  partnerRequired?: string[];
}

export interface TextMatcher {
  mode: 'none' | 'code' | 'exact_phrase' | 'lexical';
  normalized: string;
  phrase: string | null;
  /** OR across alternatives (explicit comma / "or"). Usually one. */
  alternatives: Alternative[];
  /** `-term` exclusions (from structured intent). Applied as a separate AND clause. */
  excluded: Concept[];
}

/**
 * Supporting words not in the platform lists but understood as modifiers in discovery.
 * Kept tiny and explicit; every addition changes what every surface admits.
 */
export const DISCOVERY_SUPPORTING: ReadonlySet<string> = new Set([
  // quality / quantity modifiers — never name a market on their own
  'pro', 'premium', 'new', 'various', 'misc', 'miscellaneous', 'related', 'needs', 'requirement',
]);

/**
 * Broad-but-meaningful words the platform lists miss. `market` is procurement-process vocabulary
 * ("market research was conducted", "fair market value"): alone it admitted 2,924 forecasts for
 * "market research" (measured 2026-09-22, was 40) — so it may never admit by itself in a list,
 * but inside a short query it is part of what was asked.
 */
export const DISCOVERY_QUALIFIERS: ReadonlySet<string> = new Set(['market']);

/**
 * Pronouns never name a market and never establish eligibility (Agent 3, 2026-11-14). They still COUNT toward the
 * query's shape (a typed sentence stays the capability list it was), but they are moved to rank-only, so they can
 * neither admit a record nor be required as a partner. Live defect this closes: "We provide security guards." made
 * "we" (2.9% of notices) a partner word, so the trade word needed "we" in the same notice and 0 of 13 open guard
 * notices (561612) came back, while Navy parts notices containing "we" and "Coast Guard" did.
 */
export const PRONOUNS: ReadonlySet<string> = new Set([
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
  'they', 'them', 'their', 'theirs', 'itself', 'ourselves', 'themselves',
]);

/**
 * CLOSED-CLASS English function words (pronouns, determiners, prepositions, conjunctions, auxiliaries / modals,
 * wh-words, function adverbs). Same treatment as pronouns: they count toward shape, never admit, never pair. Agent 1
 * (2026-11-14): the capability-list tiers exposed every unlisted function word at 1–5% of notices as a PARTNER word
 * ("so", "into", "about", "between", "while", "both", "every", "some", "same", "how", "was", "were" …), the same
 * failure as "we". Open-class verbs ("make", "offer", "serve") are sentence handling (C3) and are NOT listed here.
 * "it" is excluded on purpose: it is matched only as the upper-case acronym IT (TOKEN_ACRONYMS).
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  ...PRONOUNS,
  // determiners / quantifiers
  'this', 'that', 'these', 'those', 'each', 'every', 'either', 'neither', 'both', 'some', 'many', 'much', 'more', 'most',
  'few', 'several', 'such', 'same', 'own', 'no', 'its', 'whose', 'which', 'what', 'who', 'whom',
  // prepositions
  'at', 'by', 'from', 'into', 'onto', 'over', 'under', 'about', 'above', 'below', 'between', 'among', 'through', 'during',
  'before', 'after', 'since', 'until', 'while', 'within', 'without', 'against', 'per', 'via', 'as', 'than', 'upon',
  // conjunctions
  'but', 'nor', 'so', 'yet', 'if', 'then', 'because', 'although', 'though', 'whether',
  // auxiliaries / modals
  'am', 'was', 'were', 'be', 'been', 'being', 'had', 'having', 'do', 'does', 'did', 'doing', 'can', 'could', 'will',
  'would', 'shall', 'should', 'may', 'might', 'must',
  // wh-words and function adverbs
  'where', 'when', 'why', 'how', 'also', 'too', 'very', 'just', 'only', 'even', 'still', 'already', 'again', 'ever',
  'never', 'not', 'yes', 'here', 'there', 'etc',
]);

/**
 * Recognized concepts — ONE unit whose forms are interchangeable. `acronyms` match case-sensitively.
 * `cybersecurity` mirrors MCP's own CYBER_DIRECT_RE (`cyber(?:\s*security)?`): with word boundaries
 * alone, "cyber" stopped matching "cybersecurity" — 249 active notices say cybersecurity, 25 say cyber
 * (measured 2026-09-22) — so a "cyber" search would have lost ~90% of its market.
 */
export const CONCEPTS: ReadonlyArray<{ id: string; forms: string[]; acronyms?: string[]; cooccur?: string[]; names?: string[] }> = [
  { id: 'artificial intelligence', forms: ['artificial intelligence'], acronyms: ['AI'] },
  { id: 'machine learning', forms: ['machine learning'], acronyms: ['ML'] },
  { id: 'information technology', forms: ['information technology'], acronyms: ['IT'] },
  { id: 'cybersecurity', forms: ['cybersecurity', 'cyber security', 'cyber'] },
  /**
   * SOFTWARE LICENSE (Eric, Decision #4, 2026-09-23). Agencies rarely write "software license" in the
   * title; they write what they are renewing. Every form below was measured before it was admitted
   * (active open / live recompete / forecast, 2026-09-23): software licen{se,ses,sing,sed} 46/786/232 ·
   * software subscription(s) 6/170/50 · software renewal(s) 0/126/77 · software maintenance renewal(s)
   * 1/32/14 · license subscription(s) 0/70/13 · license renewal(s) 2/217/93 · license maintenance
   * 1/39/15. The `license …` phrases were audited row by row: the hits with no software cue anywhere
   * are still named software products (SolarWinds, UiPath, Citrix, Palo Alto, COMSOL, ANSYS, Stata,
   * GeoStudio) — no professional, reactor or driver license renewal appeared.
   * ⚠️ Never a bare word: `license`, `subscription`, `maintenance`, `renewal` stay ordinary words, and
   * "simulation renewal" / "software support" are NOT forms — a license must be named, or software
   * must be the thing renewed/subscribed.
   * `cooccur` keeps the pre-concept meaning ("software" AND "license" anywhere): replacing it with the
   * phrases alone was measured and REJECTED — it dropped real buys the plain words find ("Microsoft
   * Software Enterprise Licenses", "Renewal of Adobe Subscription Licenses", Oracle ULA, and every
   * recompete whose PSC reads "(PERPETUAL LICENSE SOFTWARE)"). The concept is additive only.
   */
  {
    id: 'software license',
    forms: ['software license', 'software subscription', 'software maintenance renewal', 'software renewal', 'license subscription', 'license renewal', 'license maintenance'],
    cooccur: ['software', 'license'],
    // Only the NAME recognizes the concept in a query. "license renewal" or "software subscriptions"
    // typed alone keep their own plain-word meaning; widening them to every software license was
    // measured (+6,632 recompetes for "license renewal") and is not what those users asked for.
    names: ['software license'],
  },
];

/** User-typed domain acronyms (the /try SHORT_DOMAIN_TOKENS) — matched case-sensitively in upper case. */
const TOKEN_ACRONYMS: ReadonlySet<string> = new Set([...SHORT_DOMAIN_TOKENS]);

const CONCEPT_QUERY_MAX = 3;

export function normalizeQuery(raw: string): string {
  return String(raw || '').toLowerCase().replace(/[“”]/g, '"').replace(/[^a-z0-9"\s&-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isCodeLike(raw: string): boolean {
  const t = String(raw || '').trim();
  return /\d/.test(t) && !/\s/.test(t) && t.length <= 8;
}

/**
 * Semantic class of one word. No length rule.
 * Order matters: a modifier/context word is SUPPORTING even if a broad list also carries it.
 */
export function classifyWord(w: string): { cls: ConceptClass; basis: string; weight: number } {
  if (MODIFIER_TERMS.has(w)) return { cls: 'supporting', basis: 'modifier', weight: 0.3 };
  if (CONTEXT_TERMS.has(w)) return { cls: 'supporting', basis: 'context_word', weight: 0.25 };
  if (DISCOVERY_SUPPORTING.has(w)) return { cls: 'supporting', basis: 'discovery_supporting', weight: 0.3 };
  if (COMMON_TERM_WEIGHT[w] !== undefined) return { cls: 'qualifier', basis: 'corpus_common_term', weight: COMMON_TERM_WEIGHT[w] };
  if (GENERIC_SINGLE_WORDS.has(w)) return { cls: 'qualifier', basis: 'platform_generic_word', weight: 0.35 };
  if (DISCOVERY_QUALIFIERS.has(w)) return { cls: 'qualifier', basis: 'discovery_qualifier', weight: 0.35 };
  return { cls: 'distinctive', basis: SHORT_DOMAIN_TOKENS.has(w) ? 'domain_token' : 'not_in_generic_lists', weight: 1 };
}

/** Inflection is a MATCHING rule (what counts as the same word), not an importance rule. */
function inflectFor(w: string, isConcept = false): Inflect {
  if (isConcept || SHORT_DOMAIN_TOKENS.has(w) || w.length <= 2) return 'none';
  if (w.length === 3) return 'plural'; // "pams", never "pamed"
  return 'full';
}

function wordConcept(w: string): Concept {
  const c = classifyWord(w);
  const aliases = (termOfArtSynonyms(w) || []).map(normalizeQuery).filter((a) => a && a !== w);
  const unrecognized = /^[a-z]+$/.test(w) && !looksLikeRealWord(w);
  if (TOKEN_ACRONYMS.has(w)) {
    return { label: w, cls: c.cls, basis: c.basis, forms: [], acronyms: [w.toUpperCase()], aliases: [...new Set(aliases)], inflect: 'none', weight: c.weight };
  }
  return { label: w, cls: c.cls, basis: c.basis, forms: [w], aliases: [...new Set(aliases)], inflect: inflectFor(w), weight: c.weight, ...(unrecognized ? { unrecognized: true } : {}) };
}

/** Concepts in one alternative's text: recognized concepts, hyphenated compounds, then words. */
function conceptsOf(text: string): Concept[] {
  let t = ` ${normalizeQuery(text).replace(/"/g, ' ')} `;
  const out: Concept[] = [];
  for (const c of CONCEPTS) {
    // A query names a concept in the same inflections a record does ("software licenses",
    // "software licensing"), so recognition uses the record regex; acronyms stay exact.
    const phrases = [...(c.names || c.forms)].sort((a, b) => b.length - a.length).map((f) => new RegExp(` ${formAlt(f, 'full')}(?= )`, 'g'));
    const acr = (c.acronyms || []).map((a) => a.toLowerCase());
    if (!phrases.some((re) => re.test(t)) && !acr.some((a) => t.includes(` ${a} `))) continue;
    for (const re of phrases) t = t.replace(re, ' ');
    for (const a of acr) t = t.split(` ${a} `).join(' ');
    out.push({
      label: c.id, cls: 'distinctive', basis: 'recognized_concept', forms: [...c.forms], aliases: [], inflect: 'full', weight: 1,
      ...(c.acronyms ? { acronyms: [...c.acronyms] } : {}),
      ...(c.cooccur ? { cooccur: c.cooccur.map(wordConcept) } : {}),
    });
  }
  t = t.replace(/ ([a-z0-9]+(?:-[a-z0-9]+)+)(?= )/g, (_m, comp: string) => {
    const form = comp.replace(/-/g, ' ');
    out.push({ label: form, cls: 'distinctive', basis: 'hyphenated_compound', forms: [form], aliases: [], inflect: 'full', weight: 1 });
    return ' ';
  });
  const words = queryWords(t.replace(/-/g, ' '));
  // A query made ONLY of stop-words still means those words.
  const fallback = !words.length && !out.length ? [...new Set(t.trim().split(/\s+/).filter((w) => w.length >= 2))].slice(0, 8) : [];
  for (const w of [...words, ...fallback]) {
    if (out.some((c) => c.label === w)) continue;
    const c = wordConcept(w);
    if (fallback.length) { c.cls = 'qualifier'; c.basis = 'stop_word_only_query'; }
    out.push(c);
  }
  return out;
}

/**
 * Corpus document frequency of a plain query word: the share of active SAM notices whose title or description
 * contains it (src/lib/discovery/corpus-word-df.json, built by scripts/build-corpus-word-df.ts; words under 1% are
 * not listed and read as 0). The matcher treats a word and its singular as the same word, so the lookup takes the
 * higher of the two ("grounds" reads as "ground"). Phrases and recognized concepts are never looked up.
 */
const CORPUS_DF: Readonly<Record<string, number>> = (corpusWordDf as { df: Record<string, number> }).df;
export const COMMON_WORD_DF = 0.05;
export const PARTNER_WORD_DF = 0.01;
export const MAX_PARTNER_WORDS = 6;
/** The frequency table must be rebuilt (scripts/build-corpus-word-df.ts) before it is this old; a test enforces it. */
export const CORPUS_DF_MAX_AGE_DAYS = 180;
export function corpusDf(label: string): number {
  if (!label || label.includes(' ')) return 0;
  return Math.max(0, ...bases(label).map((w) => CORPUS_DF[w] ?? 0));
}

/**
 * CAPABILITY-LIST TIERS (Agent 3, 2026-11-14; blind-labeled eval in tasks/anyword-matching-2026-11-14.md).
 * A capability list used to admit a record on ANY one distinctive word. Words that are common across all notices
 * ("provide" 19%, "access" 9%, "air" 6%, "removal" 2%, "digital" 1%) then admitted thousands of unrelated notices:
 * "armed and unarmed security guards patrol and access control services" returned 2,580 notices, almost all on
 * "access". Same rule as the documented COMMON_TERM_WEIGHT ("df >= ~5% of the corpus => common"), measured per word:
 *   df >= 5%      common   → rank only (never admits)
 *   1% <= df < 5% partner  → admits only together with another listed word in the same record
 *   df < 1%       rare     → admits on its own (unchanged)
 * Recognized concepts and hyphenated compounds are never tiered. A list with one partner word and no rare word keeps
 * that word admitting alone (otherwise it could never match). A list whose words are ALL common falls through to the
 * existing fail-narrow rule (all required). Short queries (<= 3 meaningful concepts) are untouched.
 */
function capabilityListTiers(distinctive: Concept[]): { common: Concept[]; admit: Concept[]; partnerRequired: string[] } {
  const dfOf = (c: Concept) => (c.basis === 'recognized_concept' || c.basis === 'hyphenated_compound' ? 0 : corpusDf(c.label));
  const common = distinctive.filter((c) => dfOf(c) >= COMMON_WORD_DF);
  const admit = distinctive.filter((c) => dfOf(c) < COMMON_WORD_DF);
  // Pairs grow quadratically; keep the MAX_PARTNER_WORDS rarest partner words (at most 15 pairs) and let the rest rank
  // only, so a long list can never push the PostgREST URL past its limit. Narrowing only.
  const partnerAll = admit.filter((c) => dfOf(c) >= PARTNER_WORD_DF).sort((x, y) => dfOf(x) - dfOf(y));
  const partner = partnerAll.slice(0, MAX_PARTNER_WORDS);
  const overflow = partnerAll.slice(MAX_PARTNER_WORDS);
  const rare = admit.filter((c) => dfOf(c) < PARTNER_WORD_DF);
  const kept = admit.filter((c) => !overflow.includes(c));
  const partnerRequired = rare.length || partner.length > 1 ? partner.map((c) => c.label) : [];
  return { common: [...common, ...overflow], admit: kept, partnerRequired };
}

function alternativeOf(text: string): Alternative | null {
  const all = conceptsOf(text);
  if (!all.length) return null;
  const pronouns = all.filter((c) => FUNCTION_WORDS.has(c.label));
  // Shape is decided on every concept (unchanged); pronouns are then removed from eligibility and only rank.
  const alt = alternativeOfConcepts(all);
  if (!alt || !pronouns.length) return alt;
  const isPronoun = (c: Concept) => FUNCTION_WORDS.has(c.label);
  const eligible = alt.eligible.filter((c) => !isPronoun(c));
  if (!eligible.length) {
    // Only a pronoun could admit: decide on the other words alone (fail-narrow if they are all broad); a query made
    // of nothing but pronouns keeps its own words.
    const rest = all.filter((c) => !isPronoun(c));
    return rest.length ? alternativeOfConcepts(rest) : alt;
  }
  const partnerRequired = (alt.partnerRequired || []).filter((l) => !FUNCTION_WORDS.has(l));
  const solo = eligible.filter((c) => !partnerRequired.includes(c.label));
  // A partner word that lost its only partner (the pronoun) admits alone again, as a lone partner word always does.
  const keepPartners = solo.length || partnerRequired.length > 1 ? partnerRequired : [];
  const { partnerRequired: _drop, ...rest } = alt;
  return { ...rest, eligible, rankOnly: [...alt.rankOnly, ...alt.eligible.filter(isPronoun)], ...(keepPartners.length ? { partnerRequired: keepPartners } : {}) };
}

function alternativeOfConcepts(concepts: Concept[]): Alternative | null {
  if (!concepts.length) return null;
  const distinctive = concepts.filter((c) => c.cls === 'distinctive');
  const qualifiers = concepts.filter((c) => c.cls === 'qualifier');
  const supporting = concepts.filter((c) => c.cls === 'supporting');
  const meaningful = [...distinctive, ...qualifiers];
  if (!meaningful.length) {
    // Only supporting words: they are the query — all required, never widened.
    return { shape: 'concept_query', eligibility: 'all', eligible: supporting, rankOnly: [] };
  }
  if (meaningful.length <= CONCEPT_QUERY_MAX) {
    return { shape: 'concept_query', eligibility: 'all', eligible: meaningful, rankOnly: supporting };
  }
  const tiers = capabilityListTiers(distinctive);
  if (tiers.admit.length) {
    return {
      shape: 'capability_list', eligibility: 'any', eligible: tiers.admit, rankOnly: [...tiers.common, ...qualifiers, ...supporting],
      ...(tiers.partnerRequired.length ? { partnerRequired: tiers.partnerRequired } : {}),
    };
  }
  // A long list of only broad (or only corpus-common) words: fail NARROW (all required) rather than admit on any one.
  return { shape: 'capability_list', eligibility: 'all', eligible: [...tiers.common, ...qualifiers], rankOnly: supporting };
}

/**
 * Build the matcher from RESIDUAL text (structured intent already removed) plus exclusions.
 * Pure. The ONLY function that tokenizes discovery text.
 */
export function buildTextMatcher(residual: string, exclusions: string[] = []): TextMatcher {
  const trimmed = String(residual || '').trim();
  // An exclusion removes the NAMED forms only — never the co-occurrence of two ordinary words.
  const excluded = exclusions.flatMap((e) => conceptsOf(e)).map(({ cooccur: _drop, ...c }) => c);
  if (!trimmed) return { mode: 'none', normalized: '', phrase: null, alternatives: [], excluded };

  if (isCodeLike(trimmed)) return { mode: 'code', normalized: trimmed.toLowerCase(), phrase: trimmed, alternatives: [], excluded };

  const quoted = trimmed.match(/^["“](.+)["”]$/);
  if (quoted) {
    const phrase = normalizeQuery(quoted[1]).replace(/"/g, '').replace(/-/g, ' ').trim();
    if (phrase) return { mode: 'exact_phrase', normalized: phrase, phrase, alternatives: [], excluded };
  }

  const normalized = normalizeQuery(trimmed);
  const parts = trimmed.split(/\s*[,;]\s*|\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
  const built = parts.map(alternativeOf).filter(Boolean) as Alternative[];
  // A comma-separated part made ONLY of function words ("…, so that is what we do.") names no market: drop it when the
  // query has another part, so it can never admit on "so" / "that" / "we". A query with nothing else keeps its words.
  const marketParts = built.filter((a) => !a.eligible.every((c) => FUNCTION_WORDS.has(c.label)));
  const alternatives = marketParts.length ? marketParts : built;
  if (!alternatives.length) return { mode: 'none', normalized, phrase: null, alternatives: [], excluded };
  return { mode: 'lexical', normalized, phrase: null, alternatives, excluded };
}

// ── Regex construction ──────────────────────────────────────────────────────────────────────

function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bases(word: string): string[] {
  const out = new Set<string>([word]);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) out.add(word.slice(0, -1));
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('ses')) out.add(word.slice(0, -2));
  return [...out];
}

function wordAlt(word: string, inflect: Inflect): string {
  if (inflect === 'none') return reEscape(word);
  if (inflect === 'plural') return `${reEscape(word)}s?`;
  const alts: string[] = [];
  for (const b of bases(word)) {
    alts.push(`${reEscape(b)}(s|es|ing|ed)?`);
    if (b.endsWith('e') && b.length > 3) alts.push(`${reEscape(b.slice(0, -1))}(ing|ed)`);
  }
  return alts.length === 1 ? alts[0] : `(${alts.join('|')})`;
}

function formAlt(form: string, inflect: Inflect): string {
  const words = form.split(' ').filter(Boolean);
  if (words.length === 1) return wordAlt(words[0], inflect);
  return words.map((w, i) => wordAlt(w, i === words.length - 1 ? 'full' : 'none')).join('[-\\s]+');
}

/**
 * A concept's regexes: `ci` (case-insensitive, imatch) for words/phrases/aliases and `cs`
 * (case-SENSITIVE, match) for its upper-case acronyms. Either may be null; never both.
 */
export function conceptRegexes(c: Concept): { ci: string | null; cs: string | null } {
  const alts = [...new Set([...c.forms.map((f) => formAlt(f, c.inflect)), ...c.aliases.map((a) => formAlt(a, 'full'))])];
  const ci = alts.length ? `\\m${alts.length === 1 ? alts[0] : `(${alts.join('|')})`}\\M` : null;
  const acr = [...new Set(c.acronyms || [])].map((a) => `${reEscape(a)}s?`);
  const cs = acr.length ? `\\m${acr.length === 1 ? acr[0] : `(${acr.join('|')})`}\\M` : null;
  return { ci, cs };
}

/** One ordinary word as a whole-word, fully inflected regex — the same shape the text matcher builds. */
export function wordRegex(word: string): string {
  return `\\m${wordAlt(word.toLowerCase(), 'full')}\\M`;
}

export function phraseRegex(phrase: string): string {
  return `\\m${phrase.split(' ').filter(Boolean).map(reEscape).join('[-\\s]+')}\\M`;
}

export function codeRegex(code: string): string {
  const flexible = reEscape(code)
    .replace(/[-/_. ]+/g, '[-/_. ]?')
    .replace(/([A-Za-z])(?=\d)/g, '$1[-/_. ]?')
    .replace(/(\d)(?=[A-Za-z])/g, '$1[-/_. ]?');
  return `\\m${flexible}\\M`;
}

const quote = (re: string) => `"${re.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** `col.imatch."<regex>"` — ALWAYS quoted, backslashes doubled (measured: required for `( | )`). */
export function imatchClause(col: string, regex: string): string {
  return `${col}.imatch.${quote(regex)}`;
}

/** Case-SENSITIVE `col.match."<regex>"` — acronyms only. */
export function matchClause(col: string, regex: string): string {
  return `${col}.match.${quote(regex)}`;
}

function unit(re: string, cols: readonly string[]): string {
  return cols.map((c) => imatchClause(c, re)).join(',');
}

/** One concept across columns: its case-insensitive and case-sensitive clauses, OR-ed. */
function conceptUnit(c: Concept, cols: readonly string[]): string {
  const { ci, cs } = conceptRegexes(c);
  const parts: string[] = [];
  for (const col of cols) {
    if (ci) parts.push(imatchClause(col, ci));
    if (cs) parts.push(matchClause(col, cs));
  }
  if (c.cooccur?.length) parts.push(`and(${c.cooccur.map((w) => `or(${conceptUnit(w, cols)})`).join(',')})`);
  return parts.join(',');
}

/**
 * ELIGIBILITY predicate as one PostgREST logic body (no outer wrapper), so a caller can `.or()` it
 * directly or union it with taxonomy clauses in the SAME `.or()`. Rank-only concepts never appear.
 */
export function textPredicate(m: TextMatcher, cols: readonly string[]): string | null {
  if (!cols.length) return null;
  if (m.mode === 'code') return unit(codeRegex(m.phrase || ''), cols);
  if (m.mode === 'exact_phrase') return unit(phraseRegex(m.phrase || ''), cols);
  if (m.mode !== 'lexical') return null;
  const blocks = m.alternatives.map((a) => {
    if (a.eligibility === 'any' && a.partnerRequired?.length) {
      const needs = new Set(a.partnerRequired);
      const solo = a.eligible.filter((c) => !needs.has(c.label)).map((c) => conceptUnit(c, cols));
      const partner = a.eligible.filter((c) => needs.has(c.label));
      const pairs: string[] = [];
      for (let i = 0; i < partner.length; i++) for (let j = i + 1; j < partner.length; j++) {
        pairs.push(`and(or(${conceptUnit(partner[i], cols)}),or(${conceptUnit(partner[j], cols)}))`);
      }
      return [...solo, ...pairs].join(',');
    }
    if (a.eligibility === 'any' || a.eligible.length === 1) {
      return a.eligible.map((c) => conceptUnit(c, cols)).join(',');
    }
    return `and(${a.eligible.map((c) => `or(${conceptUnit(c, cols)})`).join(',')})`;
  });
  return blocks.join(',') || null;
}

/** NULL-safe exclusion: `(col IS NULL OR col !~* R)` for every column × excluded concept, ANDed. */
export function exclusionPredicate(m: TextMatcher, cols: readonly string[]): string | null {
  if (!m.excluded.length || !cols.length) return null;
  const parts: string[] = [];
  for (const c of m.excluded) {
    const { ci, cs } = conceptRegexes(c);
    for (const col of cols) {
      // NULL-safe per column; a record is dropped if EITHER form (word or acronym) appears.
      const not = [ci && `${col}.not.imatch.${quote(ci)}`, cs && `${col}.not.match.${quote(cs)}`].filter(Boolean) as string[];
      parts.push(`or(${col}.is.null,${not.length === 1 ? not[0] : `and(${not.join(',')})`})`);
    }
  }
  return parts.length === 1 ? parts[0] : `and(${parts.join(',')})`;
}

// ── JS mirror (tests, inspection, ranking) ───────────────────────────────────────────────────

export function jsRegex(pgRegex: string, caseSensitive = false): RegExp {
  return new RegExp(pgRegex.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), caseSensitive ? '' : 'i');
}

export function conceptHit(c: Concept, text: string): boolean {
  const { ci, cs } = conceptRegexes(c);
  return (!!ci && jsRegex(ci).test(text)) || (!!cs && jsRegex(cs, true).test(text))
    || (!!c.cooccur?.length && c.cooccur.every((w) => conceptHit(w, text)));
}

export function matchesText(m: TextMatcher, texts: Array<string | null | undefined>): boolean {
  const blob = texts.map((t) => String(t || '')).join(' \n ');
  if (m.excluded.some((c) => conceptHit(c, blob))) return false;
  if (m.mode === 'code') return jsRegex(codeRegex(m.phrase || '')).test(blob);
  if (m.mode === 'exact_phrase') return jsRegex(phraseRegex(m.phrase || '')).test(blob);
  if (m.mode !== 'lexical') return m.excluded.length > 0;
  return m.alternatives.some((a) => {
    if (a.eligibility === 'all') return a.eligible.every((c) => conceptHit(c, blob));
    const needs = new Set(a.partnerRequired || []);
    if (a.eligible.some((c) => !needs.has(c.label) && conceptHit(c, blob))) return true;
    return a.eligible.filter((c) => needs.has(c.label) && conceptHit(c, blob)).length >= 2;
  });
}

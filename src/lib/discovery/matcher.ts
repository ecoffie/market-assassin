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
  /** Rank weight when matched (distinctive 1; generic from the corpus-measured table). */
  weight: number;
  unrecognized?: boolean;
}

export interface Alternative {
  shape: 'concept_query' | 'capability_list';
  /** 'all' = every eligible concept required; 'any' = one eligible concept admits. */
  eligibility: 'all' | 'any';
  eligible: Concept[];
  rankOnly: Concept[];
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

/** Recognized multi-word concepts ↔ acronym (ONE concept, interchangeable forms). */
export const CONCEPTS: ReadonlyArray<{ id: string; forms: string[] }> = [
  { id: 'artificial intelligence', forms: ['artificial intelligence', 'ai'] },
  { id: 'machine learning', forms: ['machine learning', 'ml'] },
  { id: 'information technology', forms: ['information technology', 'it'] },
];

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
  return { label: w, cls: c.cls, basis: c.basis, forms: [w], aliases: [...new Set(aliases)], inflect: inflectFor(w), weight: c.weight, ...(unrecognized ? { unrecognized: true } : {}) };
}

/** Concepts in one alternative's text: recognized concepts, hyphenated compounds, then words. */
function conceptsOf(text: string): Concept[] {
  let t = ` ${normalizeQuery(text).replace(/"/g, ' ')} `;
  const out: Concept[] = [];
  for (const c of CONCEPTS) {
    if (!c.forms.some((f) => t.includes(` ${f} `))) continue;
    for (const f of c.forms) t = t.split(` ${f} `).join(' ');
    out.push({ label: c.id, cls: 'distinctive', basis: 'recognized_concept', forms: [...c.forms], aliases: [], inflect: 'none', weight: 1 });
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

function alternativeOf(text: string): Alternative | null {
  const concepts = conceptsOf(text);
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
  if (distinctive.length) {
    return { shape: 'capability_list', eligibility: 'any', eligible: distinctive, rankOnly: [...qualifiers, ...supporting] };
  }
  // A long list of only broad words: fail NARROW (all required) rather than admit on any one.
  return { shape: 'capability_list', eligibility: 'all', eligible: qualifiers, rankOnly: supporting };
}

/**
 * Build the matcher from RESIDUAL text (structured intent already removed) plus exclusions.
 * Pure. The ONLY function that tokenizes discovery text.
 */
export function buildTextMatcher(residual: string, exclusions: string[] = []): TextMatcher {
  const trimmed = String(residual || '').trim();
  const excluded = exclusions.flatMap((e) => conceptsOf(e)).map((c) => ({ ...c }));
  if (!trimmed) return { mode: 'none', normalized: '', phrase: null, alternatives: [], excluded };

  if (isCodeLike(trimmed)) return { mode: 'code', normalized: trimmed.toLowerCase(), phrase: trimmed, alternatives: [], excluded };

  const quoted = trimmed.match(/^["“](.+)["”]$/);
  if (quoted) {
    const phrase = normalizeQuery(quoted[1]).replace(/"/g, '').replace(/-/g, ' ').trim();
    if (phrase) return { mode: 'exact_phrase', normalized: phrase, phrase, alternatives: [], excluded };
  }

  const normalized = normalizeQuery(trimmed);
  const parts = trimmed.split(/\s*[,;]\s*|\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
  const alternatives = parts.map(alternativeOf).filter(Boolean) as Alternative[];
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

export function conceptRegex(c: Concept): string {
  const alts = [...new Set([...c.forms.map((f) => formAlt(f, c.inflect)), ...c.aliases.map((a) => formAlt(a, 'full'))])];
  return `\\m${alts.length === 1 ? alts[0] : `(${alts.join('|')})`}\\M`;
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

/** `col.imatch."<regex>"` — ALWAYS quoted, backslashes doubled (measured: required for `( | )`). */
export function imatchClause(col: string, regex: string): string {
  return `${col}.imatch."${regex.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function unit(re: string, cols: readonly string[]): string {
  return cols.map((c) => imatchClause(c, re)).join(',');
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
    if (a.eligibility === 'any' || a.eligible.length === 1) {
      return a.eligible.map((c) => unit(conceptRegex(c), cols)).join(',');
    }
    return `and(${a.eligible.map((c) => `or(${unit(conceptRegex(c), cols)})`).join(',')})`;
  });
  return blocks.join(',') || null;
}

/** NULL-safe exclusion: `(col IS NULL OR col !~* R)` for every column × excluded concept, ANDed. */
export function exclusionPredicate(m: TextMatcher, cols: readonly string[]): string | null {
  if (!m.excluded.length || !cols.length) return null;
  const parts: string[] = [];
  for (const c of m.excluded) {
    const re = conceptRegex(c).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    for (const col of cols) parts.push(`or(${col}.is.null,${col}.not.imatch."${re}")`);
  }
  return parts.length === 1 ? parts[0] : `and(${parts.join(',')})`;
}

// ── JS mirror (tests, inspection, ranking) ───────────────────────────────────────────────────

export function jsRegex(pgRegex: string): RegExp {
  return new RegExp(pgRegex.replace(/\\m/g, '\\b').replace(/\\M/g, '\\b'), 'i');
}

export function conceptHit(c: Concept, text: string): boolean {
  return jsRegex(conceptRegex(c)).test(text);
}

export function matchesText(m: TextMatcher, texts: Array<string | null | undefined>): boolean {
  const blob = texts.map((t) => String(t || '')).join(' \n ');
  if (m.excluded.some((c) => conceptHit(c, blob))) return false;
  if (m.mode === 'code') return jsRegex(codeRegex(m.phrase || '')).test(blob);
  if (m.mode === 'exact_phrase') return jsRegex(phraseRegex(m.phrase || '')).test(blob);
  if (m.mode !== 'lexical') return m.excluded.length > 0;
  return m.alternatives.some((a) => (a.eligibility === 'all'
    ? a.eligible.every((c) => conceptHit(c, blob))
    : a.eligible.some((c) => conceptHit(c, blob))));
}

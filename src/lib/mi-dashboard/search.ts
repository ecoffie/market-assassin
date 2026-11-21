import { termOfArtSynonyms } from '@/lib/market/sector-expansions';

/**
 * buildSearchOr — the shared PostgREST `.or()` string for full-text opportunity search.
 * Searches title + SAM description body + extracted SOW/PWS scope text + department +
 * solicitation number, with word-boundary regex for code-like terms ("M7" ≠ "M776") and
 * substring ILIKE for phrases. Extracted from mi-dashboard so the Opportunity Map explorer
 * uses the IDENTICAL semantics — the two surfaces must never disagree on what a search matches.
 *
 * TERM-OF-ART expansion (Eric 2026-07-28): a search for "drones" also ORs UAS/UAV/unmanned-aircraft
 * so notices the literal word misses still surface — the same termOfArtSynonyms engine as app market
 * research. THIS shared function is what the MAP's Open dataset uses too (via map-filters.ts), so
 * putting it here keeps app + map + saved-search-cron in sync (the earlier fix mistakenly lived only
 * in a DUPLICATE copy inside the mi-dashboard route, so the map never got it — this consolidates it).
 */
export function buildSearchOr(search: string): string {
  const term = search.trim();
  const cols = ['title', 'description', 'sow_text', 'department', 'solicitation_number'];

  // Code-like? e.g. M7, M-7, 1005, 53-1234, AN/PVS-7. Has a digit, no whitespace,
  // short, and not a plain word. (Codes aren't terms of art — no expansion.)
  const isCodeLike = /\d/.test(term) && !/\s/.test(term) && term.length <= 8;

  if (isCodeLike) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = escaped
      .replace(/[-/_. ]+/g, '[-/_. ]?')            // existing separators → optional
      .replace(/([A-Za-z])(?=\d)/g, '$1[-/_. ]?')   // letter→digit seam
      .replace(/(\d)(?=[A-Za-z])/g, '$1[-/_. ]?');  // digit→letter seam
    const pattern = `\\m${flexible}\\M`;            // \m … \M = word boundaries
    return cols.map((c) => `${c}.imatch.${pattern}`).join(',');
  }

  // FREE TEXT. The query is split into SEGMENTS (commas, semicolons, a standalone OR, or a
  // "quoted phrase" each start one), and the segments are ORed. Inside a segment:
  //   "quoted"     → that exact phrase.
  //   1 word       → that word (+ its term-of-art aliases).
  //   2–3 words    → a CONCEPT, not a list: "active directory", "risk management framework",
  //                  "fiber optic installation". The words must appear in order, at most one word
  //                  apart, anywhere ("fiber optic cable installation", "Nashville, Tennessee"),
  //                  OR all of them must appear in the title. Any-word OR made "active directory"
  //                  match 766 open notices including a building generator job; requiring the words
  //                  anywhere in the text (AND) still returned 20, every one unrelated, because a long
  //                  SOW contains both words in different sentences. Measured 2026-11-07.
  //   4+ words     → ANY word (OR), then rankSearchResults() orders by relevance. Long entries
  //                  are word lists: Andre @ CypherIntel's "cyber cloud compliance network
  //                  server" (2026-08-02) and saved searches like "janitorial custodial grounds
  //                  turf waste removal". AND across five words returns nothing.
  // An ACRONYM matches as a whole word, optionally plural: a word of 2–3 letters, or 2–5 letters
  // typed in capitals (STIG, PQC, DAI, and aliases like UAS). As a substring it hits other words:
  // "stig" is inside "investigation", "dai" inside "daily". Lowercase 4–5 letter words ("roof",
  // "mold") stay substrings so "roof" still finds "roofing".
  const caps = new Set((term.match(/\b[A-Z]{2,5}\b/g) || []).map((w) => w.toLowerCase()));
  const segments = querySegments(term);
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.phrase) {
      const p = esc(seg.text);
      if (p) parts.push(...cols.map((c) => `${c}.ilike.%${p}%`));
      continue;
    }
    const words = queryWords(seg.text);
    if (words.length === 0) {
      const raw = esc(seg.text);
      if (raw) parts.push(...cols.map((c) => `${c}.ilike.%${raw}%`));
    } else if (words.length === 1) {
      parts.push(...wordClauses(words[0], cols, caps));
    } else if (words.length <= ALL_WORDS_MAX) {
      parts.push(...conceptClauses(words, cols, caps));
    } else {
      for (const w of words) parts.push(...wordClauses(w, cols, caps));
    }
  }
  return [...new Set(parts)].join(',');
}

/** A segment of 2..ALL_WORDS_MAX meaningful words must match ALL of them; longer segments match ANY. */
export const ALL_WORDS_MAX = 3;

// Metacharacters stripped from a value so it cannot inject a stray .or() clause.
const esc = (s: string) => s.replace(/[%,()"]/g, ' ').replace(/\s+/g, ' ').trim();

/** OR clauses across the columns for one word plus its term-of-art aliases. */
function wordClauses(word: string, cols: string[], caps: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [word, ...(termOfArtSynonyms(word) || [])]) {
    const e = esc(t);
    const key = e.toLowerCase();
    if (!e || seen.has(key)) continue;
    seen.add(key);
    if (isAcronym(e, caps)) {
      for (const c of cols) out.push(`${c}.imatch.\\m${e}s?\\M`);
    } else {
      for (const c of cols) out.push(`${c}.ilike.%${e}%`);
    }
  }
  return out;
}

/** A whole-word token: 2–3 letters, or 2–5 letters typed in capitals (in the query or an alias). */
function isAcronym(t: string, caps: Set<string>): boolean {
  if (/^[a-z]{2,3}$/i.test(t)) return true;
  return /^[a-z]{2,5}$/i.test(t) && (caps.has(t.toLowerCase()) || t === t.toUpperCase());
}
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A 2..ALL_WORDS_MAX word concept: the words in order with at most one word between them, in any
 * column (a PostgREST-safe regex: no commas or parentheses), OR every word in the title.
 */
function conceptClauses(words: string[], cols: string[], caps: Set<string>): string[] {
  const toks = words.map(esc).filter(Boolean);
  const gap = '\\W+\\w*\\W*';
  const pattern = '\\m' + toks.map((t, i) => {
    const r = reEscape(t);
    if (isAcronym(t, caps)) return `${r}s?`;
    return i < toks.length - 1 ? `${r}\\w*` : r;
  }).join(gap) + (isAcronym(toks[toks.length - 1], caps) ? '\\M' : '');
  const near = cols.map((c) => `${c}.imatch.${pattern}`);
  const inTitle = `and(${toks.map((t) => (isAcronym(t, caps) ? `title.imatch.\\m${t}s?\\M` : `title.ilike.%${t}%`)).join(',')})`;
  return [...near, inTitle];
}

/**
 * Split a free-text query into OR'd segments: each "quoted phrase" is one exact-phrase segment;
 * the rest splits on commas, semicolons and a standalone OR. Exported for tests.
 */
export function querySegments(search: string): Array<{ text: string; phrase: boolean }> {
  const out: Array<{ text: string; phrase: boolean }> = [];
  const rest = (search || '').replace(/"([^"]+)"/g, (_m, p: string) => {
    if (p.trim()) out.push({ text: p.trim(), phrase: true });
    return ',';
  });
  for (const s of rest.split(/[,;]|\s+OR\s+/)) {
    if (s.trim()) out.push({ text: s.trim(), phrase: false });
  }
  return out;
}

// Common English stop-words + GovCon filler that add noise, not signal, to a search.
// (Postgres FTS drops these too — same rationale.)
const STOP_WORDS = new Set([
  'the', 'and', 'or', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'are',
  'that', 'this', 'have', 'has', 'requirements', 'requirement', 'services', 'service',
  'support', 'related', 'other', 'all', 'any', 'available', 'opportunities', 'opportunity',
  // Chat-style filler stored in real saved searches ("Show me SBA opportunities").
  'show', 'me',
]);

/**
 * Tokenize a free-text query into the meaningful search words: split on whitespace/commas,
 * lowercase, drop stop-words + tokens under 2 chars, dedupe, cap at 8 (prompt/query budget).
 * A single-word query returns that word (so single-term search is unchanged). Exported for
 * the ranking pass + tests.
 */
export function queryWords(search: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (search || '').split(/[\s,;/]+/)) {
    const w = raw.trim().toLowerCase();
    if (w.length < 2 || STOP_WORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * GovCon-boilerplate DOWN-WEIGHT — the terms that appear in a huge fraction of DoD notices
 * as generic clauses ("contractor shall comply with cybersecurity requirements", "network
 * access", "provide support services"), so a MATCH on them is weak evidence a notice is
 * actually ABOUT that subject. This is a static, corpus-GROUNDED stand-in for IDF (rare term
 * = strong signal, common term = weak) — the exact thing BM25 / Elasticsearch / Postgres
 * ts_rank do. Without it, a valve solicitation that says "cyber" + "compliance" in boilerplate
 * out-ranks a real cloud/server opportunity, because raw coverage counts every matched term
 * equally. Measured live in the active `sam_opportunities` corpus (35,643 notices, 2026-08-02),
 * IDF = ln(N/df): compliance 2.00 (df 4,833), network 2.84 (df 2,074), cyber 3.32 (df 1,293),
 * server 4.20, cloud 4.44 — so `compliance`/`network` are the boilerplate half of Andre's
 * query and must count for LESS than `cloud`/`server`/`cyber`. df ≥ ~5% of the corpus ⇒ common.
 * (Only the genuinely-common ones are listed; everything else defaults to the full weight of 1.)
 */
export const COMMON_TERM_WEIGHT: Readonly<Record<string, number>> = {
  compliance: 0.35, network: 0.5, security: 0.5, management: 0.4, system: 0.4,
  systems: 0.4, program: 0.4, information: 0.45, technical: 0.4, data: 0.5,
  contract: 0.3, federal: 0.3, government: 0.3, general: 0.35, professional: 0.4,
  maintenance: 0.5, engineering: 0.5, operations: 0.45, technology: 0.5,
};
// Rarity weight of a query term: a known-common term is down-weighted; every other term
// (the distinctive ones — cloud, cyber, roofing, janitorial, HVAC…) carries full weight 1.
function termRarity(w: string): number {
  return COMMON_TERM_WEIGHT[w] ?? 1;
}

/**
 * Relevance-rank search rows the way every real search engine does — by an IDF-WEIGHTED score
 * of how many query words hit, WHERE (title > SOW > description > department), and HOW
 * DISTINCTIVE each matched word is. This is what makes the OR-broadened result set usable: a
 * notice matching the rare, on-topic terms ("cloud", "server") in its title floats to the top;
 * a valve notice matching only the boilerplate terms ("compliance", "network") in its body
 * sinks — even though both match "2 of 5 terms". Coverage counted RAW put "48--VALVE,GLOBE"
 * (cyber+compliance boilerplate) above real cloud opps; weighting by rarity × position fixes
 * that (Eric, live 2026-08-02 — Andre @ CypherIntel's "cyber cloud compliance network server").
 * Stable sort (ties keep input order = the caller's freshness order). Pure — no I/O.
 */
export function rankSearchResults<T extends { title?: string | null; description?: string | null; sow_text?: string | null; department?: string | null }>(
  rows: T[],
  search: string,
): T[] {
  const words = queryWords(search);
  if (words.length <= 1) return rows; // single-term: fetch order (freshness) already fine
  // Precompute each term's rarity weight once (not per-row).
  const rarity = words.map(termRarity);
  const scoreOf = (r: T): number => {
    const title = (r.title || '').toLowerCase();
    const sow = (r.sow_text || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const dept = (r.department || '').toLowerCase();
    let score = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      // Position weight (title strongest; body weakest, where boilerplate lives) × the term's
      // rarity (a distinctive word is worth far more than a generic one). A rare term in the
      // TITLE dominates; a common term in the BODY barely registers.
      let pos = 0;
      if (title.includes(w)) pos = 6;        // title = strongest position
      else if (sow.includes(w)) pos = 3;     // SOW/PWS scope = strong
      else if (desc.includes(w)) pos = 1;    // body = weak (boilerplate lives here)
      else if (dept.includes(w)) pos = 1;
      score += pos * rarity[i];
    }
    return score;
  };
  return rows
    .map((r, i) => ({ r, i, s: scoreOf(r) }))
    // Highest IDF-weighted score first; input order (freshness) breaks ties.
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.r);
}

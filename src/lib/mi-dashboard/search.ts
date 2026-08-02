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

  // MULTI-WORD query → tokenize + OR each word (the industry standard: Google / Postgres
  // FTS / Elasticsearch all default to OR-across-terms, then RANK — never a single literal
  // substring). A user typing "cyber cloud compliance network server" (Andre @ CypherIntel,
  // 2026-08-02) wants opps touching ANY of those; the old code matched the WHOLE phrase as
  // one substring → 0 results (no notice has that literal string). Now: split on whitespace/
  // commas, drop stop-words + tiny tokens, and for EACH word OR its clauses (+ that word's
  // term-of-art aliases). Relevance ranking — sorting the multi-term matches to the top so a
  // valve notice mentioning "server" once sinks — is applied AFTER the fetch by
  // rankSearchResults() (PostgREST .or() can't rank; the code layer does).
  const esc = (s: string) => s.replace(/[%,()]/g, ' ').trim();
  const words = queryWords(term);
  // Each word expands to itself + its term-of-art aliases; all metachar-stripped so an alias
  // can't inject a stray .or() clause.
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    for (const t of [w, ...(termOfArtSynonyms(w) || [])]) {
      const e = esc(t);
      if (e && !seen.has(e.toLowerCase())) { seen.add(e.toLowerCase()); expanded.push(e); }
    }
  }
  // Fall back to the raw (esc'd) term if tokenizing left nothing (e.g. an all-stopword query).
  const finalTerms = expanded.length ? expanded : [esc(term)].filter(Boolean);
  const clauses: string[] = [];
  for (const t of finalTerms) for (const c of cols) clauses.push(`${c}.ilike.%${t}%`);
  return clauses.join(',');
}

// Common English stop-words + GovCon filler that add noise, not signal, to a search.
// (Postgres FTS drops these too — same rationale.)
const STOP_WORDS = new Set([
  'the', 'and', 'or', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'with', 'is', 'are',
  'that', 'this', 'have', 'has', 'requirements', 'requirement', 'services', 'service',
  'support', 'related', 'other', 'all', 'any', 'available', 'opportunities', 'opportunity',
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
 * Relevance-rank search rows the way every real search engine does — by how many query
 * words hit and WHERE (title > SOW > description > department). This is what makes the
 * OR-broadened result set usable: a notice matching 4/5 terms in its title floats to the
 * top; a valve notice mentioning "server" once in a boilerplate clause sinks. Stable sort
 * (ties keep input order, which is the caller's freshness order). Pure — no I/O.
 */
export function rankSearchResults<T extends { title?: string | null; description?: string | null; sow_text?: string | null; department?: string | null }>(
  rows: T[],
  search: string,
): T[] {
  const words = queryWords(search);
  if (words.length <= 1) return rows; // single-term: fetch order (freshness) already fine
  const scoreOf = (r: T): number => {
    const title = (r.title || '').toLowerCase();
    const sow = (r.sow_text || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const dept = (r.department || '').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 5;       // title match = strongest signal
      else if (sow.includes(w)) score += 3;    // SOW/PWS scope = strong
      else if (desc.includes(w)) score += 1;   // body = weak (boilerplate lives here)
      else if (dept.includes(w)) score += 1;
    }
    return score;
  };
  return rows
    .map((r, i) => ({ r, i, s: scoreOf(r) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.r);
}

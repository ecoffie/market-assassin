/**
 * Query-intent resolver — "everyone gives you the data, we give you the brain."
 *
 * Turns whatever a human TYPES (common language: "8a", "8(a)", "women owned", "service disabled
 * vet", "hubzone", "236220", "R408", "cybersecurity", "Navy") into a normalized INTENT that every
 * opportunity source applies UNIFORMLY — even though each source spells the same thing differently
 * (SAM set_aside_code "8A"/"8AN" + set_aside_description "8(A) SOLE SOURCE"; recompete/forecast
 * set_aside_type "8(A)"/"8(A) COMPETITIVE"; DLA has none). So "8a" returns the same MEANING on the
 * Open, Recompete and Forecast maps — not a dumb ILIKE that matches inconsistently.
 *
 * The resolver CLASSIFIES the raw query into one of:
 *   - setAside : a set-aside eligibility program (natural-language synonyms → a canonical key)
 *   - naics    : a NAICS code (2-6 digits) or comma-list
 *   - psc      : a PSC code (4-char alphanumeric like R408, 1560)
 *   - keyword  : free text → match title/description/agency/incumbent per source
 * (agency is left to the dedicated agency filter; a bare "Navy" also falls to keyword, which hits
 * the agency columns too.)
 *
 * Each map route reads the intent and applies it to ITS OWN columns (see setAsideMatch()).
 * DLA has no set-aside/NAICS/PSC data → the honest answer there is "not applicable" (the route
 * simply doesn't narrow, and the UI can say so) — never a fabricated match.
 */

export type SetAsideKey =
  | '8a' | 'wosb' | 'edwosb' | 'hubzone' | 'sdvosb' | 'vosb' | 'sdb' | 'sb' | 'isbee';

export interface QueryIntent {
  raw: string;
  kind: 'setAside' | 'naics' | 'psc' | 'keyword' | 'empty';
  setAside?: SetAsideKey;
  naics?: string[];       // one or more codes (exact if 6-digit, prefix otherwise)
  psc?: string;
  keyword?: string;
}

// ── Set-aside natural-language dictionary. Each canonical key → the phrases a real person types.
// Longest/most-specific phrases first so "edwosb" / "economically disadvantaged women" beats "wosb",
// and "service disabled veteran" beats "veteran". Matching is done on a normalized (lowercased,
// punctuation-stripped) query, so "8(a)", "8a", "8 a" all collapse to "8a".
const SET_ASIDE_SYNONYMS: { key: SetAsideKey; phrases: string[] }[] = [
  { key: 'edwosb', phrases: ['edwosb', 'economically disadvantaged women owned', 'economically disadvantaged woman owned', 'ed wosb'] },
  { key: 'wosb',   phrases: ['wosb', 'women owned', 'woman owned', 'women owned small business', 'women-owned', 'wo sb'] },
  { key: 'sdvosb', phrases: ['sdvosb', 'service disabled veteran owned', 'service disabled veteran', 'service-disabled', 'sdvo sb', 'disabled veteran'] },
  { key: 'vosb',   phrases: ['vosb', 'veteran owned', 'veteran owned small business', 'veteran-owned', 'vet owned'] },
  { key: 'hubzone', phrases: ['hubzone', 'hub zone', 'historically underutilized'] },
  { key: '8a',     phrases: ['8a', '8 a', 'eight a', 'eighta', 'sba 8a', 'section 8a', '8a program'] },
  { key: 'isbee',  phrases: ['isbee', 'indian small business', 'buy indian', 'indian economic enterprise', 'native american small business'] },
  { key: 'sdb',    phrases: ['sdb', 'small disadvantaged business', 'disadvantaged business'] },
  { key: 'sb',     phrases: ['small business set aside', 'total small business', 'small business', 'sb set aside', 'set aside for small business'] },
];

/** Normalize for phrase matching: lowercase, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Detect a set-aside term in the (already-normalized) query. Returns the canonical key or null. */
export function detectSetAside(query: string): SetAsideKey | null {
  const n = norm(query);
  if (!n) return null;
  for (const { key, phrases } of SET_ASIDE_SYNONYMS) {
    for (const p of phrases) {
      // whole-token match for very short keys (8a) so it doesn't fire inside another word;
      // substring for multi-word phrases.
      if (p.length <= 3) { if (new RegExp(`\\b${p.replace(/\s+/g, '\\s*')}\\b`).test(n)) return key; }
      else if (n.includes(p)) return key;
    }
  }
  return null;
}

/** Classify a raw search query into a normalized intent. */
export function resolveQueryIntent(raw: string): QueryIntent {
  const q = String(raw || '').trim();
  if (!q) return { raw: q, kind: 'empty' };

  // 1) Set-aside term (common language) — highest priority: "8a"/"women owned" is a program filter.
  const sa = detectSetAside(q);
  if (sa) return { raw: q, kind: 'setAside', setAside: sa };

  // 2) NAICS code(s) — 2-6 digits, optionally comma-separated ("236220" or "541,236").
  if (/^\d{2,6}(\s*,\s*\d{2,6})*$/.test(q)) {
    return { raw: q, kind: 'naics', naics: q.split(',').map((c) => c.trim()).filter(Boolean) };
  }

  // 3) PSC code — 4 chars, at least one letter AND at least one DIGIT (R408, AJ13). Requiring a
  // digit stops dictionary words ("Navy", "cyber"→len 5 anyway) from being read as a PSC code.
  if (/^[A-Za-z0-9]{4}$/.test(q) && /[A-Za-z]/.test(q) && /[0-9]/.test(q)) {
    return { raw: q, kind: 'psc', psc: q.toUpperCase() };
  }

  // 4) Everything else = free-text keyword (matched against title/description/agency/incumbent).
  // MULTI-TERM (the vision's "cyber, cloud, compliance, network, server") is preserved as the raw
  // string; keywordOrExpr() below splits it into OR'd terms across the columns.
  return { raw: q, kind: 'keyword', keyword: q };
}

/**
 * PostgREST `.or()` expression for a free-text keyword across a source's text columns. A comma/
 * "and"-separated multi-term query ("cyber, cloud, compliance") is split into terms and OR'd — a
 * row matches if ANY term hits ANY column (broad recall, the vision's capability search). Each term
 * must be ≥3 chars to avoid matching noise. Returns '' if nothing usable.
 */
export function keywordOrExpr(keyword: string, cols: string[]): string {
  const terms = String(keyword || '')
    .split(/[,;]|\band\b/i)
    .map((t) => t.trim().replace(/[%,()]/g, ' ').trim())
    .filter((t) => t.length >= 3);
  if (!terms.length || !cols.length) return '';
  const parts: string[] = [];
  for (const t of terms) for (const c of cols) parts.push(`${c}.ilike.%${t}%`);
  return parts.join(',');
}

// ── Per-source set-aside → column match. Each source spells set-asides its own way; this returns the
// PostgREST `.or()` expression for that source so one intent applies uniformly. Empty string = the
// source can't express this set-aside (honest — the route just doesn't narrow on it, never fakes it).
//
// SAM: has BOTH a short set_aside_code (8A/8AN/…) and a long set_aside_description → match either.
// Recompete/Forecast: only a free-text set_aside_type → ILIKE the canonical spellings.
const SET_ASIDE_CODES: Record<SetAsideKey, string[]> = {
  '8a': ['8A', '8AN'],
  wosb: ['WOSB', 'WOSBSS'],
  edwosb: ['EDWOSB', 'EDWOSBSS'],
  hubzone: ['HZC', 'HZS'],
  sdvosb: ['SDVOSBC', 'SDVOSBS'],
  vosb: ['VSA', 'VSB'],
  sdb: ['SDB'],
  sb: ['SBA', 'SBP'],
  isbee: ['ISBEE'],
};
// Description/type ILIKE fragments (what the long text actually contains, per the grounded data).
// NOTE: parens are PostgREST `.or()` delimiters, so a literal "8(A)" can't be a needle — use the
// SQL LIKE single-char wildcard `_` to match the paren: "8_A_" matches "8(A)" AND "8-A-" etc. This
// is why "8(A) SOLE SOURCE" / "8(A) COMPETITIVE" (recompete/forecast) are caught without parens.
const SET_ASIDE_TEXT: Record<SetAsideKey, string[]> = {
  '8a': ['8_A_', '8A COMP', '8A SOLE'],   // 8(A)…, 8A COMPETED, 8A SOLE SOURCE
  wosb: ['WOMEN-OWNED', 'WOMEN OWNED', 'WOSB'],
  edwosb: ['EDWOSB', 'ECONOMICALLY DISADVANTAGED WOMEN'],
  hubzone: ['HUBZONE'],
  sdvosb: ['SERVICE-DISABLED VETERAN', 'SERVICE DISABLED VETERAN', 'SDVOSB'],
  vosb: ['VETERAN-OWNED', 'VETERAN OWNED', 'VOSB'],
  sdb: ['SMALL DISADVANTAGED', 'SDB'],
  sb: ['TOTAL SMALL BUSINESS', 'SMALL BUSINESS SET-ASIDE', 'SMALL BUSINESS SET ASIDE'],
  isbee: ['INDIAN SMALL BUSINESS', 'ISBEE', 'BUY INDIAN'],
};

function ilikeFrag(col: string, needle: string): string {
  // Strip only the PostgREST .or() DELIMITERS (comma + parens) — keep LIKE wildcards (% and _) so
  // needles like "8_A_" work. (A literal paren is impossible in an .or() value anyway.)
  const esc = needle.replace(/[,()]/g, ' ');
  return `${col}.ilike.%${esc}%`;
}

/**
 * PostgREST `.or()` expression matching a set-aside key against a source's columns.
 *   opts.codeCol — a short set-aside code column (SAM's set_aside_code); matched via ILIKE per code.
 *   opts.textCols — free-text set-aside columns (set_aside_description / set_aside_type).
 * Returns '' when nothing to match (caller then doesn't narrow — honest, not fabricated).
 */
export function setAsideOrExpr(key: SetAsideKey, opts: { codeCol?: string; textCols?: string[] }): string {
  const parts: string[] = [];
  if (opts.codeCol) for (const c of (SET_ASIDE_CODES[key] || [])) parts.push(ilikeFrag(opts.codeCol, c));
  for (const col of (opts.textCols || [])) for (const t of (SET_ASIDE_TEXT[key] || [])) parts.push(ilikeFrag(col, t));
  return parts.join(',');
}

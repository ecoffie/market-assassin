/**
 * NAICS + PSC code lookup helper.
 *
 * Static-JSON-backed cache modeled on Content Reaper's pain-points
 * pattern (src/lib/utils/pain-points.ts). Fast read at request time,
 * no DB, edge-friendly. Both datasets ship with the app.
 *
 * Coverage:
 *   - NAICS: 1,741 codes from USASpending (24 sectors + 341 industry
 *     groups + 1,376 specific 6-digit codes). Authoritative for
 *     federal procurement — same source SAM uses.
 *   - PSC: ~700 codes aggregated from psc-naics-crosswalk.json, which
 *     itself is built from real federal spend records.
 *
 * Use everywhere NAICS or PSC codes appear:
 *   - AI prompts (pass descriptions, not codes — see vault prefill)
 *   - UI display ("541611 — Management Consulting" not just "541611")
 *   - Search filters with type-ahead
 *   - Code validation
 *
 * Built 2026-05-26 from Eric's instinct: "We have NAICS codes scattered
 * across the codebase. Build a real cache."
 */

import naicsData from '@/data/naics-codes.json';
import pscData from '@/data/psc-codes.json';

// ---- Types -----------------------------------------------------------

export interface NaicsEntry {
  /** The 2/4/6-digit NAICS code */
  code: string;
  /** Census-authoritative description */
  title: string;
  /** 2 = sector, 4 = industry group, 6 = national industry */
  level: number;
  /** Parent code (e.g. 6-digit 541611 → parent 5416). null for sectors. */
  parent: string | null;
}

export interface PscEntry {
  /** The 4-character PSC code (e.g. R408, D302, Y1AA, 6605) */
  code: string;
  /** GSA-authoritative description */
  title: string;
  /** First character of the code (PSC category prefix) */
  category: string;
  /** Plain-English category name (e.g. 'Professional Services') */
  category_name: string;
  /** Always 4 today, kept for symmetry with NAICS */
  level: number;
}

// ---- Pre-build maps + index for search ------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NAICS_CODES = (naicsData as any).codes as Record<string, Omit<NaicsEntry, 'code'>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PSC_CODES = (pscData as any).codes as Record<string, Omit<PscEntry, 'code'>>;

// Pre-built search indexes (lowercased title → code) for fast prefix
// + token lookups. Built once at module load.
const NAICS_SEARCH: Array<{ code: string; titleLower: string; tokens: Set<string> }> = [];
for (const [code, entry] of Object.entries(NAICS_CODES)) {
  const titleLower = entry.title.toLowerCase();
  NAICS_SEARCH.push({
    code,
    titleLower,
    tokens: new Set(titleLower.split(/[^a-z0-9]+/).filter(t => t.length >= 3)),
  });
}

const PSC_SEARCH: Array<{ code: string; titleLower: string; tokens: Set<string> }> = [];
for (const [code, entry] of Object.entries(PSC_CODES)) {
  const titleLower = entry.title.toLowerCase();
  PSC_SEARCH.push({
    code,
    titleLower,
    tokens: new Set(titleLower.split(/[^a-z0-9]+/).filter(t => t.length >= 3)),
  });
}

// ---- NAICS helpers --------------------------------------------------

/** Lookup one NAICS by code. Returns null if not found. */
export function getNaics(code: string | null | undefined): NaicsEntry | null {
  if (!code) return null;
  const clean = String(code).trim();
  const entry = NAICS_CODES[clean];
  if (!entry) return null;
  return { code: clean, ...entry };
}

/** Lookup many NAICS at once. Unknown codes are dropped. */
export function getNaicsBatch(codes: (string | null | undefined)[]): NaicsEntry[] {
  const out: NaicsEntry[] = [];
  for (const c of codes) {
    const e = getNaics(c);
    if (e) out.push(e);
  }
  return out;
}

/** Format a NAICS code as 'code — title' for inline display. */
export function formatNaics(code: string | null | undefined): string {
  const e = getNaics(code);
  if (!e) return String(code || '');
  return `${e.code} — ${e.title}`;
}

/** Return all NAICS codes under a 2-digit sector (or 4-digit group). */
export function getNaicsByPrefix(prefix: string): NaicsEntry[] {
  const p = String(prefix).trim();
  const out: NaicsEntry[] = [];
  for (const [code, entry] of Object.entries(NAICS_CODES)) {
    if (code.startsWith(p) && code !== p) {
      out.push({ code, ...entry });
    }
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** Walk up the parent chain for a NAICS code. */
export function getNaicsAncestry(code: string): NaicsEntry[] {
  const out: NaicsEntry[] = [];
  let current = getNaics(code);
  while (current) {
    out.unshift(current);
    if (!current.parent) break;
    current = getNaics(current.parent);
  }
  return out;
}

// ---- PSC helpers ----------------------------------------------------

/** Lookup one PSC by code. */
export function getPsc(code: string | null | undefined): PscEntry | null {
  if (!code) return null;
  const clean = String(code).trim().toUpperCase();
  const entry = PSC_CODES[clean];
  if (!entry) return null;
  return { code: clean, ...entry };
}

export function getPscBatch(codes: (string | null | undefined)[]): PscEntry[] {
  const out: PscEntry[] = [];
  for (const c of codes) {
    const e = getPsc(c);
    if (e) out.push(e);
  }
  return out;
}

export function formatPsc(code: string | null | undefined): string {
  const e = getPsc(code);
  if (!e) return String(code || '');
  return `${e.code} — ${e.title}`;
}

// ---- Search (autocomplete / type-ahead) -----------------------------

interface SearchOptions {
  /** Max results (default 10) */
  limit?: number;
  /** Restrict NAICS results to a specific level (2/4/6). Default any. */
  level?: number;
}

/**
 * Search NAICS by description. Useful for autocomplete inputs.
 * Ranks by: (1) prefix match on title, (2) all-token contains, (3) any-token contains.
 */
export function searchNaics(query: string, opts: SearchOptions = {}): NaicsEntry[] {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const limit = opts.limit ?? 10;
  const tokens = q.split(/[^a-z0-9]+/).filter(t => t.length >= 2);

  const scored: Array<{ entry: NaicsEntry; rank: number }> = [];
  for (const item of NAICS_SEARCH) {
    if (opts.level && NAICS_CODES[item.code].level !== opts.level) continue;

    let rank = 0;
    // Exact code match (high)
    if (item.code === q) rank += 100;
    // Code prefix
    else if (item.code.startsWith(q)) rank += 50;
    // Title starts with query
    if (item.titleLower.startsWith(q)) rank += 30;
    // All tokens present in title
    if (tokens.every(t => item.tokens.has(t) || item.titleLower.includes(t))) rank += 20;
    // Any tokens present
    else if (tokens.some(t => item.tokens.has(t) || item.titleLower.includes(t))) rank += 5;

    if (rank > 0) {
      scored.push({ entry: { code: item.code, ...NAICS_CODES[item.code] }, rank });
    }
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit).map(s => s.entry);
}

export function searchPsc(query: string, opts: { limit?: number } = {}): PscEntry[] {
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const limit = opts.limit ?? 10;
  const tokens = q.split(/[^a-z0-9]+/).filter(t => t.length >= 2);

  const scored: Array<{ entry: PscEntry; rank: number }> = [];
  for (const item of PSC_SEARCH) {
    let rank = 0;
    if (item.code === q.toUpperCase()) rank += 100;
    else if (item.code.toLowerCase().startsWith(q)) rank += 50;
    if (item.titleLower.startsWith(q)) rank += 30;
    if (tokens.every(t => item.tokens.has(t) || item.titleLower.includes(t))) rank += 20;
    else if (tokens.some(t => item.tokens.has(t) || item.titleLower.includes(t))) rank += 5;

    if (rank > 0) {
      scored.push({ entry: { code: item.code, ...PSC_CODES[item.code] }, rank });
    }
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit).map(s => s.entry);
}

// ---- Validation -----------------------------------------------------

export function isValidNaicsCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const s = String(code).trim();
  return /^\d{2,6}$/.test(s) && s in NAICS_CODES;
}

export function isValidPscCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const s = String(code).trim().toUpperCase();
  return /^[0-9A-Z]{4}$/.test(s) && s in PSC_CODES;
}

// ---- Stats (for /admin/rag-library-style debugging) -----------------

export function getCodeStats(): {
  naics_total: number;
  naics_by_level: Record<number, number>;
  psc_total: number;
  psc_by_category: Record<string, number>;
} {
  const naicsByLevel: Record<number, number> = {};
  for (const e of Object.values(NAICS_CODES)) {
    naicsByLevel[e.level] = (naicsByLevel[e.level] || 0) + 1;
  }
  const pscByCategory: Record<string, number> = {};
  for (const e of Object.values(PSC_CODES)) {
    pscByCategory[e.category] = (pscByCategory[e.category] || 0) + 1;
  }
  return {
    naics_total: Object.keys(NAICS_CODES).length,
    naics_by_level: naicsByLevel,
    psc_total: Object.keys(PSC_CODES).length,
    psc_by_category: pscByCategory,
  };
}

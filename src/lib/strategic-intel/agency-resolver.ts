/**
 * Canonical agency resolution for Strategic Intelligence.
 *
 * ⚠️ WHY THIS EXISTS — read before "simplifying" it.
 *
 * The strategic-intelligence corpus has PROVEN attribution defects. Measured live
 * 2026-09-13 against `agency_intelligence` (446 gao_high_risk rows):
 *
 *   - "General Government" — the junk fallback for "no agency matched" — is the
 *     LARGEST bucket at 141/446 rows (32%).
 *   - A single GAO report is stored under MULTIPLE agencies, because the upstream
 *     extractor returns every substring match with no precedence and no primary.
 *     "Air Traffic Control: Observations on FAA's ... Modernization Program" is
 *     stored under BOTH Department of Transportation (right) AND Department of
 *     Veterans Affairs (wrong).
 *   - Junk agency names were persisted verbatim, e.g. "Department of the".
 *   - The READ path compounds it: `agency_name.ilike.%VA%` (index.ts:204) matches
 *     "Ad*va*isory Council on Historic Preser*va*tion", "Na*va*jo", "Pri*va*cy and
 *     Civil Liberties Oversight Board", "Overseas Pri*va*te Investment Corporation"
 *     — none of them Veterans Affairs. Verified live.
 *
 * The common root cause is UNANCHORED SUBSTRING MATCHING plus a guess-on-miss
 * fallback. So this resolver's contract is the inverse:
 *
 *   1. Identifiers beat names.        (a CGAC code is evidence; a word is not)
 *   2. Matching is ANCHORED + EXPLICIT. Never `haystack.includes(alias)`.
 *   3. Generic words NEVER establish identity ("DEPARTMENT", "OFFICE", "AGENCY"…).
 *   4. Unresolved STAYS unresolved. There is no junk bucket and no fallback guess.
 *   5. A subagency never silently inherits an unrelated cabinet agency.
 *
 * Precedent: `resolveToptier` in src/lib/analytics/competition-depth.ts, which
 * already refuses rather than guesses ("we never guess a name and present its
 * competition data as this buyer's"). This extends that contract with a resolution
 * METHOD and CONFIDENCE, which no existing resolver carries.
 *
 * Canonical target: the 49 names in src/data/agency-toptier-codes.json.
 */

import TOPTIER_CODES from '@/data/agency-toptier-codes.json';
import AGENCY_ALIASES from '@/data/agency-aliases.json';

/** How identity was established. Ordered strongest → weakest. */
export type ResolutionMethod =
  | 'cgac_code'       // source-provided CGAC/toptier code — strongest
  | 'exact_name'      // exact canonical name match
  | 'alias'           // explicit, curated alias table hit
  | 'department_of'   // the safe "X, DEPARTMENT OF" structural pattern
  | 'unresolved';     // nothing established identity

export type ResolutionConfidence = 'high' | 'medium' | 'unresolved';

export interface AgencyResolution {
  /** Canonical toptier name, or null when unresolved. NEVER a guess. */
  canonicalAgency: string | null;
  /** CGAC/toptier code when known. */
  toptierCode: string | null;
  /** Sub-agency / office as GIVEN — echoed, never invented, never promoted. */
  subAgency: string | null;
  /** DoDAAC office code when the caller supplied a valid one. */
  officeCode: string | null;
  method: ResolutionMethod;
  confidence: ResolutionConfidence;
  resolved: boolean;
  /** The input we were asked to resolve — kept so an unresolved row is auditable. */
  input: string;
  /** Human-readable reason, primarily for the unresolved case. */
  note: string;
}

export interface ResolveAgencyInput {
  agencyName?: string | null;
  subAgencyName?: string | null;
  /** Source-provided CGAC/toptier code — beats any name matching. */
  toptierCode?: string | null;
  /** Source-provided DoDAAC office code. */
  officeCode?: string | null;
}

type ToptierEntry = { code: string; abbreviation: string };
const CODES = TOPTIER_CODES as Record<string, ToptierEntry>;

/**
 * Words that must NEVER establish identity on their own. "DEPARTMENT" matching
 * "Department of the" is exactly how a junk agency name got persisted.
 */
const GENERIC_TOKENS = new Set([
  'DEPARTMENT', 'DEPT', 'OF', 'THE', 'OFFICE', 'AGENCY', 'ADMINISTRATION',
  'BUREAU', 'COMMISSION', 'BOARD', 'SERVICE', 'US', 'USA', 'U.S.', 'FEDERAL',
  'NATIONAL', 'GENERAL', 'GOVERNMENT', 'GENERAL GOVERNMENT', 'UNITED STATES',
  'CORPORATION', 'AUTHORITY', 'COUNCIL', 'INDEPENDENT', 'VARIOUS', 'OTHER',
  'UNKNOWN', 'N/A', 'NONE', 'MISC', 'MISCELLANEOUS',
]);

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

/** Strip trailing punctuation/commas that SAM long-names carry. */
const clean = (s: string) => s.trim().replace(/[.,;:]+$/, '').trim();

/** Canonical-name lookup, case-insensitive, built once. */
const BY_UPPER_NAME = new Map<string, string>();
for (const name of Object.keys(CODES)) BY_UPPER_NAME.set(norm(name), name);

/** CGAC code → canonical name. */
const BY_CODE = new Map<string, string>();
for (const [name, entry] of Object.entries(CODES)) {
  if (entry?.code) BY_CODE.set(String(entry.code).padStart(3, '0'), name);
}

/** Abbreviation → canonical name (e.g. VA → Department of Veterans Affairs). */
const BY_ABBREV = new Map<string, string>();
for (const [name, entry] of Object.entries(CODES)) {
  if (entry?.abbreviation) BY_ABBREV.set(norm(entry.abbreviation), name);
}

/**
 * Curated alias table. Only aliases whose TARGET is one of the 49 canonical
 * names are admitted — an alias pointing at a non-canonical string cannot
 * establish canonical identity.
 */
const BY_ALIAS = new Map<string, string>();
{
  const aliases = (AGENCY_ALIASES as { aliases?: Record<string, string> }).aliases ?? {};
  for (const [alias, target] of Object.entries(aliases)) {
    const a = norm(alias);
    if (GENERIC_TOKENS.has(a)) continue;          // never let a generic word map
    if (a.length < 2) continue;
    const canonical = BY_UPPER_NAME.get(norm(target));
    if (canonical) BY_ALIAS.set(a, canonical);
  }
}

const DODAAC_RE = /^[A-Z][A-Z0-9]{5}$/;
export const isValidOfficeCode = (code: string): boolean => DODAAC_RE.test(code.trim().toUpperCase());

function unresolved(input: string, note: string, extra?: Partial<AgencyResolution>): AgencyResolution {
  return {
    canonicalAgency: null,
    toptierCode: null,
    subAgency: extra?.subAgency ?? null,
    officeCode: extra?.officeCode ?? null,
    method: 'unresolved',
    confidence: 'unresolved',
    resolved: false,
    input,
    note,
  };
}

/**
 * Resolve an agency to one of the 49 canonical toptier names.
 *
 * Returns `resolved: false` rather than guessing. A caller MUST NOT persist a
 * derived claim against an unresolved agency — store the evidence as
 * agency-unresolved instead. That is the whole point: an honest "we don't know"
 * beats a confident wrong attribution.
 */
export function resolveAgency(input: ResolveAgencyInput): AgencyResolution {
  const rawName = clean(input.agencyName ?? '');
  const subAgency = clean(input.subAgencyName ?? '') || null;
  const rawOffice = clean(input.officeCode ?? '').toUpperCase();
  const officeCode = rawOffice && isValidOfficeCode(rawOffice) ? rawOffice : null;
  const label = rawName || subAgency || '';

  // ── 1. IDENTIFIERS BEAT NAMES ───────────────────────────────────────────
  const rawCode = clean(input.toptierCode ?? '');
  if (rawCode) {
    const padded = rawCode.padStart(3, '0');
    const byCode = BY_CODE.get(padded);
    if (byCode) {
      return {
        canonicalAgency: byCode,
        toptierCode: padded,
        subAgency,
        officeCode,
        method: 'cgac_code',
        confidence: 'high',
        resolved: true,
        input: label || padded,
        note: `Resolved by source-provided CGAC code ${padded}.`,
      };
    }
    // A code we don't recognise is NOT a licence to fall back to fuzzy name
    // matching — but a name may still resolve below on its own merits.
  }

  if (!label) {
    return unresolved('', 'No agency name, sub-agency or code supplied.', { subAgency, officeCode });
  }

  const key = norm(label);

  // ── 2. GENERIC WORDS NEVER ESTABLISH IDENTITY ───────────────────────────
  // "Department of the", "General Government", "Various" — the junk buckets.
  const tokens = key.split(' ').filter(Boolean);
  const allGeneric = tokens.length > 0 && tokens.every((t) => GENERIC_TOKENS.has(t));
  if (GENERIC_TOKENS.has(key) || allGeneric) {
    return unresolved(label, `"${label}" is a generic label, not an agency identity.`, { subAgency, officeCode });
  }

  // ── 3. EXACT CANONICAL NAME ─────────────────────────────────────────────
  const exact = BY_UPPER_NAME.get(key);
  if (exact) {
    return {
      canonicalAgency: exact,
      toptierCode: CODES[exact]?.code ?? null,
      subAgency, officeCode,
      method: 'exact_name',
      confidence: 'high',
      resolved: true,
      input: label,
      note: 'Exact canonical name match.',
    };
  }

  // ── 4. EXPLICIT ALIAS / ABBREVIATION (whole-string only, never substring) ─
  const viaAbbrev = BY_ABBREV.get(key);
  const viaAlias = viaAbbrev ?? BY_ALIAS.get(key);
  if (viaAlias) {
    return {
      canonicalAgency: viaAlias,
      toptierCode: CODES[viaAlias]?.code ?? null,
      subAgency, officeCode,
      method: 'alias',
      confidence: 'high',
      resolved: true,
      input: label,
      note: `Explicit alias "${label}" → ${viaAlias}.`,
    };
  }

  // ── 5. THE SAFE STRUCTURAL PATTERN: "X, DEPARTMENT OF [THE]" ────────────
  // Borrowed from resolveToptier. Only accepted when the rebuilt name is itself
  // one of the 49 canonical names — so the pattern cannot mint a new agency.
  const m = key.match(/^(.*),\s*DEPARTMENT OF( THE)?$/);
  if (m && m[1] && !GENERIC_TOKENS.has(m[1])) {
    const titled = m[1].split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    const rebuilt = `Department of${m[2] ? ' the' : ''} ${titled}`;
    const canonical = BY_UPPER_NAME.get(norm(rebuilt));
    if (canonical) {
      return {
        canonicalAgency: canonical,
        toptierCode: CODES[canonical]?.code ?? null,
        subAgency, officeCode,
        method: 'department_of',
        confidence: 'medium',
        resolved: true,
        input: label,
        note: `Structural "X, DEPARTMENT OF" pattern → ${canonical}.`,
      };
    }
  }

  // ── 6. REFUSE ───────────────────────────────────────────────────────────
  // No substring sweep, no nearest-match, no "General Government". The caller
  // keeps the evidence and records that the agency is unknown.
  return unresolved(
    label,
    `"${label}" did not match a canonical agency by code, exact name, explicit alias, or structural pattern. Left unresolved rather than guessed.`,
    { subAgency, officeCode },
  );
}

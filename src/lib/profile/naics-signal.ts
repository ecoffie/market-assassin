/**
 * NAICS SIGNAL NORMALIZATION — one column, two writers, two incompatible shapes.
 *
 * ── DEFECT-8, measured 2026-08-25 on production ────────────────────────────────────────
 * `user_business_profiles.extracted_naics_codes` is written by TWO paths that disagree
 * about both the SHAPE and the MEANING of what they store:
 *
 *   sample-opportunities  -> [{code,name,count}]  objects   66 rows   CLICKED opportunities
 *   app/profile           -> ["541512", ...]      strings  276 rows   DECLARED by the user
 *
 * Two distinct bugs fall out, and they need different fixes:
 *
 * A. SHAPE COLLISION (silent, and already causing wrong output).
 *    A consumer doing `codes.includes('541512')` misses every OBJECT row; one reading
 *    `c.code` misses every STRING row. Neither throws. Measured: `admin/debug-profile`
 *    reports 53 rows as INVALID NAICS purely because it stringifies objects to
 *    "[object Object]" — a diagnostic tool producing a confidently wrong diagnosis.
 *
 * B. PROVENANCE IS UNRECORDED (the originally filed defect).
 *    "I clicked this" and "I do this" are different claims, and the column name
 *    `extracted` implies a third thing — extracted from the business description — which
 *    it has never been on either path. 75 rows are click-derived; 431 are declared.
 *
 * WHAT THE AUDIT DISPROVED. The filed record inferred, from one row (VEXFOLD), that
 * click-derived codes are broadly wrong. Re-measured across the corpus they are mostly
 * ACCURATE — a janitorial firm clicked janitorial work, an IT firm clicked IT work — and
 * 0 of 39 click-path users have a wrong-industry ALERT profile. So this is a provenance
 * and typing defect, NOT the data-corruption emergency it was filed as. Interest is a
 * legitimate signal; it must simply be legible AS interest.
 */

/** One NAICS observation with its provenance intact. */
export interface NaicsSignal {
  code: string;
  /** How the code came to be associated with this company. */
  provenance: 'declared' | 'observed_interest';
  /** Human label when the source carried one. */
  name?: string;
  /** For observed interest: how many opportunities the user clicked in this code. */
  count?: number;
}

const NAICS_RE = /^\d{6}$/;

/**
 * Read EITHER stored shape into one typed list. This is the compatibility seam: it must
 * never throw and never silently drop a real code, because both shapes are live in
 * production right now and will be for as long as old rows exist.
 */
export function readNaicsSignals(
  raw: unknown,
  provenance: NaicsSignal['provenance'] = 'declared',
): NaicsSignal[] {
  if (!Array.isArray(raw)) return [];
  const out: NaicsSignal[] = [];
  for (const item of raw) {
    if (typeof item === 'string' || typeof item === 'number') {
      const code = String(item).trim();
      if (code) out.push({ code, provenance });
      continue;
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const code = String(o.code ?? o.naics ?? o.naicsCode ?? '').trim();
      if (!code) continue;                       // never emit "[object Object]"
      out.push({
        code,
        // An object row came from the click path — that is what the shape MEANS.
        provenance: 'observed_interest',
        name: typeof o.name === 'string' && o.name !== 'Unknown' ? o.name : undefined,
        count: typeof o.count === 'number' ? o.count : undefined,
      });
    }
  }
  return out;
}

/** Just the codes, either shape. The safe replacement for `.includes()` on the raw column. */
export function naicsCodesFrom(raw: unknown): string[] {
  return [...new Set(readNaicsSignals(raw).map((s) => s.code))];
}

/**
 * Genuinely malformed codes only.
 *
 * An object-shaped entry is NOT malformed — it is the click path's storage format.
 * Treating it as invalid is exactly the bug this replaces (53 false "invalid NAICS"
 * reports from the tool whose job is diagnosing profile problems).
 */
export function invalidNaicsCodes(raw: unknown): string[] {
  return naicsCodesFrom(raw).filter((c) => !NAICS_RE.test(c));
}

/** Codes a user DECLARED — the only ones that may be read as stated capability. */
export function declaredCodes(raw: unknown): string[] {
  return [...new Set(readNaicsSignals(raw).filter((s) => s.provenance === 'declared').map((s) => s.code))];
}

/** Codes a user only BROWSED. Valid for recommendations; never capability evidence. */
export function observedInterestCodes(raw: unknown): string[] {
  return [...new Set(readNaicsSignals(raw).filter((s) => s.provenance === 'observed_interest').map((s) => s.code))];
}

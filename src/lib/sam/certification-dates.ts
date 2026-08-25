/**
 * SBA CERTIFICATION DATES — parse and preserve, do not reinterpret.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 * Measured 2026-08-24 over 250K extract lines: **507 firms (17.1% of certified) carry an
 * EXPIRED SBA certification, and 467 of them have an ACTIVE SAM registration** — so nothing
 * else flags them. Confirmed on the live mirror:
 *
 *   KILIUDA CONSULTING, LLC            stored ["8(a)"]     registration Active   expired 2023-01-11
 *   ALASKA PROFESSIONAL CONSTRUCTION   stored ["HUBZone"]  registration Active   expired 2024-03-19
 *
 * The expiry was in the token all along. `import-sam-entity-extract.mjs` already prefix-matches
 * `A620210726` to get the LABEL right — its own comment explains the concatenated date — then
 * keeps the label and discards the date. So a cert that lapsed in 2021 and one valid to 2029
 * both collapse to the string "8(a)".
 *
 * ── WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT ───────────────────────────────────────
 * Parses what is ACTUALLY ENCODED and preserves three distinct states. It does NOT decide
 * eligibility, does not filter, and does not touch the existing `certifications[]` array.
 * "Has/had a certification" and "has a CURRENTLY VALID certification" are different questions;
 * this module makes the second one answerable and leaves the wiring to a later, measured step.
 *
 * ── DATE-BEARING BEHAVIOUR DIFFERS BY PROGRAM (measured, not assumed) ───────────────────────
 * Eric's caution — "don't assume field 117 carries authoritative expiry semantics for every
 * program just because it works for A6/HUBZone". It does not:
 *
 *   A6  8(a)          ALWAYS dated   1,509 of 1,521   range 1997-12-15 .. 2034-08-14
 *   JT  8(a) JV       ALWAYS dated     231 of 231     range 2022-05-27 .. 2028-07-08
 *   XX  HUBZone       MIXED — only 11% dated; **1,234 of 1,390 carry NO date**
 *   A9 / A0           not SBA-certified programs; out of scope (the importer never mapped them)
 *
 * So an undated HUBZone token is the COMMON case, not an anomaly. Its status is genuinely
 * `unknown` and must never be silently upgraded to `current`.
 */

/** The three states, kept distinct. `unknown` is never a synonym for `current`. */
export type CertStatus = 'current' | 'expired' | 'unknown';

export interface CertificationRecord {
  /** Normalized program label, matching the existing `certifications[]` vocabulary. */
  certification_type: string;
  /** The raw source token, kept so a later reader never has to re-derive it. */
  source_code: string;
  /** ISO date, or null when the token carries none (the common HUBZone case). */
  certification_expires_on: string | null;
  /** Derived ONLY where a date supports it. No date → 'unknown', always. */
  certification_status: CertStatus;
}

/** Only the documented SBA-CERTIFIED programs. Self-identified types live elsewhere. */
function programFor(code: string): string | null {
  const c = code.toUpperCase();
  if (c.startsWith('A6') || c.startsWith('JT')) return '8(a)';
  if (c.startsWith('XX')) return 'HUBZone';
  return null;
}

/** `20260824` → `2026-08-24`. Returns null for anything that is not a plausible date. */
function toIsoDate(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  // A malformed date must not become a confident status. Observed real range is 1997..2034.
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Parse extract field 117 into per-certification records.
 *
 * @param asOf ISO date to evaluate currency against. Defaults to today. Pass the SNAPSHOT date
 *             when reprocessing an old extract — evaluating a 2026 extract against today would
 *             silently age certifications that were current when the snapshot was taken.
 */
export function parseCertifications(
  field: string | null | undefined,
  asOf: string = new Date().toISOString().slice(0, 10),
): CertificationRecord[] {
  const out: CertificationRecord[] = [];
  const seen = new Set<string>();

  for (const raw of (field || '').split('~')) {
    const tok = raw.trim().toUpperCase();
    if (!tok) continue;
    const program = programFor(tok);
    if (!program) continue;                       // not an SBA-certified program — out of scope

    const dateMatch = tok.match(/(\d{8})$/);
    const iso = dateMatch ? toIsoDate(dateMatch[1]) : null;

    // ⚠️ THE WHOLE POINT: no date → 'unknown'. Never 'current'. 89% of HUBZone tokens land here,
    // so defaulting them to current would assert currency for 1,234 firms we know nothing about.
    const status: CertStatus = iso === null ? 'unknown' : (iso < asOf ? 'expired' : 'current');

    // A firm can carry the same program twice (e.g. A6 and JT). Keep the most informative:
    // a dated record beats an undated one for the same program.
    const key = program;
    const existing = out.find((r) => r.certification_type === key);
    if (existing) {
      if (existing.certification_expires_on === null && iso !== null) {
        existing.certification_expires_on = iso;
        existing.certification_status = status;
        existing.source_code = tok;
      }
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      certification_type: program,
      source_code: tok,
      certification_expires_on: iso,
      certification_status: status,
    });
  }
  return out;
}

/**
 * Does this entity hold a CURRENTLY VALID certification of this type?
 *
 * Returns false for BOTH 'expired' and 'unknown' — an unknown currency is not evidence of
 * currency. A surface that needs "has/had this certification" should read `certifications[]`
 * instead; these are deliberately different questions.
 */
export function hasCurrentCertification(records: CertificationRecord[] | null | undefined, type: string): boolean {
  return (records || []).some((r) => r.certification_type === type && r.certification_status === 'current');
}

/** The compatibility projection: every program present, regardless of currency. */
export function certificationLabels(records: CertificationRecord[] | null | undefined): string[] {
  return [...new Set((records || []).map((r) => r.certification_type))].sort();
}

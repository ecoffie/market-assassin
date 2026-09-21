/**
 * P0-3 — the SINGLE normalizer for SAM's per-NAICS small-business representation.
 *
 * Both ingestion pipelines call this so they cannot quietly diverge:
 *   Entity API  → naicsList[] of { naicsCode, sbaSmallBusiness: 'Y' | 'N' }
 *   Bulk extract→ field 34, tilde-joined "332312Y~423310Y~561720N"
 *
 * THE RULE THIS ENCODES:
 *   'Y'     → SAM says the entity represents itself as small for that NAICS
 *   'N'     → SAM says it does NOT
 *   'E'     → SAM says this NAICS has EXCEPTION-SPECIFIC size standards. NOT a size answer.
 *   absent  → SAM said nothing. NOT the same as 'N', and NOT the same as 'E'.
 *
 * Those extra states are the whole point. Storing only the Y codes would collapse
 * "not small" into "unknown", which is the unknown-vs-none defect family behind
 * P0-2 and the reason P0-3 returned zero performers for a market with 21,933
 * registrants.
 *
 * ── 'E' — ADDED 2026-08-24, AND DELIBERATELY NOT INTERPRETED ───────────────────────────────
 * MEASURED on the Aug-2026 extract: field-34 tokens are Y 147,344 / N 44,367 / **E 16,203** /
 * bare 946. This function previously accepted ONLY Y and N, so every E fell through `put()`
 * and became "SAM said nothing" — when SAM said something specific.
 *
 * The cost, measured on the live mirror against a control:
 *   541330 Engineering  50,369 firms →     0 flagged small (0.0%)
 *   541519 IT Services  47,332 firms →     0 flagged small (0.0%)
 *   541715 R&D          29,665 firms →     0 flagged small (0.0%)
 *   541512 (control)    53,322 firms → 45,190 flagged small (84.7%)
 * 13 NAICS are 100% E with ZERO Y and ZERO N — the distribution is bimodal, not gradual.
 *
 * ⚠️ 'E' IS NOT A SIZE ANSWER. Per the SAM extract layout, it means "this NAICS has
 * exception-specific size standards — consult the NAICS Exception data", which carries a
 * general-base answer PLUS one or more exception-specific answers. SBA's public standards
 * confirm the shape: 541519 has a receipts-based general standard and a separate
 * employee-based exception for IT value-added resellers; 541330 and 541715 likewise.
 *
 * So Mindy must NOT turn 'E' into 'Y' or 'N'. Until the exception string is located and
 * verified in the extract, the truthful state for those markets is EXCEPTION-DEPENDENT.
 * `smallBusinessCodes()` therefore still returns only 'Y' — an E firm is not asserted small.
 *
 * SELF-CERTIFICATION: this is the entity's own representation in SAM, not an SBA
 * determination. Callers surfacing it must say so.
 */

/**
 * 'E' is a fourth state, not a third value of a boolean. It answers a DIFFERENT question:
 * Y/N answer "is this firm small here?"; E answers "that question needs the exception data".
 */
export type SbStatus = 'Y' | 'N' | 'E';
/** { "561720": "Y", "541512": "N" } — a missing key means SAM did not say. */
export type NaicsSbMap = Record<string, SbStatus>;

const NAICS_RE = /^\d{6}$/;

function put(map: NaicsSbMap, code: string, status: string | null | undefined): void {
  const c = (code || '').trim();
  if (!NAICS_RE.test(c)) return;
  const s = (status || '').trim().toUpperCase();
  // 'E' is PRESERVED, not dropped: losing it turns "exception-dependent" into "SAM said
  // nothing", which is the evidence-failure-as-fact shape. Anything else stays ABSENT —
  // unknown is never defaulted to N.
  if (s !== 'Y' && s !== 'N' && s !== 'E') return;
  map[c] = s;
}

/** Entity API shape: assertions.goodsAndServices.naicsList[]. */
export function fromEntityApiNaicsList(
  list: Array<{ naicsCode?: unknown; sbaSmallBusiness?: unknown }> | null | undefined,
): NaicsSbMap {
  const out: NaicsSbMap = {};
  for (const n of list || []) {
    put(out, String(n?.naicsCode ?? ''), n?.sbaSmallBusiness == null ? '' : String(n.sbaSmallBusiness));
  }
  return out;
}

/**
 * Bulk extract shape: field 34, tilde-joined `<6-digit code><Y|N|E>`.
 * A token with no trailing flag (e.g. "541512") yields NO entry — unknown, not N.
 */
export function fromBulkExtractField(field: string | null | undefined): NaicsSbMap {
  const out: NaicsSbMap = {};
  for (const raw of (field || '').split('~')) {
    const tok = raw.trim();
    if (!tok) continue;
    const code = tok.slice(0, 6);
    const flag = tok.slice(6, 7);        // '' when the token is a bare code
    put(out, code, flag);
  }
  return out;
}

/**
 * DERIVED projection for indexed containment queries. Never store this
 * independently of the map — derive it, or the states will drift apart.
 *
 * ⚠️ 'E' is deliberately EXCLUDED. An exception-coded NAICS is not an assertion that the firm
 * is small — it says the applicable size standard is exception-specific. Including E here
 * would silently convert "exception-dependent" into "small", which is exactly the
 * interpretation this change refuses to make.
 */
export function smallBusinessCodes(map: NaicsSbMap | null | undefined): string[] {
  return Object.entries(map || {}).filter(([, v]) => v === 'Y').map(([c]) => c).sort();
}

/** All codes SAM said anything about — the unknown-vs-none check. */
export function representedCodes(map: NaicsSbMap | null | undefined): string[] {
  return Object.keys(map || {}).sort();
}

/**
 * Tri-state read for a single NAICS. Returns null for UNKNOWN so callers are
 * forced to handle it rather than treating a missing key as "not small".
 */
export function isSmallForNaics(map: NaicsSbMap | null | undefined, naics: string): boolean | null {
  const v = (map || {})[(naics || '').trim()];
  return v === 'Y' ? true : v === 'N' ? false : null;
}

/** Columns for a sam_entities upsert. Keeps map + projection + provenance together. */
export function toEntityColumns(map: NaicsSbMap, source: string, observedAt: string) {
  return {
    naics_small_business: map,
    small_business_naics: smallBusinessCodes(map),
    naics_sb_source: source,
    naics_sb_observed_at: observedAt,
  };
}

// ── NAICS EXCEPTION DATA (extract field idx 113) ──────────────────────────────────────────
//
// LOCATED BY EVIDENCE, not by adjacency to field 34: index 113 is populated for **100.0%** of
// firms carrying an `E` token and **0.0%** of firms without one (22,569 vs 63,932 measured).
//
// STRUCTURE — verified, not assumed. Tilde-joined `<6-digit NAICS><Y/N answers>`:
//     541519YY            2 answers
//     541715YYYY          4 answers
//     541330YYYY~541519YY per-NAICS, multiple entries
//
// The answer COUNT is CONSTANT per NAICS across every firm measured (100% consistency, single
// variant, 13 markets, >=100 firms each): 541330 always 4, 541519 always 2, 115310 always 3.
// That is exactly the documented shape — a GENERAL-BASE answer plus ONE answer per SBA
// exception for that NAICS — and it matches SBA's published standards, e.g. 541519 carries a
// receipts-based general standard plus an employee-based exception for IT value-added
// resellers, while 541330 and 541715 carry several.
//
// ⚠️ STILL NOT INTERPRETED. Which position maps to which named exception, and therefore which
// size standard applies to a given solicitation, is a PRODUCT decision requiring the exception
// NAMES — which are not in this field. Until then the honest state is EXCEPTION-DEPENDENT.
// This parser preserves the answers faithfully so that decision can be made later from data
// rather than re-derived from the raw layout.

/** One NAICS's exception answers: the general-base answer first, then one per SBA exception. */
export interface NaicsExceptionEntry {
  naics: string;
  /** The general (non-exception) size answer for this NAICS. */
  base: 'Y' | 'N';
  /** One answer per SBA exception, in source order. Position semantics are NOT yet resolved. */
  exceptions: Array<'Y' | 'N'>;
}

/** { "541519": { naics, base, exceptions } } */
export type NaicsExceptionMap = Record<string, NaicsExceptionEntry>;

/**
 * Parse extract field 113 into per-NAICS exception answers.
 *
 * A malformed token yields NO entry rather than a guessed one — an invented exception answer
 * would be worse than an absent one, because it would look authoritative.
 */
export function fromBulkExtractExceptionField(field: string | null | undefined): NaicsExceptionMap {
  const out: NaicsExceptionMap = {};
  for (const raw of (field || '').split('~')) {
    const tok = raw.trim();
    if (!tok) continue;
    const naics = tok.slice(0, 6);
    const answers = tok.slice(6).toUpperCase();
    if (!NAICS_RE.test(naics)) continue;
    if (!answers.length || !/^[YN]+$/.test(answers)) continue;
    out[naics] = {
      naics,
      base: answers[0] as 'Y' | 'N',
      exceptions: answers.slice(1).split('') as Array<'Y' | 'N'>,
    };
  }
  return out;
}

/**
 * True when this NAICS's size status depends on an exception the caller has not resolved.
 * A surface reporting size for such a NAICS must say "exception-dependent", NOT "unknown"
 * (we know why) and NOT "not small" (we did not measure that).
 */
export function isExceptionDependent(map: NaicsSbMap | null | undefined, naics: string): boolean {
  return (map || {})[naics] === 'E';
}

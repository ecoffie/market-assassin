/**
 * What we actually know about a PSC code — the one place that decides.
 *
 * THE BUG THIS EXISTS TO PREVENT (Robert Parks, 2026-08-15)
 * Two parts of Mindy contradicted each other about the same code:
 *
 *   the recommender  →  "add D314, it's 9% of your market"   (live USASpending)
 *   the validator    →  "D314 — not a known PSC"             (a static JSON file)
 *
 * He believed the validator, swapped in a code with zero market coverage, and
 * stayed stuck at 88% while doing exactly what we told him. The catalog file
 * was missing 1,528 real codes, so this was never one bad code — it was a
 * structural divergence between two universes with no shared contract.
 *
 * The label was the sharpest part of the harm. "Not a known PSC" asserts the
 * code is not real. What we actually knew was "not in our reference file" —
 * a statement about US, presented as a statement about the code. A system must
 * never confidently contradict its own source of truth.
 *
 * So: four honest states, and the UI must say which one it means.
 */
import { getPsc } from './lookup';

export type PscStatus =
  /** In the reference catalog. The code is real and we can name it. */
  | 'valid'
  /**
   * Well-formed, but absent from the catalog we ship. This is a statement about
   * OUR reference data, NOT about the code — it may be perfectly real (D314
   * was). Never render this as "not a real code".
   */
  | 'not_in_catalog'
  /** Real, but retired by the PSC manual. Kept so saved codes keep resolving. */
  | 'deprecated'
  /** Not a PSC shape at all — the only state that means "this is wrong". */
  | 'malformed';

export interface PscVerdict {
  code: string;
  status: PscStatus;
  title: string | null;
  /** Copy the UI can render verbatim. Precise about what we do and don't know. */
  label: string;
}

/**
 * PSC shape. Two levels are real, and the rule has to admit both.
 *
 * FULL (4 chars): service codes are letter-led with digits (D314, R425, AC13);
 * products are 4 digits (1005).
 *
 * GROUP (2 digits): the product-group level — 59 electrical components, 53 hardware,
 * 25 vehicular equipment. Federal data stores these, and they are classifications, not
 * truncations.
 *
 * ⚠️ THE MISTAKE THIS REPLACES. The old rule required exactly 4 chars, justified as
 * "verified against the catalog: of 2,397 codes, ZERO are four letters." But the catalog is
 * LEVEL-4-ONLY — psc-catalog-live.ts:64 discards non-4-char nodes on ingest — so it cannot
 * testify about 2-char codes at all. A shape constraint was derived from a source structurally
 * incapable of observing the counterexamples.
 *
 * MEASURED 2026-08-23 against live active opportunities:
 *   4-char  11,844 rows / 1,021 codes
 *   2-char   3,074 rows /    51 codes   <- all called "Not a valid PSC format"
 *   1-char      12 rows /     3 codes
 *
 * 3,074 active rows carrying real product groups were shown a red "invalid" chip. Same class
 * as the NAICS picker gap: the reference layer could not represent data the system already
 * held, so the UI called reality wrong.
 *
 * A group code that is not in the catalog now falls through to `not_in_catalog` — "may still
 * be valid" — which is the honest state that already existed for exactly this case. 'NOPE' is
 * still malformed, so the anti-typo intent survives.
 */
const PSC_SHAPE = /^(?=.*\d)(?:[A-Z][A-Z0-9]{3}|\d{4})$/;
const PSC_GROUP_SHAPE = /^\d{2}$/;

/**
 * Codes the PSC manual has retired. Empty today — the point is that a
 * deprecation is an EXPLICIT, recorded decision. A code must never silently
 * become unknown because a catalog refresh dropped it.
 */
export const DEPRECATED_PSC: Record<string, string> = {};

export function pscStatus(raw: string): PscVerdict {
  const code = (raw || '').trim().toUpperCase();
  if (!PSC_SHAPE.test(code) && !PSC_GROUP_SHAPE.test(code)) {
    return { code, status: 'malformed', title: null, label: 'Not a valid PSC format' };
  }
  const dep = DEPRECATED_PSC[code];
  if (dep) return { code, status: 'deprecated', title: dep, label: `Retired — ${dep}` };

  const entry = getPsc(code);
  if (entry) return { code, status: 'valid', title: entry.title, label: entry.title };

  // The honest state. We do not know this code; we are NOT claiming it is fake.
  return {
    code,
    status: 'not_in_catalog',
    title: null,
    label: 'Not in our reference catalog — may still be valid',
  };
}

/** Convenience: is it safe to keep? Only 'malformed' is actually wrong. */
export function isUsablePsc(raw: string): boolean {
  return pscStatus(raw).status !== 'malformed';
}

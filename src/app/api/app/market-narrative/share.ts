/**
 * Small-business share math for the Market Research narrative — extracted so it's
 * unit-testable and so the deterministic fallback and the LLM prompt derive the
 * share the SAME way (they must never disagree).
 *
 * The bug this guards (Jul 8): the numerator (satTotal) was summed over per-agency
 * rows in authoritative billions while the denominator was totalSpending — a
 * department-level scalar of a different, much smaller scope ($14.5M) — yielding
 * "13935% of total". A share can never exceed the whole.
 */

export interface ShareInput {
  satTotal?: number;
  /** The total over the SAME row set satTotal was summed over. Preferred denominator. */
  satBase?: number;
  /** Department-level market total — only a fallback denominator (different scope). */
  totalSpending?: number;
}

/**
 * Small-business share %, against the MATCHING base, clamped to a sane 0–100.
 * Returns null when it can't be computed honestly.
 */
export function smallBizSharePct(req: ShareInput): number | null {
  const base = req.satBase && req.satBase > 0 ? req.satBase : req.totalSpending;
  if (!base || !req.satTotal || base <= 0) return null;
  const pct = (req.satTotal / base) * 100;
  if (!Number.isFinite(pct) || pct < 0) return null;
  return Math.min(100, pct); // backstop: a share can never exceed 100%
}

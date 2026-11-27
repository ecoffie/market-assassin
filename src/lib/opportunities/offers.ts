/**
 * Offers received on an award, as reported. Pure, client-safe.
 *
 * A missing, blank or non-numeric count is NOT REPORTED → null. It is never 0 bids (which read as "sole source") and
 * never 1 bidder. FPDS reports a real count of at least 1; a stored 0 was a writer default (the retired
 * admin/sync-recompete wrote 0), so 0 is treated as not reported too.
 */
export function reportedOffers(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/** Bucket for briefing copy. 'unknown' when the count is not reported. */
export function offersCompetitionLevel(offers: number | null): 'sole_source' | 'low' | 'medium' | 'high' | 'unknown' {
  if (offers === null) return 'unknown';
  if (offers === 1) return 'sole_source';
  if (offers <= 2) return 'low';
  if (offers <= 5) return 'medium';
  return 'high';
}

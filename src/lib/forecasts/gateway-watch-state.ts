/**
 * Control-plane state for the GSA Acquisition Gateway forecast source.
 *
 * A watch is not an ingest. It must not stamp `current` unless the census
 * completed and the held canonical rows cover the listing ids we saw.
 * Reading the source at all (a page came back with the source's own total)
 * is not "unreachable". Unreachable is reserved for a source we could not read.
 */

export type GatewayWatchState = 'unreachable' | 'content_stale' | 'current';

export function gatewayWatchState(input: {
  pagesFetched: number;
  reportedTotal: number;
  complete: boolean;
  heldCanonical: number;
  uniqueListingIds: number;
}): GatewayWatchState | null {
  if (input.pagesFetched === 0) return 'unreachable';
  if (input.complete) {
    return input.heldCanonical < input.uniqueListingIds ? 'content_stale' : 'current';
  }
  // Partial read: the source answered and named its size. That is behind, not dead.
  // Never `current` — an incomplete census cannot prove we hold the corpus.
  if (input.reportedTotal > 0) return 'content_stale';
  return null;
}

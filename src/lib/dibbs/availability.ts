/**
 * Is the DIBBS (DLA supply RFQ) feed offered on the maps?
 *
 * PARKED 2026-11-07. The only source that reaches DIBBS from Vercel is a paid Apify actor, and
 * that spend is not sustainable right now (docs/engineering/dibbs-cost-closeout-2026-11-02.md).
 * The sync is disabled, so `dibbs_rfqs` stops advancing. Showing it as "Live from DLA DIBBS"
 * would present a frozen snapshot as a live market.
 *
 * While false:
 *   - the map has no "DLA Supply Bids" mode, and a saved/linked `dla` mode falls back to Open;
 *   - /api/app/opportunity-map ignores `sources=dla` (no DIBBS query, no DLA pins, no DLA total).
 * The data, the drawer for an already-saved DIBBS pursuit, and the ingest code are untouched, so
 * re-enabling is this one constant once a sustainable source exists.
 */
export const DIBBS_MAP_ENABLED = false;

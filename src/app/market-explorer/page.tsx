/**
 * /market-explorer — RETIRED as a standalone hub (Eric 2026-08-02: "the market explorer is not
 * what I imagined. It is not integrated with the maps or opportunities. It is a standalone item
 * plus it links back to old style and non-existing pages").
 *
 * Market research now ORIGINATES FROM THE MAP: the map's left-rail "Market" item carries the
 * current search/filters into /opportunity-map/market (a map sub-view — same header + rail, runs
 * the market report for that search). This route just redirects any stray link/bookmark there so
 * nothing lands on the old disconnected hub (which linked to the old-dark /contractors page and
 * 404 firm slugs). The curated /agencies and /naics SEO pages still exist and are reachable from
 * the browse-hub fallback inside /opportunity-map/market.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function MarketExplorerRetired() {
  redirect('/opportunity-map/market');
}

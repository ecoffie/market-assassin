/**
 * Maps — a LAYOUT move is not navigation (#1696, 2026-09-26).
 *
 * MEASURED (boot trace, cold and warm preview loads of /opportunity-map?q=software license):
 *   2977 ms  boot places the view → boot-release → ROUND 1 (open + recompete + forecast, with counts)
 *   3269 ms  resize 818×698 → 818×696 → invalidateSize → moveend
 *   4336 ms  ROUND 2 at a 2-px-shorter bbox → aborts round 1 and re-asks all three horizons WITH counts
 * The container had already settled; the Leaflet map was still sized from an earlier resize() tick and
 * caught up on the 450 ms timer — after boot had released round 1 at the stale size. Aborting round 1's
 * HTTP requests does NOT cancel their Postgres statements (verified), so every load ran two full rounds:
 * peak 19–22 concurrent statements on a 2-core database, and Open crossed PostgREST's 8 s statement
 * timeout → HTTP 500 (#1696).
 *
 * Two rules, no timers:
 *  1. Boot syncs the map to its container BEFORE releasing the first round (route.ts finishBoot), so
 *     round 1 reads the settled bbox.
 *  2. A moveend whose centre and zoom did not change — only the container size — is a LAYOUT move.
 *     It starts a discovery round only when it exposed area the last round did not ask for. A pan
 *     moves the centre and a zoom changes the zoom, so real navigation is never classified as layout.
 *
 * Pure functions (no DOM, no Leaflet) so they are unit-tested by extraction — the same pattern as
 * market-feedback.ts. Injected into the page as window.__mapMoveKind / window.__layoutMoveNeedsFetch.
 */
export const LAYOUT_MOVE_PURE_JS = String.raw`
  // prev/next: {x,y,z} — the view CENTRE in projected pixels at zoom z (map.project(center, z)).
  // Leaflet's invalidateSize keeps the centre (pan:true), moving it by at most a rounding pixel.
  function mapMoveKind(prev,next){
    if(!prev||!next)return 'navigate';
    if(prev.z!==next.z)return 'navigate';
    var d=Math.max(Math.abs(prev.x-next.x),Math.abs(prev.y-next.y));
    return d<2?'layout':'navigate';
  }
  // released: has boot released its first round? requested / view: [west,south,east,north].
  // requested is the bbox the most recent round asked for (bbox() rounds to 4 decimals → 1e-4 slack).
  function layoutMoveNeedsFetch(released,requested,view){
    if(!released)return false;           // the release round reads the view as it is at release
    if(!requested)return true;
    var tol=1e-4;
    var inside=view[0]>=requested[0]-tol && view[1]>=requested[1]-tol && view[2]<=requested[2]+tol && view[3]<=requested[3]+tol;
    return !inside;                      // only a layout that EXPOSED new area needs pins for it
  }
`;

export const LAYOUT_MOVE_JS = '<script>(function(){' + LAYOUT_MOVE_PURE_JS
  + 'window.__mapMoveKind=mapMoveKind;window.__layoutMoveNeedsFetch=layoutMoveNeedsFetch;})();</script>';

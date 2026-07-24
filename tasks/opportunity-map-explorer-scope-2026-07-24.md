# Opportunity Map — full explorer (Airbnb/Google map⇄list) — SCOPE (2026-07-24)

**Goal:** the complete active-SAM dataset (all 11,068, nothing self-filtered) shown as a
synchronized **map + list** explorer, viewport-driven, the way Airbnb/Google do it: a
compact teaser on the inner home that opens into a full-screen explorer.

**Decisions already locked (Eric):**
- Data loads **viewport-driven** (query only what's in the current map bounds; pan refetches).
- **No self-filtering** — ship all 11,068 incl. FSC commodity buys; user can subtract via a
  "hide commodity buys" filter. (Principle: [[no-self-filter-complete-dataset]].)
- Surface = **Option B**: `/home-v5` stays an overview + compact teaser map; the full
  explorer lives on **`/opportunity-map`** (the page the teaser already links into).
- **NOT** inside the `/app` Market Intelligence panel.

---

## The enabler: precompute coordinates (the key architectural piece)

Today `getMapOpportunities` geocodes in Node (`geocode()`: pop city → office ZIP → office
city → state centroid) over local JSON dicts. There is **no lat/lng column** on
`sam_opportunities`. Viewport (bbox) filtering needs coordinates *in the query*, so:

1. **Migration** — add `map_lat double precision`, `map_lng double precision` (+ a
   composite/BRIN index) to `sam_opportunities`. Nullable (un-geocodable rows = no pin,
   honest).
2. **Backfill** — a resumable route/cron that runs the SAME `geocode()` chain over the
   corpus and stamps `map_lat/map_lng`. Add `pop_zip` (a real column we currently DON'T use)
   to the precision chain — cleaner than city-name matching.
3. **Keep fresh** — `sync-sam-opportunities` stamps coords on insert/update so new notices
   get pinned within minutes.

Result: bbox query = `.gte('map_lat',minLat).lte('map_lat',maxLat).gte('map_lng',minLng)
.lte('map_lng',maxLng)` — fast, indexed, true viewport. (In-memory alternative rejected:
paging + re-geocoding 11k on every pan won't scale.)

---

## Data API — `GET /api/app/opportunity-map` (viewport)

- **Params:** `bbox=minLng,minLat,maxLng,maxLat`, `zoom`, + filters mirroring mi-dashboard
  (`q`, `noticeType`, `setAside`, `agency`, `state`, `urgency`, `hideCommodity` default
  **false**), `scope=all|profile`.
- **Returns:** `pins[]` in bbox (capped ~800 densest, or clustered when zoomed out),
  `totalInView`, `totalForFilters` (== dashboard's 11,068 when unfiltered → they reconcile),
  `setGroups`.
- Reuses mi-dashboard filter semantics so the two surfaces never disagree.

## Explorer UI — `/opportunity-map`

- **Split layout:** left = opportunity **list** (cards, scoped to current map bounds, sorted
  by deadline); right = Leaflet **map** with set-aside-colored pins. Reuse Eric's verbatim
  EVC template styling — extend to split, don't rebuild.
- **Shared filter bar:** notice type, set-aside, agency, state, urgency, keyword search,
  "hide commodity buys" toggle, Your Profile ⇄ All SAM. Drives BOTH views.
- **Sync interactions (the Airbnb/Google feel):** hover card → pin lifts; click pin →
  card scrolls into view + popup; **"Search this area"** button on pan (or debounced
  auto-refetch); header shows "N in view · TOTAL for these filters".
- **Zoomed-out:** cluster pins (add `leaflet.markercluster`) so a US-wide view is legible;
  zoom in to resolve individual pins.
- **Mobile:** a Map / List toggle button (each full-screen), Airbnb-style.

## Home teaser — `/home-v5`

Keep the compact hero map; its expand control opens `/opportunity-map`. (Already wired —
just carry any active search/filter context through.)

---

## Open confirmations before building
1. **Coordinate storage** = precompute column + backfill (recommended). Involves a migration
   + backfill run. OK to proceed?
2. **Clustering** when zoomed out = add `leaflet.markercluster` (recommended) vs cap +
   "zoom in to see more."
3. **List scope** = bounds-scoped (Airbnb model — list == what's on the map) [recommended]
   vs a full filtered list independent of the map.

## Build order (once signed off)
1. Migration + backfill + sync stamp (coords foundation) → verify pins reconcile to 11,068.
2. Viewport API.
3. Explorer UI (split + filters + sync interactions + clustering).
4. Home teaser link-through.
5. Remove the FSC self-filter from `getMapOpportunities` (+ revisit `home-search` oppsInNaics).

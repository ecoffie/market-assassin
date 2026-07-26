# Dense Map Rendering — How to Show ALL the Points (Not a $-Ranked Subset)

**Status:** Research + recommendation. No feature code here — this is the reference a build agent implements from.
**Date:** 2026-07-26
**Author:** Research agent (for Eric)
**Scope:** Mindy's `/opportunity-map` (raw Leaflet + OSM/CARTO tiles). Applies equally to the Companies (317K), Opportunities/Active (88K SAM + labs + SBIR + GSA), and Contacts (125K) datasets.

---

## TL;DR

The premise "you can't show hundreds of thousands of pins" is **false** — Zillow, Google, Mapbox, Airbnb, Redfin, and Uber all do it. **None of them render every point as a DOM marker.** They all do exactly two things:

1. **Only fetch/draw what's in the current viewport** (bounding-box query), and
2. **Aggregate density into count-bubbles (clusters) or tiles at low zoom, and resolve individual points only as you zoom in.**

Our current cap-and-rank-by-dollars approach is the one thing *none* of them do. It silently lies ("here are the 1,000 biggest" presented as "here's the market"). The fix is not "raise the cap" — it's **clustering**: dense areas become a `147` bubble that splits apart as you zoom, so the map is always truthful about how many are there without ever drawing 147 individual markers at country zoom.

**Cheapest first step (ship this week):** add **`Leaflet.markercluster`** to the existing page — client-side clustering over the pins the API already returns. Zero backend change, turns the capped list into count-bubbles, kills the "why only 1,000?" problem for all but the densest national views.

**The real fix (the full 317K):** move clustering **server-side** — cluster by a geo-grid in the DB per viewport+zoom and return either `{cluster, count}` bubbles (low zoom) or individual pins (high zoom). Truthful `N in view` at every altitude, constant payload size regardless of dataset size.

---

## The universal pattern (what everybody actually does)

Every product below reduces to the same three-layer contract. Learn this and the specific libraries are just implementations:

| Layer | Rule | Why |
|---|---|---|
| **Viewport-bounded fetch** | Only query the DB for the current map bounding box (bbox). Never load the whole country. | 1M markers render with up to ~300× less data when you send only the viewport. Rapid panning generates near-identical queries → cache with a 30–60s TTL. |
| **Density aggregation at low zoom** | When the bbox holds too many points, return **counts** (cluster bubbles or a heatmap), not individuals. | A country view of 317K companies is *meaningless* as 317K dots — it's a blue blob. A `52,140` bubble over the Northeast is honest AND legible. |
| **Zoom-gated resolution** | As the user zooms in, clusters split into smaller clusters, then finally into individual pins once the count in view is small enough to draw. | This is "level-of-detail" (LOD) rendering. Same idea as map tiles themselves. |

Zillow's own words for this: *"dynamic level-of-detail rendering, showing clusters or heatmaps instead of individual pins at low zoom levels… when a user zooms, the markers are unclustered to reveal the individual listings."*

---

## Product teardowns

### Zillow — server-side tiling + viewport bbox + LOD
- The frontend sends a **bounding box** of the visible map; the server filters out everything outside it. ("Tile It Up!", Zillow Tech Hub.)
- **Server does the heavy lifting**, ships only what's needed: *"1 million markers render with up to 300× less data using server-side processing."*
- **LOD**: clusters/heatmap at metro/country zoom, individual home pins at street zoom.
- **Aggressive short-TTL tile cache (30–60s)** because panning produces near-duplicate queries.
- Net: at country zoom you see cluster bubbles / a shaded density; at street zoom you see every home. The DB is never asked for "all homes in the US" — only "homes in this rectangle."

### Google Maps / My Maps — MarkerClusterer + supercluster + vector tiles
- Google's `@googlemaps/markerclusterer` library is the canonical client-side clusterer: nearby markers merge into one bubble labeled with the count; zoom in and it expands.
- The base map itself is **vector tiles** — the browser only ever holds the current viewport's tile data, which is *why* Google Maps never chokes. Your data points can ride the same model.

### Mapbox — `supercluster` (the reference implementation)
- **`supercluster`** (github.com/mapbox/supercluster) is the open-source lib that powers clustering in Mapbox GL JS. This is the single most relevant reference for us.
- Algorithm: **hierarchical greedy clustering** — pick a point, absorb everything within `radius` px into a cluster, repeat on the unclustered remainder, at every zoom level. Popularized by Dave Leaver's Leaflet.markercluster; supercluster made it fast enough for **millions of points in the browser** by pre-building a KD-tree index per zoom level.
- **Mapbox's own demo clusters 6.2M points**; indexing millions takes a few hundred ms and lives in memory.
- **Cluster: true on a GeoJSON source** — in Mapbox/MapLibre GL you literally set `cluster: true` and get count-bubbles for free.
- **Heatmap layers** for extreme density and **data-driven styling** (bubble size/color by count) at low zoom.

### Airbnb — bounded viewport + rank + mini-pins (a cautionary tale AND a good idea)
- Airbnb **does** cap visible price-bubbles (~top 30–50 by booking likelihood) — *but* they don't hide the rest: lower-ranked listings render as **mini-pins** (tiny dots, no price) so you can *see that more exist*. ("Learning to Rank for Maps at Airbnb", arXiv 2407.00091.)
- One community approach: **DBSCAN clusters** (eps≈330m, min 5) rendered as convex-hull polygons with a count bubble at city scale.
- **Lesson for Mindy:** ranking-to-cap is acceptable *only when the un-ranked remainder is still visible as dots + an honest count.* Our current version caps and shows nothing else — that's the part to kill. The "best fit gets the big label, everyone else is a dot" pattern maps perfectly onto our M-Win idea (big labeled pin for the strongest-match opps, plain dots for the rest).

### Redfin — same as Zillow: viewport bbox + server clusters + heatmap at low zoom.

### Uber / Airbnb-scale viz — deck.gl / kepler.gl (GPU brute force)
- **deck.gl** (github.com/visgl/deck.gl) renders **millions of points on the GPU via WebGL2 at 60fps** — a `ScatterplotLayer` can push ~10M small points. No clustering required; the GPU just draws them all.
- Trade-off: it's a WebGL overlay (pairs with MapLibre/Mapbox/Google, and can overlay Leaflet via a canvas layer but that's off the beaten path). Heavier integration, and a 10M-point scatterplot = up to ~1B fragment-shader invocations/frame. Overkill for our need — we want *legible clusters*, not a firehose of dots. Keep in the back pocket for a future "heat/density" view, not the primary fix.

---

## The techniques — with scale, cost, and Mindy-fit

### 1. Client-side clustering (`Leaflet.markercluster` / `PruneCluster` / `supercluster`)
- **What:** Load a set of points into the browser; the lib groups nearby ones into count-bubbles that expand on zoom. Greedy hierarchical clustering.
- **Scale:** `Leaflet.markercluster` is comfortable to ~**10k–50k**, falters past **100k** (DOM-bound; its 50k real-world demo clusters in ~60ms but 250k+ stutters on the zoom animation). `PruneCluster` is faster/lower-memory (half a million points loaded in ~3.2s, better on mobile). `supercluster` (KD-tree, no DOM until render) scales to **millions** but you wire it to Leaflet yourself.
- **Client work:** add the plugin; feed it markers; done. `PruneCluster`/`supercluster` need a bit more glue.
- **Server work:** none (beyond returning the points). This is its whole appeal.
- **Fits Mindy?** ✅ **Immediately, for the currently-loaded viewport set.** We already return ≤1000 pins per bbox → `Leaflet.markercluster` turns them into bubbles with zero backend change. It is NOT enough on its own for the full 317K at national zoom (you can't ship 317K points to the browser), which is why it's phase 1, not the finish line.

### 2. Server-side clustering (geo-grid or supercluster on the backend)
- **What:** Compute clusters on the server per `bbox + zoom`, return only bubbles (low zoom) or pins (high zoom). Two flavors:
  - **Geo-grid aggregation** (simplest, DB-native): snap points to a grid cell whose size depends on zoom, `GROUP BY cell`, return `count` + cell centroid. In PostGIS: `ST_SnapToGrid` (or `floor(lng/step), floor(lat/step)`) + `COUNT(*)` + `ST_Centroid`/`AVG`. BigQuery: `ST_GEOGPOINT` + grid math, or geohash prefix `GROUP BY`.
  - **supercluster on the server**: build the index once (Node), cache it globally, call `index.getClusters(bbox, zoom)` per request. This is the Sami Kuikka Next.js pattern — raw supercluster in an API route, `moveend` → fetch → render. Best when data fits in server memory and changes slowly.
- **Scale:** **hundreds of thousands to millions.** Payload is constant (~a few hundred bubbles) regardless of dataset size.
- **Client work:** on `moveend`/`zoomend`, fetch `?bbox=&zoom=`; render returned features (bubble if `count>1`, pin if `count==1`). No heavy client lib needed — just draw what you're told.
- **Server work:** one grid-aggregation SQL query (Postgres or BigQuery), OR an in-memory supercluster index. Grid aggregation is the lowest-effort and plays natively with both our stores.
- **Fits Mindy?** ✅✅ **This is THE fix for the full dataset.** Grid aggregation is a ~15-line SQL change and works on Postgres (SAM opps) and BigQuery (317K companies) alike. Truthful `N in view` falls out of `SUM(count)`.

### 3. Vector tiles (MVT / Mapbox Vector Tiles)
- **What:** Turn the *data* into map tiles (`/{z}/{x}/{y}.mvt`). The browser only ever holds the current viewport's tiles — same mechanism as the basemap. PostGIS generates them directly: `ST_AsMVT(ST_AsMVTGeom(geom, ST_TileEnvelope(z,x,y)))`. Served from a Next.js API route (`app/api/tiles/[z]/[x]/[y]/route.ts`), consumed by **`Leaflet.VectorGrid`** (`.protobuf`) on the client — or by MapLibre GL if we ever swap the renderer.
- **Scale:** **millions+** — this is how Google/Mapbox scale. Tiles are cacheable at the CDN edge (perfect for our Vercel setup).
- **Client work:** `Leaflet.VectorGrid.protobuf(urlTemplate, {vectorTileLayerStyles})`. More styling code than plain markers. (Or adopt MapLibre GL for first-class `cluster:true`.)
- **Server work:** PostGIS `ST_AsMVT` per tile (easy); for BigQuery you'd precompute/export tiles (harder — BQ has no native MVT). Add clustering by combining with grid aggregation inside the tile query at low zoom.
- **Fits Mindy?** ⚠️ **Powerful but heavier — phase 3, not phase 1.** Great long-term for the Postgres-backed layers (SAM opps) and for edge-cached performance. The BigQuery 317K layer needs a precompute step or a Postgres materialization to tile well. Don't start here; graduate to it once server-side clustering is proven and we want CDN-cached, buttery pan/zoom.

### 4. Heatmap / density layer at low zoom
- **What:** At country/region zoom, render a **shaded density surface** (Leaflet.heat, or a coarse grid choropleth) instead of thousands of pins; switch to clusters/pins as you zoom in.
- **Scale:** unlimited (it's an aggregate).
- **Client work:** `Leaflet.heat` takes `[lat,lng,intensity]` triples; or color grid cells by count.
- **Server work:** the *same* grid-aggregation query as #2 — a heatmap is just grid counts rendered as a gradient instead of bubbles.
- **Fits Mindy?** ✅ **As a low-zoom skin on top of server-side grid aggregation.** "Where is the federal money hot?" is genuinely a better country-zoom view than 500 bubbles. Cheap add-on once #2 exists (we already have `/api/admin/demand-heatmap` as prior art).

### 5. Viewport-bounded fetch + zoom-gated detail (the Zillow contract — the glue, not a lib)
- **What:** The orchestration around all of the above: **always** query only the current bbox; when the bbox count exceeds a threshold return **aggregates**, when it's under the threshold return **individuals**; refetch on `moveend`/`zoomend`; short-TTL cache.
- **Scale:** unlimited (that's the point).
- **Fits Mindy?** ✅ **Mandatory — it's the spine.** We are *already half-way here*: `/api/app/opportunity-map` accepts a bbox, computes `totalInView`, and sets `capped`. We just need to make the "too dense" branch return **grid clusters** instead of a deadline-ordered top-1000 list.

---

## Summary table: technique × scale × cost × fits-Mindy

| Technique | Scale it handles | Client cost | Server cost | Fits Leaflet + PG/BQ + Next.js? | Library |
|---|---|---|---|---|---|
| **Client clustering** | ~10k–50k (markercluster); ~500k (PruneCluster/supercluster) | Add plugin, feed markers | None | ✅ **Phase 1, zero backend** | `Leaflet.markercluster`, `PruneCluster`, `supercluster` |
| **Server-side clustering (geo-grid)** | 100k–millions | Draw returned bubbles/pins | ~15-line grid-aggregation SQL (PG **and** BQ) | ✅✅ **The real fix** | PostGIS `ST_SnapToGrid`, BQ geohash `GROUP BY`, or `supercluster` in Node |
| **Vector tiles (MVT)** | millions+, CDN-cacheable | `Leaflet.VectorGrid` styling | `ST_AsMVT` (PG easy; BQ needs precompute) | ⚠️ **Phase 3, PG layers first** | `ST_AsMVT`, `Leaflet.VectorGrid`, (MapLibre GL) |
| **Heatmap / density** | unlimited (aggregate) | `Leaflet.heat` | Same grid query as clustering | ✅ **Low-zoom skin on #2** | `Leaflet.heat` |
| **GPU brute-force (deck.gl)** | ~10M points @ 60fps | WebGL overlay, heavier integration | None (ship raw points) | ⚠️ **Overkill; future density view** | `deck.gl`, `kepler.gl` |
| **Viewport bbox + zoom-gate** | unlimited (spine) | refetch on move/zoom | bbox filter + count | ✅ **Mandatory glue (half-built already)** | (our own API) |

---

## Recommendation for Mindy's opportunity map

Show **every** company / opp / contact — not a dollar-ranked subset — by combining three things we already have the pieces for:

1. **Viewport-bounded query returning a truthful `N in view`.** Already implemented (`bbox`, `totalInView`, `capped`). Keep it; just change what the "dense" branch returns.
2. **Zoom-gated clustering.** Below a per-view point budget (e.g. ≤ ~400 points in the bbox), return **individual pins**. Above it, return **grid clusters**: `{ lat, lng, count }` bubbles sized/labeled by count. The bubble at country zoom might say `52,140` — honest, legible, and cheap.
3. **Individual pins only at high zoom** — where the bbox is small enough that the real count is drawable, the same endpoint returns real pins (optionally with the M-Win "best fit" opp getting a labeled pin and the rest plain dots, Airbnb-style).

### What the API returns per zoom level

`GET /api/app/opportunity-map?bbox=W,S,E,N&zoom=Z&dataset=active`

```jsonc
// Low/mid zoom (dense): grid-clustered bubbles
{
  "mode": "clusters",
  "totalInView": 52140,            // truthful — SUM of all cell counts, not a capped length
  "clusters": [
    { "lat": 38.9, "lng": -77.0, "count": 8421 },
    { "lat": 32.7, "lng": -96.8, "count": 3110 }
  ]
}

// High zoom (sparse): individual pins
{
  "mode": "pins",
  "totalInView": 214,
  "pins": [
    { "id": "...", "lat": 38.90, "lng": -77.01, "title": "...", "amount": 4200000, "mwin": 72 }
  ]
}
```

The client decides bubble-vs-pin purely on `mode`. `totalInView` is ALWAYS the true count — the map header reads "**52,140 opportunities in view — zoom in to resolve**", never a silent cap.

### How the query changes (grid aggregation)

**Postgres / PostGIS** (SAM opps, recompetes — the Supabase layers). Pick a grid step from zoom (bigger cells at low zoom), aggregate, return centroids + counts:

```sql
-- $1..$4 = bbox W,S,E,N ; $5 = cell size in degrees derived from zoom
WITH pts AS (
  SELECT lng, lat
  FROM sam_opportunities
  WHERE lng BETWEEN $1 AND $3 AND lat BETWEEN $2 AND $4
    AND /* active + dataset filters */ TRUE
)
SELECT
  floor(lng / $5) AS gx,
  floor(lat / $5) AS gy,
  count(*)        AS count,
  avg(lng)        AS lng,   -- centroid of the cell's points (nicer than cell center)
  avg(lat)        AS lat
FROM pts
GROUP BY gx, gy
ORDER BY count DESC
LIMIT 600;                  -- ~600 bubbles max; totalInView = SUM(count) over ALL cells
```
(`ST_SnapToGrid(geom, $5)` is the geometry-native equivalent if a geometry column exists.) `totalInView` comes from a parallel `SELECT count(*)` over the same bbox (no grid) — the honest denominator.

**BigQuery** (the 317K companies layer). Same idea with a geohash prefix or grid math — no PostGIS, but grid aggregation is pure arithmetic and BQ eats it. Cost-cap it (bbox `WHERE` prunes hard; return only `gx,gy,count,avg`):

```sql
SELECT
  FLOOR(lng / @cell) AS gx,
  FLOOR(lat / @cell) AS gy,
  COUNT(*) AS count,
  AVG(lng) AS lng, AVG(lat) AS lat
FROM `project.dataset.companies`
WHERE lng BETWEEN @w AND @e AND lat BETWEEN @s AND @n
GROUP BY gx, gy
ORDER BY count DESC
LIMIT 600
```
Cache per (bbox-rounded, zoom) with a 30–60s TTL (Zillow's trick) so panning doesn't re-bill BigQuery.

**Cell size by zoom** (rule of thumb — target a ~40px cluster radius, matching supercluster's default): roughly `cell_degrees ≈ 360 / 2^zoom / (tileWidthInCells)`. In practice just tune a small lookup table `zoom → cell_degrees` (e.g. z3→4°, z6→0.5°, z9→0.06°, z12→0.008°) and flip to `mode:"pins"` once `totalInView ≤ ~400`.

### Which Leaflet approach

- **Phase 1 (client-only):** drop in **`Leaflet.markercluster`** over the pins the API already returns. `L.markerClusterGroup({ chunkedLoading: true })`. Instant win, no backend change.
- **Phase 2+ (server clusters):** you don't even need a clustering plugin — the server hands you bubbles, you draw them as `L.circleMarker` sized by count with the number as a `L.divIcon` label (exactly today's rendering, just count-aware). On `moveend`/`zoomend`, refetch `?bbox=&zoom=`. Clicking a bubble → `map.flyTo` one zoom deeper (mirrors `supercluster.getClusterExpansionZoom`).
- **Phase 3 (optional):** MVT via `ST_AsMVT` + `Leaflet.VectorGrid` for the Postgres layers, CDN-cached at the Vercel edge, for buttery pan/zoom.

---

## What we do TODAY vs best-in-class (gap analysis)

| | **Mindy today** | **Best-in-class (Zillow/Mapbox/Airbnb)** |
|---|---|---|
| Selection of which points to show | **Rank by dollars, keep top 1000, drop the rest silently** | Show ALL — via clusters/aggregates, nothing dropped |
| Honesty about density | `capped: true` flag exists but the map shows a top-1000 list as if it were "the market" | Header always states true `N in view`; density is visible as bubble size |
| Low-zoom (country) view | 1000 biggest-dollar dots — a misleading blob that omits 316k companies | Count-bubbles / heatmap — legible and complete |
| High-zoom (street) view | Same capped list — may still be missing nearby small-dollar opps | Every individual point resolves |
| Payload | Up to 1000 full records per view (PostgREST hard cap) | A few hundred bubbles (constant, tiny) regardless of dataset size |
| Rendering | Raw `L.circleMarker` in a `layerGroup`, no clustering | Clustering (client or server) or vector tiles |
| Data fetched | bbox filter ✅ (good — we're half-way) | bbox filter ✅ |

**The one wrong thing:** we let *dollar amount* decide visibility. A $12k janitorial recompete in Ohio is invisible next to a $400M IT vehicle in DC — even though the Ohio one may be the user's actual sweet spot. Clustering removes the need to choose: **everything is represented; density decides bubble-vs-pin, not dollars.**

---

## Phasing

**Phase 0 — stop the lie (copy-only, hours).** Wherever `capped` is true, the header must read the true `totalInView` ("**52,140 in view — zoom in**"), not present the top-1000 as complete. Buys honesty while Phase 1 lands.

**Phase 1 — client-side clustering (cheapest real fix, ~1 day).**
- Add `Leaflet.markercluster` to `template-html.ts`; wrap the returned pins in `L.markerClusterGroup({ chunkedLoading:true })`.
- No API change. Turns the capped set into count-bubbles that expand on zoom. Solves the problem for every view except the densest national ones (where 1000 is still a ceiling on the *source* set).
- **This is the single cheapest first step to ship.**

**Phase 2 — server-side grid clustering (the real fix, ~2–4 days).**
- Add `zoom` param + the grid-aggregation branch to `/api/app/opportunity-map` (and `contacts-map`, `recompete-map`). Return `mode:"clusters"` with true `totalInView = SUM(count)` above the point budget, `mode:"pins"` below it.
- Postgres query for SAM/recompete layers; BigQuery grid query for the 317K companies layer, cached per (rounded-bbox, zoom) 30–60s.
- Client draws count-bubbles (`L.circleMarker` sized by count + `divIcon` label) or pins based on `mode`; bubble click → `flyTo` deeper.
- Now the FULL dataset is represented at every zoom with constant payload. Kill the dollar-rank cap entirely.

**Phase 3 — vector tiles + heatmap (polish, later).**
- `ST_AsMVT` tile route + `Leaflet.VectorGrid` for the Postgres layers, edge-cached on Vercel, for millions-of-points-smooth pan/zoom.
- `Leaflet.heat` low-zoom density skin off the same grid query ("where's the money hot").
- (Only if we want it: deck.gl GPU layer for a dramatic all-points density view.)

---

## Sources

- Zillow Tech Hub — *Tile It Up!* (server-side tiling, viewport bbox, LOD, short-TTL tile cache): https://www.zillow.com/tech/tile-it-up/
- Mapbox — *Clustering millions of points on a map with Supercluster* (hierarchical greedy clustering, 6.2M-point demo): https://blog.mapbox.com/clustering-millions-of-points-on-a-map-with-supercluster-272046ec5c97
- `supercluster` (algorithm, `getClusters(bbox,zoom)`, `getClusterExpansionZoom`, options): https://github.com/mapbox/supercluster · README: https://github.com/mapbox/supercluster/blob/main/README.md
- `Leaflet.markercluster` (chunkedLoading, ~100k ceiling): https://github.com/Leaflet/Leaflet.markercluster · demo: http://leaflet.github.io/Leaflet.markercluster/
- `PruneCluster` (faster/lower-memory, 500k in ~3.2s): https://github.com/SINTEF-9012/PruneCluster
- Sami Kuikka — *Cluster thousands of markers with Next.js, Leaflet & supercluster* (server-side supercluster in a Next.js API route, `moveend`→`getClusters`): https://www.samikuikka.com/en/blog/how-to-cluster-thousand-of-markers-with-leaflet/
- Google `@googlemaps/markerclusterer`: https://developers.google.com/maps/documentation/javascript/marker-clustering
- Airbnb — *Learning to Rank for Maps* (rank + mini-pins, viewport): https://arxiv.org/abs/2407.00091 · Tech blog: https://medium.com/airbnb-engineering/improving-search-ranking-for-maps-13b03f2c2cca
- deck.gl (GPU, millions of points, ScatterplotLayer 10M): https://github.com/visgl/deck.gl · perf: https://deck.gl/docs/developer-guide/performance
- PostGIS `ST_AsMVT` dynamic vector tiles from PostGIS (Crunchy Data): https://www.crunchydata.com/blog/dynamic-vector-tiles-from-postgis
- PostGIS `ST_ClusterKMeans` / `ST_SnapToGrid` (server-side clustering): https://postgis.net/docs/ST_ClusterKMeans.html · https://www.crunchydata.com/blog/postgis-clustering-with-k-means
- `Leaflet.VectorGrid` (consume MVT in Leaflet): https://github.com/Leaflet/Leaflet.VectorGrid
- Leaflet high-performance guide (canvas vs DOM, 100k markers ~300MB vs 2.8GB): https://andrejgajdos.com/leaflet-developer-guide-to-high-performance-map-visualizations-in-react/
- MDPI comparative study, marker clustering vs heatmap perf: https://www.mdpi.com/2220-9964/8/8/348

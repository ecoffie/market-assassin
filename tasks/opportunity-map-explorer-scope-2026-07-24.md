# Opportunity Map — full explorer (Airbnb/Google map⇄list) — SCOPE (2026-07-24)

---
## 🧱 ZILLOW-DEPTH BUILD (2026-07-25, in progress on feat/logged-in-home-v2)

The quick-filter bar reorg SHIPPED (commit aa02b0f6 — 6 server-wired controls: scope/
notice-type/set-aside/urgency/agency/state, + search + hide-commodity). Verified live on
the PR #409 preview: filters apply server-side + survive panning (Solicitation+SDVOSB →
142/142 all-green pins).

**Eric's depth asks (all 4, verify-as-we-build):** (1) fix crowded top bar, (2) advanced
"More filters" deep panel = the missing Zillow "property-type" dropdowns, (3) Save this
search + alerts (the retention killer), (4) label the left sidebar (unlabeled icons today).

**Deep panel — DATA-GROUNDED scope (measured 2026-07-25 on active sam_opportunities):**
- ✅ NAICS 96% · PSC 97% · notice_type 100% · posted_date 100% · set_aside 57% → BUILD
- ❌ **Contract value $-range: `award_amount` is 100% NULL on active opps** (nothing's
  awarded yet — these are open solicitations). The ONLY value column; no estimated field.
  DO NOT ship a dead $-filter on Open (the stub trap).

**VALUE FILTER DECISION (Eric):** don't drop it. Wire the REAL $-range on **Recompetes mode**
(USASpending contract ceilings — real data). Make it **mode-aware**: shows on Recompetes,
hidden/"estimated (coming)" on Open. Then build an ESTIMATED value for open opps — 3 viable
approaches to pick from later (Zillow's Zestimate is also a model, so this is legit):
  1. PSC/NAICS historical award range ("this NAICS typically awards $500K–$5M") — model/estimate, labeled.
  2. Parse est. value/ceiling from notice `description` body (now captured) — partial but real.
  3. Predecessor/incumbent contract ceiling (already computed via the Award Intelligence spine) — strong proxy.
TRACKED, not forgotten. Do NOT let the $-range on Open ship as a null control.

**Build order (commit + open each):** (1) top-bar fix + sidebar labels [fast] → (2) deep
panel: NAICS/PSC/multi-set-aside/multi-agency/multi-notice-type/posted-date + $-range on
Recompetes → (3) Save search + alerts.

---
## ⏯️ HANDOFF / NEXT STEP (as of 2026-07-25 — resumed on laptop)

**Branch:** `feat/logged-in-home-v2` — pushed, in sync at `67ee8a7f` (`git pull` to grab it).
**All map/OCONUS/Zillow-nav/drawer/dataset-mode work is committed & deployed.** The one open
task is the **filter reorg** — this file's "Shared filter bar" (line ~53) is the spec.

**The problem:** `/opportunity-map` still shows the EVC template's OWN leftover filter pills —
**Source · Service line · Set-aside · Closing ≤7 days** — which are CLIENT-SIDE (they hide
pins already in view, then reset on every pan-refetch → look dead). "Source" and "Service
line" were NEVER in the plan; "Closing ≤7 days" belongs inside More filters as urgency.

**NEXT (build to the doc, not to chat improv):**
1. DELETE the 4 leftover template pills in `src/app/opportunity-map/route.ts` — the
   `data-sheet="src"` (Source), `data-sheet="cat"` (Service line), `data-sheet="set"`
   (Set-aside), and `id="f-soon"` (Closing ≤7 days) buttons.
2. BUILD the 8 planned controls as REAL server filters wired into `fetchView`:
   **notice type · set-aside · agency · state · urgency · keyword search · hide-commodity
   toggle · Your Profile ⇄ All SAM**. The viewport API already accepts every one of these
   params (`noticeType, setAside, agency, state, hideCommodity, q, scope`; recompete API
   accepts `setAside, agency, naics`). urgency = a closing-window param (add to API if absent).
3. Set-aside dropdown must filter by set-aside GROUP (SDVOSB/SB/8a/WOSB/HUBZone → code list),
   not a single exact `set_aside_code` — the open API currently does `.eq(set_aside_code)`;
   widen to `.in(...)` using `SET_GROUPS` codes in `src/lib/opportunities/map-data.ts`.
4. Filters must re-query per active mode (open vs recompete endpoint).

⚠️ NOTE: the "Set-aside · Agency · Industry · More filters" grouping mentioned earlier was
chat improv, NOT in this doc. The doc's 8-control list above is the source of truth unless
Eric revises it.
---


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

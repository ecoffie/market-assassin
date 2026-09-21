# Contacts: 4 datasets + real city geocoding (2026-07-26)

Two DECIDED fixes (Eric, from the contacts-map screenshots). Held until the two in-flight
map agents (federal_contacts cleanup, map-clustering Phase 0) land + merge — to avoid a
4-way `route.ts`/`contacts-map` collision. Launch on a clean `main`.

## 1. Split "Contacts" → two first-class datasets in the main dropdown
**Problem:** the Companies|Buyers segmented toggle keeps getting shoved into awkward spots
(filter row → under the count → crammed next to Sort, cut off as "Bu…"). Eric: stop treating
it as a sub-toggle.
**Fix (DECIDED):** the dataset dropdown becomes **4 flat choices: Open · Awarded · Companies ·
Gov Buyers**. No Companies|Buyers toggle anywhere — each is a first-class dataset switched the
same way as Open/Awarded. `CONTACT_TYPE` is inferred from which dataset is selected (companies
vs buyers), not a separate control.
- The dataset dropdown is built in `route.ts` (~line 116-125, the `<option>` list) + the MODES
  logic. Add a 4th option; route `companies`→CONTACT_TYPE=companies, `buyers`→CONTACT_TYPE=buyers.
- Remove the `.ctseg-btn` Companies/Buyers segmented control entirely.
- Top nav (Open/Past/Contacts) — keep "Contacts" as a grouping word OR relabel; Eric picked the
  dropdown split, nav wording is minor. Keep the filter-row menu-consistency from #457.

## 2. Real city placement — kill the fake state-centroid rings
**Problem (the "not sorting by location"):** `contacts-map/route.ts` places every firm/buyer via
`placeByState()` = `STATE_CENTROIDS[state] + jitter` (src/lib/geo/state-centroids.ts). So every
KY firm (Louisville, Frankfort, Lexington) scatters in a decorative RING around Kentucky's
geographic center — not its real city. The cards already show the real city (Louisville KY,
Pascagoula MS, Marietta GA, Oak Ridge TN) — **we have the city, we just don't place by it.**
**Fix (DECIDED):** geocode to the REAL city.
- Bundle a US city→lat/lng table (~30K US cities; a static data file in `src/data/` or
  `src/lib/geo/` — NO external API, so CSP-safe, no rate limit). Source: a public US cities
  dataset (city, state, lat, lng). Key by `UPPER(city)|state`.
- `contacts-map/route.ts`: replace `placeByState()` with a `placeByCity(city, state)` that looks
  up the bundled table; FALL BACK to state-centroid+jitter only when the city isn't found (never
  fabricate — a real-city hit is exact, the fallback stays the honest approximation). Keep a tiny
  jitter ONLY for multiple firms in the SAME city (so they don't stack on one pixel), not a
  state-wide ring.
- CACHE the resolved lat/lng: store it on the row (companies → a `map_lat`/`map_lng` on the
  recipients cache like `sam_opportunities.map_lat`, OR a small geocode-cache table) so it's
  computed once, not per request. Eric picked "bundle table + place by real city"; storing the
  cached latlng is the fast-follow within the same build (request-time lookup is fine v1, cache
  is the optimization).
- After this, Phase-0 markercluster clustering becomes MEANINGFUL — real cities cluster by real
  proximity, not fake rings.

## 3. BUNDLE CITY LABELING ACROSS THE BOARD — one shared geocoder for EVERYTHING (Eric)
Eric: "make sure to bundle this city labeling across the board for everything." The city→latlng
table must NOT be a Companies-only fix — it becomes the CANONICAL location layer for EVERY map
surface, replacing the current patchwork (sam_opportunities.map_lat, company state-centroid rings,
buyer join-state).
- Build ONE shared lib `src/lib/geo/city-geocode.ts` exporting `geocodeCity(city, state) →
  {lat,lng,precision:'city'|'state'}` backed by the bundled US-cities table. This is THE geocoder.
- Route EVERY placement path through it:
  - **Companies** (contacts-map) — city from recipients_rollup_merged → real city.
  - **Gov Buyers** (contacts-map) — city where available (sparse; state fallback, labeled).
  - **Open opportunities** — currently uses `sam_opportunities.map_lat/map_lng` + `map_loc_source`.
    Reconcile: the opp geocoder (whatever sets map_lat) should ALSO use this shared lib so opps and
    companies place consistently. If map_lat is already city-accurate, leave the stored values but
    point the compute path at the shared lib; if it's state-level, upgrade it.
  - **Awarded / Recompetes** — ⚠️ CONFIRMED SAME RING BUG (Eric, screenshot 12:49). But different
    mechanism than Companies: recompete pins read a STORED `recompete_opportunities.map_lat/map_lng`,
    and that stored coord was generated at STATE-CENTROID + jitter. MEASURED: 500 MO rows cluster
    around ~9 base points all at ~(38.5, -92.5) = dead center of Missouri — not St. Louis (38.6,-90.2)
    or KC (39.1,-94.6). ROOT: `place_of_performance_city` is EMPTY on these rows, so the backfill had
    no city and fell back to state-center. So the recompete fix is TWO steps: (a) RECOVER the city —
    from the row's raw_data, the recipient HQ city, or re-fetch from USASpending (which carries
    place-of-performance city + recipient city); (b) RE-BACKFILL map_lat/map_lng via the shared
    `geocodeCity()` from the recovered city. Where no city is recoverable, keep the state-center pin
    but LABEL it state-approx (honest), don't present it as a real location. This is a bulk re-backfill
    of `recompete_opportunities.map_lat` — measure recoverable-city count first, ask before the write.
- **Precision honesty:** the geocoder returns whether a pin is city-exact or state-approx. Surface
  that (the map legend already says "hollow = buying office / place of performance not specified");
  keep an equivalent honest signal for state-fallback pins. NEVER present a state-centroid guess as
  an exact city location.
- Consistency win: one table, one lib, one placement rule → the same firm/opp lands on the same
  real spot on every surface, and clustering (Phase-0/Phase-2) is meaningful everywhere.
- Scope note: this is now a SHARED-INFRA change (not just contacts). Sequence it as its own focused
  build AFTER the map agents clear — the shared lib first, then wire each surface through it (one
  fix = every surface, GOS invariant #6). Measure how many opp rows are already city-accurate vs
  state-level before deciding whether to re-backfill map_lat.

## Grounding
- Companies carry city+state in `recipients_rollup_merged` (BigQuery, via `searchRecipients`).
- Buyers: city is sparse (federal_contacts has no city; location came from the sam_opportunities
  join's pop_state). Buyers may only geocode to state-level until a city source exists — note that
  honestly; companies get real-city placement first (they have the city).
- Existing: `src/lib/geo/state-centroids.ts` (the current fallback), `location-match.ts`.

## Constraints
- `repl()`/replacer injections in route.ts; `.fscroll` no overflow; filter-bar-overflow guard green.
- The rank-then-filter gate (step 7/9) — contacts-map query must keep passing `state` scope.
- tsc clean; unit tests pass. Marketing literature updated.
- Isolated worktree off clean `main` (after the 2 map agents merge).

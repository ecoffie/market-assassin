# Shared city-coordinate integrity — audit + repair (2026-10-04)

Trigger: Players acceptance check 5. #1822 made the Richmond query correct, with all 18 Richmond-metro firms returned. But 7 of the 8 Richmond pins drew outside a downtown-Richmond viewport. The failure chain was: correct canonical firms → correct city filter → **wrong city coordinate** → pins outside the viewport.

## 1. Source of truth

- `src/data/us-city-coords.json` (29,542 `CITY|ST` keys) arrived in #410 (2026-07-25) with **no generator** and is documented only as "GeoNames".
- Measured: every entry examined equals **one ZIP centroid** from `us-zip-coords.json`:
  - RICHMOND|VA = ZIP 23234 (Chesterfield County, 10.5 km south of the city)
  - GLEN ALLEN|VA = ZIP 23059
  - NEW YORK|NY = ZIP 10001

  It is a postal-ZIP point, not a place location, so it has no trustworthy provenance as a *city* coordinate.
- **Authoritative replacement (US Census Bureau, public domain):**
  - Coordinates: the 2024 Gazetteer place file (`2024_Gaz_place_national`), using `INTPTLAT/INTPTLONG`, the internal point of each incorporated place or CDP.
  - Boundaries: the 2024 cartographic place boundaries (`cb_2024_us_place_500k`), used to test whether the current point is inside the named place.
- Reproducible generator: `scripts/geo/correct-city-coords.mjs`. Manifest: `data/geo/us-city-coords-corrections-2026-10-04.json` (every applied and held row, with GEOID).

## 2. Audit (programmatic, all 29,542 entries)

| Outcome | Entries |
|---|---|
| Matched to exactly one Census place in the stated state | 22,035 |
| — current point inside the place boundary (left alone) | 10,901 |
| — within 0.5 km of the boundary (500k generalisation noise; left alone) | 2,920 |
| — **outside the place, move ≤ 25 km → corrected** | **8,126** |
| — outside the place, move > 25 km → **held** (homonym risk) | 79 |
| — Census internal point itself outside the polygon (left alone) | 9 |
| Ambiguous (two Census places share the name) — unchanged | 49 |
| Unmatched (postal locality with no Census place, e.g. NORTH CHESTERFIELD) — unchanged | 7,458 |

Other checks:

- **Outside the stated state:** 2 entries, both left alone because they are genuine remote places, not errors: WAKE ISLAND|HI and GRAND PORTAGE|MN.
- **State-centroid placeholder coordinates:** 0.
- **Coordinates shared by several keys:** 106 entries. Shared ZIPs are expected for this provenance and are not, by themselves, an error.

**Mindy records behind the 8,126 corrections:** 4,533 entries carry Mindy records. Behind them sit 57,238 Players firm HQs, 1,266 active-opportunity places of performance, 17,081 active-opportunity buying offices (Buyer pins) and 584 forecast places.

### Top represented corrections (records = Players firms · open PoP · buyer office · forecast)

| city | state | current | canonical (Census) | displacement | affected records |
|---|---|---|---|---|---|
| COLUMBUS | OH | 40.0999, -83.0157 | 39.9839, -82.9849 | 13.16 km | 716 firms · 17 open · 8066 buyer-office · 0 forecast |
| RICHMOND | VA | 37.4373, -77.4788 | 37.5314, -77.476 | 10.47 km | 605 firms · 98 open · 4028 buyer-office · 0 forecast |
| PHILADELPHIA | PA | 39.865, -75.2752 | 40.0094, -75.1333 | 20.1 km | 884 firms · 69 open · 2500 buyer-office · 123 forecast |
| ALEXANDRIA | VA | 38.7912, -77.0814 | 38.8193, -77.0837 | 3.13 km | 1657 firms · 41 open · 87 buyer-office · 15 forecast |
| ATLANTA | GA | 33.8687, -84.3351 | 33.7629, -84.4227 | 14.28 km | 1593 firms · 39 open · 146 buyer-office · 3 forecast |
| BALTIMORE | MD | 39.1753, -76.6732 | 39.3, -76.6105 | 14.88 km | 1489 firms · 12 open · 90 buyer-office · 35 forecast |
| DENVER | CO | 39.838, -104.9988 | 39.7619, -104.8811 | 13.14 km | 1323 firms · 3 open · 210 buyer-office · 1 forecast |
| PORTLAND | OR | 45.4373, -122.6147 | 45.537, -122.65 | 11.42 km | 1089 firms · 24 open · 118 buyer-office · 1 forecast |
| TAMPA | FL | 27.9961, -82.582 | 27.9701, -82.4797 | 10.45 km | 1043 firms · 27 open · 110 buyer-office · 2 forecast |
| LOS ANGELES | CA | 33.9731, -118.2479 | 34.0194, -118.4108 | 15.88 km | 1101 firms · 18 open · 12 buyer-office · 2 forecast |
| SAINT LOUIS | MO | 38.6459, -90.3264 | 38.6357, -90.2446 | 7.19 km | 963 firms · 24 open · 16 buyer-office · 0 forecast |
| FALLS CHURCH | VA | 38.8502, -77.1448 | 38.8847, -77.1756 | 4.67 km | 553 firms · 15 open · 419 buyer-office · 0 forecast |
| FAIRFAX | VA | 38.8177, -77.2925 | 38.8532, -77.299 | 3.99 km | 915 firms · 5 open · 0 buyer-office · 33 forecast |
| MINNEAPOLIS | MN | 45.0523, -93.2541 | 44.9633, -93.2683 | 9.96 km | 861 firms · 27 open · 29 buyer-office · 2 forecast |
| LOUISVILLE | KY | 38.189, -85.6768 | 38.2247, -85.7406 | 6.84 km | 696 firms · 5 open · 89 buyer-office · 0 forecast |
| CINCINNATI | OH | 39.162, -84.4569 | 39.1402, -84.5058 | 4.86 km | 691 firms · 22 open · 24 buyer-office · 1 forecast |
| SAINT PAUL | MN | 44.8965, -93.1034 | 44.9489, -93.1041 | 5.83 km | 520 firms · 11 open · 183 buyer-office · 0 forecast |
| DAYTON | OH | 39.7574, -84.0569 | 39.7847, -84.1996 | 12.57 km | 518 firms · 14 open · 171 buyer-office · 0 forecast |
| TULSA | OK | 36.0557, -96.0602 | 36.1279, -95.9023 | 16.3 km | 561 firms · 6 open · 22 buyer-office · 2 forecast |
| NEW ORLEANS | LA | 29.9614, -90.1577 | 30.0534, -89.9345 | 23.8 km | 510 firms · 31 open · 33 buyer-office · 9 forecast |
| BOULDER | CO | 40.0497, -105.2143 | 40.0244, -105.2513 | 4.22 km | 476 firms · 20 open · 0 buyer-office · 2 forecast |
| FREDERICK | MD | 39.4461, -77.335 | 39.4341, -77.4145 | 6.96 km | 390 firms · 16 open · 77 buyer-office · 5 forecast |
| ASHBURN | VA | 39.0853, -77.6452 | 39.0273, -77.4713 | 16.34 km | 416 firms · 1 open · 6 buyer-office · 57 forecast |
| LEESBURG | VA | 39.042, -77.6054 | 39.1064, -77.5592 | 8.2 km | 459 firms · 2 open · 0 buyer-office · 0 forecast |
| ANNAPOLIS | MD | 38.9898, -76.5501 | 38.9722, -76.5053 | 4.34 km | 416 firms · 6 open · 0 buyer-office · 15 forecast |
| RAPID CITY | SD | 44.1415, -103.2052 | 44.0711, -103.2179 | 7.89 km | 415 firms · 2 open · 10 buyer-office · 1 forecast |
| ROCHESTER | NY | 43.286, -77.6843 | 43.1699, -77.6169 | 14.02 km | 416 firms · 2 open · 0 buyer-office · 1 forecast |
| FREDERICKSBURG | VA | 38.2688, -77.5476 | 38.2993, -77.4867 | 6.31 km | 383 firms · 1 open · 10 buyer-office · 4 forecast |
| ALPHARETTA | GA | 34.1124, -84.302 | 34.0709, -84.2726 | 5.35 km | 341 firms · 1 open · 0 buyer-office · 0 forecast |
| CHARLESTON | SC | 32.9668, -79.8528 | 32.828, -79.9729 | 19.08 km | 293 firms · 6 open · 7 buyer-office · 11 forecast |
| LAUREL | MD | 39.0958, -76.8155 | 39.0951, -76.8612 | 3.94 km | 272 firms · 6 open · 1 buyer-office · 18 forecast |
| LINCOLN | NE | 40.8651, -96.8231 | 40.8103, -96.6749 | 13.88 km | 272 firms · 3 open · 1 buyer-office · 0 forecast |
| UPPER MARLBORO | MD | 38.8377, -76.798 | 38.8165, -76.7537 | 4.5 km | 270 firms · 0 open · 0 buyer-office · 0 forecast |
| IRVING | TX | 32.7673, -96.7776 | 32.8577, -96.97 | 20.6 km | 244 firms · 1 open · 16 buyer-office · 1 forecast |
| SARASOTA | FL | 27.4072, -82.5303 | 27.3383, -82.5437 | 7.77 km | 245 firms · 2 open · 0 buyer-office · 0 forecast |
| CHARLOTTESVILLE | VA | 38.0936, -78.5611 | 38.0377, -78.4854 | 9.09 km | 233 firms · 0 open · 0 buyer-office · 0 forecast |
| SPRINGFIELD | MO | 37.2581, -93.3437 | 37.1942, -93.2926 | 8.42 km | 229 firms · 3 open · 0 buyer-office · 0 forecast |
| DES MOINES | IA | 41.6727, -93.5722 | 41.5726, -93.6102 | 11.57 km | 224 firms · 4 open · 0 buyer-office · 0 forecast |
| PALO ALTO | CA | 37.4673, -122.1388 | 37.3965, -122.1431 | 7.88 km | 210 firms · 16 open · 0 buyer-office · 0 forecast |
| NORCROSS | GA | 33.9604, -84.0379 | 33.9374, -84.2056 | 15.68 km | 225 firms · 0 open · 0 buyer-office · 0 forecast |

### Held for review (move > 25 km): top 25 by records

Most are homonyms: the postal locality and the Census place share a name but are different places. Example: postal Voorhees, NJ is in Camden County, while the Census "Voorhees CDP" is in Somerset County, 81 km away. **ORLANDO|FL is a real error** in this list: it sits 57 km east, in Brevard County. It needs an explicit decision because the rule caps automatic moves at 25 km.

| city | state | current | Census candidate | displacement | affected records |
|---|---|---|---|---|---|
| ORLANDO | FL | 28.3067, -80.6862 | 28.4087, -81.2548 | 56.78 km | 877 firms · 29 open · 25 buyer-office · 6 forecast |
| COLUMBIA | SC | 34.0726, -81.1796 | 34.0405, -80.9061 | 25.45 km | 382 firms · 9 open · 4 buyer-office · 0 forecast |
| LANSING | MI | 42.5961, -84.8382 | 42.7143, -84.5609 | 26.21 km | 116 firms · 2 open · 4 buyer-office · 0 forecast |
| KODIAK | AK | 57.6036, -153.3751 | 57.7912, -152.4197 | 60.48 km | 66 firms · 3 open · 2 buyer-office · 30 forecast |
| RIO RANCHO | NM | 35.0443, -106.6729 | 35.2851, -106.6989 | 26.88 km | 76 firms · 0 open · 0 buyer-office · 0 forecast |
| ROSWELL | NM | 33.6397, -104.3748 | 33.3734, -104.5294 | 32.9 km | 50 firms · 2 open · 0 buyer-office · 0 forecast |
| KINGMAN | AZ | 35.1328, -113.7033 | 35.217, -114.0105 | 29.45 km | 48 firms · 1 open · 0 buyer-office · 0 forecast |
| VOORHEES | NJ | 39.8504, -74.9646 | 40.4822, -74.4925 | 80.9 km | 29 firms · 0 open · 0 buyer-office · 0 forecast |
| WOODBURY | NY | 40.8154, -73.4716 | 41.3275, -74.1021 | 77.69 km | 21 firms · 0 open · 0 buyer-office · 0 forecast |
| FAIRVIEW | PA | 42.0407, -80.2395 | 41.0156, -79.7432 | 121.24 km | 16 firms · 0 open · 0 buyer-office · 0 forecast |
| MARLBORO | NJ | 40.3182, -74.2639 | 39.4871, -75.3246 | 129.33 km | 14 firms · 0 open · 0 buyer-office · 0 forecast |
| LOCUST GROVE | VA | 38.3352, -77.7709 | 38.9695, -78.4021 | 89.32 km | 14 firms · 0 open · 0 buyer-office · 0 forecast |
| VALDEZ | AK | 61.101, -146.9 | 61.0836, -146.3172 | 31.39 km | 12 firms · 0 open · 0 buyer-office · 1 forecast |
| CASCADE | ID | 44.6927, -115.6417 | 44.5088, -116.0436 | 37.82 km | 13 firms · 0 open · 0 buyer-office · 0 forecast |
| FAIRVIEW | NC | 35.5258, -82.3985 | 35.156, -80.5244 | 174.89 km | 13 firms · 0 open · 0 buyer-office · 0 forecast |
| WILLIAMS | AZ | 35.5434, -112.1707 | 35.2466, -112.1833 | 33.02 km | 12 firms · 0 open · 0 buyer-office · 0 forecast |
| AJO | AZ | 32.2295, -112.6542 | 32.3923, -112.8839 | 28.17 km | 12 firms · 0 open · 0 buyer-office · 0 forecast |
| ESTES PARK | CO | 40.6281, -105.5692 | 40.367, -105.5339 | 29.19 km | 12 firms · 0 open · 0 buyer-office · 0 forecast |
| MOUNTAIN HOME AFB | ID | 43.7914, -116.4012 | 43.0492, -115.8659 | 93.17 km | 1 firms · 0 open · 8 buyer-office · 0 forecast |
| YAKUTAT | AK | 59.812, -139.5505 | 59.5636, -139.6062 | 27.8 km | 8 firms · 0 open · 0 buyer-office · 0 forecast |
| WHITEHALL | PA | 40.6567, -75.5041 | 40.3602, -79.9898 | 380.62 km | 8 firms · 0 open · 0 buyer-office · 0 forecast |
| MISSION HILLS | CA | 34.2619, -118.4587 | 34.6888, -120.4398 | 187.7 km | 7 firms · 0 open · 0 buyer-office · 0 forecast |
| GALLATIN GATEWAY | MT | 45.339, -111.2485 | 45.5878, -111.1946 | 27.98 km | 7 firms · 0 open · 0 buyer-office · 0 forecast |
| MIDWAY | AR | 36.3933, -92.4881 | 34.2499, -92.9734 | 242.37 km | 5 firms · 0 open · 0 buyer-office · 0 forecast |
| SANTA MARGARITA | CA | 35.3584, -120.2596 | 35.3894, -120.6082 | 31.79 km | 3 firms · 2 open · 0 buyer-office · 0 forecast |

## 3. Repair rule (coordinate truth only)

- Only the coordinate values of the 8,126 entries change.
- Unchanged: keys, city names, state identity, company HQ data, awards, Players membership and listing identity.

## 4. Cross-surface effect

| Surface | Reads | Effect of this PR |
|---|---|---|
| Proven Players (companies) | live `geocodeCity` | pins move to the Census place at deploy |
| Gov Buyers | live geocode of notice PoP/office | pins move at deploy |
| Open Now (SAM) | **stored** `sam_opportunities.map_lat/lng` | unchanged until those columns are re-stamped. New notices stamp with the corrected table |
| Coming Back (recompetes) | **stored** `recompete_opportunities.map_lat/lng` | unchanged until re-backfilled |
| Coming Soon (forecasts) | **stored** `agency_forecasts.map_lat/lng` | unchanged until re-backfilled |

Re-stamping the three stored surfaces is a production data write (`scripts/backfill-*-latlng`). It is **not** in this PR. The decision is recorded separately.

No discovery logic changes and no extra rounds. A coordinate can only move where a pin is drawn.

## 5. Not in this PR

- The 79 held moves, including ORLANDO|FL.
- Re-stamping the stored coordinates for Open, Coming Back and Coming Soon.
- The duplicate boot/discovery-round defect: separate, recorded in `tasks/players-canonical-activation-2026-10-04.md`.

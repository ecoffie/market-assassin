# END-TO-END FORECAST SURFACE COVERAGE AUDIT — READ ONLY

**Run:** 2026-09-14 · **Repo:** `ecoffie/market-assassin` @ `origin/main` `326244fd` (clean worktree)
**Scope:** every `(source_agency, source_type)` pair in `agency_forecasts`, traced to the Maps and MCP surfaces.
**Nothing was ingested, modified, fixed, or PR'd.** All counts are exact (`Prefer: count=exact` / full paging), never a 1,000-row sample.

> **Method note.** `DATABASE_URL` in `.env.local` is STALE — `password authentication failed for user "postgres"`,
> so `npm run migrate:status` and any direct `psql` path are dead. All DB evidence below came through
> PostgREST with the service-role key, using exact-count headers and full pagination (row counts were
> re-verified against the exact count on every pass). Live-surface evidence came from prod HTTP and from
> the real hosted MCP connector.

---

## F. VERDICT (answering the five questions first)

**1. Are all existing forecasts showing up in `/app/maps`? — NO.**
Also: **`/app/maps` does not exist** (prod returns **404**). The live maps surface is **`/opportunity-map`** (200).
Of **35,751** canonical forecast rows, **18,748 (52.4%)** can be drawn as pins. **17,003 (47.6%)** can never be a pin.

**2. Are all existing forecasts available through MCP? — NO.**
**32,234 of 35,751 (90.2%)** are eligible for `get_agency_forecasts`. **3,517 (9.8%)** are excluded by the
default past-fiscal-year rule. Live MCP unfiltered `total` = **32,234**, matching the computed figure exactly.

**3. How many records/agencies are missing from each.**

| Surface | Exposed | Missing | Agencies at 0% |
|---|---:|---:|---|
| Maps (pins) | 18,748 (52.4%) | **17,003** | HHS (5,504), USACE·enterprise (2,124), SSA (170), NASA·naf (147), USACE·district_da_pdf (124), NASA·excel (42) — **8,111 rows in 6 pairs / 4 agencies** |
| MCP | 32,234 (90.2%) | **3,517** | none at 0%; worst are Treasury (20% visible) and HHS (46%) |

**4. Is the problem data, agency identity, backend query, MCP contract, or UI? — ALL FIVE, in this order of damage:**

1. **Agency identity (P0, worst).** 9 of the 16 map agency presets return **ZERO** forecasts — verified live.
2. **Data (largest volume, mostly NOT fixable).** 15,964 of the 17,003 unmapped rows publish no location at all.
3. **Backend query (P0, wrong answers).** `agency=EPA` returns 7,246 rows; EPA's entire corpus is 50.
4. **MCP contract.** Past-FY rule + 200-row ceiling with **no offset/pagination**.
5. **UI.** 1,000-pin viewport cap; unplaced list capped at 150 and gated behind a search key.

**5. P0 — we already own the data, users cannot reach it.**

| # | Fix | Cost of not fixing |
|---|---|---|
| **P0-1** | Map agency presets don't match forecast rows | **28,079 of 35,751 rows (78.5%) unreachable via the Agency dropdown**, incl. all DoD (11,789), HHS (5,504), DHS (1,644), DOE (1,301), DOJ (619), NASA (189), EPA (50) |
| **P0-2** | `ilike.%EPA%` matches "d‑EPA‑rtment" | `agency=EPA` returns **7,246** rows, **7,196 wrong**; 5,438 draw as EPA pins |
| **P0-3** | "Army" → 0 despite USACE = Army Corps | 2,908 rows invisible; **this is why the coverage study ranked Army the #1 expansion target** |
| **P0-4** | Maps and MCP disagree on past FY | 3,517 rows visible on one surface, invisible on the other |
| **P0-5** | MCP has no pagination | HHS's 2,550 eligible rows → at most 200 retrievable per filter |
| **P0-6** | Geocode backfill never run for 1,039 rows | 1,039 pins recoverable today (NASA 103, DHS 579, DOE 145, DOJ 86, SSA 43) |

---

## A. CANONICAL DATA

**35,751** physical rows · **30** pairs · **20** agencies — pairs and agencies match the 2026-09-14 handoff exactly.
Row count is **+10** vs the handoff's 35,741 (drift since the snapshot; not an error).

- `external_id`: **35,751 / 35,751 (100%)** populated across every pair.
- `map_lat`/`map_lng` (Maps pin requirement): **18,748 (52.4%)**.
- Fiscal year passing MCP's default rule: **32,234 (90.2%)**.
- `pop_state` NULL: **14,253 (40%)**.
- No pair fails on `title`; `naics_code` is the only Maps/MCP-relevant field with real sparsity (SSA 43/170, NAVY 4,144/8,821).

## B. `/app/maps` → actually `/opportunity-map`

- **Page/component:** `src/app/opportunity-map/route.ts` (HTML+JS emitted by a route handler).
- **API:** `GET /api/app/forecast-map` → `src/app/api/app/forecast-map/route.ts`.
- **Lib:** `getForecastViewportPins` / `getUnplacedForecastRows` / `applyForecastFilters` in `src/lib/opportunities/map-data.ts`.
- **Source table:** `agency_forecasts` **directly** — no view, **no `source_type` filter, no fiscal-year filter, no status filter, no hardcoded agency allowlist.** Every source_type is equally eligible. Good.
- **Hard requirement:** `.not('map_lat','is',null)` + bbox. **This is the whole Maps gap.**
- **Caps:** `MAX_PINS = 1000` per viewport; unplaced list `limit 150`, and only when `includeUnplaced=1` **and** a `q`/`naics`/`agency` search key is present.
- **Forecast horizon is ON by default** (`{open:true,recompete:true,forecast:true}`), but is **dropped entirely** while a Today's-Lens strategy filter is active.

**Live proof (national bbox, unfiltered):** `totalForFilters: 18748`, `totalInView: 1000`, `capped: true` — the backend's mappable corpus is exactly the 18,748 computed from the DB.

### B1 — P0-1: the Agency dropdown returns ZERO forecasts for 9 of 16 agencies

`AGENCY_PRESETS` (`route.ts:74`) sends a `.match` needle built for **SAM's** `department` text. Forecast rows store
the agency in `source_agency` as an **abbreviation**, and `department` is **NULL for over half the corpus**. Verified live:

| Dropdown selection | Needle sent | Forecast rows returned | Rows that exist |
|---|---|---:|---:|
| Department of Defense | `DEFENSE` | **0** | 11,789 (NAVY+USACE+ONR+NRL) |
| Health & Human Services | `HEALTH AND HUMAN SERVICES` | **0** | 5,504 |
| Department of Homeland Security | `HOMELAND SECURITY` | **0** | 1,644 |
| Department of Energy | `ENERGY` | **0** | 1,301 |
| Department of Justice | `JUSTICE` | **0** | 619 |
| NASA | `NATIONAL AERONAUTICS` | **0** | 189 |
| Environmental Protection Agency | `ENVIRONMENTAL PROTECTION` | **0** | 50 |
| Department of State / Commerce | — | 0 | 0 (genuine gap) |

The 7 presets that *do* match only reach the `department`-populated twin of each pair, missing the `gsa_gateway_csv` half
(VA 692 of 1,390 · DOI 3,131 of 6,164 · USDA 2,509 of 5,028 · GSA 336 of 514 · DOT 660 of 897 · DOL 144 of 166).

**Total reachable via the Agency dropdown: 7,672 of 35,751 = 21.5%.** The other **78.5% is unreachable by agency.**

### B2 — P0-2: `agency=EPA` returns 144× too many rows

`agencyIlikeConds` turns a single-word needle into `col.ilike.%EPA%`. **"D‑EPA‑RTMENT" contains "EPA".**

```
EPA true corpus (source_agency=EPA)      = 50
department ILIKE %epa%                   = 7196   ← "Department of the Interior", "Department of Transportation", …
map filter (dept OR source_agency ~ epa) = 7246
  …of those, drawn as EPA pins           = 5438   ← live: totalForFilters=5438 for agency=EPA
```
Swept all 20 agency needles: **EPA is the only true over-match.** NAVY's +60 is legitimate (ONR 48 + NRL 12, both `Department of the Navy`).
`applyForecastFilters` is shared with **forecast saved-search alerts**, so this ships wrong rows by email too.

### B3 — ID-level traces through the live Maps path

| Pair | external_id | map_lat | Rendered as PIN | In unplaced list |
|---|---|---|---|---|
| DHS/api | `F2026073973` | yes | **YES** | no |
| DOI/gsa_gateway_csv | `GW-L:USGS0070330066` | yes | **YES** | no |
| EPA/apex_forecast_db | `EPA-FY-2020-13230` | yes | **YES** | no |
| NAVY/lrae_xlsx | `NAVY-T:N40085-S8LGU4` | yes | **YES** | no |
| HHS/sbcx_api | `HHS-FDD04A70-…A38454` | NULL | no | YES (150 of 162 returned) |
| USACE/enterprise_da_format | `USACE-DA-ENDIST-TULSA-X9JGZ0` | NULL | no | YES (150 of 298) |
| NASA/naf_xlsx | `9972` | NULL | no | YES (39 of 39) |
| SSA/excel | `SSA-OCIO-26-163H0` | NULL | no | YES (150 of 170) |

Unplaced rows **are** reachable — but only under a search key, and only the first 150. Unfiltered NAVY returns `150 of 3,828`.

### B4 — Is the unmapped half a bug or the truth?

Of **17,003** unmapped rows, only **1,039 carry a real state/city** and are geocodable today.
**15,964 publish no location at all** — that is upstream reality, not a Mindy failure, and the route already
discloses it honestly via `unmappedForFilters` (explicitly `null` = UNKNOWN, never 0).

## C. MCP

- **Tool:** `get_agency_forecasts` (5 credits) → `src/mcp/tools/forecasts.ts` → `queryForecasts` in `src/lib/forecasts/query.ts`.
- **Source table:** `agency_forecasts` directly. **No `map_lat` requirement** — so MCP *does* reach the location-less rows Maps cannot pin. **No source_type filter, no status filter, no allowlist.**
- **Agency matching:** `source_agency ILIKE %term%` **only — `department` is never consulted** (the inverse of Maps).
- **Default past-FY exclusion:** `includePast` defaults false; FY < current is dropped, NULL FY survives. **`includePast` is NOT exposed as a tool parameter** — an agent cannot ask for it.
- **Limits:** `limit` max **200**, overfetch 500, **no `offset`/cursor** → no enumeration path.
- `total` is the exact post-filter count (correct, and it matched the DB on every probe).

**Live MCP proof (real hosted connector):**

| Call | Live `total` | Computed from DB | Match |
|---|---:|---:|---|
| unfiltered | **32,234** | 32,234 | ✅ |
| `agency=HHS` | **2,550** | 2,550 | ✅ |
| `agency=Treasury` | **40** | 40 | ✅ |
| `agency=Department of Defense` | **0** | 0 | ✅ (fails) |
| `agency=Army` | **0** | 0 | ✅ (fails) |

**Cross-surface inconsistency, proven at row level:** `HHS-FDD04A70-…A38454` (FY2025) appears in the Maps unplaced
list but is absent from `get_agency_forecasts(agency=HHS, naics=423450)` — which returns 85 rows, all FY2026.
The same record is visible on one surface and invisible on the other.

**Tool description is factually stale** (customer-facing): claims "~33,000 records across 21 agencies and 388 buying
offices" and "37% … 12,276 of 33,075" carry no place of performance. Actual: **35,751 rows · 20 agencies · 404 offices · 40% (14,253)**.
`src/lib/marketing-stats.ts` likewise records 33,290.

## D. SPECIAL CHECKS

### D1 — NAVY: methodology, not a product gap (but Army IS a gap)

Navy's corpus is **NOT** missing from either surface:
- Maps: 5,033 of 8,821 pinnable (57%) — live `agency=NAVY` → `totalForFilters 5053` (the +20 is ONR+NRL, correctly matched via `department = "Department of the Navy"`).
- MCP: 8,701 of 8,821 eligible (99%); `agency=NAVY` resolves.

So the coverage study's `NAVY/DOD Forecast ✗` was **a methodology/agency-mapping artifact of that study**, not an exposure gap — *for Navy*.

**But the same artifact hides a real one.** `source_agency` has no `DOD` value at all, so **"DoD"/"Defense" resolves to
zero on BOTH surfaces**, and **"Army" → 0 on both** even though **USACE holds 2,908 Army Corps rows (2,628 MCP-eligible)**.
The coverage study therefore ranked **Army as the #1 Tier-1 expansion target when we already hold Army forecasts** — they
are simply unreachable under that name. **Do not build an Army connector before fixing agency identity.**

### D2 — HHS: exactly which of the 5,340 current records are exposed

| | Rows |
|---|---:|
| Physical HHS rows | 5,504 |
| **Maps — pinnable** | **0** (0 rows have `map_lat`; 0 have `pop_state`) |
| Maps — reachable in the unplaced list | only under a search key, ≤150 per query |
| **MCP — eligible** | **2,550** (FY2026 1,190 · FY2027 1,332 · FY2028+ 21 · null 7) |
| MCP — excluded by past-FY rule | 2,954 (FY2025 2,514 · FY2024 440) |

Against the handoff's **5,340 current usable**: MCP exposes **2,550 = 47.8%**, Maps exposes **0 as pins**.
The 2,514 FY2025 rows are current upstream in SBCX but invisible to MCP. (Correctly NOT measured against 5,504.)

### D3 — Subagencies: agency identity IS costing forecast visibility

| Search style | Maps | MCP |
|---|---|---|
| Parent department ("Department of Defense") | **0** | **0** |
| Canonical agency ("USACE", "NAVY") | works if `department` matches | works (`source_agency`) |
| Common abbreviation ("DoD", "Army") | **0** | **0** |
| Subagency ("ONR", "NRL") | found under "Navy" (via `department`) | **NOT** found under "Navy" (`source_agency` only) |

The two surfaces use **opposite** columns — Maps matches `department` OR `source_agency`, MCP matches `source_agency` only —
so the same query returns different agencies depending on the surface. This is the single highest-leverage fix.

## E. FINAL RECONCILIATION TABLE

| Agency | Source type | Canonical rows | Maps eligible (pinnable) | Maps % | MCP eligible | MCP % | Maps status | MCP status | Failure reason | Representative external_ids |
|---|---|---:|---:|---:|---:|---:|---|---|---|---|
| DHS | api | 1644 | 870 | 53% | 1644 | 100% | PARTIAL | FULL | Maps: 774 no coord (579 geocodable → BLOCKED_BY_DATA+backfill) | *F2026073903<br>F2025071567 |
| DOE | excel | 431 | 409 | 95% | 431 | 100% | PARTIAL | FULL | Maps: 22 no coord (22 geocodable → BLOCKED_BY_DATA+backfill) | NNG15SD72B / 89303726FEM400344<br>47QTCA21D0031 / 89233123FNA400558 |
| DOE | osdbu_xlsx | 870 | 747 | 86% | 870 | 100% | PARTIAL | FULL | Maps: 123 no coord (123 geocodable → BLOCKED_BY_DATA+backfill) | DOE-C:NNG15SD73B-89303126FEM400483<br>DOE-C:47QRAA19D0029-89303022FEI400111 |
| DOI | api | 3131 | 3125 | 100% | 3130 | 100% | FULL | FULL | — | AGBOR300217<br>AGBOR700459 |
| DOI | gsa_gateway_csv | 3033 | 3030 | 100% | 3032 | 100% | FULL | FULL | — | GW-L:AGBOR300119<br>GW-L:FWS2025001209 |
| DOJ | excel | 619 | 348 | 56% | 619 | 100% | PARTIAL | FULL | Maps: 271 no coord (86 geocodable → BLOCKED_BY_DATA+backfill) | FY26-DEA-1524-0026<br>FY26-FBI-1549-1 |
| DOL | api | 144 | 142 | 99% | 144 | 100% | PARTIAL | FULL | Maps: 2 no coord (2 geocodable → BLOCKED_BY_DATA+backfill) | AG39955_1765222042<br>BLS_FY2025_80 |
| DOL | gsa_gateway_csv | 22 | 22 | 100% | 22 | 100% | FULL | FULL | — | GW-L:KS60<br>GW-L:KS53 |
| DOT | api | 660 | 560 | 85% | 660 | 100% | PARTIAL | FULL | Maps: 100 no coord (67 geocodable → BLOCKED_BY_DATA+backfill) | FAA_REG_FY26_051<br>FAA_MMAC_FY26_075 |
| DOT | gsa_gateway_csv | 237 | 194 | 82% | 237 | 100% | PARTIAL | FULL | Maps: 43 no published location → BLOCKED_BY_DATA | GW-L:FHWA-2026-204<br>GW-L:FAA-WJHTC-FY26-019 |
| EPA | apex_forecast_db | 50 | 27 | 54% | 50 | 100% | PARTIAL | FULL | Maps: 23 no published location → BLOCKED_BY_DATA | EPA-FY-2022-14305<br>EPA-FY-2022-14272 |
| GSA | api | 336 | 266 | 79% | 336 | 100% | PARTIAL | FULL | Maps: 70 no coord (5 geocodable → BLOCKED_BY_DATA+backfill) | AG47229_1780589420<br>G0OdTw3M2TACDfR |
| GSA | gsa_gateway_csv | 178 | 66 | 37% | 178 | 100% | PARTIAL | FULL | Maps: 112 no published location → BLOCKED_BY_DATA | GW-L:G0ODTW3M2TACDFR<br>GW-L:A032600033 |
| HHS | sbcx_api | 5504 | 0 | 0% | 2550 | 46% | NONE | PARTIAL | Maps: 5504 no published location → BLOCKED_BY_DATA; MCP: 2954 dropped by past-FY rule → BLOCKED_BY_QUERY | HHS-6695F4A6-F0D1-408B-A126-3388FEC52460<br>HHS-786ACB79-73D7-4FB9-A632-875CBFE06F82 |
| NASA | excel | 42 | 0 | 0% | 42 | 100% | NONE | FULL | Maps: 42 no published location → BLOCKED_BY_DATA | 1136<br>1183 |
| NASA | naf_xlsx | 147 | 0 | 0% | 147 | 100% | NONE | FULL | Maps: 147 no coord (103 geocodable → BLOCKED_BY_DATA+backfill) | 10175<br>9928 |
| NAVY | lrae_xlsx | 8821 | 5033 | 57% | 8701 | 99% | PARTIAL | PARTIAL | Maps: 3788 no published location → BLOCKED_BY_DATA; MCP: 120 dropped by past-FY rule → BLOCKED_BY_QUERY | NAVY-T:N40080-35YMGW<br>NAVY-T:N68335-1LJNB70 |
| NRC | api | 89 | 89 | 100% | 89 | 100% | FULL | FULL | — | NRC_26_0087<br>NRC_26_0088 |
| NRL | excel | 12 | 12 | 100% | 12 | 100% | FULL | FULL | — | NRL-NRL-13-541513<br>NRL-NRL-15-541715 |
| NSF | api | 37 | 37 | 100% | 36 | 97% | FULL | PARTIAL | MCP: 1 dropped by past-FY rule → BLOCKED_BY_QUERY | NSFOTDFY260030<br>NSFOASFY260003 |
| ONR | excel | 48 | 8 | 17% | 48 | 100% | PARTIAL | FULL | Maps: 40 no coord (3 geocodable → BLOCKED_BY_DATA+backfill) | ONR-ONR-38-541611<br>ONR-ONR-46-541511 |
| SSA | excel | 170 | 0 | 0% | 170 | 100% | NONE | FULL | Maps: 170 no coord (43 geocodable → BLOCKED_BY_DATA+backfill) | SSA-OCIO-27-407F0<br>SSA-OCIO-27-885B0 |
| Treasury | osdbu_salesforce | 200 | 197 | 99% | 40 | 20% | PARTIAL | PARTIAL | Maps: 3 no published location → BLOCKED_BY_DATA; MCP: 160 dropped by past-FY rule → BLOCKED_BY_QUERY | TREAS-A0RSJ000001PWWY2AI<br>TREAS-A0RSJ000001MRWK2AK |
| USACE | district_da_pdf | 124 | 0 | 0% | 123 | 99% | NONE | PARTIAL | Maps: 124 no published location → BLOCKED_BY_DATA; MCP: 1 dropped by past-FY rule → BLOCKED_BY_QUERY | USACE-ENDIST-SACRAMENTO-HILL-AFB-F-35-COMPOSITE-REPAIR-TRAINING-PHASE-1-DBB-NEW-CONSTRUCTION-OF-MEDIUM-BAY-FACILITY-FOR-F-35-C<br>USACE-ENDIST-SACRAMENTO-DDJC-TRACY-SANITARY-SEWER-REPAIR-DBB-REPAIR-DAMAGED-SECTIONS-OF-EXISTING-SANITARY-SEWER-SYSTEM-236220 |
| USACE | district_workbook | 660 | 425 | 64% | 586 | 89% | PARTIAL | PARTIAL | Maps: 235 no published location → BLOCKED_BY_DATA; MCP: 74 dropped by past-FY rule → BLOCKED_BY_QUERY | USACE-US-ARMY-ENGINEER-DISTRICT-WALLA-WAL-MNA-NAVLOCK-D-S-GATE-REPLACEMENT<br>USACE-US-ARMY-ENGINEER-DISTRICT-WALLA-WAL-DWA-SHIPPING-CONTAINERS |
| USACE | enterprise_da_format | 2124 | 0 | 0% | 1919 | 90% | NONE | PARTIAL | Maps: 2124 no published location → BLOCKED_BY_DATA; MCP: 205 dropped by past-FY rule → BLOCKED_BY_QUERY | USACE-DA-USA-ENG-SPT-CTR-HUNTSVIL-1IB5KPO<br>USACE-DA-ENDIST-NASHVILLE-1FLJ4PS |
| USDA | api | 2509 | 881 | 35% | 2509 | 100% | PARTIAL | FULL | Maps: 1628 no coord (3 geocodable → BLOCKED_BY_DATA+backfill) | FY26_WBSCM_000454<br>FY26_006763 |
| USDA | gsa_gateway_csv | 2519 | 889 | 35% | 2519 | 100% | PARTIAL | FULL | Maps: 1630 no published location → BLOCKED_BY_DATA | GW-L:FY26-WBSCM-000835<br>GW-L:FY26-003492 |
| VA | api | 692 | 683 | 99% | 692 | 100% | PARTIAL | FULL | Maps: 9 no coord (1 geocodable → BLOCKED_BY_DATA+backfill) | 36C10B26AP0312<br>36C10BOIT0190 |
| VA | gsa_gateway_csv | 698 | 688 | 99% | 698 | 100% | PARTIAL | FULL | Maps: 10 no published location → BLOCKED_BY_DATA | GW-L:36C10B26AP1497<br>GW-L:36C10B26AP1902 |

**TOTALS** — canonical 35751 · Maps pinnable 18748 (52.4%) · MCP eligible 32234 (90.2%) · dropped by past-FY 3517 · unmapped-but-geocodable 1039

### Totals

- Total canonical current forecasts: **35,751**
- Exposed in Maps (pinnable): **18,748 — 52.4%**
- Queryable through MCP: **32,234 — 90.2%**
- Agencies at 100% on **both** surfaces: **2** — NRC (89), NRL (12)
- Agencies partial on either: **17**
- Agencies completely missing from a surface: **4 on Maps** (HHS, SSA, NASA, and USACE's 2 of 3 pairs); **0 on MCP**

### "data exists" ≠ "surface can retrieve it" ≠ "user can discover it"

| Layer | Rows | Note |
|---|---:|---|
| Data exists | 35,751 | 100% controlled per the closeout |
| Surface CAN retrieve — MCP | 32,234 | but ≤200 per call, no pagination |
| Surface CAN retrieve — Maps | 18,748 pins + 17,003 list-only | list-only needs a search key, ≤150 |
| **User can actually DISCOVER by agency** | **7,672 (21.5%)** | the Agency dropdown is the primary affordance, and it misses 78.5% |

That last row is the real headline: the control plane is at 100%, and discovery by agency is at 21.5%.

## Recommended order (for the post-review fix pass — NOT done here)

1. **P0-1/P0-3** — one shared agency resolver mapping department ↔ canonical ↔ abbreviation ↔ subagency, used by BOTH surfaces (and by the alerts that share `applyForecastFilters`). Fixes DoD/Army/HHS/DHS/DOE/DOJ/NASA/EPA in one change.
2. **P0-2** — require a word-boundary (or exact/alias match) for short single-word needles so `%EPA%` stops matching "department".
3. **P0-4** — align the past-FY rule across Maps and MCP, or expose `include_past` as an MCP parameter.
4. **P0-6** — run the geocode backfill for the 1,039 rows that carry a real state/city.
5. **P0-5** — add `offset`/cursor to `get_agency_forecasts`.
6. Refresh the stale counts in the MCP tool description and `marketing-stats.ts`.
7. **Re-run this audit** before starting coverage expansion. Re-check the Army/DoD conclusion in the audience study first — its Tier-1 ranking is built on the agency-identity artifact.

---

*Read-only. No data changed, no fixes applied, no PRs opened. Evidence scripts: session scratchpad (`pr.mjs`, `a-data.mjs`, `c-mcp.mjs`, `presets.mjs`, `recoverable.mjs`, `trace-maps.mjs`, `final.mjs`).*

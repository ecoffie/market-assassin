# Task orders by parent contract / vehicle (OASIS+) — record, evidence, demo

Branch `feat/task-order-parent-vehicle-filter` · 2026-09-24 · no merge, deploy, ingest or production writes.

## The defect (before)

`search_idv_contracts` (MCP) had no parent or vehicle parameter on `origin/main`. `git show origin/main:src/mcp/tools/idv-contracts.ts` has no `vehicle`/`parent_id` field, and the zod schema in `src/mcp/server.ts` has none either. A host that passed `vehicle: "OASIS+"` had it dropped by the schema, and the tool **silently returned task orders from every vehicle**. `evidence.json → evidence.before_unscoped` is the only query shape that existed: NAICS 541611 task orders. Of 10, 0 were under OASIS+; they sat under USAID vehicles and standalone contracts. The Map had no parent/vehicle parameter either.

## What was measured first (read-only)

| Fact | Value | Source |
|---|---|---|
| BigQuery `usaspending.awards` parent identity | `parent_piid` only; no parent agency column (the #1658 IDV columns are not applied) | `INFORMATION_SCHEMA.COLUMNS` |
| Where the parent lives on the Map's table | `recompete_opportunities.contract_id` = `CONT_AWD_<piid>_<ag>_<parent piid>_<parent ag>`, which `award-lineage.ts` already parses | table + `parseAwardLineage` |
| `recompete_opportunities.naics_description` | **0 of 142,000** filled (`naics_code` is filled) | live count |
| Index usable on `contract_id` for a regex | none (btree unique only) | `pg_indexes` |
| OASIS+ solicitations | `47QRCA23R0001`–`0006`: SB · 8(a) · HUBZone · SDVOSB · WOSB · Unrestricted | GSA via [SAM.gov](https://sam.gov/opp/0e50b6b1d5bd4d0198ab32e73de975b8/view); corroborated per IDV |
| Original OASIS | solicitation `GS00Q-13-DR-0002`; holders include `47QRAD…` PIIDs | USASpending IDV records |

## Design

- **A vehicle is identified by its solicitation, never by a PIID prefix.** `src/lib/vehicles/definitions.ts` holds the GSA-published solicitation set. `scripts/verify-vehicle-parents.ts` read the USASpending award record of every distinct parent IDV on orders in the Map's table under GSA parent agencies (4732/4730/4740): **5,778 candidates**. A parent is an OASIS+ member only if its own `solicitation_identifier` is one of the six. Result: **237 members** (SB 101 · 8(a) 45 · HUBZone 8 · SDVOSB 34 · WOSB 14 · Unrestricted 35). 2 candidates (GSA Schedule BPAs `GS00F…`) could not be read. They are counted as unresolved and disclosed, never assumed in or out. The full per-parent evidence is `parent-idv-solicitations.json`; the runtime reads the compiled `src/data/vehicles/vehicle-parents.json`.
- **"OASIS", "GSA OASIS", "OASIS SB", "OASIS Unrestricted" → `ambiguous`.** Unknown names → `unknown`. Malformed ids → `invalid_parent_id`. All of these → `status: unresolved`; nothing is searched, the total is `null`, and there's no map link.
- **One query, three readers.** The parent scope and the work subject are Maps *surface ops* (`maps-recompete-discovery.ts`). The MCP tool (`src/lib/vehicles/task-order-search.ts`), the Map's PostgREST path and its SQL twin all apply them **inside** the read, before counting, ordering and paging. Parent scope = a member-derived `LIKE` superset prefilter, then an exact regex on the parent slot. The regex alone timed out at 8 s over 178K rows.
- **Work evidence comes from work fields only:** description · PSC title · the **official NAICS title** of `naics_code` (`src/data/naics-codes.json`, USASpending NAICS API). Every term must appear. Incumbent and agency names are deliberately not evidence ("FEMA" + "XYZ Consulting" is not management consulting). Each order reports which field carried each term.
- **Map link:** `mode=recompete&horizon=recompete&vehicle|parent=…&work=…&leadMax=…`. The Awarded horizon is isolated so Open/Forecast totals can't be summed in. The params round-trip through the URL writer, survive reload, and are cleared by **Clear**. Saved searches reject the new keys (`validate-filters` allowlist), and alert scope already refuses Awarded mode. So a scoped search can never become an all-vehicles alert.

## Acceptance — live, read-only (`npx tsx scripts/verify-task-order-scope.ts` → 21/21 at the first head; 25/25 after the correction batch)

| # | Criterion | Result |
|---|---|---|
| 1 | Management consulting under OASIS+ → only verified members with work evidence | **23** active orders out of 285 OASIS+ orders; all 23 under a `47QRCA23R000x` parent; every term evidenced; independent JS recount **23** |
| 2 | Exact parent id → only that parent | `CONT_IDV_47QRCA25DU100_4732` → 10, all that parent (bare PIID resolves to the same 10) |
| 3 | Negative controls | 134 original-OASIS parents in the table: 0 classified OASIS+, 0 in the result. Mech-Elec II (`CONT_IDV_FA850124D0005_9700`): 5 own orders, 0 in the result |
| 4 | Unknown / ambiguous → explicit unresolved | OASIS · OASIS SB · Alliant 3 · CIO-SP4 · malformed id → `unresolved`, total `null`, no link |
| 5 | Missing parent data ≠ zero | fabricated parent → `no_parent_orders`; OASIS+ + "submarine hull welding" → `zero_matching_orders` (285 in scope); 11 matching orders have **no recorded parent** and are reported as `unattributed_orders`, neither included nor denied |
| 6 | Counts, cards, pagination, Map agree | pages of 7 → 23 unique, stable order. Map API via the shared link: 15 mapped + 8 unmapped = 23. Map pins = the tool's 15 on-map orders. Exact parent: 9 + 1 = 10 |
| 7 | Unscoped search unchanged | legacy USASpending path, same arguments and shape (unit-pinned + live) |

Browser (built app, headless Chrome; `browser-evidence.json`, `screens/`):
- **Open:** "14 of 15 opportunities · 8 not shown on map", 15 results, and the scope banner.
- **Refresh and a fresh browser:** identical URL, banner and final fetch.
- **Clear:** the URL goes back to `?mode=recompete` and the next fetch is unscoped.
- **Ambiguous "OASIS":** "Not searched: …", "Nothing searched yet" and no pins.

## Correction batch (#1692 review)

| Finding | Fix | Execution regression (PGlite, real rows) | Proven red on the old code |
|---|---|---|---|
| **Dropped filters.** psc, dates, `search_type:"idv"`, `state_scope`, `min_value` were accepted and ignored in scoped mode | naics · agency · `min_value` (`potential_total_value`) · `state` with `state_scope:"pop"` are applied in the query, echoed in `applied_filters`, and on the Map link (`minValue`). psc · dates · `search_type:"idv"` · recipient/both state are refused: `needs_refinement`, `refused_filters`, nothing searched | each applied filter removes exactly the one fixture row that fails it, and the Map (readOld + SQL twin, from the tool's link) returns the same ids; each refused input returns no rows and a null total; every input key is classified | refusal disabled + min_value unforwarded → 9 failing |
| **Bare PIID > 1,000 rows.** The agency set came from a 1,000-row sample | one existence query per round, excluding the known agencies inside the query | 1,001 orders at 9700 inserted first, 1 at 4732: the old sample sees only 9700; the fix finds both → `unresolved` offering both exact ids; each exact id returns 1,001 / 1 | old sampler → 2 failing |
| **Generated ids with missing parents.** `…_-NONE-_-NONE-` / `…_<piid>_-NONE-` orders were in neither number | `UNATTRIBUTED_ORDERS_OR` covers raw-PIID and missing-parent-slot orders (by contract_type), with a JS twin | SQL result == JS twin row by row; count 3 (was 1); never admitted into scope | old definition → 2 failing |

Live after the batch (`npm run verify:task-order-scope`, **25/25**):
- The original 21 checks are unchanged.
- `state=DC` + `min_value=1,000,000` gives 6. That equals the JS subset of the 23, and the Map shows 4 mapped + 2 unmapped.
- The five unsupported inputs are refused.
- Unattributed orders: tool 11, independent recount 11 (0 generated-ID orders with a missing parent in the window today).
- Measured: no parent PIID in the table currently appears under two agencies, so finding 2 has no live instance; the fixture carries it.

Browser (built app, `browser-evidence.json`): the filtered link, the base link and the ambiguous name each open, refresh and open in a fresh browser to the identical final Awarded fetch. Filtered: "4 opportunities · 2 not shown on map".

### Delta review of the correction batch (independent reviewer, `dfa19cd0..11558dcc`)

No blockers were found. Two should-fix items and the cheap nits are fixed at the final head; the rest are recorded below.

| Item | Status |
|---|---|
| **Should-fix 1.** The Map's `minValue` guard lost its `\.` escape in the template literal. `?minValue=1-2` injected a max | **Fixed.** The guard now admits digits only (the tool sends whole dollars). The test executes the cooked regex the browser receives, and it goes red on the old guard |
| **Should-fix 2.** `minValue` wasn't managed by the URL writer, so a cleared or edited floor came back on reload | **Fixed.** The writer manages `minValue` beside a scope, like `leadMax`. The Value pill syncs an intent link, and the banner's Clear drops the floor. Browser: Clear then reload keeps the floor cleared |
| Negative, NaN, fractional or ≥ 1e15 `min_value` was silently dropped or disagreed with the Map | **Fixed.** Refused; 0 remains the legacy "no floor" |
| The PIID ambiguity message miscounted past 21 agencies | **Fixed.** It now says "at least N" (the result was already refused as ambiguous) |
| The `…_-NONE-_<agency>` shape wasn't covered | **Fixed.** Fixture added; the unattributed count is 4 |
| The input-coverage test used a hand-written list | **Fixed.** Keys are now derived from the published tool schema, so a new input fails until it's classified |
| `state:"Virginia"` echoed as `VIRGINIA` | **Fixed.** Normalized once to `VA` in the query, the echo and the Map link |
| `contract_type` abbreviations `DO`/`PO` aren't order types | **Not changed.** This mirrors award-lineage's shared order-type list; there are 0 raw-PIID `DO` rows live. Recorded as a bound |
| The harness routes `.or()` through the SQL twin's translator | **Accepted.** PostgREST parsing of the same strings is covered by the live oracle (25/25) |
| `state`/`naics` are unmanaged URL params (pre-existing) | **Unchanged.** After Clear, the URL and FILT both keep `state=DC`, so they agree |

### Second delta review (`11558dcc..8fcc3712`): no blockers

| Item | Status |
|---|---|
| **Should-fix.** An off-band floor (e.g. $2.5M) was wiped by any Filters apply, in both the fetch and the URL | **Fixed.** A `data-offband` mark on the select keeps the applied value; a user choice or Reset clears it. The browser run (`offband-browser-evidence.json`) also found that a scoped link's `leadMax=60` shrank to the 18-month default the same way, now fixed with the same mark |
| A pill floor of `1500.5` wrote a URL value the reader rejects | **Fixed.** The writer emits `Math.floor` whole dollars |
| The guard test only undid doubled backslashes | **Fixed.** It evaluates the served line as a template literal. An injected single-escape regression (`1-234`) now goes red |
| `state:"VA,MD"` was refused as "not a US state" | **Fixed.** Normalized per code and ORed (the plan supports lists); an unknown member is refused |
| Pill apply on a record link strips `horizon` | **Pre-existing, not changed.** Filters apply and Reset already did this, and the record itself still opens |
| Unscoped hand-built `?minValue=` isn't rewritten by the pill | **Not changed.** Only reachable by hand; tool links always carry a scope |
| `state`/`naics` survive the banner's Clear (URL and FILT agree) | **Pre-existing unmanaged market params, not changed** |

### Third delta review (`8fcc3712..627ee6a6`): no blockers

| Item | Status |
|---|---|
| **Should-fix.** The hidden `data-offband` mark kept the value applied, but the select still *showed* "No min" / "Any timeframe", and picking that option fired no change, so the value couldn't be cleared from its own select | **Fixed.** The hidden mark is replaced by a real visible "(custom)" option (`window.__selectShow`), so choosing the blank option genuinely clears it. Executed on a fake select in the unit test, and in the browser (`final-browser-evidence.json`) |
| URL writer: a pill floor over 15 digits was still written | **Fixed.** The writer emits only 1…999,999,999,999,999 |
| Found during the browser run: the scope banner covered the Filters panel footer | **Fixed.** z-index 1000, under `#ztop` (1001); hit-testing the Reset button returns the button |
| `FILT` and the fetch keep a `1500.5` pill floor until reload (under $1 difference) | **Accepted** |
| Pre-existing on `main`: the literal `\u2013` between Min and Max in the Filters panel (`route.ts:251`) | **Not changed.** Outside this PR |

### Reconcile with Maps P0/P1 (#1684, #1693) — 2026-09-25

`main` moved under the approved head `17676c87` (#1684: newest action wins, progressive horizons, horizon cache, counts=0 pans; #1693: transition feedback). Merged `main` into the branch (merge commit `f4ad3ace`) and **re-applied the scope inside the P0 engine**. The feature logic is unchanged; its earlier review still applies.

| Integration risk | How it's handled | Proof |
|---|---|---|
| A scoped search must load Awarded only | `_enabled=['recompete']` is set before the P0 round, so Open/Forecast requests already in flight are aborted and never paint | P0-harness test: in-flight Open/Forecast never paint. Browser: only `recompete-map` is ever requested, with 0 unscoped requests after the scope applies |
| Cached counts must belong to the exact scope and filters | The truth cache key is the URL minus the bbox. Every scope and filter param is in the URL; the pins cache key is the full URL | P0 harness: changing work, parent or a filter is a new counted request with its own total; returning to scope A gives A's counts. Browser: the filter change sent a counted request |
| counts=0 means "not supplied", never zero | The server omits the counts (`countsSkipped`), and the client uses the cached truth for the same intent | PGlite + live check 9: a counts=0 read returns the same pins with the counts omitted, not 0. Browser: a pan sent one counts=0 request and the headline was unchanged |
| The banner must stay correct through pans and progressive loading | It updates only from the current round's Awarded answer; a new scope hides it until its answer arrives; a superseded answer never sets it; `vehicle_scope` is carried on cached pins | P0 harness: the naive resolutions A/B/C fail 3/1/3 tests. Browser: banner visible in 80/80 samples during a pan |
| MCP and both Map paths must agree after counts load | unchanged | Live 26/26 (23 = 15 + 8; DC + $1M = 4 + 2). Browser filter change to $5M: Map "2 opportunities" = MCP 2 + 0 |
| Shared links, refresh, filter changes, Clear | unchanged | Browser (`integration-browser-evidence.json`): open, refresh and a fresh browser are identical; Clear returns to `?mode=recompete`; ambiguous "OASIS" searches nothing |

**Integration review: one blocker, fixed.** The reviewer confirmed risks 1–6 of the integration. The blocker predates the merge and was missed earlier:
- A scoped link followed by the **DLA** tab painted the unscoped Awarded market as the DLA map.
- Fix: the scope override now applies only on the Opportunities map.
- Proof: the P0-harness test fails on the pre-fix route and passes after. In the browser (`dla-browser-evidence.json`), DLA sends only `sources=dla` requests and hides the banner; returning sends the scoped request and shows the banner again.
- Carried over from `main`, not #1692: `recompete-map-paths.ts` turns a null counted total into `0` (`r.total ?? 0`). Reported separately, not changed here.

**DLA-fix verification: no blockers, two should-fix items of the same class, both fixed.**
- The scope banner stayed over the Players map. It now renders only on the Opportunities map and is re-evaluated every round.
- A URL sync in DLA/Players stripped the scope from the link, while the map re-applied it on return. The scope keys now come from `FILT` in every mode.
- Proof: `vehicle-scope-modes.unit.test.ts` (5 tests fail on the pre-fix route) and `modes-browser-evidence.json`.

Live data moved since the first head: OASIS+ has 284 orders in the window, and 10 are unattributed. Agreement holds on every path.

## Reproducible demo (VCI / IMRI style)

A management-consulting firm asks what management consulting is currently being ordered through OASIS+.

1. MCP: `search_idv_contracts { "search_type": "task", "vehicle": "OASIS+", "work": "management consulting" }`
2. Read `status`, `_meta.total`, and `coverage` (the vehicle's orders in scope, plus unattributed orders). For each order, read `parent.parent_id`, `parent.vehicle.solicitation_identifier`, `parent.vehicle.pool` and `work_evidence`.
3. Open `map.url` (= `https://getmindy.ai/opportunity-map?mode=recompete&horizon=recompete&vehicle=OASIS%2B&work=management+consulting&leadMax=60`). The headline, the not-on-map disclosure and the pins match the tool.
4. Show the refusal: `vehicle: "OASIS"` returns `unresolved` with the reason. It doesn't guess which OASIS you meant.

**What the demo does not claim:** that any firm, VCI and IMRI included, holds OASIS+ or any pool, or is eligible for an order. The result lists orders placed under OASIS+ contracts and the holders of those orders. Vehicle membership of a company was not looked up and is not implied.

## Known bounds (not fixed here)

- **Population:** active orders in `recompete_opportunities` (not expired, ending within the window, max 60 months). Completed/historical orders are not included. The BigQuery warehouse has them, but its `parent_piid` carries no parent agency until the #1658 columns are applied.
- **Registry freshness:** the registry is as of its `verified_at`. Parents first seen after that are not members until re-verification (`npx tsx scripts/verify-vehicle-parents.ts`, resumable).
- **Pre-existing Map mobile defect, reproduced without this change:** a small result set clustered outside the default mobile viewport shows "N results" above "No opportunities match" (`?mode=recompete&horizon=recompete&naics=541611&state=VA&agency=COMMERCE` → "14 results" + empty state).
- **Boot order:** like every existing scope link, the Map paints its default view first and then applies the scope. The final fetch and counts are scoped.

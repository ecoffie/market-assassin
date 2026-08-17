# Demo runway — Today's Intel → Map (demo **2026-08-22**)

**Eric's sequence (2026-08-15):** *"make page, approve it then perfect map then flip once
both are complete."* The apex flip is LAST, after BOTH surfaces are signed off. Do not
touch `next.config.ts` before then.

**The demo flow:** land on Today's Intel → read what changed → click into the map as the app.

---

## Step 1 — THE PAGE ✅ SHIPPED AND LIVE (2026-08-15, evening)

All merged to `main` and verified on prod. PRs #1132 · #1134 · #1135 · #1136 · #1138 · #1139.

| What | Where |
|---|---|
| Editorial front page (dateline · headline · Morning Brief · Observation · map · cards · stats) | `src/app/today/route.ts` |
| **Stateful bottom half** — anonymous→Discovery, authenticated→Momentum, expired→Recovery | `docs/today-page-states.md` |
| `/api/today/your-market` (token-verified, server-resolved identity) | `src/app/api/today/your-market/route.ts` |
| Explore-by-Market tiles w/ live counts | `src/lib/today/markets.ts` |
| Your Market (since-last-visit · recently viewed · your work · recommended) | `src/lib/today/your-market.ts` |

**Four UX fixes on top of that:**
1. **Money formatting** — cards rendered `195479` where `$195K` belonged. Now via the SHARED
   `estMoneyServer` (never a second local formatter).
2. **The midnight collapse** — the hero read "16 opportunities posted in the last 24 hours"
   at 00:13 UTC because `posted_date` is midnight-stamped. Now anchors to the latest day with
   REAL VOLUME (`latestPostedDay` + `MIN_MEANINGFUL_DAY`). 16 → 1,338.
3. **Map overlays covered the map** — the count pill sat on Leaflet's legend, the CTA on its
   zoom controls. Invisible to the DOM (cross-origin iframe); caught by screenshot.
4. **The embed never shipped the pin runtime** — `PIN_JS` was concatenated only on the
   non-embed branch, so `typeof` guards silently fell back: 600 opportunities rendered as ~35
   visible dots. Clustering now ON in the embed only. Live: 9 bubbles + 19 dots.

**⚠️ DELIBERATELY NOT BUILT — do not "discover" these as bugs:**
- **Saved Searches / Saved Opportunities sections** — CUT. Measured **14 rows / 7 users** and
  **29 rows** across the ENTIRE user base; they'd be permanent empty prompts for ~99% of
  visitors. They return when they have usage.
- **The M-Estimate basis line** still reads `309 comparable 339115 · PSC 6540 contracts` (a bare
  NAICS mid-sentence). That label is composed upstream and SHARED with the map — fixing it on
  one surface is drift. Its own change.

## Step 2 — THE MAP (deep links are the remaining work)

⚠️ **Re-confirmed 2026-08-15 the hard way.** During the UX pass I added `?posted=7` to the
embed iframe to make the map show the window the caption claimed — then found it filtered
NOTHING and removed it. That is this exact defect, hit from a different direction: the map
route reads ONLY `embed` server-side (`route.ts` ~8196). A URL that reads like it works while
doing nothing is worse than the mismatch it pretends to fix.

### 2a. ⚠️ CORRECTED 2026-08-15 — MOST deep links already work. Re-measure before believing this file.

The claim below (written earlier the same day) said the map reads "NONE" of the params and that
`opp`/`agency`/`naics` were all dead. **That was wrong for `?opp=`, the only one `/today` still
emits.** How the error happened, because it will happen again: the check grepped
`searchParams.get(...)` — the SERVER parser, which really does read only `embed`. The map's
deep-link handlers are **client-side**, parsing `location.search` inside the emitted JS. Grepping
the server side and concluding "the map ignores everything" is a false negative.

**Six params ARE wired** (boot handlers in `route.ts`, each with its own `Deep-link:` comment):
`opp` · `company` · `buyer` · `recompete` · `strategy` · `ss`.

**`?opp=<notice_id>` — VERIFIED WORKING ON PROD** (headless, 2026-08-15). `#oppDrawer`:

| | `?opp=ea4e7b…` | no param |
|---|---|---|
| visibility | **visible** | hidden |
| position | on-screen, `left: 64` | parked off-screen, `left: -951` |
| content | the requested notice | — |

So the Featured-card → map handoff — the demo moment — already works end to end. It was built for
the Share link and the Favorites page and `/today` inherited it for free.

⚠️ **Two traps when testing this**, both hit during verification:
1. `#mDrawer` is the MOBILE NAV drawer, not the listing drawer. It is `display:none` on desktop
   **by design**. Reading it as the listing drawer looks exactly like a failed deep link. The
   listing drawer is **`#oppDrawer`**.
2. `#oppDrawer` is `display:flex` **even when closed** — it's hidden via `visibility` + an
   off-screen `left`. Asserting on `display` alone passes in both states and proves nothing.
   Assert `visibility` / on-screen position, or that it shows the RIGHT notice.

**Still genuinely dead — but nothing points at them any more.** `?agency=` and `?naics=` are
ignored (measured: baseline, `?agency=DEPT%20OF%20DEFENSE` and `?naics=311999` all return an
identical **145,775 results**). The four-section cut (PR #1122) removed Top Buyers and Trending
Markets, which were the only emitters. Wire these **only if** a future section links by agency or
NAICS — building them now would be code with no caller.

### 2b. The fix is WIRING, not new machinery — reuse `applyIntent`

`window.__applySearchFilters(intent)` (route.ts ~line 1665, inside VIEWPORT_JS) ALREADY:
- sets `FILT.agency` / `FILT.state` / `FILT.setAsideMulti`
- syncs the visible chip + label + `mfBadge` "Filters N" count
- pans to the state centroid when a state is set (otherwise a state filter renders "none in view")
- calls `fetchView()`

A deep link is just an intent sourced from the URL instead of from the AI. Read the params
once at boot → build the intent → call the SAME function. No second filtering path (the
shared `applyMapFilters` + `verify:oracles` filters check stay authoritative).

**⚠️ GAP:** `applyIntent` handles `agency` / `state` / `setAside` / `horizon` / `dataset` /
`keyword` — but **NOT `naics` / `psc`**. It only READS `FILT.naics` for the badge count.
The Trending Markets row links by NAICS, so that branch must be added, and it must set the
NAICS **chips** (`window.__naicsChips.set()`), not just `FILT.naics` — the chip input is the
control that the Filters panel reads back (see the NAICS chip contract, PR #1102).

`?opp=` needs a different path — it should OPEN THE LISTING DRAWER for that notice, not
filter. Check how the drawer is opened programmatically before wiring it.

**Vocabulary is already established** — `openMarketView` (route.ts ~1543) emits
`q`/`naics`/`psc`/`agency`/`setAside`/`state`. Deep links should use the SAME names.

### 2c. Verify like the oracles do — a filtered map that renders 0 pins is a FAIL

Do not accept "the param is in the URL." Prove: link → map → pins genuinely narrowed AND
every rendered pin satisfies the predicate. `npm run verify:oracles -- --only filters`
covers the shared lib; the deep link needs its own browser proof.

## Step 3 — THE FLIP (last, after Eric approves BOTH)

ONE line: `next.config.ts` ~line 117, the apex host rewrite
`destination: '/mindy-landing'` → `'/today'`. The file's own comment says: *"Changing this
one line IS the flip; do not touch it without Eric's explicit go."*

⚠️ This is the cutover the **map-migration gate** blocks ("no migration — everything on the
map must pass first"). Eric is sequencing the gate deliberately: page ✅ → map ✅ → flip.
`/signin` → `/app` is a separate rewrite and is unaffected.

---

## Open items carried out of the 2026-08-15 session

Ordered by what I'd pick up first.

### 1. Map deep links (Step 2 above) — the highest-value remaining demo work
Every `/today` card lands on the same unfiltered national map. Fix is WIRING, not new
machinery (reuse `applyIntent`). Note the `naics`/`psc` gap and the `?opp=` drawer path.

### 2. `_uemail()` census — NOT TAKEN
The new `/today` code correctly gates on the TOKEN, and `_uemail()` is known-wrong at
`opportunity-map/route.ts:5399` (it decodes the wrong JWT segment and returns `''` for
genuinely signed-in users). **But I never counted the other call sites.** "Multiple auth
philosophies are alive in the product" is Eric's inference and mine — it is NOT a measurement.
Count before acting. (memory: `gate-on-token-not-decoded-email`)

### 3. BigQuery — what burned the 2 TiB is still UNKNOWN
The project carries a manual `QueryUsagePerDay` override of 2 TiB/day vs the 200 TiB default.
**Keep it small** (Eric). Measured heaviest realistic day is ~303 GB = 6.8× headroom; the whole
BQ bill is ~$7/month. ⚠️ When the quota blows, every query fails at **0 bytes billed** — which
blinds the guards AND destroys the evidence, so the culprit hides behind a wall of victims.
Catch it live if it recurs. Dry runs are free and work while blown.
- FIXED: the freshness oracle now distinguishes "could not check" from "the data is stale"
  (falls back to the `data_sources` ingest stamp). 13/13 oracles green.
- NOT VERIFIED: that BigQuery actually *rejects* an over-ceiling query at execution —
  `maximumBytesBilled` isn't enforced in a dry run, and a real query fails on the exhausted
  quota first, which would produce a false pass.
- (memory: `bigquery-quota-blind-spot`)

### 4. Eric's standing asks (not started)
- **UI State Contract everywhere** — the three-state model currently exists on `/today` only.
  Eric wants every page to declare what it shows when anonymous / authenticated / expired.
- **A freshness footer** — "Updated 8 minutes ago". `intel.generatedAt` already carries it, so
  this is cheap. The more editorial the page gets, the more freshness matters.
- **A dogfooding week** — Eric: *"stop for a week, watch users, fix polish. Ask what confused
  one user yesterday."* His read is that the architecture is largely done and the next wins are
  copy/spacing/ordering/defaults.

### 5. Step 3 — THE FLIP
Still last, still one line, still needs Eric's explicit go. Page ✅ → map (deep links) → flip.

---

*Created 2026-08-15. Updated 2026-08-15 evening — Step 1 complete and live.*
*Prod at update: `/today` 200 with all three user states verified in a real browser;
`/api/today/your-market` 200; embed map 9 cluster bubbles + 19 dots, 0 page errors;
apex still → `/mindy-landing` (flip NOT done).*

---

## 2026-08-17 — map defect sweep (Eric's 8-item list)

⚠️ **Demo day is 2026-08-22** (corrected from 08-23 — Eric, 2026-08-17). Five days out.

Eric's list read as UI-organisation work. Investigating found that **three of the items
were not organisation problems — they were broken JavaScript on prod**, confirmed in a real
browser before any edit. Two branches shipped:

| PR | What |
|---|---|
| #1168 `fix/map-filter-dead-js` | Industry filter dead in BOTH directions (`commitLive is not defined`); Today's Lens ✕ silently inert; logged-out header decoded the wrong JWT segment + gated on email; bare glyph → labelled "Log In" button |
| #1169 `perf/map-count-query` | The map's ~3s-per-pan lag: the headline count walked 155,629 rows in ~156 SEQUENTIAL round-trips, uncached, on every request |

**The transferable lesson:** 625/625 unit tests were green the entire time all three controls
were dead. They are source-string assertions; these were runtime scope failures. Only a real
browser found them — same finding as `brittle-test-anchors-false-verdicts`.

### STILL OPEN from Eric's list (not started)

1. **Agency / Buying Office / State auto-populate.** Agency populates lazily from a 16-item
   hardcoded array and opens BLANK with no empty-state if it's empty. **Buying Office and
   State have NO option list at all** — bare text inputs (6-char and 2-char). That's a build,
   not a fix. `STATE_CENTROIDS` (50 states) is ALREADY shipped client-side and unused for
   this — the State one is nearly free.
2. **Move Horizons / Value / Agency / Industry under Filters.** All four are already
   DUPLICATED — top bar *and* Filters panel, both writing the same `FILT`. So this is a
   de-duplication decision (which copy survives?), not a move. Needs Eric's call.
3. **Icon standardisation.** Measured: **8 stroke-widths, 17 sizes, 6 mechanisms**, 8 ways
   to draw a checkmark, and **14 Unicode glyphs used as icons** (violates the standing
   no-emoji rule). `route.ts` uses the shared `<defs>` sprite ZERO times; the heart path is
   hand-copied 6×. Largest job, least urgent for the demo.

### Also found, not on the list
- `/today` **bypasses the Players paywall gate** — links straight to `?mode=buyers` instead
  of calling `__playersGate`. **ATTEMPTED 2026-08-17 and REVERTED** — routing the deep link
  through the gate breaks the map's BOOT (every global undefined on `?mode=buyers`), because
  the gate opens the sign-in modal during page init. Measured: the DATA is safe (0 pins, 0
  rows, honest empty state) — this is a CONVERSION dead end, not a leak, so it is deliberately
  deferred past the demo. Full write-up + the two dead ends already ruled out:
  **`tasks/players-gate-deeplink-2026-08-17.md`**. (memory: `players-first-premium-moment`)
- The `_uemail()` census is STILL not taken (carried from the 08-15 session, item 2 below).


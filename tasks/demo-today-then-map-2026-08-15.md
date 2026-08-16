# Demo runway — Today's Intel → Map (demo 2026-08-23)

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

### 2a. Deep links from /today are DEAD ENDS — the map ignores them (MEASURED)

Every tile on `/today` links into the map with a filter param. The map reads **NONE** of
them. Measured on `main` @ 264fe9d8 — the ONLY params `opportunity-map/route.ts` reads are
`embed` and `utm_source`:

| Link `/today` emits | Source | Map behavior today |
|---|---|---|
| `?agency=<dept>` | Top Buyers (4 cards) | ignored → unfiltered map |
| `?naics=<code>` | Trending Markets (4 cards) | ignored → unfiltered map |
| `?opp=<notice_id>` | Featured Opportunities (3) | ignored → no listing opens |
| `?posted=1` / `?posted=7` | Today's market stats | ignored |
| `?mode=recompete` / `?events=1` | Today's market stats | ignored |
| `?mode=buyers` | Start anywhere | `mode` has 1 ref — VERIFY separately |

So on demo day every card lands on the same unfiltered national map. This is the single
highest-value map fix for the demo: it's what makes the page→map handoff feel like one
product instead of two.

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

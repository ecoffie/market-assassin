# POTETO — Mindy Maps latency + transition-experience audit (2026-09-24)

READ-ONLY. No code, DB, deploy or PR changes were made.

**Production build measured:** `c29974c5` (the `maps-account-build` stamp). This equals
`origin/main`, and it is the code read for this audit.

## Evidence and its limits

| Source | What it measured | Validity |
|---|---|---|
| **Browser 2** (laptop), visible tab, signed in | Real UI journeys. An injected harness recorded T0 (the action), every `/api/*` fetch start and end, and the first and last DOM mutation on `#rescount`, `#mapCount`, the Leaflet marker/overlay panes and the `#feed` rail. | n=1 per journey |
| **Browser 1** (desktop) | Cold-load resource timing only. Chrome **froze the background tab**, so timers, paints and in-page fetches were throttled or suspended. | Only the first 3 s of its cold load is used |
| **curl** from this machine, n=2 per case | The three horizon endpoints × 9 canonical queries, a tiny-bbox pan, the page HTML and the drawer endpoints. | Server latency. No browser render cost. |
| Code, `origin/main` | The client waterfall in `src/app/opportunity-map/route.ts` and the server routes. | Exact |

**Not measured:**
- Saved-search restore timing (Browser 1 was throttled)
- `?q=` deep-link
- Return-from-drawer
- A signed-in drawer (`opportunity-events`, `win-probability` and `federal-contacts` return 401 to curl)

Each of these is flagged as *inferred* below.

**Render model.** The client is vanilla JS plus Leaflet, not React. There is no loading state for viewport fetches (verified in code and on screen).

---

## 1. Performance scoreboard

T1 = first visible acknowledgement · T3 = first API response · T4 = first useful content ·
T5 = counts, cards and pins coherent · T6 = settled. Times are ms from the action.

| Journey | T1 | T3 | T4 | T5 | T6 | Requests | Slowest request | User sees during the wait |
|---|---|---|---|---|---|---|---|---|
| **Cold load** (B2) | ~1,118 (DOM interactive; server-inlined pins) | 2,459 | ~1,118 (inline pins; count not final) | ~4,810 | **~10,600** (a 2nd Open round starts at 8,651) | 3 horizons + me + drafts + shortlist ×2 + engagement ×3 + a later Open round | `forecast-map` 3,694 | Inline pins, then a silent swap, then a 2nd silent swap |
| **Cold load** (B1, first round only) | ~1,120 | 2,466 | ~1,120 | ~2,923 | invalid (throttled) | same | `recompete-map` 1,807 | same |
| **Start fresh** (clear restore) | 198 (pill removed) | 1,637 | **1,731, and it is WRONG** (still the DoD-filtered result) | 3,171 | 3,171 | 2 Open rounds, serialized | `opportunity-map` 1,553 | Old results → **stale DoD results painted** → correct results |
| **Horizon: +Recompete** | ~200 (checkbox) | 1,450 | 2,304 | 2,305 | 2,305 | Open (**refetched, unchanged**) + RC | `opportunity-map` 1,758 | Old pins, then a silent swap |
| **Horizon: +Forecast** | ~220 | 1,316 | 1,974 | 1,974 | 2,479 | Open + RC (**both refetched**) + FC + unplaced | `opportunity-map` 1,308 | Old pins, then a swap, then an unplaced tail |
| **Horizon: −Open** (hide only) | ~230 | 1,162 | 1,583 | 1,583 | 1,583 | RC + FC (**both refetched, unchanged**) | `recompete-map` 947 | **1.6 s wait to *hide* data already in hand** |
| **Search "ai governance"** (Enter) | ~360 (autocomplete dropdown) | 2,533 | 3,444 | 3,444 | 3,444 | search-capture, suggest-codes, agency-hierarchy, **3 horizons**, unplaced | `recompete-map` 3,007 | Old market for 3 s with no sign it is working; then 27 results with **0 pins in view** (empty map) |
| **Pan** (unfiltered, tiny DC bbox; curl + 450 ms debounce) | none | ~1,050 | ~1,500 | ~1,500 | ~1,500 | 3 horizons | `opportunity-map` 0.93–1.03 s **even for a 3-block bbox** | Old pins, no indicator |
| **Open opportunity drawer** (curl; SAM opp) | drawer + "Loading…" (instant) | 2,500–2,800 | **~2,600** | ~3,100+ (intel 0.33–0.56 s after) | inferred ~3.5 s (win-prob, events and contacts after intel) | detail → (intel ∥ related) → (win-prob ∥ events ∥ contacts) | `opportunity-detail` 2.5–2.8 s | A "Loading…" drawer |

**Server latency by canonical query** (curl, full-CONUS bbox, seconds, 2 runs each):

| Query | Open | Recompete | Forecast | Round wall (max) |
|---|---|---|---|---|
| (none) | 1.30–1.48 | 1.07–1.20 | 1.14–1.34 | ~1.4 |
| ai governance | 1.47–**2.05** | **3.10–4.16** | 1.35–1.52 | **3.1–4.2** |
| janitorial | 1.34–1.35 | 0.71–0.76 | 1.38–1.54 | ~1.5 |
| cybersecurity | 1.68 | **2.96–3.03** | 1.70–1.81 | **~3.0** |
| naics=541512 | 0.42–0.43 | 0.60–0.66 | 0.76 | ~0.76 |
| agency=USDA | 0.98–**4.49** | 1.78–1.84 | 1.73–**4.19** | **1.8–4.5** (high variance) |
| agency=VA | 0.90–1.69 | 1.65–1.90 | 1.26–1.40 | ~1.9 |
| state=FL | 0.60–0.81 | 0.71–0.94 | 0.65–0.79 | ~0.9 |
| 541512 + VA + FL | 0.42–0.66 | 0.41–0.43 | 0.80–0.88 | ~0.9 |

**Client render cost** (last response → first DOM mutation, measured in B2):

| Pins | Render time |
|---|---|
| 27 | ~57 ms |
| 504 | ~94 ms |
| ~2,000 | **~350–440 ms** |
| ~2,550 | **~350–440 ms** |

Every card is rebuilt on every fetch (329 card nodes for 327 in view).

**First slow layer, by journey**

| Journey | First slow layer |
|---|---|
| Cold load | Client orchestration: 2–4 boot rounds. Then the slowest horizon (Forecast, 4 serial DB round-trips). |
| Search / filter | Server: the Recompete free-text matcher (3–4 s). Then `Promise.all` makes everyone wait for it. |
| Horizon switch | Client: unchanged horizons are refetched. The pure-hide case needs no request at all. |
| Pan / zoom | Server: bbox-independent headline counts are recomputed on every pan (Open paged distinct count ~1 s floor). |
| Start fresh / any rapid change | Client: no cancellation, so a stale response paints, then a serialized second round runs. |
| Drawer | Server: `opportunity-detail` runs ~7 serial awaits (row → canonical → similar → tracking count → saved count → distinct-viewer scan → family). |

---

## 2. Waterfalls

### Cold load (B2 measured; accidental dependencies marked ✗)

```
0      HTML request (TTFB 67 ms in browser; 450–730 ms by curl — the server awaits
       getMapOpportunities(600) before first byte and inlines 600 pins)
~1,118 DOM interactive. 1.06 MB decoded HTML (286 KB wire) + Leaflet from unpkg.
       Inline OPPS pins paint ("600 results"-style provisional count).
~1,114 ── opportunity-map ─────────── 2,384 ──┐
       ── recompete-map ── 1,345 ────────────┤ Promise.all  ✗ all-or-nothing
       ── forecast-map ───────────────────────┴ 3,694 → render at ~4,810
       ── me 1,390 · proposal/drafts 3,113 · shortlist ×2 · engagement ×3   (off-path, OK)
~4,810 first coherent count + pins + cards
 8,651 ✗ second Open round (restore / autofit / map-home moveend / 4 s safety timer —
       code: setTimeout(fetchView,300), maybeAutoFit fitBounds, __mapBootView ×2, 4 s refetch)
~10,600 settled
```

**Real dependencies:** HTML → Leaflet → a view (bbox) → horizon data.

**Accidental dependencies:**
- ✗ Open waits for Forecast (`Promise.all`).
- ✗ The restore and autofit moves each trigger another full 3-horizon round, after a first round was already painted.
- ✗ The server holds the first byte for `getMapOpportunities(600)`.

**Minimum data for a useful Maps screen:** one horizon's pins plus its in-view count for the resolved view. Everything else can arrive later:
- the other horizons
- the market-wide headline count
- the unmapped / "not shown" disclosure
- unplaced forecasts
- account menu
- shortlist
- saved-search badge

The view must be resolved once, before the first fetch: restore → IP → CONUS.

### Search "ai governance" (B2 measured)

```
0     Enter  (typing debounce 400 ms already queued; Enter path coalesced by `busy`)
7     search-capture POST
199   suggest-codes (41 ms) ∥ agency-hierarchy (1,037 ms)   ← autocomplete, visible ~360 ms
380   opportunity-map ───── 2,618 ─┐
      forecast-map ──────── 2,533 ─┤  Promise.all
      recompete-map ────────────── 3,387 ┘  → render 3,444
1,237 forecasts/unplaced?q= (818 ms, autocomplete "9 without a mapped location")
3,444 27 results, rail swaps, pins in view = 0 (matches are elsewhere; map stays blank)
```

Findings from this trace:
- Debounce is 400 ms.
- There are 6 API requests.
- All three horizons run concurrently.
- Previous requests are **not cancelled**.
- A stale response **can paint** (proven by Start fresh).
- The map and cards wait on each other, and both wait on the slowest horizon.
- Counts do not block pins separately: everything lands in one render.
- The unmapped count is computed inside each horizon request, so it slows that horizon.
- Existing results **stay visible** until the swap. There is no dim and no acknowledgement.

### Filter change and horizon switch

The same shape as search, with two differences:
- Any toggle refetches every enabled horizon.
- Hiding a horizon costs a full round (1.6 s) though no new data is needed.

### Pan / zoom

- **Pan:** `moveend` → 450 ms debounce → 3 horizons. Each horizon recomputes its **bbox-independent** market totals. Open pages the whole filtered corpus for a distinct count; RC runs 2 count heads plus the viewport count; FC runs 2 serial counts. So a 3-block pan costs ~1 s.
- **Zoom:** `zoomend` re-renders local data with no fetch. The following `moveend` does fetch.

### Opportunity open

- **SAM opp:** `opportunity-detail` takes 2.5–2.8 s and blocks the drawer body. Then intel (0.3–0.6 s) runs in parallel with related-awards (0.1–0.2 s). Then win-probability, events and contacts run in parallel. That is **three serial levels**.
- **Recompete and forecast:** the drawer paints instantly from the pin row, then fills in sections. This is the good pattern.

---

## 3. Top performance fixes (ranked by measured user time saved)

| # | Issue | Measured cost | Frequency | User impact | Root cause | Smallest optimization |
|---|---|---|---|---|---|---|
| 1 | **All-or-nothing horizon render** | First paint is gated by the slowest horizon. On ai governance, Open was ready at 2.6 s but shown at 3.4 s. Free-text searches lose 1–2.5 s. | Every fetch | High | `Promise.all` in `fetchView` | Render each horizon as it resolves. Merge incrementally and mark the other horizons pending. This also enables truthful ✓/◌/○ progress. |
| 2 | **Recompete free-text matcher is slow** | 3.0–4.2 s for "ai governance" (3 rows) and "cybersecurity", vs 0.6 s by NAICS | Every text search with Recompete on | High | *Hypothesis:* whole-word matcher ops over `recompete_opportunities` text, run **4×** per request (market total, unmapped, viewport `count:'exact'`, follow-on) without a supporting index | EXPLAIN ANALYZE first. Then add a trigram/FTS index, or evaluate the matcher once (a CTE/RPC with window counts). Target ≤0.8 s. |
| 3 | **Counts recomputed on every pan** | ~1.0 s floor per pan (the Open tiny-bbox case). Recompete and Forecast repeat 2 counts each. | Every pan/zoom (most frequent action) | High | Market totals and unmapped counts ignore the bbox but ship inside the viewport request | Split `counts` from `pins`. The client caches counts by filter signature, so a pan fetches pins only. Optionally add a short server TTL cache keyed by filter. Target pan ≤0.5 s. |
| 4 | **Unchanged horizons refetched on toggle** | +Recompete refetched Open (1.76 s). −Open refetched RC and FC (1.6 s) for a pure hide. | Every horizon switch | Medium-high | `toggleHorizon` → `fetchView` for all enabled horizons; no per-horizon cache | Keep a per-horizon result cache keyed by (horizon, filter signature, bbox). Toggle-off = 0 requests, instant. Toggle-on fetches only the new horizon. |
| 5 | **No cancellation → stale paint + doubled latency** | Start fresh showed wrong DoD results at 1.7 s and correct ones at 3.2 s | Any change made during an in-flight fetch (typing, restore, rapid filters) | High (trust) | `busy`/`pendingFetch` serialization; no AbortController or sequence id | AbortController per round plus a monotonic sequence; the latest intent wins, and older responses never paint. |
| 6 | **Boot fires 2–4 full rounds** | Settled at ~10.6 s vs ~4.8 s after the first round | Every Maps open | High (first impression) | `setTimeout(fetchView,300)`, `__mapBootView` ×2, autofit `fitBounds`, map-home/IP `setStateView` and the 4 s safety timer each cause a `moveend` or fetch | One boot resolver decides the view (restore → map-home → IP → CONUS) **before** the first fetch. Then fetch once. |
| 7 | **Drawer detail endpoint is serial** | 2.5–2.8 s before any content | Every SAM opp open | High (core action) | ~7 sequential awaits in `opportunity-detail`. The distinct-viewer scan over `user_engagement` is the prime suspect; needs per-query timing. | Paint from the pin row immediately (Recompete/Forecast already do). Return core fields fast; `Promise.all` or defer similar, tracking, saved, viewers and family. Target ≤0.5 s to core. |
| 8 | **Forecast route runs serially** | 1.1–4.2 s | Every fetch with Forecast on | Medium | pins → count → unmapped → unplaced, awaited one at a time | `Promise.all` the three independent reads, then (with #3) move the counts out. |
| 9 | **Client re-renders all cards and pins** | 350–440 ms for ~2,000–2,550 pins | Broad views, all horizons | Medium | Full rebuild of the rail and markers each fetch | Diff by id; virtualize the rail (render the first ~50 cards). |
| 10 | **Heavy HTML** | 1.06 MB decoded; DOM interactive ~1.1 s; server holds TTFB for 600 inline pins | Cold load | Low-medium | Inline OPPS plus ~20 inline JS blocks | Later: stream the shell first; cache static JS. Not P0. |

**Avoidable vs useful work**

- **Avoidable:**
  - #4 and #5, and #6's extra rounds.
  - Most of #3: counts recomputed for an unchanged filter.
  - #1's gating: the work is useful, but the waiting is not.
- **Useful, but reducible:**
  - #2: the matcher must run; it should not take 3–4 s.
  - #7 and #8.
- **Genuinely unavoidable today:**
  - The first market-wide count for a *new* filter. ~0.4–1.5 s after #2/#3.
  - One viewport pin query. ~0.3–0.8 s.
  - First-time intel compute for an opp without precomputed intel (`buildOppIntel`).

After P0, the realistic unavoidable wait for a new search is **~1 s**. This is why the transition system below is sized mostly for the 300 ms–1 s and 1–3 s bands. The rich 3 s+ experience should become rare.

---

## 4. Transition-state audit

What the UI shows today during each wait:

| Wait | Shown today | "Did Mindy freeze?" window |
|---|---|---|
| Cold load, before the first round | Inline pins plus a provisional count; no signal that data is still coming | 1.1 → 4.8 s, and again 8.6 → 10.6 s (silent re-swap) |
| Search / filter | **Old results unchanged**, no dim, no text. Only the autocomplete dropdown reacts. | 0.4 → 3.4 s (ai governance) — **yes** |
| Search matches off-screen | 27 results in the rail, **blank map** in view | Indefinite, until the user pans — **yes** |
| Horizon toggle | The checkbox flips; the map is unchanged | 0.2 → 1.6–2.5 s — **yes**, especially for toggle-off |
| Start fresh | The pill disappears; old results; then **wrong** results; then right ones | 0.2 → 3.2 s — **yes, plus misleading** |
| Pan | Old pins remain in place | ~0.45 → 1.5 s. Mild, but it looks like "no pins here". |
| Drawer (SAM) | Drawer plus "Loading…" | 0 → 2.6 s — **yes** |
| Drawer sections | `.vr-loading` "Estimating…", `.mw-loading` "Scoring your fit…", `.intel-load`, "Analyzing…" | OK: these already acknowledge |
| Fetch failure | `#fetchErr` with Retry | OK |
| Tiles | `#tileStatus` "Loading … tiles…" | OK |

---

## 5. Proposed Mindy loading system (design only)

**Thresholds** (kept as proposed; the evidence supports them):

| Band | Treatment |
|---|---|
| <300 ms | Nothing, except the control itself acknowledging the input (pressed state). |
| 300 ms–1 s | Local acknowledgement: a thin progress rail under the filter bar, the count changes to "Updating…", and the rail dims to ~60% with pointer-events kept. |
| 1–3 s | Branded inline transition: the count area becomes the horizon progress strip (below). |
| 3 s+ | Rich Mindy transition. **Cold load only**, plus rare slow first-time searches. Never on pan. |

A treatment only appears once its threshold elapses. A 250 ms response shows nothing extra.

**Preserve context by default.** On search and filter changes:
- Keep the old map and rail visible, dimmed, with "Updating your market…".
- Where stale content **must not** stay:
  - After **Start fresh** or clearing a filter, the old *count* must not remain. The stale DoD count currently reads as the new market. Replace the count with "Updating…" while keeping pins dimmed.
  - When a horizon is toggled **off**, remove its pins immediately. They are already in hand.
  - If the previous result set was **0**, don't keep a stale "No results" message; show acknowledgement instead.
- Cards stay non-clickable-looking but clickable. A click during an update opens the old record, which is still a real record.

**Truthful horizon progress** (possible only after P0 fix #1). Shown in the `#rescount` slot:

```
Searching the federal market for "ai governance"
✓ Open Now 11   ◌ Coming Back   ✓ Coming Soon 4
```

Each mark flips when that horizon's response lands. No percentages. When unavailable, show "n/a — not zero" (the coverage semantics already exist in `horizonCountLabel`).

---

## 6. NBA-2K-style concept (design only)

| Moment | Visual behavior | Copy (from real stages only) |
|---|---|---|
| **First Maps load** (cold, 1–4 s today; target <2 s) | The basemap renders immediately. Over the rail, a Mindy card shows the three horizon rows lighting up as each resolves. One MINDY INTEL card sits below. Pins fade in per horizon. | "Building your market…" → "✓ Open Now · ◌ Coming Back · ○ Coming Soon" |
| **Search** (1–3 s) | Map and rail dim. The count slot becomes the progress strip. If matches fall off-screen, auto-fit, or show "11 matches outside this view — Show all" (never a blank map). | "Searching the federal market…" · "Checking Open Now…" · "Finding contracts coming back to market…" · "Looking ahead at agency demand…" |
| **Horizon switch** | Toggle-off is instant, with no transition. Toggle-on shows only that horizon's row: ◌ → ✓ and its pins fade in; other horizons are untouched. | "Finding contracts coming back to market…" |
| **Opportunity open** | The drawer opens with the pin's real title, agency, value band and due date **immediately** (from the row in hand). Section skeletons stay in their fixed slots (the `constant-skeleton` contract). | "Loading opportunity intelligence…" · "Analyzing the buyer…" (only while intel/contacts are actually pending) |

**MINDY INTEL cards during long waits**

- **Where they would be seen:** the cold load, and first-time slow searches. After P0 that is expected at ≤10% of searches.
- **Reading time:** 1.5–3 s realistic, so one card of ≤20 words. **No rotation** under 4 s; rotate every ~5 s only beyond that.
- **Interruptible:** always. Results replace the card **the instant they are ready**; never delay data to finish a card.
- **Returning users:** track seen-card ids per viewer (localStorage) and serve unseen cards first. Tie cards to the current state, e.g. show the forecast card when Forecast is the pending horizon.
- **Starter set:** the three cards in the brief. Write the full set only after P1 ships and the real wait distribution is measured.

---

## 7. Product principle (refined)

> **Never make the user wonder whether Mindy heard them.** Acknowledge every action within 100 ms.
> Keep useful context on screen while work happens, but never let an old number stand in for a new
> answer. Show only progress that is real. Spend unavoidable waits teaching something true. Never
> make a user wait for Mindy to finish talking.

The additions to the original: *"never let an old number stand in for a new answer"* (from Start fresh) and *"never wait for Mindy to finish talking"* (data beats the card).

---

## 8. Implementation sequence

**P0 — actual speed** (all measured above):
1. Progressive per-horizon render, replacing `Promise.all` (#1)
2. AbortController plus sequence id, so the latest intent wins (#5)
3. A single boot resolver, then one fetch (#6)
4. Per-horizon result cache; toggle-off costs zero requests (#4)
5. Split counts from pins; a pan fetches pins only (#3)
6. EXPLAIN and fix the Recompete free-text matcher (#2)
7. `opportunity-detail`: paint from the pin, return core first, parallelize the rest (#7)
8. `forecast-map`: `Promise.all` its reads (#8)

**P1 — immediate acknowledgement.** Pressed states; a "Updating your market…" dim plus a count placeholder at 300 ms; a drawer shell painted from the row; an off-screen-matches fallback (never a blank map on search).

**P2 — branded transitions.** The horizon progress strip (✓/◌/○) and the cold-load Mindy card. Needs P0 #1.

**P3 — Mindy Intel content system.** Card schema, per-viewer rotation, state-aware selection; copy written after P2 metrics.

---

## 9. Acceptance metrics (production, real browser, p50/p95 over ≥20 runs per journey)

**Actual latency**

| Journey | Today (measured) | Target p50 | Target p95 |
|---|---|---|---|
| Cold load, first useful pins (T4) | ~1.1 s (inline pins); real data ~4.8 s | ≤1.5 s real data | ≤2.5 s |
| Cold load settled (T6) | ~10.6 s | ≤2.5 s, with **exactly one** fetch round | ≤4 s |
| Text search T4, first horizon | 2.6–3.4 s | ≤1.0 s | ≤2.0 s |
| Text search T6, all horizons | 3.4 s (server up to 4.2 s) | ≤1.5 s | ≤3.0 s |
| NAICS / state / multi-filter T6 | ~0.9 s server + client | ≤0.8 s | ≤1.5 s |
| Pan T6 | ~1.5 s | ≤0.6 s | ≤1.0 s |
| Horizon toggle-off | 1.6 s | ≤100 ms, 0 requests | ≤150 ms |
| Horizon toggle-on | 2.3–2.5 s | ≤1.0 s, only 1 request | ≤2.0 s |
| Drawer core content (SAM) | ~2.6 s | ≤300 ms (from pin) | ≤500 ms |
| Drawer full detail | ~3.5 s (inferred) | ≤1.5 s | ≤3.0 s |
| Render of ~2,500 pins | 350–440 ms | ≤120 ms | ≤200 ms |

**Perceived responsiveness**
- 100% of actions show visible acknowledgement within 100 ms (T1).
- 0 stale paints: no response older than the latest intent ever renders (assert via sequence id in telemetry).
- 0 "blank map with results" states after a search.
- No interval over 300 ms without an acknowledgement state, verified by the mutation-harness method used here.
- Mindy Intel cards appear in ≤10% of searches, and the card never delays results (result-ready → swap ≤50 ms).

## Harness (reusable)

The in-page harness used on Browser 2 did three things:
- wrapped `window.fetch` to record path, param keys, start, end and status
- ran MutationObservers on `#rescount`, `#mapCount`, `.leaflet-marker-pane`, `.leaflet-overlay-pane` and `#feed`
- used `__mark(label)` to set T0 and `__rep()` to report

It is recorded here so a later session can rebuild it and re-run it for the acceptance numbers.
**⚠️ The measured tab must be visible.** Chrome freezes background tabs, which invalidated Browser 1.

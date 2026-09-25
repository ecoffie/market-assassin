# Maps P1/P2 — instant feedback, truthful horizon progress, Building your market (2026-09-24)

> ✅ **PRODUCTION-PROVEN 2026-09-25** — merge `24dbb20e` (#1693) served by getmindy.ai; acceptance at the end of this record.

> Never make the user wonder whether Mindy heard them, and never let an old answer masquerade as the new one.

> ⚠️ **Correction (2026-09-25):** the absolute timings below were measured with x86 Chrome under Rosetta (Node is x64 here). Native arm64 Chrome is ~5–40× faster. Relative comparisons stand. Native numbers are in `tasks/maps-first-load-investigation-2026-09-25.md`:
> - acknowledgement 10–49 ms for nearly every action (reset 145 ms, show Recompete 169 ms);
> - drawer skeleton 10 ms;
> - cold load: first useful pins 1.5–2.4 s;
> - 0 stale paints.

Branch `feat/maps-p1-feedback`, rebased onto `main` after P0 (#1684) merged and was production-verified (`7ce3a668`).
The diff against main is P1/P2 only. No backend optimization, no Canonical Discovery change, no compute-once semantics change.

## What ships
| Part | Where |
|---|---|
| Feedback module (presentation only: never fetches, never delays data) | `src/app/opportunity-map/market-feedback.ts` |
| Mindy Intel content system (sourced, horizon-scoped cards) | `src/lib/maps/mindy-intel.ts` |
| Round facts reported by the fetch machinery | `route.ts` VIEWPORT_JS: `begin` / `horizon` / `paint` / `idle` |
| A user action supersedes in-flight work at once | `route.ts` `_actionNow()` (generation bump + acknowledgement) |
| Drawer section-level loading (P1C) | `route.ts` DRAWER_JS: `secSkel`, `oskErrHTML` |
| Tests | `market-feedback.unit.test.ts` (33) + 1 behavioral case in `newest-action-wins.unit.test.ts` |

## When each thing appears (all thresholds in `MF_TIMING`, measured from the ACTION)
| State | Shows when |
|---|---|
| **Nothing** | A pan/zoom that settles in < 300 ms; a cached horizon toggle; any round that finishes before the next frame. A system refetch (boot view placement, the 4 s boot failsafe) is never acknowledged. |
| **Subtle acknowledgement** | At the action (next frame) for any user action. A 2px bar starts at the top of the map. After 100–120 ms (so a fast answer never flashes), veils fade over the old map and list, and the header count is replaced by "Updating your market…". A pan gets the bar only, after 300 ms. |
| **Local progress** | 300 ms – 1 s: a spinner beside "Updating your market…". |
| **Updating your market panel** | ≥ 1 s while the round is unsettled. Bottom-center of the map, one row per enabled horizon, each marked done only when *its* request completed: Open Now / Coming Back / Coming Soon with the real count; `couldn't load` / `not covered` / `add what you sell` / `count unavailable` are states, never 0. |
| **Building your market** | The first market of a page load (cold, warm, deep link, restored search). It is in the server HTML (`.app` already `mfb-booting`) and a CSS animation fades it in after 300 ms — no script has to run first (first-load pass, 2026-09-25). A fast entry never sees it. Stages: Understanding your market (done when the intent is dispatched), then one per enabled horizon. It leaves at the **first paint with pins**, not when every horizon is done. The remaining horizons continue in the Updating panel. It also leaves when the round settles, or after a 25 s failsafe. Nav and search stay usable underneath. |
| **Mindy Intel** | ≥ 3 s in the Updating panel; ≥ 2.5 s in Building your market. Rotates every 8 s only while the wait continues. Unseen cards come first. A card about a horizon only appears while that horizon is shown. It never delays dismissal. |
| **Failure** | Every horizon failed with the old market on screen: the old market stays veiled, the header reads "Showing previous results", and the note says "Couldn't update your market. Showing your previous results." with Retry. One horizon failed: its row reads `couldn't load`; the others paint. |

## State-transition matrix
| Trigger → | 0 ms | 100–120 ms | 300 ms | 1 s | 3 s | first paint with pins | settled | superseded by a newer action |
|---|---|---|---|---|---|---|---|---|
| Search / filter / agency / state / Start Fresh / uncached horizon | bar; generation bumped | veils + "Updating your market…" | spinner | Updating panel | + Mindy Intel | veils and label clear; panel continues | everything clears | older round can never paint; progress resets to the new round |
| Cached horizon toggle | bar (usually settles in the same frame) | — | — | — | — | — | clears | same |
| Pan / zoom | — | — | bar | — | — | — | clears | same |
| System refetch (boot failsafe) | — | — | bar if slow | — | — | — | clears | same |
| First market of a page load | overlay in HTML (hidden) | revealed at 250 ms | stages advance per real horizon | — | Intel at 2.5 s | overlay leaves | overlay leaves | stays until the newer round paints |
| Every horizon failed | — | — | — | — | — | never | veils stay + "Showing previous results" + Retry | — |
| `needs_positive_scope` / Forecast unavailable | as a search | | | rows: `add what you sell` / `not covered` | | | P0's explicit header and feed states (unchanged) | |
| Players map / nothing enabled | `idle` clears everything | | | | | | | |
| Opportunity drawer | shell: pin facts + titled section skeletons | | | | | detail replaces skeletons; intel sections fill locally | | detail failure: facts stay, local `Couldn't load the full details` + Retry |

## Measurements (Vercel previews, same data, compute-once on both)
- Baseline = `707e20a5` (P0 + main, no P1).
- P1 = final `d8629011`.
- Headless Chrome, 1440×900, two runs each. ms from the user's action.
- Baseline "first visible change" = the first time anything changes; before P1, that is new data.

| Journey | Baseline: first visible change | P1: acknowledgement | Baseline useful map | P1 useful map | P1 feedback shown |
|---|---|---|---|---|---|
| search "ai governance" | 1,647 / 1,637 | 116 / 236 | 1,646 / 1,636 | 1,188 / 1,500 | bar, label, spinner, panel |
| search "software license" | 4,463 / 5,500 | 88 / 64 | 4,456 / 5,483 | 3,800 / 3,680 | + Mindy Intel |
| broad capability list | 6,290 / 5,685 | 271 / 77 | 6,224 / 5,661 | 5,330 / 6,197 | + Mindy Intel |
| USDA | 1,543 / 1,003 | 250 / 257 (in-page: 27 / 117) | 1,522 / 991 | 1,416 / 1,434 | panel |
| Florida | 715 / 1,151 | 279 / 274 (in-page: 37 / 63) | 712 / 1,139 | 875 / 781 | panel |
| hide Recompete (cached) | 1,247 / 544 | 426 / 364 (in-page: 11 / 53) | 1,184 / 506 | 841 / 720 | bar, label |
| Start Fresh | 591 (cache) / 1,675 | 88 / 74 | 588 / 1,674 | 2,129 / 1,865 | panel |
| rapid A→B | stale paints **1** | stale paints **0** (×4 runs) | | | |
| pin → drawer | full shell 113–133, "Loading full details…" | skeleton shell 70–136 | detail 1.2–1.9 s | detail 1.9–2.7 s, full 3.3–3.5 s | section skeletons |
| cold Maps load | 3.4–3.9 s (placeholder list) | Building your market at 1.4–1.9 s | 12.0–12.9 s | 13.1–15.1 s | boot → panel → Intel |
| deep link ?q=cybersecurity | 3.5–3.7 s | overlay at 1.4–3.9 s | 9.0–9.5 s | 9.4–13.2 s | boot → panel |

**Acknowledgement (in-page probe, first frame with the acknowledgement written and painted), final build:**
- 8–118 ms for filter and horizon actions, most under 100 ms.
- A search Enter is acknowledged in the Enter event; it paints once the browser renders the next frame (64–236 ms in the harness, which reads one frame late).
- Misses of the 100 ms target: USDA once at 117 ms (the handler itself took 50 ms), and show-Recompete at 100 ms.

**Does feedback slow the data?** Same-build A/B with the module disabled in-page:
- Toggle medians of 20 rounds: 764–949 ms on vs 672–781 ms off.
- Traced rounds had the opposite sign: on 333–703 ms vs off 635–950 ms.
- The directly measured costs are an ~18 ms acknowledgement frame, a < 3 ms DOM flush, and the one-frame dispatch yield (by design, so the acknowledgement paints first).
- Two costs found and removed along the way:
  - class-based stale styling forced 130–260 ms page recalcs;
  - fading the content layers cost ~80 ms per round. Replaced by inline writes and composited veils.
- Round-to-round variance is dominated by P0's existing pin/card render (300–835 ms of script).

## Browser acceptance (headless Chrome against the P1 preview)
| Check | Result |
|---|---|
| cold / warm load | Building your market; leaves at first paint with pins; no placeholder list shown |
| ai governance / software license / broad capability | acknowledged, truthful rows, Intel on long waits |
| USDA / Florida / Start Fresh | acknowledged; panel at ≥ 1 s; Start Fresh never shows the stale DoD market as the answer |
| Open → Recompete → Forecast; hide/show | cached switches settle in < 300 ms with no loader |
| rapid A→B | **0 stale paints** (4 runs; baseline 1) |
| pin → drawer | shell at 70–136 ms with section skeletons; failure keeps facts + local Retry |
| deep link ?q= | Building your market with the query shown |
| one horizon fails | its row `couldn't load`; others paint |
| all fail | old market stays veiled, "Showing previous results", Retry |
| `needs_positive_scope` (`-computers`) | unchanged explicit state; no feedback lingers |
| Forecast unavailable (NOAA) | unchanged "Unavailable … not zero" |
| reduced motion | overlay and states visible, no animation |

## Defects found by acceptance and fixed in this branch
1. Stale classes forced whole-page style recalcs (130–260 ms) → inline writes.
2. The acknowledgement was written inside tasks that then read geometry, forcing synchronous layout. Fixed with a per-frame flush and a static-position label.
3. The acknowledgement painted only after the dispatch work. Fixed: `fetchView` yields one frame and Enter defers its commit.
4. **Stale paint:** the older round's response landed in that yield gap. Fixed: `_actionNow` bumps the generation at the action; the new test fails without it.
5. The boot failsafe refetch was acknowledged as a user action → `{system:true}`.
6. The panel covered the "Picked up…" pill → moved to bottom-center. The veil covered the panel → veil z 450.
7. The suggestion dropdown reopened after submit (pre-existing race) → timer cleared + sequence guard.
8. Fading the content layers made each render slower → veils.
9. Reduced motion left animated elements invisible → visible is the default state.

## Known limits (not fixed here)
- **Cold load.** The ~8 s figure was x86 Chrome under Rosetta. Natively, DCL is 0.7–1.1 s and first useful pins land at 1.5–2.4 s. The overlay reveals late because a parse-time timer shows it; the cause and the proposed bootstrap separation are in `tasks/maps-first-load-investigation-2026-09-25.md` (not implemented).
- **A horizon can fail on the first request after a fresh deploy.** Measured twice on the preview: the Open API returned HTTP 500 after ~10.7 s on the first cold load following a deploy, then 200 in 3–5 s warm (3/3). That is the Open API, which this PR does not change. The page now says "Open couldn’t load" instead of "still loading Open" (fixed in `b144acbc`).
- **Naming.** Progress rows say Open Now / Coming Back / Coming Soon (your copy, and FIND's); the Horizons dropdown and legend still say Open / Recompete / Forecast. One canonical name is needed. That's a product call, flagged rather than renamed here.
- Forecast's row count is `totalForFilters` (mappable); the header adds location-less forecasts, as P0 already does.
- Actions whose own handlers are slow (e.g. show Recompete after a heavy render) acknowledge only when that handler ends; the browser cannot paint mid-task.

## Review previews (not production)
- P1: `https://market-assassin-git-feat-maps-p1-feedback-eric-coffies-projects.vercel.app/opportunity-map`
- Baseline: `https://market-assassin-ftv9lgtj6-eric-coffies-projects.vercel.app/opportunity-map`
- Preview-only env: `RECOMPETE_COMPUTE_ONCE_MODE=authority`, scoped to branches `feat/maps-p1-feedback` and `perf/maps-p1-baseline` (the baseline also received it via CLI `-e`). Remove after review.

## Production acceptance (2026-09-25) — getmindy.ai serving `24dbb20e`
Served HTML: full page 891,692 bytes with `let OPPS = [];`, `.app mfb-booting` in the server HTML, transform sweep,
failed-horizon state and "not zero results" copy present. `?embed=1`: 600 rows, no overlay.

**Cold load, native arm64 Chrome, 3 runs each (ms from navigation)**
| CPU | First paint | Building your market visible | First discovery request | First useful pins |
|---|---|---|---|---|
| 1× | 528–700 | 959–1,134 | 545–709 | 1,253–1,463 (one run 3,245) |
| 4× | 456–1,160 | 905–1,602 | 589–1,260 | 1,613–2,430 |

Real desktop Chrome (Browser 1, `?q=ai governance`): DCL 313 ms, first discovery request 313 ms, first paint 612 ms,
overlay dismissed at the first useful paint (1,998 ms — same instant), settled 4.2 s.

**Actions (ms from the user's action)**
| Action | Acknowledgement | First horizon | Useful | Settled |
|---|---|---|---|---|
| search ai governance | 26 | 1,001 | 1,050 | 2,038 |
| search software license | 24 | 3,583 | 3,614 | 5,505 (Intel at 3,041) |
| broad capability list | 41 | 5,948 | 6,114 | 17,150 |
| agency USDA | 24 | 436 | 505 | 2,425 |
| state Florida | 24 | 378 | 400 | 919 |
| hide / show Recompete (cached) | 38 / 154 | — (0 requests) | 137 / 143 | 137 / 143 |
| Open / Recompete / Forecast only | 44–56 | — (0 requests) | 37–53 | 37–53 |
| rapid A→B | 37 | — | 139 | 139 — **stale paints 0** |
| Start Fresh | 20 | 1,174 | 1,231 | 1,231 |
| drawer | skeleton 11 | — | details 1,554 | full 1,861 |
| deep link ?q=cybersecurity (load) | overlay 796 | 1,031 | 1,053 | 4,495 |

**Truth states:** forced Open 500 → "Open couldn't load" (others paint); every horizon forced 500 → "Results unavailable /
a loading error, not zero results"; `-computers` → needs_positive_scope on all three horizons ("Add what you sell");
NOAA Forecast → "unavailable … — not zero". Reduced motion: overlay shown statically at first paint, no animation, leaves on
useful. Mindy Intel appeared only on long waits and never delayed a paint (useful follows the first horizon by 31–63 ms).
Console: no errors on normal loads, deep link, embed, needs-scope, NOAA; only the deliberately forced 500s.

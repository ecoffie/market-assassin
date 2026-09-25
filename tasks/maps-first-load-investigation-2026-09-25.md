# Maps first load — what the "~8 s cold parse" really was, and how to show Mindy before it (2026-09-25)

Read-only investigation. No product code changed; each candidate fix was measured by serving the live page
HTML with one edit through request interception, in the same browser, on the same preview (#1693 on main:
P0 + P1, `ed40d5b1`).

## ⚠️ Correction first: the 8 s was mostly my measurement browser
- Every earlier Maps timing in this project came from Puppeteer's bundled Chrome. Node here is **x64**, so that Chrome was the **x86 build running under Rosetta** on an arm64 Mac (Puppeteer printed "Degraded performance warning" on every run).
- Under Rosetta, the same page took ~8 s to DOMContentLoaded. Native arm64 Chrome takes **0.7–1.1 s**, and your real desktop Chrome took 0.7–0.9 s.
- **Relative findings stand** (what dominates, and which variant wins).
- **Absolute times in `tasks/maps-p1-feedback-2026-09-24.md`, the review artifact and PR #1693 are inflated ~5–40×** and are superseded by the native numbers below.
- Harnesses now accept `CDP_URL` and are driven against `arch -arm64` Chrome.

## What this page is
`/opportunity-map` is a route handler that returns ONE HTML document. It is not a Next/React page, so there is **no JS bundle download and no hydration**.

| Part | Size (uncompressed) |
|---|---|
| Whole document | 1.11 MB (313 KB on the wire, gzip) |
| Inline JavaScript | 955 KB |
| Embedded placeholder dataset (`let OPPS = [600 SAM rows]`) | 250 KB |
| VIEWPORT_JS | 247 KB |
| DRAWER_JS | 241 KB |
| Template main script | 79 KB |
| BOOT_VIEW_JS | 35 KB |
| SEARCH_PANEL_JS | 28 KB |
| Inline CSS | 113 KB |

External resources:
- Leaflet JS/CSS from unpkg (~0.1 s download);
- Google Fonts CSS (render-blocking);
- OSM tiles.

## Cold waterfall — native arm64 Chrome, 3 runs, ms from navigation
| Stage | As-is, 1× CPU | As-is, 4× CPU (mid laptop) |
|---|---|---|
| HTML received | 583–879 | 647–841 |
| First visual (FCP) | 720–1,276 | 820–1,244 |
| JS download | inline; Leaflet 89–101 | inline; Leaflet 81–326 |
| JS parse/compile | V8 compile 5–6; HTML parse 16–19 | compile 20–24; parse 57–75 |
| Hydration | none (not React) | none |
| Map library init | Leaflet eval 5–7; map + tiles inside template main | Leaflet 20; map + tiles inside template |
| Route script init | template main 33–47 · BOOT_VIEW 25 · VIEWPORT 6–8 | template 123–127 · BOOT_VIEW 106–117 · VIEWPORT 23–24 |
| Placeholder list work (rAF chunks, style/layout, paint) | ~120 | ~660–780 |
| First discovery request | 877–1,312 | 1,650–2,111 |
| First useful pins | 1,544–2,381 | 2,493–2,999 |
| **Transition on screen** | **1,127–1,508** | **1,735–2,226** |

Your real desktop Chrome (16 cores, P1 preview):
- DCL 708–934 ms, first discovery 712–931 ms;
- first useful pins about 1,850 ms, settled 3,041 ms.

## Root cause of first-load cost
**The embedded 600-row placeholder list is rendered, and then rendered again, before the first discovery request can go out.** Nobody uses it:
- the first fetch round replaces it;
- on the full page, P1's transition hides it.

It is drawn by the template's inline `render()` at parse time, drawn again when BOOT_VIEW moves the map (`setView → moveend → render`), cleared marker by marker, and redrawn in P0's chunked card frames.

At 4× CPU, pre-discovery main-thread work drops from about 1.1 s to about 0.25 s without it.

Secondary costs:
- `shortDate()` builds a fresh `Intl` formatter per card. Large under Rosetta; minor natively.
- Style/layout for about 3,000 cards.

JS size and compile are **not** the problem: compile is 5–24 ms for the whole page.

## Can "Building your market" render before the heavy work?
**Its markup and CSS can; its visibility currently cannot.**
- The overlay HTML sits early in `<body>` and its CSS is in `<head>`.
- But it is revealed by a parse-time `setTimeout(250)`. A timer cannot fire while the parser is busy with the inline scripts, so the reveal lands after FCP:
  - native 1×: +0.4–0.7 s;
  - native 4×: +0.9–1.4 s;
  - Rosetta: up to +4.8 s.
- Its sweep line animates `background-position` (a main-thread property), so it freezes during that work. The spinners use `transform` and keep moving.

## Measured candidate fixes (native arm64, 3 runs each)
| Variant | CPU | Transition on screen | First discovery | First useful pins |
|---|---|---|---|---|
| As-is | 1× | 1,127–1,508 | 877–1,312 | 1,544–2,381 |
| No placeholder | 1× | 1,002–1,348 | 659–976 | 1,323–1,570 |
| No placeholder + shell visible in server HTML | 1× | **707–871 (= FCP)** | 736–894 | 1,291–1,636 |
| As-is | 4× | 1,735–2,226 | 1,650–2,111 | 2,493–2,999 |
| No placeholder | 4× | 1,185–1,256 | 953–997 | 1,658–1,769 |
| No placeholder + shell visible in server HTML | 4× | **783–1,143 (= FCP)** | 926–1,298 | 1,652–2,050 |

## Recommendation: the smallest bootstrap separation (fixes 1–3 IMPLEMENTED 2026-09-25 — see the end)
1. **Server-render the transition's visibility; no JS reveal.**
   - The overlay reveals itself with a compositor-driven CSS fade (opacity keyframes, about 300 ms delay, fill `both`), and `.app` carries `mfb-booting` in the server HTML.
   - It no longer depends on any script or timer, and the compositor runs the fade even while the parser is busy.
   - A ~300 ms delay keeps a fast load from flashing the full transition, matching P1's tiers.
   - Under reduced motion it shows statically at first paint: the page's global rule removes the delay, which is acceptable for a static shell.
   - The JS keeps only what it already owns: stage progress and dismissal.
2. **Stop shipping the placeholder list on the full page.**
   - `JSON.stringify(embed ? opps : [])`, and skip the 600-row `getMapOpportunities` query when not embedding.
   - **`?embed=` must keep it.** The embed branch injects no VIEWPORT_JS, makes no fetch rounds, and the embedded rows are its entire content.
   - Measured gain: first discovery −0.2 to −0.6 s at 1×, −0.7 to −1.2 s at 4×; first useful pins −0.2 to −0.8 s at 1×, −0.8 to −1.2 s at 4×.
3. **Sweep line on `transform`** instead of `background-position`, so it keeps moving while the main thread works.
4. *(Optional, small)* Cache the two `Intl.DateTimeFormat` instances in `shortDate`.

Out of scope: a general frontend rewrite, bundling or lazy-loading DRAWER_JS and the like. Compile is under 25 ms, so splitting would not move first load.

**Revised first-load timing if 1–3 ship** (measured with those edits served, native):
- 1×: transition at first paint (0.7–0.9 s), first discovery 0.74–0.89 s, first useful pins 1.3–1.6 s.
- 4×: transition at first paint (0.8–1.1 s), first discovery 0.93–1.3 s, first useful pins 1.65–2.05 s.

With the ~300 ms reveal delay, the transition appears about 0.3 s after first paint, and not at all on loads that finish sooner.

## Implemented (2026-09-25, `e01288aa` + `dabe0e36`): fixes 1–3 only
1. **CSS-first Building your market.** The overlay ships in the server HTML with `.app` already `mfb-booting`. No script reveals it: a compositor opacity animation (`mfbBootIn .24s ease-out 300ms both`) does. Visible is its static state, so reduced motion shows it at first paint. `.out` beats the animation, so a load that is useful sooner never shows it, and leaving has no minimum display time.
2. **Placeholder list: embed only.** The full page ships `OPPS=[]` and skips the 600-row query. Page 1.11 MB → 891 KB. `?embed=1` still ships 600 rows (600 pins, 0 API calls).
3. **Sweep on `transform`**, not `background-position`.

Found by forced-failure acceptance and fixed (`dabe0e36`): with no placeholder, "every horizon failed" on first load read **"0 results"** + "No opportunities match". It now reads "Results unavailable" + "a loading error, not zero results" + Retry. Before this change, the same path showed the 600 placeholder rows as the user's market.

### Before / after — native arm64 Chrome, same session, interleaved, 3 runs each (ms from navigation)
Before = preview `d0eb4c34`, after = preview `e01288aa` (`dabe0e36` changes only the all-failed path).

| | CPU | HTML received | First paint | Building your market visible | First discovery request | First useful pins |
|---|---|---|---|---|---|---|
| Before | 1× | 1,023–1,103 | 1,212–1,328 | 1,613–1,741 | 1,346–1,489 | 1,890–3,162 |
| After | 1× | 365–452 (one outlier 2,776) | 524–684 | 958–1,112 | 539–700 | 1,758–2,238 |
| Before | 4× | 765–902 | 1,012–1,224 | 1,923–2,158 | 1,859–2,304 | 2,544–3,166 |
| After | 4× | 332–461 | 552–808 | 986–1,255 | 683–956 | 1,537–1,900 |

Relative to HTML received (removes the server gain from not querying 600 rows):
- first discovery request: 1× 323–386 → 167–248; 4× 1,015–1,402 → 330–495;
- first useful pins: 1× 867–2,086 → 771–1,786; 4× 1,700–2,264 → 1,177–1,568;
- first paint → overlay visible: 1× ~400–430 → ~430 (unchanged); 4× 891–961 → 434–447. The overlay now appears ~0.43 s after first paint at either CPU speed (300 ms delay + fade), no longer later on a slower machine.
- main-thread work before the first discovery request: 1× 218–324 → 64–72 ms; 4× 1,121–1,447 → 203–245 ms.

Real desktop Chrome (Browser 1), `dabe0e36`, `?q=janitorial`: DOMContentLoaded **368 ms** (was 708–934), overlay shown with the query, left at first useful pins (2.06 s), settled 3.0 s.

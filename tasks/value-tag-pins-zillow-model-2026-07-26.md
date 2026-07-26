# Value-tag pins (Zillow price-tag model) — 2026-07-26

DECIDED (Eric, from the Zillow for-sale-map screenshot): the opportunity map should show
**value-tag pins**, NOT clustering. Zillow does not cluster — it shows a dense field of PRICE-TAG
pins overlapping on purpose; the number ON the pin is the pin, and the wall of numbers triggers
comparison/emotion. We over-corrected to marker clustering; the right model is value-on-the-pin.
GOS rule: "VALUE-ON-THE-PIN (Zillow price tags), not clustering" (MINDY-OPERATING-THESIS.md).

**HELD until the geocoding build (`feat/real-city-geocoding-board-wide`) lands + merges** — real-city
placement is the prerequisite (value tags in a fake state-centroid ring = a wall of numbers in the
wrong place). Build on top of real cities + the 4-dataset dropdown.

## What to build
1. **Replace plain circle-dot markers with value-TAG pins.** Each pin is a small rounded label (Zillow
   teardrop/tag style) showing the dataset's emotion-number, in the dataset/set-aside color:
   - **Opportunities (Open)** → the **M-Estimate™** (the value range's median, compact: "$222K",
     "$1.3M"). Opps rarely carry a stated value, so M-Estimate is the number. If no estimate → a small
     neutral dot (don't fabricate a price).
   - **Awarded / Recompetes** → **contract value** ("$837M", "$1.3M") — already on the row (`o.value`).
   - **Companies** → **$ won** ("$65.7B", "$25.8B") — already on the row (`total_obligated`).
   - **Gov Buyers** → these have no $ → keep a labeled dot (name/agency on hover), NOT a value tag.
   - Format compact: $Nk / $N.NM / $N.NB. Right-size the tag; long numbers must not blow out the pin.
2. **Overlap is allowed — do NOT cluster by default.** Remove the `markerClusterGroup` default; render
   tags directly in a layer. They can overlap like Zillow. Selected/hovered tag comes to front
   (z-index) and enlarges slightly. Keep the popup-on-click + feed-select behavior.
3. **Clustering demoted to the far-zoom edge case ONLY** — at country/region zoom where even tags
   can't fit, optionally collapse to a light count-bubble ("340 here"), releasing to value tags as you
   zoom to metro/street. This is the ONLY clustering that remains. (Simplest v1: just render value
   tags always + let them overlap; add the far-zoom count-bubble as a fast-follow if the continent
   view is unusable. Prove it with the real data first.)
4. **Color still encodes set-aside / source** (the existing legend: SDVOSB green, 8(a) purple, etc.,
   and the recompete/source colors) — the tag's background or border carries it, the text carries the $.

## Constraints / notes
- Map render lives in `template-html.ts` (served) + `template.html` (source, keep in sync) + `route.ts`
  inline JS (marker build loop, `cardHTML`/`popupHTML`, the render fn). `repl()`/replacer injections
  only, no raw `$`. `.fscroll` no overflow; filter-bar-overflow guard green.
- This SUPERSEDES the Phase-0 `markercluster` PR (#461) approach — replace the cluster container with
  the value-tag layer. Keep the honest "N in view" count from #461.
- The M-Estimate median for opps must come from the same `intel_value_range` already on the row/detail
  — don't recompute; if the map's opp objects don't carry it yet, thread it through (the map API
  `opportunity-map/route.ts` select).
- tsc clean; unit tests + guard green. Marketing literature updated. Isolated worktree.
- KEEP node_modules symlink until AFTER git push (pre-push gate runs tsc/vitest).

## Sequence
geocoding build merges → THIS build (value-tag pins on real cities) → the map finally reads like
Zillow: a scannable field of $ numbers at real locations, the number triggering the bid/pursue emotion.

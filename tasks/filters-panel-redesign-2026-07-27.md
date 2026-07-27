# Filters panel redesign — UNPAUSED + re-done on current main (2026-07-27)

**Eric:** the Opportunity Map Filters panel "is sparse compared to Zillow, different fonts,
plus we need more stuff better organized." Then: "we need to unpause."

## Status: branch `feat/filters-panel-density` (pushed, needs preview visual-verify → merge)
The ORIGINAL paused branch (`fix/filters-placeholder-and-redesign`) was **15 commits behind main**
after this session's map work merged — merging it would have conflicted with / reverted newer code.
So it was **deleted** and the still-needed fixes were re-applied fresh on current main.

### DONE on `feat/filters-panel-density`
1. **Placeholder bug (was STILL live in main).** NAICS/PSC used `“...”` JS-escapes inside an
   HTML `placeholder=` attribute → literal `“construction`. → plain text.
2. **Removed the duplicate `.mf-sec` rule.** A base `.mf-sec` (uppercase/faint) competed with the
   deep-panel header (`.mfpanel-deep .mf-sec`, 800/13px ink). Every `.mf-sec` is inside `.mfpanel-deep`,
   so the base was dead + the source of "different fonts". One header now.
3. **Density.** Group headers get a hairline top-divider (Zillow separation); margins 26→18, grid gaps
   16/20→13/18, input/chip padding tightened. Gate-green, 99/99 tests.

### STILL TO DO (finish with the screenshot loop)
- Visual-verify the density on the preview (open `moreBtn`); tighten/loosen by eye vs the Zillow ref.
- Reorg: the groups (Show · Codes · Buyer · Location · Only show · Set-aside · Notice type · Timing ·
  How this buyer buys · Recompete signals · Contract value · Refine) — consider tighter logical order /
  2-col packing of short related controls.
- Optional "more stuff": ONLY measured-populated columns (no dead controls). Prior audit: competition
  type / # offers are NULL from the awards feed (not viable). Candidates: PoP-vs-office state, has-SOW.

### Resume
1. Preview → screenshot the open panel → compare to Zillow (dense, divider-separated, one header style).
2. Iterate CSS by eye; re-screenshot.
3. `node scripts/check-drawer-js.mjs` + `npx tsc --noEmit` + `npx vitest run src/app/opportunity-map/`.
4. Merge → deploy → verify on getmindy.ai.

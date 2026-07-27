# Filters panel redesign — HANDOFF (paused 2026-07-27, waiting on Vercel)

**Eric:** the Opportunity Map Filters panel "is sparse compared to Zillow, some text is different
fonts, plus I feel like we need more stuff better organized."

## State: branch `fix/filters-placeholder-and-redesign` (2 commits, pushed, NOT merged)
Paused because Vercel's preview queue was stuck 5-10 min all session — the density/reorg pass needs a
before/after screenshot loop, so it was deferred rather than blind-guessed. Everything committed is
gate-green + tsc clean.

### DONE (committed, needs preview-verify then merge)
1. **Bug fix — broken placeholder text.** NAICS/PSC placeholders used `\\u201C...\\u201D` (JS unicode
   escapes) inside an HTML `placeholder=` ATTRIBUTE → the browser rendered the literal `“construction`.
   HTML attributes don't do JS escapes. → plain text ("e.g. 236220 or a word like construction").
   (route.ts ~line 108-109.)
2. **Typography unified.** There were TWO competing `.mf-sec` rules — `.mfpanel-deep .mf-sec` (bold ink)
   and a base `.mf-sec` (uppercase faint, ~line 415). Now ONE consistent group header (13.5px/800 ink),
   non-italic "(any selected)" em in faint grey. (route.ts ~line 359.)
3. **Tighter + divider-separated groups.** Group gaps 26px→18px; each group sits under a hairline
   top-divider (Zillow-style separation), grid row-gap 16→14.

### STILL TO DO (the "more density + better organized" pass — DO WITH SCREENSHOTS)
- Density: Zillow packs more per screen; our panel still has generous whitespace. Tighten further but
  DON'T overshoot into cramped — verify visually.
- Reorganization: the 10 groups (Show · Codes · Buyer · Location · Only show · Set-aside · Notice type ·
  Timing · Contract value · Refine) are loosely ordered. Consider tighter logical grouping / 2-col
  packing of related short controls.
- Optional (Eric said "more stuff" — SCOPE FIRST): only add filters backed by real, measured-populated
  columns (no dead controls). Candidates to MEASURE before adding: competition type, number of offers
  (both NULL from the USASpending awards feed per prior audit — likely NOT viable), PoP-vs-office state
  toggle, has-SOW.

### How to resume
1. Deploy branch preview, screenshot the panel (open `moreBtn`), compare to the Zillow reference
   (dense, divider-separated, consistent headers).
2. Do the density/reorg CSS with the eye; re-screenshot each iteration.
3. Verify: `node scripts/check-drawer-js.mjs` (MUST be clean — client JS is a template literal, tsc
   can't see syntax errors inside it), `npx tsc --noEmit`, `npx vitest run src/app/opportunity-map/`.
4. Merge, deploy prod, verify on getmindy.ai.

## Related shipped this session (context)
Top bar is now: Active · Value · Agency · Industry · Filters. Set-aside + Notice type moved INTO this
Filters panel (top-bar pills removed). So the Filters panel is now the ONLY home for set-aside, notice
type, NAICS/PSC codes, agency free-text, state, country, docs/contact, timing, value — it carries more
weight now, which is why the organization matters more.

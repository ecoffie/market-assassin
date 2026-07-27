# PRD — Industry-first selector (the universal dropdown across all boards)

**Status:** proposed, awaiting Eric's go. Cross-app change. Grounds in existing code — minimal new logic.

## The problem (Eric, 2026-07-27)
Real people don't think in codes. They say **"I do construction," "I'm a manufacturer," "I do cyber,"
"I do janitorial"** — never "I do 238220." Today the map's primary selector is a **"NAICS or PSC code"
pill** that:
1. Is mislabeled — says "NAICS" but accepts codes AND free text.
2. Is redundant — NAICS lives in BOTH the top pill AND the Filters panel.
3. Forces the code-first mental model on a code-averse user.

This contradicts our own doctrine (CLAUDE.md): *"NAICS is the WRONG primary key… keyword is the
discovery key; NAICS is auto-derived invisibly."* We just never surfaced it in the UI.

## The decision (Eric)
- **The dropdown = INDUSTRY.** Human rollups (Construction / Manufacturing / IT / Cyber / Professional
  Services…). One industry rolls up MANY NAICS under the hood. This is the UNIVERSAL primary selector
  across all boards (map + app panels).
- **NAICS + PSC = Filters panel ONLY** — code-specific, for the pro who wants exact codes. KEEP them
  there (already done, #502). REMOVE the redundant NAICS top-pill.
- **Keyword = the refiner.** "Construction → painting / paving / flooring." "Manufacturer → aluminum
  windows." "Cyber → RMF." The Industry sets the lane; the keyword narrows within it.

## What already exists (REUSE — do not rebuild)
- **`src/lib/industry-presets.ts`** — `INDUSTRY_PRESETS` (12 industries): `{label, name, codes[],
  description}`. e.g. Construction → [236,237,238]; IT Services → [541511-9]; Cybersecurity →
  [541512,541519,518210]; Manufacturing; Professional Services → [541]; Healthcare; Logistics &
  Supply; Facilities & Maintenance; Training & Education; Medical Supplies; Products & Wholesale;
  Office & Industrial Supplies. **This IS the dropdown's data.**
- **`src/lib/market/profile-from-text.ts`** — turns "I do construction" → codes (the text→code bridge).
- **The map endpoints already accept `naics`** — so Industry just expands its preset codes into the
  existing `naics=` param (comma-joined). NO new backend: Industry is a UI rollup over the code filter.
- `src/lib/opportunities/map-filters.ts` naics handling (3-4 digit = prefix, 6 = exact) already
  supports the 3-digit rollups the presets use (236/237/238).

## Design

### The Industry dropdown (replaces the NAICS pill on every board)
- A pill labeled **"Industry"** (default "All industries"). Opens a list of the 12 preset industries
  (label + one-line description + emoji already in the presets). Single-select v1 (multi = fast-follow).
- On pick: expand `preset.codes` → set the existing `naics` filter param (comma-joined) → refetch.
  The map/panel already knows how to filter by those codes. **Zero new query logic.**
- The pill shows the chosen industry name ("Construction"), not codes. "Clear" → All industries.

### Keyword refiner (already present as the search box — just position it as the "narrow within")
- The existing search box (`q`) is the keyword refiner. No change needed to wiring; optionally add a
  hint under the Industry pill: "Narrow with a keyword — e.g. painting, aluminum windows, RMF."

### NAICS + PSC — Filters panel only (already shipped)
- #502 put working NAICS + PSC (+ state/value/agency) INSIDE the Filters panel per dataset. Keep as-is.
- REMOVE the `naicsInput` "NAICS or PSC code" top-pill from `route.ts` (lines ~183-184) — the Industry
  dropdown takes its place; precise codes live in Filters. (Also kills the `3–` escaping bug in
  the old pill's hint text.)

### "Advanced: enter a code" path
- For the pro who knows their code: the Filters panel's NAICS/PSC inputs ARE that path. The Industry
  dropdown can carry a small "or enter a NAICS/PSC code in Filters →" affordance. (PR #503's
  NaicsAutocompleteInput becomes the code-entry UX inside Filters — decide when we get there.)

## Scope / rollout
1. **Map first** (the board Eric is looking at): replace the NAICS pill with the Industry dropdown;
   verify the 12 industries each filter correctly (count moves). Preview-verify.
2. **Then the app panels** that have a NAICS pill/selector as their PRIMARY axis (onboarding, alerts
   signup, Market Research, Recompetes, Forecasts, Contractors…) — Industry becomes the primary; the
   existing NAICS field demotes into "advanced/Filters." One board at a time, each preview-verified.
3. PR #503 (NAICS autocomplete) folds in as the code-entry UX inside Filters — not the primary selector.

## Non-negotiables
- Ground: Industry → codes strictly from INDUSTRY_PRESETS (real NAICS), never invented. Keyword is the
  user's own text. No fabricated mapping.
- The 12 presets may not cover every business — keep a "Filters → NAICS/PSC code" escape hatch for the
  long tail (a niche manufacturer whose exact code isn't in a preset). Never trap the user.
- Measure: after wiring, prove each industry's code-set actually returns results (a preset that yields
  0 on the map is a bad preset — fix the codes, don't ship a dead industry).

## DECIDED (Eric, 2026-07-27)
- **Single-select v1**, multi-select as a fast-follow.
- **Ship the 12 presets as-is**; refine labels/verticals after seeing it live (Cyber/IT 541512 overlap
  accepted for v1).
- **Map first**, then roll the same Industry dropdown to the app panels (onboarding, alerts signup,
  Market Research, Recompetes, Forecasts, Contractors) one at a time.
- Keyword refiner: keep the existing top search box for now (don't relocate in v1).

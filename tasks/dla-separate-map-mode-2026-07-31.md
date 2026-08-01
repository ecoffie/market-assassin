# DLA as its own map mode (3rd dropdown) — decided 2026-07-31

## Decision (Eric)
Pull DLA OUT of Opportunities → make it the **3rd top-level map mode**, sibling to
Opportunities and Players. **Remove the Source dropdown** (redundant once DLA is its own
mode) → frees toolbar space.

Toolbar: `[Opportunities ▾] [Players ▾] [DLA ▾]` (was: Opps/Players + a Source dropdown
that mixed DLA into opps).

## WHY (the real reason — segmentation, not just UI)
Two different client profiles, two different jobs:
- **DLA map = the BID client** — supply contractor pricing NSN parts to quote on DIBBS.
  Wants: reference price anchor, part#, qty, response-due. Tactical/transactional.
- **Opportunities map = the MARKET-RESEARCH client** — BD studying money flow, incumbents,
  recompetes. Strategic.
Mixing clutters both (a cybersecurity BD person doesn't want 7,400 screw/valve bids; a DLA
bidder doesn't want $500M recompetes). Separating makes each map coherent for its user.
"Cap the view to the job." Ties to [[mindy_zillow_product_design]] + [[map1_two_axis_pin_system]].

## DLA mode's own filter dropdown = FSC supply class (Eric picked)
`DLA ▾`: All supply classes · 5305 Screws · 5340 Hardware · 4310 Compressors · … — from the
NSN data (nsn.identity FSC + item names). The axis a DLA bidder thinks in ("I supply X").
Replaces the toolbar space the Source dropdown freed.

## Build scope (once NSN BQ deploy lands)
- Add DLA as a 3rd map MODE in opportunity-map/route.ts (the mode toggle system alongside
  Opps/Players). DLA mode fetches ONLY dibbs_rfqs pins (not merged with SAM/etc).
- REMOVE the Source dropdown + its `__srcFilter`/onSourceChange wiring (SBIR already removed).
  Opportunities mode = SAM/Recompete/Forecast/Grants via the existing Horizons dropdown; DLA
  is no longer one of its sources.
- DLA-mode dropdown = FSC supply class multi-select, counts from the data. Filters pins by fsc.
- The DLA drawer (renderDla + NSN reference price, just shipped) stays — it's the DLA-mode pin's detail.
- Horizons dropdown is Opportunities-only; Players keeps its Companies/Gov-Buyers; DLA gets FSC.

## CLARIFIED (Eric): filter slots are CONTEXTUAL per mode — not a global replace
"Industry menu replaced by FSC menu" = **per-mode swap**, NOT global removal:
- **DLA mode:**   `[DLA ▾] [FSC ▾] [Agency ▾] [Value ▾] [Sort ▾]` — the Industry(NAICS)
  slot shows **FSC supply classes** (NAICS is meaningless for DLA parts).
- **Opps mode:**  `[Opportunities ▾] [Horizons ▾] [Industry(NAICS) ▾] [Agency ▾] …` — Industry
  STAYS NAICS (BD market-research users need it).
- **Players mode:** unchanged (Companies/Gov Buyers + its filters).
The toolbar filter SLOT is the same; its CONTENTS switch by active mode. Do NOT remove
NAICS/Industry globally — only DLA mode substitutes FSC for it.

Toolbar filters visible per mode:
| slot        | Opportunities | Players        | DLA          |
|-------------|---------------|----------------|--------------|
| mode toggle | Opportunities | Players        | DLA          |
| horizons    | Horizons ▾    | —              | —            |
| industry    | Industry(NAICS)| Industry(NAICS)?| **FSC ▾**   |
| agency      | Agency ▾      | Agency ▾       | (buying office?) |
| value       | Value ▾       | Value ▾        | (drop? DLA has no $ range) |
| source      | **REMOVED**   | REMOVED        | REMOVED      |
(open Qs marked ? — resolve during build: does DLA need Agency/Value, or just FSC + Sort?)

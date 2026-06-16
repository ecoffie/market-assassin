# CTA Tagger Audit — false positives before mass-drain (June 15, 2026)

**Why:** Before draining ~30K untagged active opps (the AFWERX/CTA demo feed), a dry-run
found the rules-based tagger mislabels heavily. Mass-tagging now = 30K confidently-wrong
tags. This audit quantifies the problem across all 14 Critical Technology Areas so the fix
is grounded, not guessed. (Companion: `AFWERX-SBIR-READINESS.md` Tier 2.1–2.2.)

## Coverage as found
- 94,950 total opps · **1,902 stamped (2.0%)** · 610 tag rows. Active feed: 31,281 opps,
  **1,654 stamped (5.3%)**. HTTP backfill stalled (FUNCTION_INVOCATION_TIMEOUT, ~50-100/min).
- Tags live in `opportunity_cta_tags` (notice_id→cta_id); `sam_opportunities.cta_tagged_at`
  is the processed-stamp. There is no `cta_codes` column; `active` column (not `is_active`).

## The root bug
`tagOpportunityForCta` (definitions.ts) tags **`confidence:'high'` on a NAICS-anchor match
ALONE**, and anchors are NAICS prefixes. `advanced_materials` anchors on **3-digit 325/331/332**
→ NAICS 332994 (Small Arms Ammunition) matches `332` → a **rifle is tagged "Advanced
Materials," HIGH confidence.** Demo-killer: a DAF expert judging the CTA filter sees rifles
under composites.

## Audit — anchor-match vs. keyword corroboration (ACTIVE opps)
| CTA | Anchor-tags | Real title-kw hits | Risk |
|---|---|---|---|
| **advanced_materials** | **5,445** | **0** | 🔴 BROKEN — 3-digit anchors; ~99.8% false |
| directed_energy | 872 | 345 | 🟡 high count but keyword-corroborated |
| microelectronics | 717 | 42 | 🟡 |
| network_systems | 615 | 10 | 🟡 541330 Engineering Svcs over-broad |
| human_machine | 571 | 12 | 🟡 541330/334290 over-broad |
| integrated_sensing_cyber | 509 | 23 | 🟡 541512/541519 IT catch-alls |
| trusted_ai | 405 | 18 | 🟡 541511/541512 IT catch-alls |
| hypersonics | 380 | 0 | 🟡 uncorroborated |
| futureg | 267 | 19 | 🟢 |
| renewable_energy | 276 | 10 | 🟢 |
| advanced_computing | 173 | 0 | 🟡 IT catch-alls, 0 keyword hits |
| quantum | 233 | 8 | 🟢 |
| biotechnology | 70 | 0 | 🟢 small |
| space_tech | 48 | 32 | 🟢 specific anchors, well-corroborated |

## Patterns
1. **advanced_materials** = catastrophic (3-digit prefixes). Single worst offender.
2. **Broad consulting/IT NAICS reused across CTAs**: `541330` (Engineering Svcs),
   `541511/541512` (Custom Programming), `334290` (Other Comm Equip). One opp gets tagged
   for several CTAs on NAICS alone, none keyword-corroborated.
3. **hypersonics + advanced_computing** = 0 keyword hits → anchor tags entirely uncorroborated.

## Recommended fix (one structural change, fixes the whole class)
Demote bare-NAICS matches on BROAD anchors. A NAICS-anchor match gets `high` ONLY when the
anchor is specific (≥5-6 digits) OR a keyword also hits; a broad-anchor-only match becomes
`medium`/`low` (or is dropped from the tagged set used by the feed). Collapses
advanced_materials 5,445→~13 and tightens the 541330/IT catch-all cluster WITHOUT hand-editing
14 anchor lists. Then re-run the local drain (`scripts/drain-cta-tags.ts`) on clean rules.

## Status
- [x] Audit complete (this doc)
- [x] Fix tagger matching — broad anchor (≤4-digit) alone = `low`; promoted to high/medium
      only with keyword corroboration; specific anchors (≥5-digit) keep `high` (`definitions.ts`)
- [x] Feed filter only surfaces high/medium (`getNoticeIdsForCtaFilter` `opportunity-tags.ts`)
- [x] Re-dry-run: rifle (332994) → `low`/suppressed; advanced_materials false positives gone
- [x] Reset 1,654 old-logic active opps + their stale tag rows
- [x] Local drain ALL active opps (`scripts/drain-cta-tags.ts`) — **31,281 active = 100% processed**
- [ ] Deploy the tagger + feed-filter code (DB tags already correct; feed needs the filter live)
- [ ] Spot-check demo-relevant opps in the live feed after deploy

## Round 2 — catch-all 6-digit anchors (June 16, 2026)

Post-deploy spot-check found a SECOND tier of false positives: the round-1 fix trusted any
≥5-digit anchor on NAICS alone, but several 6-digit codes are vendor-INDUSTRY catch-alls, not
capability proof — they tagged a fire sprinkler as "Directed Energy" (334516/541330) and a
forestry BPA as "AI" (541511/541715). Added `WEAK_ANCHORS` (definitions.ts) — empirically
chosen catch-all codes (high active volume and/or reused across ≥2 CTAs): 541330, 334290,
541512, 541713, 541511, 541715, 541519, 336414, 334516, 334419. A match on these needs keyword
corroboration like a broad anchor; only genuinely specific anchors (334413 Semiconductors,
333611 Turbines, …) keep `high` on NAICS alone.

**Re-drained all active. Verified June 16:** sprinkler/boiler/forestry/eDNA-samplers/coagulation/
cable-assembly/biological-containment/rifle → all NONE (suppressed). What's SHOWN is now real:
directed_energy = turbine blades + "Directed Energy Deposition"; trusted_ai = "Artificial
Intelligence", "MRI Computer Vision"; microelectronics = "Semiconductor Device", "Microcircuit".

## Result (June 16, 2026 — round-2 drain complete)
- ACTIVE **32,470 · 100% processed**. Tags: **1,135 SHOWN (high+med)** · 10,268 suppressed.
  968 distinct opps shown. All 14 CTAs populated; shown tags defensible (specific NAICS or
  keyword-corroborated). The tighter rule suppresses far more (correctly) than round 1.

## Result (June 15, 2026 — round-1 drain, superseded by round 2)
- ACTIVE opps **31,281 · 100% processed** (was 5.3%). Tag rows 10,861 → **5,290 SHOWN
  (high+medium)** · 5,571 suppressed (`low`). 596 distinct active opps show a CTA tag.
- **advanced_materials: 5,444 `low` (suppressed) vs 55 shown** — the rifle/metal/ordnance
  false positives are written but never surface. All 14 CTAs populated with defensible counts
  (directed_energy 164, microelectronics 129, network_systems 124, …).

**Note on `match_source`:** the `opportunity_cta_tags` table has a CHECK constraint allowing
only `naics`/`keyword_title`/`keyword_description` (no in-app DDL — rule #6). The corroboration
level is carried by `confidence`, not a new match_source value, so no migration was needed.

*Grounded in live prod counts, June 15 2026.*

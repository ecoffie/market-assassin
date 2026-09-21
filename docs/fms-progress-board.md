# Federal Market Scanner Progress Board

Working status board for the Federal Market Scanner (FMS).

Use this doc to separate:
- what is already live and usable
- what exists but still needs validation
- what is still blocked
- what we should do next

---

## Overall Status

**Program status:** In progress

**Current maturity estimate:** ~65%

High-level read:
- foundation is real
- several FMS subsystems are already live
- forecast/scraper expansion is the largest unfinished area
- FMS is not yet a single polished product surface

---

## Done

### 1. Spending Intelligence

**Status:** Live

What exists:
- [market-scan/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/market-scan/route.ts)
- live NAICS + state market scan
- spending analysis
- visibility gap logic
- ranked opportunities

Confidence:
- strong base for FMS
- core scanner philosophy is already implemented here

### 2. Agency Intelligence

**Status:** Live

What exists:
- [agency-sources/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/agency-sources/route.ts)
- agency procurement source mapping
- buying pattern guidance
- agency-specific recommendations

Confidence:
- production-usable

### 3. Event Intelligence

**Status:** Live

What exists:
- [federal-events/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/federal-events/route.ts)
- event source catalog
- category filtering
- agency/NAICS relevance logic

Confidence:
- useful today
- still more curated than fully automated

### 4. Recompete Intelligence Base

**Status:** Implemented

What exists:
- [recompete/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/recompete/route.ts)
- recompete query surface
- stats mode
- filtering by agency, NAICS, value, likelihood, timing

Confidence:
- meaningful subsystem exists
- still needs more validation as a core FMS pillar

---

## In Progress

### 5. Forecast Intelligence

**Status:** Built, partially validated

What exists:
- [forecasts/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/forecasts/route.ts)
- admin forecast setup and scraper orchestration
- unified forecast schema
- multi-agency scraper library in [src/lib/forecasts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts)

Current read:
- the forecast system is real
- not all sources are equally production-ready
- strongest sources are suitable earlier than the full source set

Source readiness:
- production candidates: `DHS`, `GSA`
- supervised/manual: `Treasury`, `EPA`, `USDA`, `HHS`
- keep disabled: `VA`, `DOD`

### 6. Forecast/Scraper Reliability Hardening

**Status:** In progress

Already improved:
- deterministic IDs added for scrapers
- `agency=all` persistence fixed
- source health/seeding behavior improved
- clearer failure handling for auth-blocked or partially supported sources

Still needed:
- repeated run validation
- broader source-by-source QA
- clearer launch policy in code/config

---

## Blocked Or Not Yet Finished

### 7. Unified FMS Product Surface

**Status:** Not finished

What is missing:
- a single polished “Federal Market Scanner” user-facing experience
- one top-level product surface that clearly federates:
  - market scan
  - forecasts
  - recompetes
  - events
  - agency intelligence

Right now:
- the parts exist
- they are still mostly separate APIs and product slices

### 8. Forecast Coverage Expansion

**Status:** Blocked by source reliability

Main blockers:
- dynamic agency sites
- auth-gated sources
- brittle selectors
- incomplete file-download ingestion

Most important blocked sources:
- `VA`
- `DOD`

### 9. Launch-Ready FMS Positioning

**Status:** Not finalized

We still need to decide whether FMS v1 should be:
- `Market Scan + Agency Sources + Events + Recompete`
or
- the full scanner including forecasts

Current recommendation:
- ship the stronger scanner core first
- keep forecasts as expanding coverage rather than the center of the launch promise

---

## Recommended V1 Scope

If we wanted to define a clean FMS v1 today:

Include:
- Market Scan
- Agency Sources
- Federal Events
- Recompete Intelligence

Include carefully:
- Forecast Intelligence as a limited/beta coverage feature

Do not rely on for the main launch message yet:
- VA forecasts
- DOD forecast ingestion
- fully automated all-agency scraper coverage

---

## Progress By Area

| Area | Status | Rough Progress |
|------|--------|----------------|
| Market Scan | Live | 85% |
| Agency Sources | Live | 90% |
| Event Intelligence | Live | 80% |
| Recompete Intelligence | Implemented | 70% |
| Forecast Intelligence | Partial | 60% |
| Unified FMS Product | In progress | 50% |
| Full Scanner Vision | In progress | 65% |

---

## Launch Matrix

### 1. Ready For V1

These are the strongest FMS pieces today and can anchor a scoped launch.

APIs and surfaces:
- [market-scan/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/market-scan/route.ts)
- [agency-sources/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/agency-sources/route.ts)
- [federal-events/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/federal-events/route.ts)
- [recompete/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/recompete/route.ts)
- [recompete/page.tsx](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/recompete/page.tsx)

Supporting systems:
- [snapshot-recompetes/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/cron/snapshot-recompetes/route.ts)
- [briefings/recompete](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/briefings/recompete)

Docs:
- [federal-market-scanner.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/federal-market-scanner.md)
- [fms-progress-board.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/fms-progress-board.md)

### 2. Needs Validation

These are promising and implemented enough to keep, but they still need runtime validation or tighter launch policy.

Forecast core:
- [forecasts/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/forecasts/route.ts)
- [forecasts/page.tsx](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/forecasts/page.tsx)
- [setup-forecasts/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/admin/setup-forecasts/route.ts)
- [run-forecast-scraper/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/admin/run-forecast-scraper/route.ts)
- [sync-recompete/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/admin/sync-recompete/route.ts)
- [budget-intel/route.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/app/api/budget-intel/route.ts)

Source-level validation set:
- [dhs-apfs.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/dhs-apfs.ts)
- [gsa-acquisition-gateway.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/gsa-acquisition-gateway.ts)
- [treasury.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/treasury.ts)
- [epa.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/epa.ts)
- [usda.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/usda.ts)
- [hhs.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/hhs.ts)
- [hhs-sbcx.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/hhs-sbcx.ts)

Validation docs and scripts:
- [intelligence-systems/forecasts.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/intelligence-systems/forecasts.md)
- [README.md](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/README.md)
- [run-all-forecast-scrapers.js](/Users/ericcoffie/Market%20Assasin/market-assassin/scripts/run-all-forecast-scrapers.js)
- [run-scrapers-tsx.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/scripts/run-scrapers-tsx.ts)

### 3. Keep Disabled For Now

These should remain out of the main FMS launch promise until the implementation is more trustworthy.

Forecast sources:
- [va-vendor-portal.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/va-vendor-portal.ts)
- [dod-multi-source.ts](/Users/ericcoffie/Market%20Assasin/market-assassin/src/lib/forecasts/scrapers/dod-multi-source.ts)

Why:
- `VA` is auth-blocked and now fails honestly
- `DOD` still needs stronger file/download ingestion and more deterministic sourcing

### 4. Keep, But Don’t Center The Launch Around Yet

These are valuable supporting pieces, but they should not define the core FMS promise right now.

- [PRD-forecast-intelligence.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/PRD-forecast-intelligence.md)
- [PRD-budget-intelligence.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/PRD-budget-intelligence.md)
- [federal-market-intelligence-architecture.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/federal-market-intelligence-architecture.md)
- [budget-intel.md](/Users/ericcoffie/Market%20Assasin/market-assassin/docs/intelligence-systems/budget-intel.md)

---

## Next 3 Milestones

### Milestone 1

Define and commit to FMS v1 scope.

Decision:
- ship with forecasts as beta coverage
or
- wait until forecast coverage is more complete

### Milestone 2

Turn source readiness into explicit policy.

Needed:
- production-safe source list
- admin-only source list
- disabled source list
- docs and config reflecting that policy

### Milestone 3

Create a unified FMS presentation layer.

Needed:
- one surface that combines:
  - spending
  - agency sources
  - events
  - recompetes
  - forecast coverage

---

## Working Conclusion

FMS is no longer just an idea.

It already has:
- a working scanner core
- real intelligence subsystems
- meaningful APIs

What it does not yet have is:
- a fully finished unified product
- fully reliable forecast coverage across all intended agencies

That means the right framing today is:

**FMS is partially live, strategically valuable, and close enough for a scoped v1, but not yet fully complete as the total vision.**

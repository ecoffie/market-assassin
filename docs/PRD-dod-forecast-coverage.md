# PRD: DoD Forecast Coverage — Close Mindy's Biggest Forecast Gap

> Mindy's Forecast Intelligence has **7,824 forecasts but ZERO from the
> Department of Defense** — the single largest federal buyer (~$400B+/yr).
> Add DoD forecast sources so the "what's coming 6-18 months out" view isn't
> blind to the biggest market.

**Status:** Draft / scoping — 2026-06-05. No code yet.
**Trigger:** Eric, after we found DoD opportunities decode cleanly via DoDAAC
but Forecasts is 100% civilian: *"sounds like we need to get some DoD forecast
from somewhere? This seems to be a gap in coverage for Mindy."*
**Related:** Forecast Intelligence (`src/lib/forecasts/`, `agency_forecasts`
table); DoDAAC office decode (`src/lib/gov-contacts/dodaac.ts`).

---

## 1. The gap (measured 2026-06-05)

- `agency_forecasts`: **7,824 rows, 0 DoD.** Live coverage is **DHS + DOE
  only** (the CLAUDE.md "11 agencies / 7,764" reflects a fuller historical
  import; current flowing sources are thinner).
- DoD is **~$400B+/yr** — more than every civilian agency we cover combined.
- Every other Mindy surface now reaches DoD office-level (Decision Makers,
  Alerts, Recompetes, Pipeline via DoDAAC) — but **Forecasts can't see DoD at
  all**, so the "plan ahead" view is blind to the biggest market.

**Why it matters:** forecasts are the *earliest* signal (6-18 months pre-RFP).
A GovCon targeting DoD construction/IT/services gets nothing from Mindy's
forecast view today — the highest-value, longest-lead intel is missing for the
largest buyer.

---

## 2. Where DoD forecasts actually live (the sourcing problem)

DoD does NOT publish one consolidated forecast like civilian agencies do via
acquisition.gov. It's **fragmented across components**, each with its own
Long Range Acquisition Forecast (LRAF) / Advance Procurement Plan:

| Component | Source | Format | Notes |
|---|---|---|---|
| **Army** | Army APBI / ASA(ALT) forecast | web / Excel | Largest; multiple commands |
| **Navy / NAVSEA / NAVAIR / NAVSUP** | Navy LRAF, command-specific | web / PDF | NAVFAC has its own construction forecast |
| **Air Force** | AF/SpaceForce forecast (SBP) | web / Excel | |
| **DLA** | DLA Long Range Acquisition Estimates | Excel | Goods-heavy |
| **DHA / Defense Health** | DHA forecast | web | |
| **SOCOM, DISA, MDA, DARPA** | per-agency forecast pages | mixed | smaller but high-value |
| **DoD OSBP** | osbp.dod.mil aggregates some | links | a starting index, not complete |
| **APEX Accelerators (PTACs)** | aggregate some component forecasts | mixed | secondary source |

There is no single API. This is a **multi-source scraping/import effort**, the
same shape as the existing civilian forecast scrapers (`src/lib/forecasts/
scrapers/` — DHS via Puppeteer works).

---

## 3. Options (ranked)

### Option A — Phase the biggest components first (RECOMMENDED)
Don't boil the ocean. Add DoD components by spend, biggest first:
1. **Army + Navy (incl. NAVFAC) + Air Force + DLA** — these 4 are the bulk of
   DoD spend. Each is one scraper/importer into the existing `agency_forecasts`
   table (same schema, same UI — DoD forecasts just appear in the feed).
2. Then DHA, SOCOM, DISA, MDA, DARPA as follow-on.
- **Effort:** medium per component (mirror the DHS Puppeteer scraper pattern).
- **Value:** high immediately — Army alone is a massive coverage win.

### Option B — Use SAM "Special Notice" / Sources Sought as proto-forecasts
DoD posts Sources Sought / RFIs / Special Notices on SAM 6-12 months pre-RFP.
We ALREADY ingest SAM (`sam_opportunities`). Tag DoD Sources Sought as
"forecast-like" early signals and surface them in the forecast view.
- **Effort:** low (data's already here; it's a query + tag + UI).
- **Value:** partial — these are *earlier-stage solicitations*, not the formal
  LRAF, but they're real forward signal and FREE. Good stopgap / complement.

### Option C — Commercial forecast data (GovTribe/HigherGov-grade)
Buy DoD forecast coverage from a provider that already aggregates it.
- **Effort:** low to integrate; **cost:** licensing.
- **Value:** most complete fastest, but a buy decision + recurring cost.

### Option D — APEX Accelerator / OSBP index scrape
Scrape the DoD OSBP forecast index + APEX aggregations as a single entry point.
- **Effort:** medium; **coverage:** partial (indexes aren't exhaustive).

---

## 4. Recommendation

1. **Now (cheap, immediate):** Option B — tag DoD Sources Sought / RFI / Special
   Notices from the SAM cache as early forecast signals in the Forecast view.
   Closes "Forecasts shows nothing for DoD" today with data we already have.
   Label them honestly as "early signal (Sources Sought)" vs a formal forecast.
2. **Next (real coverage):** Option A — build component scrapers Army → Navy/
   NAVFAC → Air Force → DLA into `agency_forecasts`. Each is a discrete,
   verifiable import; mirror the DHS scraper.
3. **Evaluate:** Option C if speed-to-complete-coverage matters more than the
   licensing cost — a buy, gated on demand.

**Do NOT:** claim "DoD forecast coverage" until at least the big-4 components
(Option A step 1) are flowing. Until then, Option B's tagged early signals are
the honest interim, clearly labeled as such.

---

## 5. Scope

- **In:** new rows in the existing `agency_forecasts` table (DoD components);
  same UI/feed; an "early signal" tag for Option-B SAM-derived items.
- **Out:** schema redesign (the table already holds what we need); a DoD-only
  UI (DoD forecasts belong in the unified forecast feed, filterable by agency).
- **Reuse:** the DoDAAC decoder — once DoD forecasts carry a predecessor/
  solicitation number, they get office-level granularity for free.

---

## 6. Success criteria

- Forecast view returns DoD results (currently 0). Target ≥ the big-4 components.
- DoD forecasts filterable by component (Army/Navy/AF/DLA) in the existing
  agency filter — and, where a contract number exists, office-level via DoDAAC.
- Honest labeling: formal LRAF forecasts vs SAM-derived "early signals."

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | DoD forecast coverage is a real gap (0 of 7,824); write it up as a PRD | Eric |
| 2026-06-05 | Phase by component spend (Army/Navy/AF/DLA first); use SAM Sources Sought as the free interim early-signal | (proposed) |

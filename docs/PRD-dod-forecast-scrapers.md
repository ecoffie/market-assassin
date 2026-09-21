# PRD: DoD Forecast Scrapers (Option A) — Formal LRAF Coverage

> Bring DoD's FORMAL forecasts (component Long Range Acquisition Forecasts)
> into `agency_forecasts`, so the forecast feed has real DoD plan-ahead data —
> not just the SAM "early signals" the interim (Option B) surfaces.

**Status:** Draft / scoping — 2026-06-05. **DO NOT EXECUTE** — queued behind
the current fix list (Eric: "save for after our list of fixes").
**Trigger:** DoD forecast gap (`agency_forecasts` = 0 DoD). Option B (SAM
Sources Sought as early signals) shipped as the interim; this is the real
coverage build.
**Parent:** `docs/PRD-dod-forecast-coverage.md` (the gap + options). This PRD
details Option A only.

---

## 1. Why this exists (Option B isn't enough)

Option B (shipped) surfaces DoD **Sources Sought / RFIs** from SAM — real, but
they're *solicitation-stage* early signals, not the agency's *forecast*. A
formal component LRAF lists planned buys 12-18 months out, often before any SAM
notice exists — the earliest, highest-value signal. Civilian agencies publish
these; DoD does too, but fragmented per component. This PRD ingests them.

**Honest framing already in the UI:** Option-B items are labeled "⚡ Early
signal"; Option-A items will be true "forecast" entries. Both coexist in the
feed, distinguishable.

---

## 2. The sources (each = one scraper/importer)

No single DoD forecast feed. Build per component, **biggest spend first**:

| # | Component | Source (verify URLs at build time) | Format | Priority |
|---|---|---|---|---|
| 1 | **Army** | ASA(ALT) / Army APBI forecast | web / Excel | P0 (largest) |
| 2 | **Navy** (NAVSEA/NAVAIR/NAVSUP) | Navy LRAF + command pages | web / PDF | P0 |
| 3 | **NAVFAC** | NAVFAC construction forecast | web / Excel | P0 (construction-heavy) |
| 4 | **Air Force / Space Force** | AF Small Business forecast | web / Excel | P1 |
| 5 | **DLA** | DLA Long Range Acquisition Estimates | Excel | P1 (goods) |
| 6 | DHA, SOCOM, DISA, MDA, DARPA | per-agency forecast pages | mixed | P2 |

Cross-check the **DoD OSBP index** (osbp.dod.mil) + **APEX Accelerators** as
discovery aids for component forecast URLs (they aggregate links, not data).

---

## 3. Architecture (reuse what exists)

The civilian forecast pipeline already does exactly this shape — mirror it:
- **Target table:** `agency_forecasts` (no schema change — it already holds
  title, agency, naics, fiscal_year, anticipated_quarter, estimated_value,
  set_aside, contracting_office, pop_state, incumbent, poc). DoD rows just flow
  in with `source_agency` = the component.
- **Scrapers:** `src/lib/forecasts/scrapers/` — the DHS Puppeteer scraper is the
  working template. One module per component.
- **Import:** mirror `scripts/import-forecasts.js` / `import-gsa-forecasts.js`.
  Excel sources → SheetJS parse; web → Puppeteer; PDF → existing PDF path
  (NSF importer is the template).
- **Tracking:** `forecast_sources` + `forecast_sync_runs` (already exist) — add
  a row per DoD component for health/coverage.
- **Office granularity:** where a forecast carries a contract/solicitation
  number, the **DoDAAC decoder** (`src/lib/gov-contacts/dodaac.ts`) gives
  office-level for free — already wired into the forecast feed.

**No new tables, no UI rebuild.** DoD forecasts appear in the existing feed,
filterable by the existing agency filter, deduped against Option-B signals by
solicitation/title.

---

## 4. Phasing

- **Phase A1 — Army + Navy + NAVFAC (P0):** the bulk of DoD spend + most
  construction/services. Three scrapers, each verified (row counts sane, NAICS
  populated, no dupes) before the next.
- **Phase A2 — Air Force + DLA (P1).**
- **Phase A3 — DHA/SOCOM/DISA/MDA/DARPA (P2).**
- After each phase: update `forecast_sources` coverage; the feed shows the new
  component immediately.

Migrate one component at a time, verify, then the next — never a big-bang
import (a bad parse pollutes the feed for everyone).

---

## 5. Risks / gotchas

- **Source instability:** component forecast pages move / change format yearly.
  Each scraper needs a health check (forecast_sync_runs) + alert when a source
  returns 0/garbage — don't silently serve stale DoD data.
- **Format variety:** Excel column names differ per component; PDFs are worst.
  Budget per-source parsing/validation; don't assume a shared schema across
  components.
- **De-dup vs Option B:** a forecast and its later SAM Sources Sought may both
  appear. Dedup by solicitation_number when present, else fuzzy title+agency;
  prefer the formal forecast, keep the early signal's "released?" stage.
- **Stale/expired:** forecasts are FY-bound; expire old FY rows or mark them so
  the feed isn't cluttered with last year's plan.

---

## 6. Success criteria

- DoD forecasts present in `agency_forecasts` (currently 0), starting with the
  P0 components.
- Filterable by component in the existing agency filter; office-level via DoDAAC
  where a number exists.
- Each source has a health row; a dead source is visible, not silent.
- Formal forecasts (this PRD) and Option-B early signals coexist, clearly
  labeled, deduped.

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Option B (SAM early signals) is the shipped interim; Option A (component scrapers) is the real coverage. Write Option A as its own PRD, DO NOT execute yet — queue behind the current fix list. | Eric |
| 2026-06-05 | Phase by spend: Army/Navy/NAVFAC first, then AF/DLA, then the rest. Reuse civilian forecast pipeline; no schema/UI rebuild. | (proposed) |
| 2026-06-29 | **VERIFIED REALITY (research + live probing) — the "scrapers" framing is mostly a dead end.** (1) The civilian forecasts were NOT scraped — they come from a file→importer flow (`import-forecasts-live.js` pulls the GSA Acquisition Gateway FCO API + a few agency .xlsx files). The Puppeteer scrapers (incl. `dod-multi-source.ts`) produce ~0 rows; DHS-APFS-JSON is the only real "live" one. (2) **The GSA Acquisition Gateway FCO API contains ZERO DoD rows** — probed all 320 pages / 7,629 records → only DOI, USDA, VA, DOT, GSA, DOL, NRC, NSF. So Eric's chosen "Gateway re-export" path yields no DoD; a DEPT_CODE/DoD-component extension would map 0 rows (not built — would be dead code). (3) DoD component forecast pages are `.mil` behind WAFs (confirmed 403/TLS on Army/Navy/AF) or render via Tableau → not auto-fetchable from our infra OR Vercel. (4) **No consolidated DoD-wide forecast feed exists** (sourced). **Conclusion:** the only non-fragile real-data path is a **manual file → SheetJS importer** per component, mirroring `fetchNASA`/`fetchDOE`. The cleanest single file is the **Air Force LRAF .xlsx** (native structured workbook) — but it needs a one-time manual download (WAF-blocked host). Build the importer WITH the real file in hand (map actual columns), not blind. Until then, Option-B SAM "early signals" remain the DoD coverage. | Eric + research |

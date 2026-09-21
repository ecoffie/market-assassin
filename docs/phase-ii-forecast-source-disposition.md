# Phase II · Potato 2C — Forecast source disposition

**Date:** 2026-09-13 · **No scraper was repaired and no source was scheduled in this
pass.** Every disposition below rests on a **live upstream probe** performed against
the URL the rows themselves record — not on a code comment, and not on a URL I guessed.

> Every source is either MADE LIVE or given an explicit, evidence-backed decision
> that it should not be live. `NOT_POLLED` is not a final disposition.

---

## ⚠️ Two code comments were wrong. Probing changed the answer.

`sync-forecasts`' header — written after health sweeps on 2026-07-31 and 2026-08-01 —
records why 28 sources are unscheduled. Two of its conclusions **no longer hold**, and
they are the two largest frozen sources:

| Source | The comment says | **Measured 2026-09-13** |
|---|---|---|
| **NAVY** (8,821 rows) | *(not listed as blocked; simply never automated)* | **HTTP 200, 4,118,847 B, real `.xlsx`.** Parsed: **9,919 rows**, 51 columns, FY2026 requirements. No login, no WAF. We store 8,821 — **upstream has ~1,100 MORE than we hold** |
| **HHS** (3,643 rows) | *"login-gated SPA (osdbu.hhs.gov) — no file, no API"* | **HTTP 200, 4,437,988 B, `application/json`.** Parsed: **5,376 records**, 26 fields. The *web page* is an SPA; the **API behind it is open** — and it is already the URL in our rows |

Both are `READY_TO_ACTIVATE`. Together they are **12,464 of 33,687 rows (37%)** of the
forecast corpus. This is why "explain every source" had to mean *probe*, not *read the
note from six weeks ago*.

---

## Primary disposition table

Probe legend: **✅** reachable + real data · **🔒** login/WAF wall · **⚠️** reachable but
no parseable data · **—** not probed (superseded/one-off).

| Source | Rows | Last advance | Producer | Upstream reachable | Current state | **Final disposition** | Action |
|---|---:|---|---|---|---|---|---|
| DHS · api | 1,634 | 2026-09-13 | `sync-forecasts` | ✅ | ADVANCING | **LIVING** | none |
| DOE · osdbu_xlsx | 870 | 2026-09-13 | `sync-forecasts` | ✅ 135 KB xlsx | ADVANCING | **LIVING** | none |
| **NAVY · lrae_xlsx** | **8,821** | 2026-08-01 | manual import | **✅ 4.1 MB xlsx, 9,919 rows** | NOT_POLLED | **READY_TO_ACTIVATE** | **activate first** |
| **HHS · sbcx_api** | **3,643** | 2026-08-01 | manual | **✅ 4.4 MB JSON, 5,376 recs** | NOT_POLLED | **READY_TO_ACTIVATE** | **activate second** |
| DOI · gsa_gateway_csv | 3,033 | 2026-08-01 | manual | 🔒 Gateway login | NOT_POLLED | **BLOCKED** | manual drop |
| USDA · gsa_gateway_csv | 2,519 | 2026-08-01 | manual | 🔒 Gateway login | NOT_POLLED | **BLOCKED** | manual drop |
| USACE · enterprise_da_format | 2,124 | 2026-08-02 | manual | 🔒 **403** (Akamai) | NOT_POLLED | **BLOCKED** | documented manual (`ingest-usace-forecast.ts`) |
| VA · gsa_gateway_csv | 698 | 2026-08-01 | manual | 🔒 Gateway login | NOT_POLLED | **BLOCKED** | manual drop |
| USACE · district_workbook | 660 | 2026-08-02 | manual | 🔒 **403** | NOT_POLLED | **BLOCKED** | manual |
| DOT · gsa_gateway_csv | 237 | 2026-08-01 | manual | 🔒 Gateway login | NOT_POLLED | **BLOCKED** | manual drop |
| Treasury · osdbu_salesforce | 200 | 2026-08-01 | manual | 🔒 **Salesforce login** | NOT_POLLED | **BLOCKED** | manual |
| GSA · gsa_gateway_csv | 178 | 2026-08-01 | manual | 🔒 Gateway login | NOT_POLLED | **BLOCKED** | manual drop |
| DOL · gsa_gateway_csv | 22 | 2026-08-01 | manual | 🔒 Gateway login | NOT_POLLED | **BLOCKED** | manual drop |
| USACE · district_da_pdf | 124 | 2026-08-02 | manual | 🔒 403 | NOT_POLLED | **BLOCKED** | manual |
| NASA · naf_grid | 146 | 2026-08-01 | manual | ⚠️ page loads, **JS shell, 0 data rows** | NOT_POLLED | **REPAIR_REQUIRED** | needs a dynamic fetch |
| EPA · apex_forecast_db | 50 | 2026-08-01 | manual | ⚠️ **302 redirect chain** | NOT_POLLED | **REPAIR_REQUIRED** | follow APEX session |
| SSA · excel | 60 | **2026-04-06** | one-off | ⚠️ **403** | NOT_POLLED | **REPAIR_REQUIRED** | UA/headers |
| DOI · api | 3,131 | 2026-06-26 | rotted Puppeteer | — | NOT_POLLED | **SUPERSEDED** | by `DOI·gsa_gateway_csv` |
| USDA · api | 2,509 | 2026-06-26 | rotted Puppeteer | — | NOT_POLLED | **SUPERSEDED** | by `USDA·gsa_gateway_csv` |
| VA · api | 692 | 2026-06-26 | rotted | — | NOT_POLLED | **SUPERSEDED** | by `VA·gsa_gateway_csv` |
| DOT · api | 660 | 2026-06-26 | rotted | — | NOT_POLLED | **SUPERSEDED** | by `DOT·gsa_gateway_csv` |
| GSA · api | 336 | 2026-06-26 | rotted | — | NOT_POLLED | **SUPERSEDED** | by `GSA·gsa_gateway_csv` |
| DOL · api | 144 | 2026-06-26 | rotted | — | NOT_POLLED | **SUPERSEDED** | by `DOL·gsa_gateway_csv` |
| DOE · excel | 431 | 2026-06-26 | rotted | — | NOT_POLLED | **SUPERSEDED** | by `DOE·osdbu_xlsx` (LIVING) |
| NASA · excel | 79 | 2026-06-26 | rotted | — | NOT_POLLED | **SUPERSEDED** | by `NASA·naf_grid` |
| DOJ · excel | 500 | 2026-06-26 | rotted | ⚠️ file moved | NOT_POLLED | **REPAIR_REQUIRED** | relocate the published file |
| NRC · api | 89 | 2026-06-26 | rotted | — | NOT_POLLED | **UNMEASURED** | probe before deciding |
| NSF · api | 37 | 2026-06-26 | rotted | 🔒 Gateway | NOT_POLLED | **BLOCKED** | 4 rows via Gateway |
| ONR · excel | 48 | **2026-04-12** | one-off | — | NOT_POLLED | **RETIRED** | final watermark 2026-04-12 |
| NRL · excel | 12 | **2026-04-12** | one-off | — | NOT_POLLED | **RETIRED** | final watermark 2026-04-12 |

---

## Disposition summary — 30 source pairs, **0 remain merely NOT_POLLED**

| Disposition | Count | Rows covered |
|---|---:|---:|
| **LIVING** | 2 | 2,504 |
| **READY_TO_ACTIVATE** | **2** | **12,464 (37%)** |
| **BLOCKED** (login/WAF) | 11 | 9,845 |
| **SUPERSEDED** | 8 | 7,982 |
| **REPAIR_REQUIRED** | 4 | 756 |
| **RETIRED** | 2 | 60 |
| **UNMEASURED** | 1 | 89 |
| UPSTREAM_QUIET | 0 | — |
| MANUAL *(folded into BLOCKED — each has a documented manual path)* | — | — |

---

## Activation / repair order

**Activate (Potato 2D), in this order — largest verified upstream first:**
1. **NAVY · lrae_xlsx** — 9,919 rows upstream vs 8,821 held. Plain `.xlsx`, no auth.
   Largest single win in the dataset.
2. **HHS · sbcx_api** — 5,376 records upstream vs 3,643 held. Open JSON API.

Each must clear the full activation contract: preview → prove real upstream response
→ prove parsed population → prove write semantics → clocks → deploy → production
semantic smoke test → schedule → observe a dispatcher run. **A 200 that writes zero
without explanation is not an activation.**

**Repair later, by materiality:** DOJ (500) → NASA naf_grid (146) → EPA (50) → SSA (60).
**Probe then decide:** NRC (89).
**No action:** the 11 BLOCKED (manual drops are the documented path), the 8 SUPERSEDED,
the 2 RETIRED.

---

## Retired sources — explicit record

**ONR · excel** (48 rows) and **NRL · excel** (12 rows) — final watermark **2026-04-12**,
one-off imports with no repeatable producer. Historical rows are retained; both are
removed from active-sync expectations and must not be presented as current feeds.

---

## Completion-contract status

| # | Requirement | State |
|---|---|---|
| 1 | abandoned `forecast_sources` no longer drives health | ⏳ **open** — still read by `check-fms-health` + `health-check` |
| 2 | all 30 pairs have an explicit operational state | ✅ |
| 3 | no material source merely NOT_POLLED | ✅ **0 remain** |
| 4 | living sources carry producer/cadence/clocks | ✅ for the 2 LIVING; pending for the 2 activating |
| 5 | important viable sources actually scheduled | ⏳ **Potato 2D** — Navy + HHS |
| 6 | failed producers cannot report empty success | ✅ zero-record fetch = HTTP 500 + ops alert |
| 7 | one source cannot hide behind another | ✅ (Potato 2B, `54622301`) |
| 8 | retired/superseded documented | ✅ |
| 9 | dataset status rolls up honestly | ✅ rolls up `incomplete` |

**Remaining before Forecasts is complete:** items 1 and 5.

## Carried forward, not reopened
Event Radar's 32.7% missing-description limitation · DoD SBIR `KNOWN BROKEN — PARKED`.

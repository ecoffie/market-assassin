# Phase II · Potato 2 — Forecasts per-source advancement

**Date:** 2026-09-13 · **Measurement + observability only. No scraper was repaired.**
Every figure re-derived from live data; the "21 sources" literal was **not** trusted.

> Stop one healthy forecast source from making the entire dataset look fresh while
> another source is dead.

---

## Source population (re-derived)

Derived from `GROUP BY source_agency, source_type` over `agency_forecasts` — the
identifiers actually written into the rows, not a hand-maintained list.
**30 distinct (agency, source_type) pairs across 21 agencies**, 33,687 rows.

`LAST SOURCE ADVANCE` is **`unmeasured` for every source**: `last_synced_at` is
Mindy's *write* time, and no forecast source exposes a publication clock in what we
store. Inventing freshness from a write timestamp is exactly what this Potato forbids.

| Source | Producer | Rows | Last write (Mindy) | Last source advance | State |
|---|---|---:|---|---|---|
| DHS · api | `sync-forecasts` cron | 1,634 | **2026-09-13** | unmeasured | **ADVANCING** |
| DOE · osdbu_xlsx | `sync-forecasts` cron | 870 | **2026-09-13** | unmeasured | **ADVANCING** |
| NAVY · lrae_xlsx | manual import | **8,821** | 2026-08-01 | unmeasured | **NOT_POLLED** |
| HHS · sbcx_api | manual (login-gated SPA) | 3,643 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| DOI · api | rotted Puppeteer | 3,131 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| DOI · gsa_gateway_csv | manual | 3,033 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| USDA · gsa_gateway_csv | manual | 2,519 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| USDA · api | rotted Puppeteer | 2,509 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| USACE · enterprise_da_format | manual (Akamai WAF) | 2,124 | 2026-08-02 | unmeasured | **NOT_POLLED** |
| VA · gsa_gateway_csv | manual | 698 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| VA · api | rotted | 692 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| USACE · district_workbook | manual | 660 | 2026-08-02 | unmeasured | **NOT_POLLED** |
| DOT · api | rotted | 660 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| DOJ · excel | rotted | 500 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| DOE · excel | superseded by osdbu_xlsx | 431 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| GSA · api | rotted | 336 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| DOT · gsa_gateway_csv | manual | 237 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| Treasury · osdbu_salesforce | manual | 200 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| GSA · gsa_gateway_csv | manual | 178 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| NASA · naf_grid | manual | 146 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| DOL · api | rotted | 144 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| USACE · district_da_pdf | manual | 124 | 2026-08-02 | unmeasured | **NOT_POLLED** |
| NRC · api | rotted | 89 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| NASA · excel | rotted | 79 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| SSA · excel | one-off | 60 | **2026-04-06** | unmeasured | **NOT_POLLED** |
| EPA · apex_forecast_db | manual | 50 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| ONR · excel | one-off | 48 | **2026-04-12** | unmeasured | **NOT_POLLED** |
| NSF · api | rotted | 37 | 2026-06-26 | unmeasured | **NOT_POLLED** |
| DOL · gsa_gateway_csv | manual | 22 | 2026-08-01 | unmeasured | **NOT_POLLED** |
| NRL · excel | one-off | 12 | **2026-04-12** | unmeasured | **NOT_POLLED** |

**Totals — 30 pairs:** ADVANCING **2** · NOT_POLLED **28** · INGEST_BROKEN **0** ·
UPSTREAM_QUIET **0** · UNMEASURED **0** *(as source states; every source's upstream
advance clock is separately unmeasured)*.

---

## Aggregate masking demonstration

```
MAX(last_synced_at) over agency_forecasts   = 2026-09-13   ← dataset "looks fresh"
sources that wrote on 2026-09-13            = 2 of 30
sources frozen 30+ days                     = 28 of 30
largest single source (NAVY, 8,821 rows)    = last wrote 2026-08-01
```

**Two live sources drag the maximum forward and conceal twenty-eight.** Proven in
`forecast-source-advancement.unit.test.ts` with the real figures, then proven again
by injection: restoring the max-timestamp rollup turns **4 tests red**, including
*"one healthy source can NEVER make the dataset healthy on its own."*

---

## ⚠️ Frozen is NOT broken — the important correction

The 28 frozen sources are **deliberately unscheduled and documented**.
`sync-forecasts`'s own header records a health sweep of all 9 registered scrapers
(2026-07-31) and a second sweep of all 13 stale sources (2026-08-01): HHS is a
login-gated SPA, VA/DOT migrated behind the GSA Gateway login, USACE sits behind an
Akamai WAF, and DOI/USDA/DOJ/GSA/DOL/NASA had rotted Puppeteer scrapers.

They were left unscheduled **on purpose** — *"scheduling them would create jobs that
'succeed' while importing nothing."* That is the correct instinct, and it is why
`NOT_POLLED` exists as a first-class state rather than being reported as
`ingest_broken`. **Zero sources are actually broken.**

---

## Zero-row sources

**None.** All 30 pairs hold rows. The zero-row problem lives one layer up — see below.

---

## The most important defect found

**`forecast_sources` — the per-source registry — is abandoned and actively wrong.**

| Reality | `forecast_sources` says |
|---|---|
| 33,687 rows across 30 pairs | **`total_records: 0` on all 11 rows** |
| DHS writes daily | `is_active: false` |
| DOE writes daily | `last_sync_at: 2026-04-06` |
| 30 source pairs exist | only **11** rows, none matching the real `source_type` values |

`data_sources[forecast_intelligence].notes` literally says *"See forecast_sources
table for per-source detail."* The live `sync-forecasts` cron **never writes it** —
but **two health crons READ it**: `check-fms-health` and `health-check` both select
`total_records`, `last_success_at`, `last_failure_at`, `consecutive_failures`.

**So forecast health has been evaluated against abandoned data since April.** This is
the same class as the DoD SBIR finding: a monitor reporting on a table nobody feeds.

---

## Latest run reconstruction

For the 2026-09-13 13:00 run, per source:

| Dimension | DHS | DOE | the other 28 |
|---|---|---|---|
| attempted | yes | yes | **no — not scheduled** |
| fetch success | yes (wrote) | yes (wrote) | n/a |
| upstream items observed | **unmeasured** | **unmeasured** | n/a |
| qualifying items | **unmeasured** | **unmeasured** | n/a |
| writes attempted | yes | yes | no |
| destination changed | yes | yes | no |
| source watermark | **unmeasured** | **unmeasured** | **unmeasured** |

The run's own per-source counts are **not persisted**, so upstream/qualifying volumes
are `unmeasured` for this cycle. That is reported as `unmeasured`, not reconstructed
from the cron's aggregate `success`.

---

## Persistence added/reused

**None added.** `forecast_sources` already carries every column a source receipt
needs — `last_sync_at`, `last_success_at`, `last_failure_at`, `consecutive_failures`,
`total_records`, `is_active`. Creating a parallel forecast-only monitoring subsystem
would repeat the mistake that produced the abandoned table in the first place.

**Recommendation (not done here):** make `sync-forecasts` write `forecast_sources`
per source, and reconcile its 11 rows against the 30 real pairs. That is a repair,
and repairs are out of scope for this Potato.

---

## Dataset rollup semantics

Forecasts stays **one** logical dataset. Status **derives** from source states — no
average, no percentage, no max timestamp:

```
any ingest_broken              -> degraded    (a dead source can never be hidden)
else any unmeasured/not_polled -> incomplete  (the gap is disclosed, not averaged away)
else                           -> healthy
```

**Today Forecasts rolls up to `incomplete`** — 2 advancing, 28 not polled — where the
old aggregate said fresh.

---

## Findings requiring later repair (NOT done here)

1. **`forecast_sources` is abandoned and read by two health crons** — highest impact.
2. **28 of 30 sources have no scheduled collector**; 92% of the corpus (30,000+ rows)
   is maintained by hand. A product decision, not a bug.
3. **Three sources last wrote in April** (SSA, ONR, NRL) — effectively one-off imports.
4. **No forecast source exposes an upstream publication clock**, so real upstream
   advancement is unmeasurable for all 30.

## Carried forward, not reopened

**Event Radar:** 32.7% of active candidates (1,962 of 5,994) lack descriptions, so
classification runs on partial text. Recorded as a known evidence-quality limitation.
**DoD SBIR:** remains `KNOWN BROKEN — PARKED`.

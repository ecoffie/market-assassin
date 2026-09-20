# Mindy Data Source Control Plane — Phase I

**Date:** 2026-09-13 · **Scope:** Phase I only. **No repairs. No Phase III interpretation.**
Every figure re-derived from machine evidence (live Supabase / BigQuery / `cron_jobs`)
on the date above. The prior "46 sources" figure was **not** carried forward.

> Before Mindy interprets government change, Mindy must prove it is reliably
> **seeing** government change.

**The rule this document obeys:** a cron reporting `success` is **not** evidence that
data advanced. The three clocks are kept apart everywhere below.

---

## Primary table — material sources

`LAST POLL` = job ran · `LAST SOURCE ADVANCE` = upstream's own newest content ·
`LAST INGEST` = Mindy actually wrote rows. Blank = **not measurable today**, which is
itself a finding (never read as "fresh").

### PROCUREMENT

| Logical dataset | Source | Destination | Producer | Cadence | Last poll | Last source advance | Last ingest | Records | Status | Product dependency |
|---|---|---|---|---|---|---|---|---:|---|---|
| SAM opportunities | SAM.gov API | `sam_opportunities` | `sync-sam-opportunities` ×3 | daily (full/delta/resume) | 09-13 13:00 ✓ | 2026-09-13 | 09-13 13:00 | **206,340** | **LIVING** | Opportunity Map, alerts, Today's Intel, listings, SEO |
| Awards / spending | USASpending → BigQuery | `usaspending.awards` | `sync-usaspending-awards` | weekly `0 4 * * 0` | 09-13 04:00 ✓ | **2026-09-04** | 09-06 | **64,797,069** | **LIVING** | market intel, incumbents, competition, contractor profiles |
| Recompetes | USASpending | `recompete_opportunities` | `sync-recompete-contracts` | hourly `25 * * * *` | 09-13 13:25 | n/a (PoP dates) | 09-13 13:28 | **172,118** | **LIVING** | Recompetes panel, MCP, briefings |
| Forecasts | 21 agency sources | `agency_forecasts` | `sync-forecasts` | daily `0 13 * * *` | 09-13 13:00 ✓ | 2026-09-12 | 09-13 13:00 | **33,687** | **LIVING** (see per-source caveat) | Forecasts panel, map layer, MCP |
| Contractors / recipients | USASpending → BQ | `recipients`, `recipients_rollup_merged` | `refresh-bq-rollups` | monthly `0 8 5 * *` | 09-05 08:00 | — | — | **320,799 / 296,445** | **PARTIAL** — no advance clock | /contractors, ContractorsPanel, MCP |
| Buying offices | DoDAAC decode | `dodaac_directory` | `refresh-dodaac-directory` | monthly `0 9 6 * *` | 09-06 09:00 | — | — | **4,826** | **PARTIAL** — no advance clock | office anchoring, contacts |
| Decision makers | SAM POCs | `federal_contacts` | `sync-gov-buyer-data` | rolling | — | — | — | **247,113** | **UNMEASURED** — no clock at all | Decision Makers panel, buyer cards, MCP |
| Recipient certs | SAM entity | `recipient_certifications` | `backfill-recipient-certs` | hourly `40 * * * *` | 09-13 13:40 | — | — | **24,899** | **PARTIAL** | set-aside eligibility |

### STRATEGIC / RESEARCH

| Logical dataset | Source | Destination | Producer | Cadence | Last poll | Last source advance | Last ingest | Records | Status | Product dependency |
|---|---|---|---|---|---|---|---|---:|---|---|
| GAO reports | gao.gov RSS | `institute_sources` | `institute-gao-sync` | daily `20 12 * * *` | **09-13 13:18 ✓** | **2026-09-10** | **09-13 09:21** | **25** | **LIVING** | Institute corpus, pain points |
| Federal Register | federalregister.gov API | *none* | `federal-register/index.ts` (passthrough) | per-request | — | live (09-14 observed) | — | 0 | **READY_TO_ACTIVATE** | MCP `get_regulatory_demand` only |
| Agency intelligence | GovInfo GAO + USASpending | `agency_intelligence` | `/api/admin/sync-agency-intel` (**no cron**) | manual | 09-13 08:33 (a repair edit) | **2000-09-27** | manual | **556** | **PARTIAL / MANUAL** | buyer detail, company detail, opp intel |
| Agency pain points | GAO + NDAA, hand-merged | `src/data/agency-pain-points.json` (**in the build**) | `merge-agency-intelligence.js`, hand-run | quarterly | — | **2026-08-01** | n/a (deploy) | **3,032** | **MANUAL** | market research, customer reports |
| Agency priorities | budget prose, hand-curated | same JSON | same | quarterly | — | 2026-08-01 | n/a | **2,658** | **MANUAL** | same |
| Budget authority | OMB + CBJ, hand-pasted | `src/data/agency-budget-data.json`; `agency_budget_authority` **0 rows** | none (admin route returns JSON, writes nothing) | — | — | **2026-02-18** | — | 47 agencies | **MANUAL (stale)** | budget API, MCP trends |
| Inspector General | — | — | **none** | — | — | — | — | 0 | **MISSING** | — |
| Legislation / enacted law | — | — | **none** (`api.congress.gov` = 0 files) | — | — | — | — | 0 | **MISSING** | — |
| Appropriations | — | — | **none** | — | — | — | — | 0 | **MISSING** | — |
| NDAA | GovInfo | static corpus text | `~/Bootcamp/scan-ndaa-sections.py` (**outside the repo**) | ad hoc | — | Jan 2026 | — | 46 points | **MANUAL** | 46 legacy pain points |
| Strategic plans | — | — | **none** | — | — | — | — | 0 | **MISSING** | — |

### PRE-PROCUREMENT / EVENTS

| Logical dataset | Source | Destination | Producer | Cadence | Last poll | Last source advance | Last ingest | Records | Status | Product dependency |
|---|---|---|---|---|---|---|---|---:|---|---|
| Event Radar | SAM special notices | `sam_events` | `extract-sam-events` | daily `0 7 * * *` | 09-13 07:00 ✓ | — | **2026-09-12 07:00** | **4,945** (only **508** upcoming) | **LIVING** ⚠️ | map events, target research |

⚠️ **The job ran 09-13 07:00 and reported `success`, but the newest `extracted_at` is
09-12.** Either nothing qualified or the write silently no-opped — **today's run
produced no rows and the status cannot tell us which.** Exactly the ambiguity Phase I
exists to surface.

### REFERENCE / TAXONOMY

| Logical dataset | Source | Destination | Producer | Cadence | Last advance | Records | Status |
|---|---|---|---|---|---|---:|---|
| NAICS vocabulary | census/curated | `naics_vocabulary` | has a `refreshed_at` clock | — | — | **25,252** | **PARTIAL** — GREEN data, **no `data_sources` row**, so unmonitorable |
| Agency identity | `agency-toptier-codes.json` (49), `agency-aliases.json` (454) | static | hand-curated | — | — | 49 / 454 | **MANUAL** |
| PSC | crosswalk lib | static | — | — | — | — | **MANUAL** |

### SPECIALTY (parked — measured, not reopened)

| Logical dataset | Destination | Producer | Cadence | Last poll | Records | Status |
|---|---|---|---|---|---:|---|
| DIBBS | `dibbs_rfqs` | `sync-dibbs` | daily `0 8 * * *` | 09-13 08:00 ✓ | **48,385** | **LIVING** (grew from 895 — the paid token landed) |
| Grants | `grants_cache` | `sync-grants` | daily `0 9 * * *` | 09-13 09:00 ✓ | **2,126** | **LIVING** |
| DoD SBIR | `dod_sbir_topics` | `sync-dod-sbir` | `0 */6 * * *` | 09-13 12:00 ✓ | **0** | **INGEST_BROKEN** ⚠️ |
| Multisite (NIH/DARPA/NSF) | `multisite_sources` | 3 snapshot crons | daily | 09-13 04:00–06:00 ✓ | — | **PARTIAL** |

⚠️ **`sync-dod-sbir` reports `success` every six hours into a table holding ZERO rows.**
Verified three ways: the route's own header says it "upserts into `dod_sbir_topics`";
`cron_job_runs` shows **HTTP 200, status `success`, empty error** on every run back
through 09-12; `count(dod_sbir_topics) = 0`. This is the headline Phase I finding —
**cron success is not data advancement**, and here the gap is total.

---

## Summary — 27 material sources

| State | Count | Which |
|---|---:|---|
| **LIVING** | **8** | SAM opportunities · awards · recompetes · forecasts · GAO · Event Radar* · DIBBS · Grants |
| **READY_TO_ACTIVATE** | **1** | Federal Register |
| **PARTIAL** | **6** | contractors · buying offices · recipient certs · agency intelligence · NAICS vocabulary · multisite |
| **MANUAL** | **5** | pain points · priorities · budget authority · NDAA · agency identity/PSC |
| **MISSING** | **4** | IG · legislation/enacted law · appropriations · strategic plans |
| **INGEST_BROKEN** | **1** | DoD SBIR (success into an empty table) |
| **UNMEASURED** | **2** | decision makers (247,113 rows, no clock) · Event Radar's today-gap |

\* Event Radar is LIVING as a collector but carries an unexplained one-day ingest gap.

---

## Logical dataset vs source — the hiding problem

**Forecasts is one logical dataset over 21 upstream sources** (Navy LRAE 8,821 · DOI
6,164 · USDA 5,028 · HHS 3,643 · USACE 2,908 · DHS · VA · DOE · DOT · GSA · DOJ ·
NASA · Treasury · DOL · NRC · SSA · EPA · ONR · NSF · NRL …).

`sync-forecasts` reports one status for all 21. **A dead Navy scraper is invisible
while USDA advances** — the aggregate `max(last_synced_at)` stays fresh. Per-source
advancement is not measurable today. Same structural risk for multisite (3 sources,
3 crons) and SAM (3 sync modes, one table).

---

## Provenance status

| Level | Sources |
|---|---|
| **Full** (url + date + resolution receipt) | GAO (`institute_sources`) |
| **Partial** (source named, no per-record citation) | SAM · awards · recompetes · forecasts · events · DIBBS · grants |
| **None** (claims with no citable source) | pain points (**0 of 3,032 carry a URL**) · priorities (**0 of 2,658**) · budget authority |

---

## Monitoring coverage

Only **13 of 27** sources have a `data_sources` row, and only **2** encode clocks
(`institute_gao`, `bq_awards`). **Fourteen sources cannot be flagged stale even in
principle** — for them, silence and absence are indistinguishable.

---

## Phase II activation queue (smallest first)

**No repairs were made in this pass.** Ranked by evidence, not preference:

| # | Action | Why first |
|---|---|---|
| **1** | **DoD SBIR: `success` into 0 rows** | The only outright **INGEST_BROKEN**. A job asserting success while writing nothing is the worst state in the table — it is actively misleading |
| **2** | **Event Radar's one-day gap** | Same class, smaller: `success` at 07:00 with no row newer than 09-12. Determine whether it no-opped or genuinely had nothing |
| **3** | **Clocks for the 14 unmonitorable sources** | Configuration, not code: a `data_sources` row + clock block. Until then most of the estate cannot be proven stale |
| **4** | **Per-source forecast advancement** | One dead scraper of 21 is invisible today |
| **5** | **Decision makers (247,113 rows, no clock)** | Large, customer-facing, entirely unmeasured |
| **6** | **Federal Register activation** | The only READY_TO_ACTIVATE source; adapter written and parked on `feat/institute-federal-register`, deliberately **not merged** |
| **7** | **Budget authority** (stale since 2026-02-18) | Needs a real producer; the admin route fetches a different thing and writes nothing |

---

## Explicitly deferred — Phase III

Causation vs correlation · Demand Formation Chains · emerging/mandated/funded/buying
stages · cross-source inference · "Why Now?" · lead-time prediction · strategic
scoring · advanced contractor daily reads · UI visualization.

Timestamps and provenance are being preserved now so those become possible later.
**None of it is being solved now.**

## Work parked by this course correction

`feat/institute-federal-register` — the FR adapter, admission gate (tuned against a
real 200-document batch: 18/200 admitted), collector route and 16 tests are **pushed
but unmerged and unscheduled**. It is Phase II item #6, not Phase I.

---

## INTERNAL DATA FIRST AUDIT — CANDIDATES

Sources still on a live public API (or mixed path) that should be evaluated for
warehouse-first measurement the same way `get_keyword_coverage` moved to BigQuery
`usaspending.awards`. **Candidates only — not this change.**

| Candidate | Current source | Why it's a candidate | Status |
|---|---|---|---|
| `codeMarketSize()` (`src/lib/market/keyword-coverage.ts`) | Live USASpending `spending_by_category` | Same honesty class as keyword coverage was: API miss can look like a small/empty market; grain and FY window disagree with BQ action obligations | **CANDIDATE** — left on the live API in the keyword-coverage BQ cutover |
| Keyword-coverage Senses v2 (`industry_title`, `product_psc`) | Not wired | Named in `keyword-coverage-bq.ts`; do not implement until interpretation is a separate product | **HOLD** |


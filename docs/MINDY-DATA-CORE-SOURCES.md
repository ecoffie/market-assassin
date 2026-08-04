# Mindy Data Core — Source Map

**Purpose:** (1) document provenance of every dataset, and (2) prove the moat —
*how many separate places a competitor would have to pull from, in how many
formats, across how many agencies, to recreate Mindy.*

> **Headline:** ~998,000 measured records assembled from **34 distinct external
> sources**, in **6 delivery formats** (REST API · Excel · CSV · PDF · scraped
> HTML · BigQuery bulk), spanning **300+ federal agencies** — then normalized,
> scored, embedded, and joined to one market. Plus **5 live passthrough sources**
> that add reach without adding rows. No single feed gives you this; the
> unification *is* the product.

Live counts: `/api/admin/data-inventory?password=$ADMIN_PASSWORD` (admin page at
`/admin/data-inventory`). Source registry: `src/lib/data-sources/registry.ts`.

**Counts below verified live 2026-08-04.** Re-check before citing anything older
than a month — the corpus grows weekly and stale figures undersell it.

---

## The measured corpus

| Dataset | Records | Provenance |
|---|---:|---|
| Contractor database | 317,135 | curated |
| Decision makers | 192,832 | curated |
| SAM opportunities (cache) | 152,025 | cache |
| Recompetes (expiring contracts) | 148,375 | curated |
| Semantic-indexed opportunities | 138,298 | **exclusive** |
| Forecasts (upcoming buys) | 33,097 | **exclusive** |
| Buying-office directory (DoDAAC) | 4,813 | curated |
| Event Radar | 3,492 | curated |
| Agency pain points | 3,045 | **exclusive** |
| Agency spending priorities | 2,658 | **exclusive** |
| Knowledge base (RAG) | 1,386 | **exclusive** |
| Agency intelligence | 557 | **exclusive** |
| Budget authority | 47 | curated |
| **Total measured** | **997,760** | |

**By provenance:** 179,041 exclusive · 666,694 curated · 152,025 cached.

**Live passthrough (no stored rows, queried per request):** Federal grants
(Grants.gov) · SBIR/STTR (NIH RePORTER + SBIR Multisite) · Pricing intel (GSA
CALC+, ~240K awarded labor categories) · Incumbent financials (SEC EDGAR
companyfacts) · Regulatory demand (Federal Register). These contribute **0** to
the 997,760 — the headline undercounts what Mindy actually reaches.

---

## 1. Forecasts — 33,097 records · 21 agencies · 12 source formats

Each agency publishes its procurement forecast in its *own* place and format.
There is **no unified federal forecast feed** — we built it. This is the single
most fragmented dataset we carry, and the clearest moat.

| Agency | Source type | Records |
|---|---|---:|
| NAVY | LRAE xlsx | 8,821 |
| HHS | SBCX API | 3,643 |
| DOI | API | 3,131 |
| DOI | GSA Gateway CSV | 3,033 |
| USDA | GSA Gateway CSV | 2,519 |
| USDA | API | 2,509 |
| USACE | Enterprise DA format | 2,124 |
| DHS | API | 1,015 |
| DOE | OSDBU xlsx | 870 |
| VA | GSA Gateway CSV | 698 |
| VA | API | 692 |
| USACE | District workbook | 660 |
| DOT | API | 660 |
| DOJ | Excel | 500 |
| DOE | Excel | 431 |
| GSA | API | 336 |
| DOT | GSA Gateway CSV | 237 |
| Treasury | OSDBU Salesforce | 200 |
| GSA | GSA Gateway CSV | 178 |
| NASA | NAF grid | 146 |
| DOL | API | 144 |
| USACE | District DA PDF | 124 |
| NRC | API | 89 |
| NASA | Excel | 79 |
| SSA | Excel | 60 |
| EPA | APEX forecast DB | 50 |
| ONR | Excel | 48 |
| NSF | API | 33 |

**12 distinct source formats:** `lrae_xlsx`, `sbcx_api`, `api`,
`gsa_gateway_csv`, `enterprise_da_format`, `osdbu_xlsx`, `district_workbook`,
`excel`, `osdbu_salesforce`, `naf_grid`, `district_da_pdf`, `apex_forecast_db`.

Scrapers live in `src/lib/forecasts/scrapers/`.

## 2. Pain Points (3,045) + Priorities (2,658) — hand-curated · 307 agencies · 5 research corpora

Not an API anywhere. Curated by reading government oversight documents per agency.

| Source corpus | Role |
|---|---|
| **GAO reports** | Dominant source (referenced 900+ times) — findings, high-risk list |
| **IG audits** | Agency Inspector General findings |
| **CRS analyses** | Congressional Research Service |
| **FY2025–26 budget justifications** | Where funded priorities come from |
| **Agency strategic plans** | Stated priorities |
| **NDAA** | Authorized program direction |

Plus a **live** layer (`agency_intelligence`, 557 records): **GovInfo API** → GAO
high-risk records · **USASpending API** → contract-pattern records.

## 3. Recompetes — 148,375 · USASpending Awards API

Source: **usaspending.gov** `spending_by_award` (contracts >$25K with end dates;
FPDS retired Feb 2026). Our value-add: identify expiring → score likelihood →
resolve incumbent → quality-quarantine bad $ values.
(`src/app/api/admin/sync-recompete`)

## 4. Contractor Database — 317,135 · 3 sources

| Source | Format | Role |
|---|---|---|
| **USASpending recipients** | BigQuery bulk (`market-assasin.usaspending.recipients`) | The 317K base |
| **SBA Prime Directory FY24** | sba.gov CSV | SBLO contacts / small-biz enrichment (~3,500) |
| **SAM.gov Entity API** | REST | UEI/CAGE lookups |

## 5. Decision Makers — 192,832 · SAM POCs + DoDAAC decode

| Source | Role |
|---|---|
| **SAM.gov POCs** | Contracting officer / POC directory, synced daily → `federal_contacts` |
| **DoDAAC directory** | FPDS/BigQuery-derived office decode → buying-office rosters (3+ people) |

Backed by the **buying-office directory** (4,813) — the decoded DoD/agency
contracting offices behind the raw codes.

## 6. SAM Opportunities (cache) — 152,025 · SAM.gov Opportunities API

Source: **sam.gov** Opportunities API, mirrored to `sam_opportunities`.

## 7. Semantic-Indexed Opportunities — 138,298 · our embeddings

SOW and description text from the SAM cache → **OpenAI `text-embedding-3-small`**
(1536-dim) → `sow_embedding`. Breakdown: **18,156 SOW · 79,178 description**.
Powers `hidden-match` (finds opportunities the keyword/NAICS filters miss). The
*index* is exclusively ours.

## 8. Knowledge Base (RAG) — 1,386 documents · 12,382 searchable passages

8 years of teaching corpus + **743 podcast interviews** + winning proposals.
Powers Mindy Chat and Proposal Assist grounding. Exclusively ours — this one
cannot be sourced at any price.

## 9. Event Radar — 3,492 · SAM Special Notices, DoDAAC-decoded

Industry days and sources-sought notices, decoded to the **real buying command**
rather than the notice's parent department.

## 10. Budget Authority — 47 · OMB / USASpending toptier budgets

Toptier agency budget trends — which agencies are winning and losing money.

## 11. Live passthrough sources (queried per request, 0 stored rows)

| Source | Surfaced as | Note |
|---|---|---|
| **Grants.gov API** | Federal grants | Queried live per search |
| **NIH RePORTER + SBIR Multisite** | SBIR / STTR | Queried live per search |
| **GSA CALC+** | `get_pricing_intel` (MCP) | ~240K awarded labor categories · price-to-win |
| **SEC EDGAR companyfacts** | `get_incumbent_financials` (MCP) | Public filers only |
| **Federal Register** | `get_regulatory_demand` (MCP) | "Demand before SAM" leading indicator |

## 12. Supporting datasets

- **Agency Hierarchy & Aliases** — SAM.gov Federal Hierarchy API (official org
  structure) + 450 internal abbreviation mappings (`agency-aliases.json`).
- **NAICS Buyer Vocabulary** — 25,252 terms. The real WORDS federal buyers use
  per NAICS, mined from live USASpending award descriptions and cleaned by
  cross-NAICS TF-IDF (a term appearing across too many codes = filler, dropped).
  Table `naics_vocabulary`, built by `scripts/build-naics-vocabulary.ts`, read via
  `src/lib/market/vocabulary.ts`. The *derivation* is exclusively ours.

---

## "To recreate Mindy" — the tally

A competitor would have to independently build and maintain:

| Category | Distinct sources |
|---|---|
| **Government APIs** | USASpending · SAM Opportunities · SAM Entity · SAM Federal Hierarchy · SAM POCs · SAM Events · Grants.gov · GovInfo · Federal Register · SEC EDGAR · GSA CALC+ · NIH RePORTER — **12 API systems** |
| **Agency forecast sources** | 21 agencies across 12 distinct source formats — each its own site, auth, and parser |
| **Oversight research corpora** | GAO · IG · CRS · budget justifications · strategic plans · NDAA — **6**, read per agency across 307 agencies |
| **Commercial / 3rd-party** | SBA Prime Directory · DSBS · OpenAI embeddings · BigQuery USASpending bulk |
| **Curated internal** | DoDAAC decode · agency aliases · SBLO contacts · 8-yr teaching corpus · 743 podcast interviews |

**34 distinct sources · 6 delivery formats · 300+ agencies · 1 embedding model**
— then normalized, scored, embedded, and resolved to a single market.

**Build cost to date:** 1,101,201 lines across 3,013 commits —
534,699 code · 314,200 curated data · 152,333 assets · 99,969 docs.

*That* is the slurpee.

---

## Known drift

- `sourceTrace.forecastsByAgency` in `/api/admin/data-inventory` reports **7,731**
  forecasts against the live table's **33,097**. That block sums hardcoded
  `recordCount` values in `src/lib/data-sources/registry.ts`, which have not been
  updated as scrapers landed. The dataset count (33,097) is a live query and is
  correct; the registry's per-source numbers are stale. Fix by making
  `getRegistrySummary()` read live counts, or by refreshing the registry.
- The registry also still lists HHS, Treasury, EPA and USDA as *pending*. All four
  are live and carry records (HHS 3,643 · USDA 5,028 · Treasury 200 · EPA 50).

---

*Live counts from `/api/admin/data-inventory`; provenance tracked here.
Verified 2026-08-04.*

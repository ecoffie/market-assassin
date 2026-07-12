# Mindy Data Core — Source Map

**Purpose:** (1) document provenance of every dataset, and (2) prove the moat —
*how many separate places a competitor would have to pull from, in how many
formats, across how many agencies, to recreate Mindy.*

> **Headline:** ~596,000 records assembled from **~25–30 distinct external sources**,
> in **6 different formats** (REST API · Excel · CSV · PDF · scraped HTML · BigQuery
> bulk), spanning **300+ federal agencies** — then normalized, scored, embedded, and
> joined to one market. No single feed gives you this; the unification *is* the product.

Live counts: `/api/admin/data-inventory`. Source registry: `src/lib/data-sources/registry.ts`.

---

## 1. Forecasts — 7,824 records · 12 active agency feeds · 7 portals · 4 formats

Each agency publishes its procurement forecast in its *own* place and format. There
is **no unified federal forecast feed** — we built it.

| Agency | Portal | Format | Records |
|---|---|---|---|
| DOJ | justice.gov | Excel | 3,140 |
| DOI | GSA Acquisition Gateway | CSV | 2,039 |
| DOE | energy.gov | Excel | 833 |
| DHS | dhs.gov/procurement-forecast | Puppeteer scraper | 683 |
| NASA | nasa.gov | Excel | 294 |
| VA | GSA Acquisition Gateway | CSV | 268 |
| GSA | GSA Acquisition Gateway | CSV | 164 |
| NRC | GSA Acquisition Gateway | CSV | 79 |
| DOT | GSA Acquisition Gateway | CSV | 68 |
| SSA | ssa.gov | Excel | 60 |
| NSF | nsf.gov | PDF | 56 |
| DOL | GSA Acquisition Gateway | CSV | 47 |

**Distinct portals:** justice.gov, energy.gov, nasa.gov, ssa.gov, nsf.gov, dhs.gov,
GSA Acquisition Gateway (7). **Pending (5 more):** HHS (procurementforecast.hhs.gov),
Treasury (osdbu.forecast.treasury.gov), EPA (ordspub.epa.gov), USDA
(forecast.edc.usda.gov), DOD (multi: Army/Navy/Air Force/DISA). Scrapers live in
`src/lib/forecasts/scrapers/`.

## 2. Pain Points (3,045) + Priorities (2,611) — hand-curated · 307 agencies · 5 research corpora

Not an API anywhere. Curated by reading government oversight documents per agency.

| Source corpus | Role |
|---|---|
| **GAO reports** | Dominant source (referenced 900+ times in the data) — findings, high-risk list |
| **IG audits** | Agency Inspector General findings |
| **CRS analyses** | Congressional Research Service |
| **FY2025–26 budget justifications** | Where funded priorities come from |
| **Agency strategic plans** | Stated priorities |

Plus a **live** layer (`agency_intelligence` table): **GovInfo API** → 446 GAO
high-risk records · **USASpending API** → 111 contract-pattern records.

## 3. Recompetes — 6,660 active / 9,481 total · USASpending Awards API

Source: **usaspending.gov** `spending_by_award` (contracts >$25K with end dates;
FPDS retired Feb 2026). Our value-add: identify expiring → score likelihood →
resolve incumbent → quality-quarantine bad $ values. (`src/app/api/admin/sync-recompete`)

## 4. Contractor Database — 317,135 · 3 sources

| Source | Format | Role |
|---|---|---|
| **USASpending recipients** | BigQuery bulk (`market-assasin.usaspending.recipients`) | The 317K base |
| **SBA Prime Directory FY24** | sba.gov CSV | SBLO contacts / small-biz enrichment (~3,500) |
| **SAM.gov Entity API** | REST | UEI/CAGE lookups |

## 5. Decision Makers — 142,135 · SAM POCs + DoDAAC decode

| Source | Role |
|---|---|
| **SAM.gov POCs** | Contracting officer / POC directory, synced daily → `federal_contacts` |
| **DoDAAC directory** | FPDS/BigQuery-derived office decode → buying-office rosters (3+ people) |

## 6. SAM Opportunities (cache) — 104,085 · SAM.gov Opportunities API

Source: **sam.gov** Opportunities API, mirrored to `sam_opportunities`.

## 7. Semantic-Indexed Opportunities — 9,572 · our embeddings

SOW text from the SAM cache → **OpenAI `text-embedding-3-small`** (1536-dim) →
`sow_embedding`. Powers `hidden-match` (finds opportunities the keyword/NAICS
filters miss). The *index* is exclusively ours.

## 8. Grants — live · Grants.gov API

Source: **grants.gov** REST API (queried per search; passthrough).

## 9. Events — SAM.gov + APEX + SBA + GSA

SAM.gov Events API · APEX Accelerators (apexaccelerators.us, 50+ local events) ·
SBA events · GSA events.

## 10. Agency Hierarchy & Aliases — 450+ · SAM Federal Hierarchy + internal

SAM.gov Federal Hierarchy API (official org structure) + 450 internal
abbreviation mappings (`agency-aliases.json`).

## 11. NAICS Buyer Vocabulary — 25,252 · USASpending award text + our TF-IDF

The real WORDS federal buyers use per NAICS, mined from **live USASpending award
descriptions** (top awards per code) and cleaned by **cross-NAICS TF-IDF** (a term
appearing across too many codes = filler, dropped). Table `naics_vocabulary`, built
by `scripts/build-naics-vocabulary.ts`, read via `src/lib/market/vocabulary.ts`.
Powers keyword→NAICS lead selection, onboarding "buyers also say" terms,
recompete/forecast work-word chips, and alert keyword expansion. The *derivation*
(which words are distinctive to which code) is exclusively ours. Planned as a Tier-1
Data Core chat tool (`get_market_vocabulary`, Phase 2 — see
`tasks/PRD-mindy-chat-data-core.md`).

---

## "To recreate Mindy" — the tally

A competitor would have to independently build and maintain:

| Category | Distinct sources |
|---|---|
| **Government APIs** | USASpending · SAM Opportunities · SAM Entity · SAM Federal Hierarchy · SAM POCs · SAM Events · Grants.gov · GovInfo — **8 API systems** |
| **Agency forecast portals** | 7 live (+5 pending) — each its own site + format |
| **Oversight research corpora** | GAO · IG · CRS · budget justifications · strategic plans — **5**, read per agency across 307 agencies |
| **Commercial / 3rd-party** | SBA Prime Directory · DSBS · OpenAI embeddings · BigQuery USASpending bulk |
| **Curated internal** | DoDAAC decode · agency aliases · SBLO contacts |

**≈ 25–30 distinct sources · 6 formats (REST, Excel, CSV, PDF, scraped HTML,
BigQuery) · 300+ agencies · 1 embedding model** — then normalized, scored,
embedded, and resolved to a single market. *That* is the slurpee.

---

*Generated from `src/lib/data-sources/registry.ts` + `/api/admin/data-inventory`.
Update counts there; this doc tracks provenance + the recreate-cost story.*

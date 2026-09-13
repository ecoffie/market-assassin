# Strategic Intelligence — Source Control Plane

**Date:** 2026-09-13 · **Status:** report only. **No source was activated.**
Measured live against production; nothing below is inferred from prose.

GAO is the first proven living Institute source. This establishes ONE source
contract and states, for every other strategic signal, the shortest path into it.
**We are not building ten pipelines.**

---

## 1. Canonical Source Contract

A source is LIVING when all six hold. GAO is the reference implementation
(`src/lib/institute/sources.ts`, `src/app/api/cron/institute-gao-sync/route.ts`).

| # | Requirement | GAO's answer |
|---|---|---|
| 1 | **Discovery** — a machine-readable feed with a stable per-document id | `gao.gov/rss/reports.xml` → `GAO-26-108092` |
| 2 | **Provenance** — url + publication date survive ingestion (`source_url NOT NULL`) | 25/25 documents carry a URL |
| 3 | **Agency identity** — resolved ONLY via `resolveAgency()`; unresolved stays unresolved | 15 resolved / 10 unresolved, no fan-out |
| 4 | **Destination** — lands in `institute_sources`, `UNIQUE(source_type, document_number)` | 0 duplicates after repeated runs |
| 5 | **Derivation is separate** — evidence may produce NO claim | 12 of 25 evidence-only |
| 6 | **Advancement is observable** — four distinct clocks; failure reports as itself | poll advanced while the other three held |

**Where operational metadata belongs — no fourth registry:**

```
data_sources        what the source is + clocks (in notes)   ← reuse, INSERT only
cron_jobs           how/when collection runs                 ← reuse, INSERT only
institute_sources   the documents actually collected
intelligence_changes what interpretation changed, and why
C1 advancement      whether the source is really moving
docs/               human runbook + methodology
```

---

## 2. Source Coverage Matrix

Measured 2026-09-13. "Last advance" = the real data clock, not a job clock.

| Source | Fetcher? | Scheduled? | Destination | Last poll | Last source advance | Last Institute ingest | Last intel change | Status |
|---|---|---|---|---|---|---|---|---|
| **GAO** | ✅ RSS | ✅ `20 12 * * *` | `institute_sources` | 2026-09-13 13:18 ✓success | 2026-09-10 | 2026-09-13 09:21 | 2026-09-13 09:21 | **LIVING** |
| **Federal Register** | ✅ `federal-register/index.ts` | ❌ no cron | *none durable* — only a 1h TTL row in `mcp_external_cache` | per-request | live (2026-09-14 observed) | — | — | **READY_TO_ACTIVATE** |
| **Forecasts** | ✅ 21 scrapers | ✅ `0 13 * * *` | `agency_forecasts` (33,687) | 2026-09-13 13:00 | 2026-09-13 13:00 | n/a (reference) | never | **LIVING (store)** · intel link MISSING |
| **SAM events** | ✅ regex extractor | ✅ `0 7 * * *` | `sam_events` (4,945) | 2026-09-13 07:00 | 2026-09-12 07:00 | n/a (reference) | never | **LIVING (store)** · intel link MISSING |
| **Awards / spending** | ✅ BQ ingest | ✅ `0 4 * * 0` | `usaspending.awards` (64.8M) | 2026-09-13 04:00 | 2026-09-04 | n/a (reference) | never | **LIVING (store)** · intel link MISSING |
| **Recompetes** | ✅ USASpending sync | ✅ `25 * * * *` | `recompete_opportunities` (172,118) | 2026-09-13 13:28 | 2026-09-13 13:28 | n/a (reference) | never | **LIVING (store)** · intel link MISSING |
| **Budget justifications** | ⚠️ two half-fetchers, neither usable (see §3) | ❌ | static JSON, **hand-pasted**; `agency_budget_authority` **0 rows** | — | **2026-02-18** (file) | — | — | **PARTIAL** |
| **NDAA** | ⚠️ `scan-ndaa-sections.py` **outside the repo** | ❌ | text baked into the static corpus | — | Jan 2026 (script mtime) | — | — | **PARTIAL** |
| **Appropriations** | ❌ | ❌ | — | — | — | — | — | **MISSING** |
| **Legislation (introduced)** | ❌ `api.congress.gov` = 0 files | ❌ | — | — | — | — | — | **MISSING** |
| **Enacted law** | ❌ | ❌ | — | — | — | — | — | **MISSING** |
| **Inspector General** | ❌ no fetcher (only static agency JSON) | ❌ | — | — | — | — | — | **MISSING** |
| **Agency strategic plans** | ❌ no collector | ❌ | — | — | — | — | — | **MISSING** |

**Counts — 13 families:** LIVING **5** (1 Institute + 4 structured stores) ·
READY_TO_ACTIVATE **1** · PARTIAL **2** · MISSING **5**.

---

## 3. Existing fetchers (built, and what they cost to use)

| Fetcher | State |
|---|---|
| `src/lib/institute/sources.ts` | **in use** — the GAO reference |
| `src/lib/federal-register/index.ts` | **built, unused for evidence.** `fetchRegulatoryDocuments()` — typed, keyless, live. One real importer: `mcp/tools/regulatory-demand.ts` (per-request). **No cron, no durable persister** — it writes only a 1h TTL row to `mcp_external_cache`, which is a response cache, not a corpus (an expired row is a miss) |
| `agency-intelligence/fetchers/govinfo.ts` `fetchBudgetDocuments` | **built, never called on any live path.** Queries `collection:BUDGET AND ("congressional justification" OR "budget request" OR "appropriations")`. Re-exported in `agency-intelligence/index.ts`, but the pipeline and `sync-agency-intel` both call only `fetchGAOReports`. Its only other references are test mocks |
| `/api/admin/build-budget-data` | **not a CBJ fetcher, and it writes nothing.** It calls USASpending `budgetary_resources` (not budget-justification documents) and **returns JSON in the HTTP response** — it never writes the file or a table. So `agency-budget-data.json` is pasted in by hand |
| `agency-intelligence/fetchers/govinfo.ts` `fetchGAOReports` | **superseded.** GAOREPORTS frozen at 2008-09-18; key returns `API_KEY_INVALID` |
| `briefings/web-intel/rss.ts` | partially used — `gao_reports` now wired; `gao_protests` and the news feeds still orphaned |

**Unused collectors:** Federal Register (evidence path), `fetchBudgetDocuments`,
GovInfo GAO, `gao_protests` RSS, `it-dashboard.ts` (marked dead in code).

---

## 4. Document vs Structured sources — link, don't duplicate

**DOCUMENT sources** → `institute_sources` → interpretation.
GAO · IG · Federal Register · legislation · budget justifications · strategic plans.
These are individually citable artifacts; the Institute should own the row.

**STRUCTURED OPERATIONAL sources** → stay in their canonical store; Strategic
Intelligence **references** them. Forecasts (33,687) · SAM events (4,945) ·
awards (**64.8M**) · recompetes (172,118).

> Copying 64.8M award rows into the Institute to "own" them would be absurd. The
> Institute owns the **evidence model**, not every physical byte. `intelligence_changes`
> already has `institute_source_id`; a structured signal needs a sibling reference
> (e.g. `signal_ref = 'agency_forecasts:<id>'`), **not** a copy.

**Recommended:** a forecast or industry day becomes Institute evidence **only when it
is cited as the basis of a claim** — a reference row, not a bulk import.

---

## 5. Poll cadence vs publication cadence

These are different facts. A quiet annual source is not stale.

| Source | Poll | Upstream publishes | A quiet poll means |
|---|---|---|---|
| GAO | daily | business days, irregular | `upstream_quiet` = healthy |
| Federal Register | daily | **every business day, high volume** | a quiet day is suspicious |
| Legislation | daily | frequent in session, quiet in recess | seasonal |
| IG | daily | continuous across ~70 offices | — |
| Appropriations | weekly | episodic (Sep–Dec spike) | normal for months |
| Budget justifications | weekly **in season** (Feb–Apr) | annual | normal for ~9 months |
| Strategic plans | monthly | **multi-year** | normal for years |
| Forecasts | daily (live) | source-specific | — |
| SAM events | daily (live) | daily | — |
| Awards | weekly (live) | daily upstream, weekly ingest | — |

---

## 6. Advancement monitoring coverage

| Source | Has a `data_sources` row? | Clocks encoded? | C1 oracle? |
|---|---|---|---|
| GAO | ✅ `institute_gao` | ✅ `[gao-ingest-clocks:v1]` | — |
| Awards | ✅ `bq_awards` | ✅ `[awards-ingest-clocks:v1]` | ✅ |
| Federal Register | ✅ `federal_register` (**`last_built: null`**) | ❌ | ❌ |
| Forecasts | ✅ `forecast_intelligence` (**`last_built: null`** while advancing daily) | ❌ | — |
| SAM opportunities | ✅ (`last_built: null`) | ❌ | ✅ |
| Pain points | ✅ `agency_pain_points` (2026-08-01, quarterly) | ❌ | — |
| IG · legislation · appropriations · NDAA · budgets · strategic plans | ❌ **no row at all** | ❌ | ❌ |

⚠️ **Six of thirteen families cannot be flagged stale even in principle** — they have
no registry row, so silence is indistinguishable from absence.

---

## 7. What currently updates pain points / priorities

Measured against the shipped corpus:

| Source | Pain points it produced |
|---|---|
| **GAO (legacy, hand-run)** | 280 tagged `(Source: GAO)` |
| **NDAA (hand-run, out-of-repo script)** | 46 (untagged; identified by text) |
| **No attribution at all** | **2,719** |
| **GAO (new, living pipeline)** | 13 in `agency_pain_points_db`, each citing an Institute evidence id |

Priorities: **1,846 of 2,658 carry a dollar figure in prose**, none structured, none
sourced. **No automated source updates priorities today.**

### Sources that SHOULD influence pain/priorities but do not

| Source | Why it should | Today |
|---|---|---|
| Federal Register | rules/EOs create requirements 6–18 months before solicitations | passthrough only |
| IG reports | corroborate GAO findings → would *strengthen* a claim | no collector |
| Appropriations | the only thing separating a **stated** from a **funded** priority | none |
| Legislation | "what has Congress told them to do" | none |
| Budget justifications | the richest source of funded priorities | static, 7 months stale |
| Forecasts | a forecast is a **buying signal** on an existing pain point | never linked |
| SAM events | an industry day **confirms** a priority is moving to procurement | never linked |
| Awards/spending | a material spend shift is itself evidence | never linked |

---

## 8. Institute destination model

```
DOCUMENT SOURCE ─► institute_sources ─► derive.ts ─► agency_pain_points_db
                          │                               │
                          └──────► intelligence_changes ◄──┘
                                   (institute_source_id)

STRUCTURED SOURCE ─► canonical store (agency_forecasts, sam_events,
                     usaspending.awards, recompete_opportunities)
                          └──► referenced by a signal id, NEVER copied
```

Adding a document source = a parse function + a `source_type` value + a
`cron_jobs` row + a `data_sources` row. **No new tables.** `institute_sources.source_type`
already enumerates all 12 document classes.

---

## 9. Activation queue

Ranked by contractor value × infrastructure reuse × provable advancement ÷ effort.

### NEXT — mostly configuration
1. **Federal Register.** ✅ Verified, not assumed: typed client exists, API is keyless
   and live (2026-09-14 documents observed), `data_sources` row already exists, and
   items carry `document_number` + `publication_date` + `html_url` + `agencies` —
   a direct fit for the Institute contract. **Needs only:** a `parseFederalRegister`
   adapter, `source_type: 'federal_register'`, a cron row, clocks. No new tables,
   no key, no schema change. *Caveat: high volume — it needs a relevance filter GAO
   did not, or it will flood the corpus.*
2. **Forecast + SAM-event REFERENCES** (not ingestion). Both stores are already
   LIVING; the missing piece is the reference field so a forecast can be cited as a
   buying signal. Small, and it completes the pain→priority→buying-signal chain.

### SOON — modest producer work
3. **Inspector General** — oversight.gov is the plausible central discovery path, but
   **no collector exists** and I did not verify its API in this pass. Highest
   intelligence value after GAO: IG corroboration is what would let a claim
   *strengthen* rather than just appear.
4. **Congress.gov** — legislation + enacted law. Real API, needs a key and a new
   client. Must keep introduced ≠ enacted as distinct evidence classes.
5. **Budget justifications** — genuinely two half-solutions, neither sufficient:
   `fetchBudgetDocuments` targets the right corpus but is never called and needs a
   working GovInfo key; `/api/admin/build-budget-data` fetches a *different* thing
   (USASpending budgetary_resources) and writes nowhere. Unblocks *funded* vs
   *stated* priorities, so it is worth doing properly rather than patching.

### LATER — new acquisition strategy
6. **Appropriations** — parsing enacted appropriations to agency/account is genuinely hard.
7. **Agency strategic plans** — no central index; per-agency discovery, multi-year cadence.
8. **NDAA** — currently an out-of-repo Python script; needs re-homing as a GovInfo consumer.

---

## 10. Per-source answers

| Source | Where from | How collected | Where it lands | How we know it advanced | What it influences | Living? |
|---|---|---|---|---|---|---|
| GAO | gao.gov RSS | daily cron | `institute_sources` | `max(publication_date)` vs poll | pain points | **YES** |
| Federal Register | federalregister.gov API | per-request only | nowhere | not tracked | nothing yet | no |
| Forecasts | 21 agency sources | daily cron | `agency_forecasts` | `max(last_synced_at)` | nothing yet | store only |
| SAM events | SAM notices | daily cron | `sam_events` | `max(extracted_at)` | nothing yet | store only |
| Awards | USASpending → BQ | weekly | `usaspending.awards` | `max(action_date)` + clocks | nothing yet | store only |
| Recompetes | USASpending | hourly | `recompete_opportunities` | `max(last_synced_at)` | nothing yet | store only |
| Budgets | OMB/CBJ | **hand-pasted** (the admin route returns JSON, writes nothing) | static JSON | `lastUpdated` (2026-02-18) | legacy priorities | no |
| NDAA | GovInfo | **out-of-repo script** | static corpus text | none | 46 legacy pain points | no |
| IG · CRS · legislation · appropriations · strategic plans | — | — | — | — | — | no |

---

## 11. Scope discipline

**Nothing was activated.** No Federal Register ingestion, no Congress.gov client, no
IG scraping, no budget import, no corpus migration, no duplication of forecasts /
events / awards into the Institute, no UI.

Open from 1B and now closed: **the GAO dispatcher run was observed** —
`last_status: success`, `last_run_at: 2026-09-13 13:18:27`, 0 duplicates, poll clock
advanced while source/ingest/intelligence clocks held.

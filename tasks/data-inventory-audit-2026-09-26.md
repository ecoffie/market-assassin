# DATA INVENTORY AUDIT — `/admin/data-inventory` (2026-09-26)

Read-only. No code, no PR, no deploy. Every figure below is taken from production:
- the live `GET /api/admin/data-inventory` (generatedAt `2026-09-26T17:52:10Z`)
- direct head-counts against the prod Supabase primary (service role, read-only)
- `data_sources`, `data_source_instances`, `cron_jobs`, `cron_job_runs`
- the live MCP catalog (`/api/mcp/catalog` → 64 tools)
- `verify:oracles --only freshness`

Code examined: `origin/main` @ `e5f552ea`.

## ⚠️ Corrections found during implementation (same day, PR fix/data-inventory-truth)

The read-only audit below was itself incomplete. Found while building the fix, and measured on production:

1. **Semantic index was overstated by a further 55,328.** `embedding_source='none'` rows have
   `sow_embedding = []`, an empty-array "nothing to embed" sentinel (`embed-sow-corpus`, text under 80 chars), not a
   vector. So `sow_embedding IS NOT NULL` (203,761) is not the index. The index is SOW 30,541 + description
   117,894 = **148,435**. §4/§10 below still quote 203,761.
2. **Omitted corpora the audit also missed:**
   - `sam_entities`: **910,126** SAM entity registrations (customer-read by `lookup_sam_entity`; no registered schedule)
   - `dod_sbir_topics`: **0 rows**. Its cron `sync-dod-sbir` reports success/HTTP 200 every 6 h behind a reachability gate (#604), so a green run is not evidence of data
   - `usaspending_awards`: an **889-row** legacy Supabase mirror (read by `get_contractor_award_history`'s name path)
   - the BigQuery `awards` warehouse, **65,030,126 rows at TRANSACTION grain** (keyed `txn_id`, not distinct awards)
3. **The contractor count used the wrong store.** The page counted `recipients` (321,500 UEIs). The frozen P0 decision
   (`contractor-corpus.ts`) makes `recipients_rollup_merged` (297,145 companies) the only store allowed to state the
   contractor population.
4. **`search_past_contracts` / `get_keyword_coverage` are live USASpending API calls**, not reads of the warehouse.
   They are listed as passthrough.
5. **The admin demo page** (`/admin/demo`) hand-typed "~604,718 records · 13 datasets · 34 sources" for this screen.

---

## 1. Page architecture

| Layer | File | Role |
|---|---|---|
| Page | `src/app/admin/data-inventory/page.tsx` | Client component with a password gate. Fetches the API, then renders the totals strip, the "What it took to build" strip, two pies and the dataset table. **Never renders `sourceTrace`**, even though its header comment says it does. |
| API | `src/app/api/admin/data-inventory/route.ts` | Owns everything: the `DatasetEntry[]` literal, 14 head-counts, 3 research subtypes, 2 embedding-source counts, provenance sums, `RECREATE_COST`, `sourceTrace`. |
| Registry | *none*. The dataset list is a **hand-typed array literal in the route**. It does NOT read `data_sources` (18 rows) or `data_source_instances` (23 rows), which are the real control plane. |
| Source trace | `src/lib/data-sources/registry.ts` `getRegistrySummary()` | Static category snapshots. Five are overridden with live counts. Returned by the API but **not displayed**. |
| Guard | `inventory-truth.unit.test.ts` | Covers only 3 mirrored corpora (dibbs / grants / aggregated). The candidate list comes from `sync-*` / `snapshot-*` cron dirs, so `institute-*-sync` corpora can't trip it. |
| Freshness | **None.** There is no timestamp on any dataset. The only time shown is `generatedAt` (the request time). |

### Value classes

| Value | Class |
|---|---|
| Every dataset `count` except pain points, priorities and budget | **LIVE COUNT** (Supabase head-count, or BQ `COUNT(*)` for contractors) |
| pain_points / priorities / budget_authority counts | **DERIVED from a static bundled JSON** (fixed at build time, not live) |
| Research subtypes, embedding split (`embedNote`) | LIVE COUNT |
| Provenance totals, `allMeasured`, "N datasets" | DERIVED (sums of the above) |
| `distinctSources` (46) | DERIVED, but by counting **label strings**, not upstreams |
| `formats` 6, `formatList`, `agencies` '300+', `linesOfCode` 1,101,201, `commits` 3,013 | **HARDCODED** |
| label / source / note / `sources[]` / provenance on every row | **STATIC METADATA** (hand-typed) |
| forecasts note "12 agency feeds · 7 portals · 4 formats" | HARDCODED (and wrong, see §4) |
| `sourceTrace` "Pricing & Regulatory" `totalRecords: 240000` | HARDCODED (API only, not rendered) |

## 2. Dataset registry source

The route's array literal is the only list. It has no link to the control plane:
- `data_sources` has `institute_legislation`, `institute_gao` and `strategic_intelligence`. The page has none of them.
- `data_sources.record_count` is itself stale: sam_opportunities 123,255 vs 224,158 live; forecast_intelligence 7,764 vs 35,881; agency_pain_points 3,045 vs 3,036.
- `data_source_instances.held_population` also lags: dibbs 57,816 vs 65,376; sam 215,066 vs 224,158.

So Mindy now has **three inventories that disagree**: the route literal, `data_sources`, and `data_source_instances`.

## 3. Displayed vs actual dataset list

Displayed: 19 rows (16 counted + 3 passthrough).

| Dataset | On page? | Verdict |
|---|---|---|
| Contractor database | yes | keep |
| Decision makers | yes | keep, relabel (see §4) |
| SAM opportunities | yes | keep, fix note |
| Semantic-indexed opportunities | yes | **overlap**: a property of SAM rows, not a separate corpus |
| Forecasts | yes | keep, fix sources/note |
| Recompetes | yes | keep, count served vs stored |
| Agency pain points (static JSON) | yes | keep, relabel as static/legacy |
| Agency spending priorities (static JSON) | yes | keep, relabel as static/legacy |
| Knowledge base | yes | keep |
| Event Radar | yes | keep |
| Agency intelligence | yes | **misdescribed** (see §7) |
| Buying-office directory | yes | keep |
| Budget authority | yes | keep, add a static-file date |
| DIBBS | yes | keep |
| Federal grants | yes | keep |
| Research & Lab Funding | yes | keep, fix the source list |
| CALC / EDGAR / Federal Register | yes (passthrough) | keep, separate section |
| **Legislation (Institute)** | **NO** | **INVENTORY OMISSION** |
| **GAO (Institute, living)** | **NO** | **INVENTORY OMISSION** |
| **Sourced pain points (`agency_pain_points_db`)** | **NO** | OMISSION (derived layer, 32 rows) |
| `intelligence_changes` | no | optional (32 rows; change log) |
| BQ awards (63M rows, weekly) | no (only recipients) | OMISSION as a row. It powers recompetes, keyword coverage, the contractor DB and /awards |
| Keyword coverage | no | correct to omit as a dataset. It is a **derived measurement** over BQ awards |

## 4. Displayed vs actual counts

| Dataset | Displayed | Actual (prod) | Query | Last updated | Verdict |
|---|---|---|---|---|---|
| Contractors | 321,500 | 321,500 | BQ `COUNT(*) recipients` | BQ source 2026-09-18 | **PASS**. The `sources[]` list claims SBA + SAM Entity, but the count is BQ only |
| Decision makers | 302,151 | 302,151 rows = **220,134** SAM contacts + **82,017 vendor POCs** (`sam_entities_pocs`) | `federal_contacts` head | 2026-09-26 14:00 | **WRONG (semantics)**. 27% are vendor POCs, not government decision makers, and the count is rows, not people (~21K people) |
| SAM opportunities | 224,158, note "live open-opportunity corpus" | 224,158 total / **35,829 active** | `sam_opportunities` head; `active=true` | 2026-09-26 13:00 | **WRONG (copy)**. 84% are archived, not "open" |
| Semantic-indexed | 203,761, note "30,541 SOW · 117,892 description" | 203,761 = 30,541 sow + 117,892 description + **55,328 `embedding_source='none'`**; only **22,074 active** | `sow_embedding not null` | embed cron 17:50 | **WRONG (note doesn't sum; 55K unexplained)**. Also double-counted inside `allMeasured` (§10) |
| Forecasts | 35,881 | 35,881 across **20** `source_agency` values | `agency_forecasts` head | 2026-09-26 13:00 | count **PASS**. Note "12 agency feeds · 7 portals" and the 7-item source list are **STALE**. HHS 5,507, USDA 5,028, Navy 8,821, USACE 2,908 etc. are missing from the list. Control plane: EPA/NRC/SSA *unreachable*, Navy/GSA *content_stale* |
| Recompetes | 181,773 | 181,773 stored / **143,709 served** (`quality_flag IS NULL`); flagged: expired 28,676 · grouped_synthetic 9,297 · placeholder 84 · sentinel 5 · implausible 2 | head; `quality_flag` split | 2026-09-26 17:28 | **WRONG (overstates by 38,064)**. It counts synthetic/expired rows the product filters out |
| Pain points | 3,036 | 3,036 (static JSON, 307 agencies) | JSON length | file last commit 2026-09-22 | count **PASS**. Provenance copy misleading (§8) |
| Priorities | 2,500 | 2,500 | JSON | same file | **PASS** |
| GAO (Institute) | — | **73** (pub 2026-07-22 → 2026-09-25) | `institute_sources source_type='gao_report'` | 2026-09-26 12:20 | **OMITTED** |
| Legislation | — | **29** | `institute_sources` bill/law/report | poll 2026-09-23 | **OMITTED** |
| Event Radar | 5,315 | 5,315 | `sam_events` head | extracted 2026-09-26 07:00 | **PASS** |
| Agency intelligence | 556 | 556 = **445 GovInfo GAO testimonies dated 1993-10-06 → 2000-09-27** + 111 contract patterns | `agency_intelligence` by `intelligence_type` | updated 2026-09-20 | count PASS / **label WRONG** |
| Buying offices | 4,826 | 4,826 | `dodaac_directory` head | 2026-09-06 | **PASS** |
| Budget authority | 47 | 47 | static JSON | **file last changed 2026-02-18** | **STALE** (labelled as OMB/USASpending, no date) |
| DIBBS | 65,376 | 65,376 (`status` NULL on 100%, so there's no open/closed split) | `dibbs_rfqs` head | synced 2026-09-26 08:01 | **PASS** (the count is total held, not open) |
| Grants | 2,227 | 2,227 = 1,588 posted + 639 forecasted | `grants_cache` head | synced 2026-09-26 09:00 | **PASS** |
| Research funding | 1,585 (1,531 / 42 / 12) | 1,585 = NIH 1,516 · Grants.gov slice 63 · DARPA 6 · **NSF 0** | `aggregated_opportunities` by `source` | NIH 2026-09-21 (*content_stale*); DARPA 2026-04-05 (cron **disabled**); grants.gov slice 2026-04-12 | count **PASS**. Source list **misleading**: NSF listed with 0 rows, DARPA and the slice are ~5 months dead |
| Knowledge base | 1,386 docs / 12,382 passages | 1,386 / 12,382 | head | — | **PASS** |
| CALC / EDGAR / FR | "live" | not persisted | — | — | **PASS** (correctly null) |

## 5. Missing datasets
1. **Legislation corpus** (Institute, 29): a distinct source corpus and a customer surface.
2. **GAO living corpus** (Institute, 73): a distinct source corpus.
3. **Sourced pain points** (`agency_pain_points_db`, 32, every row carrying `institute_source_ids`): the derived layer that `get_agency_intel` prefers.
4. **BQ awards** (weekly, source 2026-09-18): the heaviest corpus Mindy holds. It shows up only indirectly through recipients.

## 6. Legislation inventory status
- **Production**: 29 rows = **22 bill versions** (`introduced_bill`, covering IS/IH/RS/RH/ES/EH/EAH/CPS) + **2 enacted_law** (S.1071 PUBLIC-LAW 2025-12-19 and S.1071-ENR) + **5 committee reports**, one of which is errata (`119-SRPT-39-ERRATA`). FY2026 (S.1071 / S.2296 → PL) and FY2027 (H.R.8800 / S.4784) are both present, along with SPEED Act H.R.3838 and technical-correction bills. `raw` carries `becameLaw`, `lawNumber`, `fiscalYear` and `measureRole`, so law status is held.
- **Control plane**: `institute_legislation` → `source_state=upstream_quiet`, `intervention_state=none_required`, `held_population=29`, `last_poll 2026-09-23T01:29Z`, `last_data_advance 2026-09-20`, `last_source_advance 2026-07-30`. `data_sources.institute_legislation.last_built 2026-09-23`.
- **Collector**: `cron_jobs institute-legislation-sync` `40 13 * * 0` (weekly, Sunday), enabled. Its `last_run_at` is still **2026-09-20** (`cron_job_runs` status `success`, `http_status NULL`). The 09-23 poll was manual.
- **The 2026-09-27 scheduled run has NOT happened yet.** Today is Saturday 09-26, so operational acceptance is still OPEN. The terminal `http_status NULL` on the last scheduled run is the #1593 observability debt.
- **Customer surfaces (live)**: `get_legislation_status` is in the production catalog (64 tools, confirmed), and the `get_agency_intel` → `legislation` section reads `getLegislativeEvidenceForAgency`. The cron note "corpus is NOT yet a customer product surface" is now **stale**.
- **Inventory**: **absent → INVENTORY OMISSION.** NDAA currently appears only as a label string on the static pain-points row.

## 7. GAO inventory status: three different things, shown as one or not at all

| | Store | Count | Dates | Living? | Customer path | On page? |
|---|---|---|---|---|---|---|
| **A. Living GAO corpus** | `institute_sources gao_report` | 73 | pub 2026-07-22 → 09-25 | **Yes**. Daily RSS; last 7 runs all 200; `source_state=current` | `agency_pain_points_db` (32 sourced) → `get_agency_intel` / `understand_customer` | **No** |
| **B. Static GAO prose in pain points** | `agency-pain-points.json` | 860 of 3,036 pain points mention GAO; 94 carry a `GAO-##-###` number; **0 URLs** | undated | **No** | legacy fallback, labelled "legacy" in `get_agency_intel` | Folded into "Agency pain points" as `GAO reports` |
| **C. Old GovInfo GAO testimonies** | `agency_intelligence gao_high_risk` | 445 | **1993-10-06 → 2000-09-27** (all stamped FY2026 by the fetcher) | **No**. Collection frozen; the fetcher is quarantined | **Withheld** from customers as historical (`legacy-gao-currency.ts`, 5-yr ceiling) | Shown as "Agency intelligence — GAO/GovInfo high-risk", **Exclusive**, with no dates |

Row C is the most misleading line on the page. It presents 25-to-33-year-old testimonies that the product deliberately withholds as current "exclusive" GAO high-risk intelligence.

## 8. IG / CRS truth
- **IG**: `institute_sources ig_report` = **0**. IG exists only as prose inside the static JSON (157 pain points mention IG/OIG/Inspector General; 0 URLs). There is **no living IG corpus.**
- **CRS**: `crs_report` = **0**. **One** pain point and two priorities mention CRS. There is **no CRS corpus.**
- **NDAA**: two distinct things. (a) 39 static pain-point claims mentioning NDAA, and (b) the living 29-row legislative corpus. The page shows only (a), as a `sources[]` chip.
- **Budget justifications / Strategic plans**: `institute_sources` rows = 0. These are static prose attributions only.
- **GovInfo API**: its only persisted output is row C above (frozen, quarantined).

So the pain-points row lists seven "sources" (GAO reports, IG audits, CRS analyses, NDAA, Budget justifications, Strategic plans, GovInfo API). That reads as seven living feeds. The reality is one hand-curated JSON with zero URLs.

## 9. Static vs living

| Living (scheduled producer, advancing) | Static / frozen |
|---|---|
| SAM opps · semantic index · decision makers · forecasts (partial, see instances) · recompetes · events · DIBBS · grants · NIH research · Institute GAO · Institute legislation (weekly) · BQ awards/recipients (weekly) · DoDAAC dir | pain points + priorities JSON · budget authority JSON (Feb 2026) · agency_intelligence GAO (1993–2000) · DARPA BAA slice (Apr, cron disabled) · Grants.gov research slice (Apr) · NSF (never wrote) |

The page draws no line between these two columns.

## 10. Provenance totals reconciliation

Recomputed exactly from the live payload:

| Bucket | Members | Sum | Page |
|---|---|---|---|
| Exclusive | embedded 203,761 + forecasts 35,881 + pain 3,036 + priorities 2,500 + RAG 1,386 + agency_intel 556 | **247,120** | 247,120 ✓ |
| Curated | contractors 321,500 + DM 302,151 + recompetes 181,773 + events 5,315 + dodaac 4,826 + budget 47 + dibbs 65,376 + grants 2,227 + research 1,585 | **884,800** | 884,800 ✓ |
| Cache | sam_opps 224,158 | **224,158** | ✓ |
| All measured | the three above (passthrough contributes 0) | **1,356,078** | ✓ |

- **"Refresh" is not a provenance category.** It is the reload button. There are exactly four buckets (exclusive / curated / cache / passthrough).
- The arithmetic reconciles, but the **semantics don't**:
  - **Double count**: all 203,761 "semantic-indexed" records are rows of the 224,158 SAM cache. `allMeasured` counts them twice. Unique-record total ≈ **1,152,317**.
  - **Inflated rows**: recompetes +38,064 not served. Decision makers include 82,017 vendor POCs.
  - **Exclusive is 82% one line**: 203,761 of 247,120 "exclusive" records are an embedding of public SAM text. The truly authored exclusive rows are forecasts, pain points, priorities and RAG (≈42.8K), plus sourced claims.
  - The header's "N datasets" = datasets with count > 0 = **16**, which is a different number from the 19 rows in the table.
- Recommended semantics: headline = **unique persisted records**. Show the embedding index as a *coverage property* ("91% of SAM rows embedded"), not as additive records.

## 11. Distinct-source count (displayed: 46)

46 = distinct **label strings** in `sources[]`. It is not upstreams. Specific problems:
- SAM.gov appears as 6 labels (Opportunities API, SOW text, descriptions, Special Notices, POCs, Entity API). The first five are **one upstream** (Opportunities API), and Entity is a second.
- "DoDAAC decode", "DoDAAC office decode" and "DoDAAC directory (FPDS/BigQuery)" are a **derived process**, not a source.
- "OpenAI embeddings" and "OpenAI text-embedding-3-small" name a tool, not a data source.
- GAO appears as 3 labels ("GAO reports", "GAO high-risk reports", "GovInfo API").
- USASpending appears as 6 labels (Awards API, recipients BQ, FPDS awards BQ, contract patterns, patterns, toptier).
- Static-prose attributions (IG, CRS, Budget justifications, Strategic plans) are **not ingested feeds**.
- **Under-counted**: forecasts list 7 publishers while 20 agencies are held; the instances table names HHS SBCX, Navy LRAE, USACE, Treasury, EPA APEX, NRC, DOJ live, NASA NAF and GSA Gateway. **Congress.gov API** and **GAO RSS** are missing entirely.

**Proposed definition**: a source is a distinct upstream publisher endpoint from which Mindy *persists* rows. Count passthrough and internal corpora separately. The natural authority is `data_source_instances` (23 rows today, keyed `source_key`) plus the non-instanced `data_sources`, **not** the page literal. I have not produced a single replacement number, because that requires deciding whether forecast portals count per-agency. The label count of 46 should stop being called "distinct sources."

## 12. Format count (displayed: 6)
HARDCODED: REST, Excel, CSV, PDF, Scraped HTML, BigQuery bulk. It now omits **RSS/XML** (GAO Institute) and probably DIBBS flat files. At least **7**. Derive the count from instance `ingest_mode` + format metadata, or label it "as of" a date.

## 13. Agency count (displayed: '300+')
HARDCODED string. The defensible basis is the **307 agency keys in the static pain-points JSON**, a curated list. Forecasts cover 20 agencies, and the Institute resolves `canonical_agency` on its own. Relabel it "307 agencies profiled (curated)", or derive it.

## 14. Freshness matrix (none of this is on the page today)

| Dataset | Last data advance | Cadence | Control-plane state | Verdict |
|---|---|---|---|---|
| SAM opps | 2026-09-26 13:00 | daily full/delta/resume | current | FRESH |
| Semantic index | continuous (embed-sow-corpus 4×/hr) | 15 min | — | FRESH |
| Decision makers | 2026-09-26 14:00 | 2-hourly | current | FRESH |
| Forecasts | 2026-09-26 13:00 (aggregate) | daily | **mixed**: EPA/NRC/SSA *unreachable*; Navy/GSA/NIH *content_stale*; Treasury/USACE *unmeasured* | PARTIAL |
| Recompetes | 2026-09-26 17:28 | hourly | — | FRESH |
| Events | 2026-09-26 07:00 | daily | — | FRESH |
| DIBBS | 2026-09-26 08:01 | daily | current | FRESH |
| Grants | 2026-09-26 09:00 | daily | current | FRESH |
| Research – NIH | 2026-09-21 | daily | content_stale | STALE-ish |
| Research – DARPA / grants.gov slice / NSF | 2026-04-05 / 2026-04-12 / never | cron disabled | unreachable / content_stale / blocked | DEAD |
| GAO Institute | 2026-09-26 12:20 (pub 09-25) | daily | current; 7/7 runs 200 | FRESH |
| Legislation | data 2026-09-20, poll 2026-09-23 | weekly, Sunday | upstream_quiet; **09-27 run pending acceptance** | OK, acceptance OPEN |
| BQ awards | source 2026-09-18 (8d), run 5d | weekly | oracle PASS | FRESH |
| DoDAAC dir | 2026-09-06 | — | — | 20d |
| Budget authority | file 2026-02-18 | manual | — | STALE (7 mo) |
| Pain points / priorities | file 2026-09-22 (edited) | manual/quarterly | — | STATIC |
| agency_intelligence GAO | content 1993–2000 | frozen | — | HISTORICAL |

## 15. Passthrough vs owned
- Owned/persisted: every counted row in §4 plus the omitted Institute corpora.
- Live passthrough (not persisted beyond the short-TTL `mcp_external_cache`): **GSA CALC, SEC EDGAR, Federal Register**. The page handles them correctly (count null, excluded from totals). Two leaks remain:
  - the CALC note "~240K awarded labor categories" is an upstream figure, and it sits beside owned counts
  - `sourceTrace` "Pricing & Regulatory" `totalRecords: 240000` and `data_sources.gsa_calc_pricing.record_count 240000` both assert a persisted-looking count for data Mindy does not hold. The first is not rendered today, but it is exposed by the API.
- Passthrough appears in the same table as owned data. It should be its own section.

## 16. Customer-surface map (on origin/main; legislation confirmed in the live catalog)

| Dataset | Kind | Customer surfaces |
|---|---|---|
| SAM opps | SOURCE/CACHE + SURFACE | find_opportunities, search_sam_opportunities, lookup_solicitation, alerts, map |
| Semantic index | DERIVED | hidden-match alerts, match_recompete_sow |
| Decision makers | DERIVED/CURATED + SURFACE | search_federal_contacts, contacts panel, dossier |
| Forecasts | SOURCE (scraped) + SURFACE | get_agency_forecasts, FIND "coming soon", alerts, map |
| Recompetes | SOURCE (USASpending) + SURFACE | get_expiring_contracts, FIND "coming back", recompetes panel, briefings |
| Contractors / BQ awards | SOURCE + SURFACE | search_contractors, find_capable_contractors, search_past_contracts, keyword coverage (DERIVED MEASUREMENT) |
| Legislation | **SOURCE CORPUS + SURFACE** | **get_legislation_status**, **get_agency_intel.legislation** |
| GAO Institute | SOURCE CORPUS → DERIVED (32 sourced claims) → SURFACE | get_agency_intel, understand_customer |
| Pain points / priorities JSON | CURATED (static) + SURFACE | legacy fallback in get_agency_intel, proposal agency-context, briefings |
| agency_intelligence GAO | frozen SOURCE | admin/historical only (withheld from customers) |
| Events | DERIVED (from SAM) + SURFACE | search_federal_events, get_federal_event_series |
| DoDAAC dir | DERIVED | office rosters, event/opp office anchoring |
| Budget authority | CURATED (static) + SURFACE | get_agency_budget_trends, budget-intel |
| DIBBS | SOURCE/MIRROR + SURFACE | DIBBS panel, map, opportunity-detail |
| Grants | SOURCE/MIRROR + SURFACE | search_grants, map grants layer |
| Research | SOURCE/MIRROR + SURFACE | search_sbir (42-row slice), market-scan |
| Knowledge base | EXCLUSIVE + SURFACE | get_winning_playbook, search_podcast_lessons, Chat, Proposal Assist |
| CALC / EDGAR / FR | PASSTHROUGH + SURFACE | get_pricing_intel, get_incumbent_financials, get_regulatory_demand |

## 17. Misleading / stale copy on the page

1. Agency pain points `sources[]`: "GAO reports · IG audits · CRS analyses · NDAA · Budget justifications · Strategic plans · GovInfo API" implies living corpora. In reality it is static prose with 0 URLs, IG and CRS corpora = 0, and GovInfo is frozen.
2. Agency intelligence: "GAO high-risk + contract patterns", labelled **Exclusive**, with no dates. 445 of 556 rows are 1993–2000 testimonies the product withholds.
3. SAM opps note "live open-opportunity corpus". Only 35,829 of 224,158 rows are active.
4. Semantic-indexed note "30,541 SOW · 117,892 description" sums to 148,433 of 203,761, with 55,328 `embedding_source='none'` unexplained. It is also counted additively on top of SAM.
5. Forecasts note "12 agency feeds · 7 portals · 4 formats" and its 7-item source list. The real figure is 20 agencies.
6. Recompetes count includes 38,064 expired/synthetic/placeholder rows.
7. "Decision makers" includes 82,017 **vendor** POCs.
8. Research lists **NSF** (0 rows) and DARPA (dead since April) as if they were current sources.
9. "{distinctSources} distinct sources" is a label count.
10. "6 formats" and "300+ agencies" are hardcoded. The lines-of-code / commit figures (1,101,201 / 3,013) are hardcoded as of 2026-07-30; `origin/main` now has **4,346** commits.
11. The headline "The moat, quantified — 1,356,078 records" double-counts ~204K. The "~N records pulled from…" sentence repeats the same figure.
12. Budget authority is presented as OMB/USASpending with no date. It is a Feb-2026 static file.
13. The page header comment and the API comment promise a "forecast source trace" that the page never renders.
14. Omissions: legislation, living GAO, sourced pain points, BQ awards.
15. Cron note on `institute-legislation-sync` says "Corpus is NOT yet a customer product surface". That is stale, because `get_legislation_status` is live.

## 18. Exact corrections required (for a later implementation PR)

1. **Add rows**:
   - `legislation` (Institute; SOURCE CORPUS; count = `institute_sources` in bill/law/committee_report/appropriation/ndaa_provision; subtypes: bill versions 22 / enacted law 2 / committee reports 5, including errata; FY split; freshness from `data_source_instances.institute_legislation`)
   - `gao_institute` (73, daily, freshness from `institute_gao`)
   - `sourced_pain_points` (`agency_pain_points_db`, DERIVED, 32)
   - optionally `bq_awards`
2. **Split GAO** into A / B / C as in §7. Relabel `agency_intelligence` as "Legacy agency intelligence (historical GovInfo GAO 1993–2000 + contract patterns)". Mark it as not a customer surface and not Exclusive.
3. **Rewrite the pain-points / priorities provenance** as "Static curated JSON (hand-authored; prose attributions to GAO/IG/CRS/NDAA; 0 source URLs)". Remove IG / CRS / GovInfo / Strategic plans as `sources[]` chips, or render them under a separate "cited in prose" label.
4. **Fix counts / semantics**:
   - SAM: show active vs total.
   - Recompetes: show served (`quality_flag IS NULL`) vs stored.
   - Decision makers: split out the vendor POCs.
   - Semantic index: make it a non-additive subtype of SAM, and explain `none`.
5. **Headline**: unique persisted records (no double counting). Say explicitly that passthrough is excluded.
6. **Add a freshness column** from `data_source_instances` (`last_data_advance`, `source_state`, `intervention_state`), plus file dates for static JSON.
7. **Put passthrough in its own section.** Remove the persisted-looking 240,000 from `sourceTrace` and `data_sources.gsa_calc_pricing.record_count`.
8. **Sources**: redefine as upstream publishers derived from `data_source_instances` + `data_sources`, not labels. Add Congress.gov API and GAO RSS. Fix the forecast publisher list. Remove NSF, or mark it dead.
9. **Formats / agencies / LOC / commits**: derive them, or print an "as of" date.
10. **Registry convergence**: make the route read `data_sources` / `data_source_instances` (or assert parity in a test). Otherwise the fourth-inventory problem persists. Extend `inventory-truth.unit.test.ts` so `institute-*-sync` corpora are candidates.
11. Update the stale `institute-legislation-sync` cron note (or leave it until the 09-27 acceptance run).

## 19. Recommendation

**NO-GO on treating the current page as truthful. GO on an implementation PR, scoped as described below and with one prerequisite.**

- The counts that are shown are real live head-counts, and the provenance arithmetic reconciles exactly. The problem is **semantics and omissions**, not broken queries: 2 living corpora are missing, 1 frozen corpus is presented as exclusive current GAO, ~204K records are double-counted, ~38K recompetes rows are never served, and the source list implies IG/CRS/NDAA feeds that do not exist.
- **Prerequisite**: let the 2026-09-27 Sunday `institute-legislation-sync` run land. Verify `cron_job_runs.http_status` and `data_source_instances.last_poll` advance, so the new legislation row's freshness column shows accepted operational state rather than a manual poll.
- **Scope**: admin-only page + route, plus the guard test. This fits the priority order: it is not an internal-dashboard expansion, it is correcting the provenance of the numbers behind Eric's SBDC/SAME talks. The pain-point "GAO/IG/CRS/NDAA" framing is exactly what a speaking audience would repeat.

# Mindy Data Sources Registry

> **Purpose:** the authoritative, permanent record of where EVERY data source in
> Mindy comes from and whether it's real. Eric's principle: every fact must trace
> to a real source. This is that trace. Surfaced in the **Command Center → Data
> Sources** view (like the Forecast list) with last-updated + refresh cadence.
>
> **Rule for future work:** before calling any dataset "unverified," trace its
> BUILD PIPELINE (the scraper / merge script that produced it) — provenance lives
> in the build, not always in an inline `source` field.

_Last verified: 2026-06-08 · updated 2026-07-12 (added Mindy MCP live-API sources: GSA CALC, SEC EDGAR, Federal Register) · **row counts recounted live 2026-07-30**_

> **Counting note (2026-07-30):** the table counts below were re-measured directly
> against prod, not carried forward. Several had drifted materially in both
> directions — `federal_contacts` 123K→**185K**, `sam_opportunities` 29K→**145K**,
> `agency_forecasts` 7,764→**9,973**, and `aggregated_opportunities` 50K→**732**
> (that one was overstated by ~68×). Before quoting any figure from this doc
> externally, re-run the count: a stale number in a customer or diligence
> conversation is worse than no number.

---

## Live API sources (real-time, no refresh needed)

| Source | What it powers | Endpoint | Provenance |
|---|---|---|---|
| **USASpending — awards** | Market totals, top agencies, suggest-codes $, teaming primes, bid/no-bid competitors | `api.usaspending.gov/api/v2/search/spending_by_category/*` | Official federal award data. Fiscal year via `fiscalYearTimePeriod()` (auto-rolls). |
| **USASpending — IDV/IDIQ** | IDV/IDIQ contracts (real UEIs, $, award IDs) | `spending_by_award` w/ `award_type_codes:[IDV_*]` (`src/lib/idv-search.ts`) | Official. The task-order granularity. |
| **USASpending — offices** | Office-level drill-down | `spending_by_award` → `Awarding Office` | Official, aggregated per office. |
| **SAM.gov** | Opportunities, `federal_contacts` POCs | `api.sam.gov/opportunities/v2` | Official federal solicitation data. |
| **Grants.gov** | Federal grants | `api.grants.gov/v1/api/search2` | Official. |
| **GSA CALC+** | MCP `get_pricing_intel` — price-to-win labor rates (p25/p50/p75, small-vs-large gap, top vendors) | `api.gsa.gov/acquisition/calc/v3/api/ceilingrates/` (keyless, ~240K awarded labor categories, daily refresh) | Official. Live fetch + 12h TTL response cache (`mcp_external_cache`). Wrapped via `src/lib/utils/calc-rates.ts`. |
| **SEC EDGAR** | MCP `get_incumbent_financials` — incumbent revenue/net income/gross margin/public float/employees/latest 10-K | `www.sec.gov/files/company_tickers.json` → `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` + `data.sec.gov/submissions/CIK##########.json` (keyless, requires `User-Agent`) | Official. Public filers only — private contractors return `grounded=false` (no invented figures). Cache 24h/6h. `src/lib/edgar`. |
| **Federal Register** | MCP `get_regulatory_demand` — "demand before SAM" leading indicator (proposed/final rules precede solicitations 6-18mo) | `federalregister.gov/api/v1/documents.json` (keyless) | Official. Does NOT tag items to NAICS — any NAICS mapping is inference, not data. Cache 1h. `src/lib/federal-register`. |
| **USASpending — award detail** | MCP `get_award_detail` (obligated→ceiling, parent IDV, PoP, recipient) + `find_predecessor_award` (largest-recent-match incumbent inference) | `api.usaspending.gov/api/v2/awards/*` + `spending_by_award` | Official. `src/lib/usaspending/award-detail.ts` + `find-predecessor.ts` — the Award Intelligence spine, reused. Predecessor is a NAICS+agency BEST-MATCH inference (labeled "likely"), not a certified link. |
| **SAM.gov — Entity Management** | MCP `lookup_sam_entity` — live registration (UEI/CAGE, status, NAICS, 8(a)/HUBZone certs) by UEI or name | `api.sam.gov/entity-information/v3/entities` (`src/lib/sam/entity-api.ts`) | Official. Set-aside eligibility reflects CURRENT registration, not past awards. `grounded=false` = not found in SAM (no assumed eligibility). |
| **BigQuery — recipients** | MCP `search_contractors` — competitive landscape (top firms by total obligated, award count, distinct-agency breadth) by keyword/NAICS/state | `recipients_rollup` / `top_contractors_by_dimension` BQ tables (`src/lib/bigquery/recipients.ts:searchRecipients`, same query as the in-app Contractors panel; `liveBq:true`) | USASpending-derived, ~317K rows. Cumulative historical obligations, not a bid list. `queryCached` SWALLOWS a BQ quota/rate limit to empty rows, so `grounded=false` can mean a thin market OR a transient source limit (mirrors pricing-intel). |
| **BigQuery — Proven Players** | Maps Players + MCP `search_contractors` NAICS path (when `PLAYERS_SOURCE=canonical`) | `players_naics_recipients` BQ table — one row per 6-digit NAICS × UEI with award history, HQ city/state from `recipients`, NO rank cap; carries `source_action_max` + `built_at` (`src/lib/players/dataset.ts`) | Built by `npm run players:rebuild -- --go` (refused unless awards cohort completeness = complete) and after each ingest when `PLAYERS_REBUILD_AFTER_INGEST=on`. Build record (source watermark / Players watermark / status) in Supabase `data_sources[bq_players]`. Reconcile: `npm run players:rebuild -- --reconcile` + `verify:oracles --only players`. NOT YET BUILT in production (2026-10-04). `top_contractors_by_dimension` remains the /top/* listicle source ONLY — never a population. |
| **Agency hierarchy + spending** | MCP `get_agency_intel` — agency identity/hierarchy + curated GovCon pain points & priorities + live USASpending obligations (FY, top NAICS) | `src/lib/agency-hierarchy/unified-search.ts:getAgency` + `spending-stats.ts:getAgencySpending` (→ `api.usaspending.gov` agency endpoints) | Identity/pain-points are curated intel (not an official agency statement); spending is official USASpending obligations. `spending:null` = USASpending had no match, NOT $0 spend. |
| **Grants.gov** | MCP `search_grants` — federal grant (assistance) opportunities by keyword/agency/category | `apply07.grants.gov/grantsws/rest/opportunities/search` (`src/lib/grants/search.ts`) | Official Grants.gov. Assistance funding, not contracts. Agency is a client-side prefix filter (hits carry agencyCode like "DOD-AMRAA"). |
| **Agency forecasts** | MCP `get_agency_forecasts` — planned procurements 6-18mo pre-solicitation | Supabase `agency_forecasts` (~7,700 rows, ~12 agencies) via `src/lib/forecasts/query.ts` | Agency-published forecasts; estimates that slip/cancel. Coverage is ~12 agencies, not government-wide — empty ≠ no demand. Refreshed on forecast-import runs. |
| **SBIR/STTR** | MCP `search_sbir` — NIH RePORTER awarded projects + multisite open notices | `api.reporter.nih.gov/v2/projects/search` (activity codes R43/R44/R41/R42) + Supabase `aggregated_opportunities` (`src/lib/sbir/search.ts`) | Official NIH RePORTER (source="nih" = AWARDED projects, not open sols) + aggregated open notices (source="multisite"). NIH is health-research heavy. |
| **Recompetes** | MCP `get_expiring_contracts` — federal contracts expiring within a window (recompete targets) | Supabase `recompete_opportunities` (USASpending-derived) via `src/lib/recompete/query.ts` | USASpending-derived. Task/delivery orders are rolled up under their parent IDV (parsed from the stored generated award id) with the IDV ordering end from the USASpending award-detail endpoint (UNKNOWN when not established); `capture_start_date` (PoP end − 12 months, derived) is the suggested capture start and `estimated_recompete_date` is null (not established); parentless orders are listed individually; `place_of_performance_state` is exposed as reported by USASpending (no override; IMI 2026-09-22). `recompete_likelihood` is an inference. |
| **Keyword coverage** | MCP `get_keyword_coverage` — total federal market $ for a product/service keyword + every buying NAICS ranked + the ~90%-coverage NAICS set + top PSCs ("what was bought") | USASpending spending-by-category (`src/lib/market/keyword-coverage.ts:keywordCoverage`) | USASpending keyword search is EXACT-PHRASE — single significant terms match best; a long phrase may ground nothing. Teaches "NAICS is the wrong primary key" (one obvious code ≈ 28% of a market). Historical obligations, not a forecast. |
| **IDV vehicles** | MCP `search_idv_contracts` — IDIQ/GWAC/BPA base vehicles + task orders flowing through them | USASpending live search (`src/lib/idv-search.ts:searchIDVContracts`) | USASpending forbids mixing contract + IDV award-type groups — one group per call (`search_type` idv vs task). IDV `awardAmount` is a ceiling, not obligated spend. |
| **Contractor award history** | MCP `get_contractor_award_history` — a named firm's prime-award history: total obligations, count, YoY trend, top agencies/NAICS, recent awards | USASpending cache + contractor DB (`src/lib/contractor-sales-history.ts:getContractorSalesHistory`, `publicView` — contacts gated out) | Fuzzy name match — check `match.confidence` (a "low" match may be a name collision). Prime obligations only; no subcontract revenue. |
| **Market depth (Rule of Two)** | MCP `assess_market_depth` — capable-small-business count for a NAICS (+ set-aside/state), Rule-of-Two determination, scored/tiered vendor list | Supabase `sam_entities` + BQ recipients activity enrichment (`src/lib/gov-buyer/market-research.ts:runMarketResearch`) | `registered_only` firms shown separately, never inflate the count. Determination is only as current as `data_as_of` (latest SAM sync). Capability tiering needs BQ activity — if BQ quota is exhausted, entities fall to `registered_only` and `market_depth` reads 0 (honest under-count, same class as search_contractors), NOT fabricated depth. |
| **Solicitation documents** | MCP `get_solicitation_documents` — full SOW/PWS + notice body + downloadable attachments for a notice_id (inline extracted text + short-lived signed download URLs) | Warm: `pursuit_documents` notice-level dedup; cold: on-demand SAM attachment download + pdf-parse/mammoth extract (`src/lib/sam/solicitation-documents.ts` → `fetchAndExtractNoticeFiles`); metadata cached in `mcp_external_cache`, blobs in `pursuit-documents` Storage bucket | Public SAM federal data (no tier gate). `extracted_text` is INLINE-capped (check `*_truncated`); the full text is in the signed `download_url` (expires ~1h — re-call to refresh). Not every notice has attachments — empty `documents` can be legitimate. |
| **Federal events** | MCP `search_federal_events` — upcoming industry days / matchmaking / sources-sought + association conferences for an agency | Supabase `sam_events` (cron-populated SAM.gov Special Notices, DoDAAC-office-anchored) + optional `searchEventsViaAI` (Serper web + Groq) via `src/lib/events/query.ts` | `source="sam"` rows are grounded SAM notices (trust the date); `source="ai"` rows are web-discovered — carry a `confidence` and MUST be verified before attending (misdated/loosely attributed possible). Agency matched via `normalizeAgencyKey`. AI pass off by default; `ai_discovery="unavailable"` when Serper/Groq unconfigured. |
| **Proposal compliance (no external source)** | MCP `scan_proposal_compliance` — pre-submit disqualification scan (deadline, set-aside eligibility, page limits, reps/certs, unaddressed eval factors) against the requirements + draft the CALLER passes | Pure deterministic logic (`src/mcp/tools/scan-compliance.ts` → `src/lib/proposal/*`); NO external API/DB | Runs entirely on caller-supplied inputs — coverage is only as complete as the requirements passed in (a missed requirement can't be checked). `grounded=false` = empty requirements or draft. Not AI; not a legal guarantee of responsiveness. |
| **Bid/no-bid framework (no external source)** | MCP `evaluate_bid_decision` — GovCon Giants' 5 eliminator gates + 10-factor scorecard; returns the rubric always, and scores the card when gate answers + ratings are supplied | Pure deterministic logic (`src/mcp/tools/bid-decision.ts` → `src/lib/proposal/bid-decision.ts`); NO external API/DB | Scores a bidder's SELF-ASSESSMENT — ratings are judgment calls, not measured facts. A failed gate = automatic No-Bid regardless of score. `grounded=true` always (the framework itself is the data). |
| **OSBP / Small Business Office directory** | MCP `lookup_federal_osbp` — the small-business front door (OSBP/OSDBU office, director, contact, acquisition office, forecast URL) for a command/agency | Curated `src/data/dod-command-info.json` via `src/lib/utils/command-info.ts` (static, no LLM/IO) | Curated DoD/DLA/Navy/Army-weighted directory. Office structure + mailboxes are STABLE; director NAMES rotate — each carries a `director_verified` (YYYY-MM) stamp; absent = unverified/role-title. grounded=false = coverage gap, not proof the office doesn't exist. Quarterly refresh (names). |
| **Office-anchored open opps** | MCP `search_agency_opps_by_office` — open SAM.gov solicitations for a specific BUYING OFFICE, anchored on the 6-char DoDAAC prefixing the solicitation number (W912PL = USACE LA District) | Supabase `sam_opportunities` filtered by `solicitation_number ILIKE '<DODAAC>%'`; DoDAACs resolved via `src/lib/gov-contacts/dodaac-directory.ts` (`src/lib/opportunities/by-office.ts`) | Official SAM data; the DoDAAC anchoring avoids the whole-DoD firehose a department filter returns. `_meta.anchor`: "dodaac" = office-precise (DoD/DLA/Navy/Army); "department" = broad civilian preview (no DoDAAC path). grounded=false + anchor="dodaac" = genuinely nothing open now. |
| **SBLO teaming contacts** | MCP `get_sblo_contact` — the Small Business Liaison Officer at a prime (name, title, email, phone, supplier portal) | Curated `src/data/sblo-roster-2026-06.json` (200 legal names, re-researched Jun 2026) → fallback `src/data/prime-contractors-database.json` (3,502 primes), via `src/lib/gov-contacts/sblo-lookup.ts` | Canonical roster is verified Jun-2026; blank fields = "no public SBLO found" (NO fabrication — surfaces the supplier portal). prime_db matches carry older provenance. grounded=false = company not in the curated set. Quarterly refresh — **MANUAL curation, no automated producer** ([lineage](#sblo-lineage-proven-from-git-2026-09-12)). |
| **Federal buying-office contacts** | MCP `search_federal_contacts` — named POCs (contracting officers, contract specialists, small-business) at a buying office, DoDAAC-anchored + OSBP prepended | Supabase `federal_contacts` (SAM POC rows) filtered by `solicitation_number ILIKE '<DODAAC>%'`; office decoded via `dodaac_directory`; `src/lib/gov-contacts/contact-roster.ts` | Official SAM POC data. DoDAAC anchoring returns the office's OWN people, not the whole-DoD firehose (`_meta.anchor`: dodaac/agency-dodaac = office-precise; department = broad civilian preview). Overseas offices filtered out. grounded=false = no matching POC (never invented). POC data can lag staff changes. |
| **Podcast corpus (proprietary)** | MCP `search_podcast_lessons` — real lessons from GovCon Giants podcast guests, matched by topic/agency/NAICS/set-aside/guest | Supabase `podcast_episode_metadata` (`key_lessons`, guest, agencies/NAICS mentioned) via `src/lib/rag/podcast-search.ts` (keyword/structured search, no LLM) | Proprietary GovCon Giants content — un-copyable moat. Every lesson must trace to a returned episode; grounded=false = corpus has no match (do NOT invent a lesson or a guest quote). Grows as episodes are recorded + extracted. |
| **Agency budget trends** | MCP `get_agency_budget_trends` — FY2025→FY2026 discretionary budget authority + trend (growing/cut/stable) for 47 toptier agencies | Curated `src/data/agency-budget-data.json` (OMB FY2026 Discretionary Budget Request + agency Congressional Budget Justifications) | Official OMB/CBJ figures. DISCRETIONARY budget authority ONLY (not total obligations / mandatory spending); FY2025=Enacted, FY2026=President's Request (can change in appropriations). Snapshot dated in `lastUpdated`. grounded=false = agency not in the 47-agency set. |
| **Company keyword derivation** | MCP `derive_company_keywords` — a company's own words (description + past-performance scope) → semantically-ranked search keywords buyers use | `src/lib/market/semantic-keywords.ts` — OpenAI embeddings (`embedText`/`cosineSimilarity`), NO BigQuery | Not a data source — a semantic transform of caller-supplied text. Fails soft to lexical order if embeddings are down (`_meta.ranked`). Inferred search terms, not an official classification; only as good as the input text. grounded=false = not enough input. |
| **Agency spending detail** | MCP `get_agency_spending_detail` — sub-agency (component) breakdown + set-aside distribution (SB/8(a)/SDVOSB/WOSB/HUBZone shares) for a fiscal year | `api.usaspending.gov/api/v2/search/spending_by_category/{awarding_agency,awarding_subagency}` filtered to one toptier agency (`src/lib/usaspending/agency-spending-detail.ts`) | Official USASpending. Agency-filtered single-value aggregates = exact totals (not top-N sums). CONTRACT obligations only (award types A/B/C/D) — NOT total agency budget (grants/mandatory/payroll excluded). Set-aside buckets are mutually exclusive by code. grounded=false = no toptier match; degraded=true = USASpending errored (not $0). |

## Built / curated sources (real provenance, needs periodic refresh)

| Source | What it powers | Built from | Refresh cadence | Last built |
|---|---|---|---|---|
| **Tier-2 / SBLO contractor DB** (2,700+) | Tier-2 teaming partners, SBLO contacts | **MANUAL curated — no automated producer.** Canonical roster `src/data/sblo-roster-2026-06.json` (200 legal entities) was hand-curated Jun 2026 from the SBA Prime Directory; see [SBLO lineage](#sblo-lineage-proven-from-git-2026-09-12). ⚠️ NOT built by `~/Bootcamp/compile-sblo-list.py` — that is the superseded regex scraper this roster replaced for quality. | **Quarterly** (manual) | Jun 2026 (`last_built` 2026-06-01) |
| **DoD command / OSBP directory** (170 commands) | OSBP-by-sub-agency, office structure | `src/data/dod-command-info.json` — gov org hierarchy. Structure is STABLE; only director names rotate. | Quarterly (names only) | Dec 2025 |
| **Agency pain points / intelligence** (3,045 pts, 307 agencies) | Pain points, agency priorities, "similar agencies" | `scripts/merge-agency-intelligence.js` → **GAO high-risk reports** (tagged `(Source: GAO)`) + USASpending spending patterns. The FY2026 NDAA strings that once cited S.2296 (a bill that never became law) were re-cited to **PL 119-60** or retired in `432701f3e` (2026-09-22); none cite S.2296 now. ⚠️ **Open (2026-11-17 audit):** all **278** pain points tagged `(Source: GAO)` trace to GAO documents published **1993–2000** (the historical GovInfo slice in `agency_intelligence`), not current GAO work, and `merge-agency-intelligence.js --merge` would re-inject them from that table. Do not run that merge; remediation is tracked separately. | Quarterly / on new GAO report | Apr 2026 |
| **Mindy Institute — GAO reports** | Institute evidence corpus, derived pain points + `intelligence_changes` | `institute_sources` table ← **GAO RSS** (`gao.gov/rss/reports.xml`) via `/api/cron/institute-gao-sync`. ⚠️ NOT the GovInfo `GAOREPORTS` collection — that is frozen at 2008 and cannot carry a living signal. | **Weekly** (cron, daily poll) | rolling (`data_sources.institute_gao`) |
| **Mindy Institute — Federal Legislation** | Legislative evidence corpus (NDAA + future approps), provenance for legislative claims | `institute_sources` table ← **api.congress.gov** via `/api/cron/institute-legislation-sync`. **Discovery is DYNAMIC and WATERMARKED** — two separate jobs: (A) *discovery* scans `/bill/{congress}` over a `fromDateTime`-bounded window and proves coverage by comparing rows read against the API's own `pagination.count` (a page ceiling yields `partial`, and the cursor does **not** advance); (B) *tracking* re-polls every measure already in the corpus **by identity**, so a known bill stays tracked forever even after thousands of unrelated bills push it out of the recent-update window. **No bill number, fiscal year, or Congress is hardcoded**; a Congress change discards the cursor and forces a full pass. **ONE ROW PER LEGISLATIVE VERSION** (House introduced/reported/engrossed · Senate versions · committee reports · conference text · enacted law) — never collapsed into one "NDAA" record. Authenticated with the existing api.data.gov key. | **Weekly** (cron) | rolling (`data_sources.institute_legislation`) |
| **DoDAAC directory** | Office code → office name | `dodaac_directory` table, from BigQuery FPDS awards via `/api/cron/refresh-dodaac-directory` (`src/lib/gov-contacts/refresh-dodaac-directory.ts`) | **Monthly** (`0 9 6 * *`) | **Measured from the table, not a stamp** (2026-11-17): healthy = newest `updated_at` ≤ 40d **and** ≥ 90% of rows refreshed in that window (`src/lib/data-sources/table-measured.ts`). The job never writes `last_built`, which is why it once alerted as 169 days stale while 4,901/4,902 rows had been refreshed 11 days earlier. |
| **Forecast intelligence** (9,973) | `/forecasts` | 13 agency forecast portals (Excel/CSV/Puppeteer) — see `forecast_sources` table | Weekly (per-source) | rolling |
| **NAICS buyer vocabulary** (25,252) | keyword→NAICS lead selection, onboarding "buyers also say" terms, recompete/forecast work-word chips, alert keyword expansion (`VOCAB_ALERT_EXPANSION`) | `naics_vocabulary` table, from `scripts/build-naics-vocabulary.ts` → **live USASpending award text** (top award descriptions per NAICS) cleaned by **cross-NAICS TF-IDF** (a term appearing across too many codes = filler, dropped). Read via `src/lib/market/vocabulary.ts`. | On rebuild (static; re-run the script when NAICS spend patterns shift materially — no cron) | Jul 2026 |

---

## Full inventory (acquisition due-diligence)

A complete sweep (2026-06-08) accounts for **every** data source in the platform.
This is the acquisition data asset — provenance + refresh plan for each.

**Totals:** 28 static data files · 80+ Supabase tables · 27 live external APIs ·
50+ build/scrape scripts · **~700K+ prod records** (recount 2026-07-30).

### Static data files (28) — all have a build pipeline
`contracts-data.json` (9,450 awards, USASpending), `prime-contractors-database.json`
(2,768 + SBLO, SBA/DHS/DoD dirs), `tribal-businesses-database.json` (SBA 8a/HUBZone/
WOSB), `contractors.json` (2,768), `agency-pain-points.json` (3,045 pts / 307 agencies,
GAO+NDAA), `psc-naics-crosswalk.json` (GSA), `naics-codes.json` (Census/OMB),
`agency-spending-complete.json` (USASpending), `psc-codes.json` (GSA), `dod-command-info.json`
(gov org), `agency-aliases.json`, `agency-budget-data.json` (OMB/Treasury), `naics-top100.ts`
(USASpending), `agencies-seo.ts`, + ~14 smaller curated/snapshot files.

### Supabase tables (80+) — grouped
Opportunities (`sam_opportunities` 145K, `aggregated_opportunities` 732, `dibbs_rfqs` 7.3K,
`recompete_opportunities` 146K, `multisite_sources`,
`scrape_log`), users (`user_profiles`, `user_notification_settings`, `user_business_profiles`,
`user_pipeline`, `user_past_performance`, vault tables), briefings (`briefing_templates`,
`briefing_log` 100K+, `briefing_dead_letter`, `briefing_system_health`), alerts (`alert_log`
100K+), payments (`purchases`, `stripe_*`), RAG (`mindy_rag_documents`, `mindy_rag_chunks` 12.4K),
intel (`agency_intelligence` 557, `agency_forecasts` 9,973, `forecast_sources`/`_sync_runs`,
`naics_vocabulary` 25,252 — buyer-words per NAICS from USASpending award text + TF-IDF),
ops (`tool_errors`, `tool_health_metrics`, `api_provider_status`, `cron_jobs`, `sam_api_cache`),
contacts (`federal_contacts` 185K, `dodaac_directory`).

### Live external APIs (27)
SAM.gov (5 endpoints: opportunities/awards/entity/hierarchy/subaward), USASpending (4),
Grants.gov (2), NIH Reporter, SBIR.gov, GSA (Acquisition Gateway forecasts + CALC rates),
GovInfo (GAO reports), **SEC EDGAR** (company_tickers + companyfacts + submissions),
**Federal Register** (documents), LLMs (Groq/OpenAI/Anthropic/Grok/Perplexity), Stripe.

### Build/scrape scripts (50+)
`~/Bootcamp/`: compile-sblo-list (⚠️ SUPERSEDED — see SBLO lineage; not the roster's producer), scrape-dhs-*, scan-ndaa-sections, search-sba-dsbs-tribal-8a,
research-sba-sblo-contacts, process-dod-csp-pdf. `scripts/`: import-forecasts(+gsa/nsf/ssa),
merge-agency-intelligence, generate-naics-top100, ingest-govcon-podcast, populate-dodaac-directory,
populate-contracting-officers, import-sam-entity-extract, validate-opengov-idiq-against-usaspending.

---

## Refresh ownership (the acquisition discipline: validate · verify · update)

Every curated source has a named refresh path. Tracked as ongoing work, surfaced in
the Command Center Data Sources view (last-built + record count, like the Forecast list).

| Cadence | Sources | How |
|---|---|---|
| **Real-time** | SAM ops, USASpending, Grants, LLMs | live APIs; health via `/api/cron/check-provider-health` |
| **Quarterly** | SBLO/tier-2, tribal DB, pain points (GAO/NDAA), agency intel, NAICS-top100 | SBLO/tier-2 = **MANUAL curation, no script** ([lineage](#sblo-lineage-proven-from-git-2026-09-12)); others: `search-sba-dsbs-tribal-8a.py`, `merge-agency-intelligence.js`. ⚠️ `compile-sblo-list.py` is superseded — do NOT run it to refresh SBLO. |
| **Annual** | NAICS/PSC codes (OMB/GSA), agency budgets (FY rollover), DoDAAC, DoD command names, NDAA | per official release |
| **As-published** | Forecasts (per-agency), SBA goaling | import scripts |

### SBLO lineage (proven from git, 2026-09-12)

Traced after the freshness alert directed a refresh at the wrong producer. Every
claim below is established from git history + the artifacts themselves; nothing
is inferred.

**Refresh method: MANUAL CURATED · no automated producer · repeatability currently incomplete.**

**Canonical serving lineage**

```
SBA Prime Directory (sba.gov)
  → 225-row source roster
  → MANUAL cleaning (dropped non-company rows, merged duplicates/fragments)
  → 200 official legal entities
  → MANUAL / agent-assisted live-source contact research (Jun 2026)
  → data/imports/sblo-refresh-2026-06.csv        (200 rows)
  → src/data/sblo-roster-2026-06.json            (200 contacts — CANONICAL)
  → src/lib/gov-contacts/sblo-lookup.ts          (serving path, tier 1)
```

**Downstream merge branch**

```
data/imports/sblo-refresh-2026-06.csv
  → scripts/import-sblo-refresh.js --write   (Jun 2026; replaced by the .ts importer, PR 3 below)
  → 68 matched companies merged into src/data/prime-contractors-database.json
     (sbloVerified=2026-06)
  → the remaining 132 companies (200 − 68; commit 95f6826c describes them as
     "~130") were NOT inserted. They remain served from the separate canonical
     SBLO roster, pending an architectural decision (insert-as-new vs separate
     store) that has not been made. Reasons recorded at the time: legacy/acquired
     names, universities, regional firms, or risky name-variants.
```

**Evidence**

| Claim | Proof |
|---|---|
| Roster is a one-off manual curation | Its own `metadata.methodology`: *"225-row SBA prime roster cleaned to 200 official legal names… every contact field re-researched Jun 2026 via parallel research agents."* |
| No producer exists | `grep` across `scripts/` + `~/Bootcamp/` finds only `import-sblo-refresh.js` (reads the CSV; now `.ts`, still researches nothing) and `sblo-lookup.ts` (reads the JSON). Nothing **writes** either artifact. |
| CSV and JSON are one dataset | 200/200 companies, identical company sets, **200/200 emails identical, 0 differences**. |
| `compile-sblo-list.py` is NOT the producer | It writes `sblo-list-compiled.csv` / `sblo-list.csv` in `~/Bootcamp/` — different filenames, different schema (`sblo_name`, no `vendorPortal`), and touches neither served artifact. |
| It was replaced for quality | Commit `95f6826c`: refresh was *"re-researched against live sources — not the garbage-producing legacy regex scrapers."* Roster metadata calls itself the *"canonical replacement for the legacy TIER-2-FINAL-CONTACT-LIST (regex-scraped garbage names/emails)."* |
| Coverage profile | `companyCount` 200 · `withSbloName` 41 · `withEmail` 57 · `withPortal` 104 · `mergedIntoPrimeDb` 68. Blank = no public SBLO found (no fabrication). |

Commits: `e517967f` (importer) → `95f6826c` (56 primes, importer hardened for
office/portal-only rows) → `d9de8de2` (103 primes + CSV committed) →
`e88a2efe` (roster JSON added).

**Refresh procedure (Data Core PR 3, 2026-11-17)**

The research step is still manual — company pages change layout and many block bots
(Lockheed returned 403 in the 2026-11-17 sample). What is now tooled is APPLYING that
research without ever making the data less verified.

1. Research each company on its OWN published page. Record, per contact field
   (`sbloName`, `email`, `phone`, `portal`): `<field>_status` =
   `confirmed | changed | not_named | unreachable`, `<field>_verifiedAt` (YYYY-MM-DD) and
   `<field>_sourceUrl`. Optional `email_kind` = `role | personal`. Save as
   `data/imports/sblo-refresh-<YYYY-MM>.csv` (columns: `company,title,source,email_kind,`
   then `sbloName,sbloName_status,sbloName_verifiedAt,sbloName_sourceUrl` and the same four
   for `email`, `phone`, `portal`; the Jun-2026 header `vendorPortal` is accepted for `portal`).
2. Diff (the default — **writes nothing**):
   `npx tsx scripts/import-sblo-refresh.ts --csv data/imports/sblo-refresh-<YYYY-MM>.csv`
   prints a per-company, per-field report (readable, then JSON; `--json` for JSON only)
   against `--base` (default `src/data/sblo-roster-2026-06.json`). `--csv` is **required**;
   there is no default input file.
3. Fix every `REJECTED` field, re-run until `REJECTED 0`.
4. Apply: `... --write --out src/data/sblo-roster-<YYYY-MM>.json` writes a **new** roster file.
   It refuses the base/canonical path, an existing file, and any run with a rejected field.
   `--merge-prime-db` additionally applies the same rules to matched rows of
   `prime-contractors-database.json`. Pointing `sblo-lookup.ts` at the new file is a separate,
   reviewed change.

**Merge rules** (`src/lib/gov-contacts/sblo-refresh.ts`, pinned by `sblo-refresh.unit.test.ts`):

| status | effect |
|---|---|
| `confirmed` | value must equal the one held and carry a sourceUrl → bumps `provenance.<field>.verifiedAt` |
| `changed` | replaces the value **only with a sourceUrl**; the old value is appended to `history.<field>` |
| `not_named` / `unreachable` | value **kept**, `provenance.<field>.staleSince` set — never blanked |
| (blank, no status) | no change — a blank cell never overwrites a populated field |
| a value with no status | rejected |

Role mailboxes win: a verified company mailbox replaces a personal email (the personal one
is kept internally as `personalEmail`, `personalEmailStatus: stale`, never served), and a
personal email never displaces a role mailbox.

**Serving labels.** `sblo-lookup.ts` adds `contact.verification` (additive): per-field
`status` (`verified | unverified | stale`), `verified_at`, `source_url`, plus `email_kind`.
A field is `verified` only with field provenance (confirmed/changed + sourceUrl); every
Jun-2026 snapshot value is `unverified` with `verified_at: "2026-06"`. MCP
`get_sblo_contact` mirrors it as `_meta.email_status` / `_meta.email_kind`, and the chat
answer labels a non-verified email (e.g. "personal email, not re-verified since 2026-06").

Do **not** run `~/Bootcamp/compile-sblo-list.py`. Its output was replaced for quality;
running it risks reintroducing regex-scraped contact data.

### Freshness stamps require evidence (fixed 2026-11-17)

`GET /api/cron/check-data-freshness?stamp=<key>` used to perform
`UPDATE data_sources SET last_built = <today>` with **no evidence that a refresh
occurred** — freshness on the honor system (*no execution ≠ success*,
`docs/engineering/silent-failure-registry.md`). It now goes through
`src/lib/data-sources/stamp-guard.ts`:

- **Required:** `&records=<positive count>` and `&evidence=<what was refreshed and where to check it>`
  (≥ 20 characters, citing a URL, commit, PR or file path). The evidence line is appended to the row's
  `notes`, so every stamp can be audited later.
- **Refused even with evidence:** table-measured sources (`dodaac_directory`), the events catalog
  (freshness comes from the file), producer-stamped sources (`bq_awards`, `bq_award_lookups`,
  `bq_players`, `institute_gao`, `institute_legislation`, `seo_lookup_demand`) and live APIs.
- A stamp is never a way to clear an alert. For `tier2_sblo` the roster already exposes bindable
  evidence (`companyCount` / `withSbloName` / `withEmail` / `withPortal` = 200/41/57/104).

### Needs attention (flagged for acquisition cleanup)
- **Stale snapshots:** `december-hit-list.json`, `december-spend-forecast.json` — refresh or remove.
- **Opinion-based:** `agency-sat-friendliness.json` — re-derive statistically from USASpending or remove.
- **Manual-drift risk:** `agency-procurement-sources.json` (URLs break) — quarterly verify. (`federal-events-sources.json` is now monitored — see below.)

### Federal events catalog (`federal_events_catalog`, monthly)
`src/data/federal-events-sources.json` — curated event series + dated conferences, hand-verified
against **organizer** sites (never a third-party listing).
- **Per-entry truth:** every entry carries `verification {status, checked_at, source_url, note}`.
  Only `verified_upcoming` entries may carry a `next_occurrence`, and every date records
  `verified_at` + `source_url` (enforced by `catalog-integrity.unit.test.ts`). Editing the file
  never makes an entry current.
- **Monitor:** `check-data-freshness` (daily 13:05 UTC) reads review age from the file's own
  `lastFullReview` (no separate stamp), flags dated occurrences that have ended, and on Mondays
  (or `?links=1`) GETs every catalog URL — 404/410 or a deep link now landing on a home page is
  flagged; 403/5xx/timeouts are counted as inconclusive, never as broken. Findings go to the same
  ops alert. None of this runs in CI, so an organizer outage cannot block a deploy.
- **Review procedure:** re-check entries on organizer sites, update `next_occurrence` and
  `verification`, then bump `lastFullReview` (that date IS the stamp).
- **Not yet built:** Phase 3-4 forecast scrapers (HHS/Treasury/EPA/USDA/DOD); 20+ DOE-lab multisite scrapers.
- **Validate:** OpenGov IQ enrichment — run `validate-opengov-idiq-against-usaspending.js` monthly.

### Acquisition-readiness actions (the moat)
1. Define a staleness SLA per source (SAM ≤24h, budgets ≤1mo, contractors ≤3mo).
2. Convert manual refresh scripts → scheduled crons (priority: contractors, forecasts, intel).
3. Keep this registry current — it IS the data-lineage doc a buyer's diligence will ask for.

### Tooling (live — #30/#31)
- **Registry table:** `data_sources` (migration `20260608_data_sources_registry.sql`), seeded from this doc.
- **Command Center view:** `GET /api/admin/data-sources?password=...` — every source by category + freshness + a `needsRefresh` list.
- **Freshness watchdog:** `GET /api/cron/check-data-freshness` — **daily** (dispatcher `cron_jobs`, `5 13 * * *`). Flags any curated source past its cadence (weekly >10d, monthly >35d, quarterly >100d, as-published >120d, annual >380d) + names the refresh procedure, and posts the checklist to the **ops Slack channel** (moved off email 2026-07). The refreshes are human-run — we never auto-stamp `last_built`; after a real refresh, stamp it **with evidence** (`?stamp=<key>&records=<n>&evidence=<...>`, see above). Sources with a scheduled producer are measured from their rows instead (`TABLE_MEASURED_SOURCES`).
  - **Live-sync monitoring (added 2026-06-25):** the watchdog also checks LIVE pipelines by table recency via `LIVE_SYNC_CHECKS` (no stamping — reads `max(updated_at)`). First covered: **`federal_contacts`** (daily SAM POC sync) — if the newest row is >3d old the cron is likely down and it alerts. Closes the gap where a silently-broken daily contacts sync raised no alarm. **For this alert to be timely the dispatcher should fire this job daily** (quarterly-only catches a down sync up to 3 months late).
- **Office rosters (#16):** `GET /api/app/federal-contacts?facets=office-roster&agency=&office=` builds COMPLETE per-buying-office contact lists from DoDAAC-decoded offices (DoD/DLA/Navy; civilian = agency preview). Foreign-filtered.

# Mindy Data Sources Registry

> **Purpose:** the authoritative, permanent record of where EVERY data source in
> Mindy comes from and whether it's real. Eric's principle: every fact must trace
> to a real source. This is that trace. Surfaced in the **Command Center → Data
> Sources** view (like the Forecast list) with last-updated + refresh cadence.
>
> **Rule for future work:** before calling any dataset "unverified," trace its
> BUILD PIPELINE (the scraper / merge script that produced it) — provenance lives
> in the build, not always in an inline `source` field.

_Last verified: 2026-06-08 · updated 2026-07-12 (added Mindy MCP live-API sources: GSA CALC, SEC EDGAR, Federal Register)_

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
| **Agency hierarchy + spending** | MCP `get_agency_intel` — agency identity/hierarchy + curated GovCon pain points & priorities + live USASpending obligations (FY, top NAICS) | `src/lib/agency-hierarchy/unified-search.ts:getAgency` + `spending-stats.ts:getAgencySpending` (→ `api.usaspending.gov` agency endpoints) | Identity/pain-points are curated intel (not an official agency statement); spending is official USASpending obligations. `spending:null` = USASpending had no match, NOT $0 spend. |
| **Grants.gov** | MCP `search_grants` — federal grant (assistance) opportunities by keyword/agency/category | `apply07.grants.gov/grantsws/rest/opportunities/search` (`src/lib/grants/search.ts`) | Official Grants.gov. Assistance funding, not contracts. Agency is a client-side prefix filter (hits carry agencyCode like "DOD-AMRAA"). |
| **Agency forecasts** | MCP `get_agency_forecasts` — planned procurements 6-18mo pre-solicitation | Supabase `agency_forecasts` (~7,700 rows, ~12 agencies) via `src/lib/forecasts/query.ts` | Agency-published forecasts; estimates that slip/cancel. Coverage is ~12 agencies, not government-wide — empty ≠ no demand. Refreshed on forecast-import runs. |
| **SBIR/STTR** | MCP `search_sbir` — NIH RePORTER awarded projects + multisite open notices | `api.reporter.nih.gov/v2/projects/search` (activity codes R43/R44/R41/R42) + Supabase `aggregated_opportunities` (`src/lib/sbir/search.ts`) | Official NIH RePORTER (source="nih" = AWARDED projects, not open sols) + aggregated open notices (source="multisite"). NIH is health-research heavy. |
| **Recompetes** | MCP `get_expiring_contracts` — federal contracts expiring within a window (recompete targets) | Supabase `recompete_opportunities` (USASpending-derived) via `src/lib/recompete/query.ts` | USASpending-derived. A multiple-award IDIQ appears as several rows (one per holder) — NOT deduped to one vehicle here. `recompete_likelihood` is an inference. |
| **OSBP / Small Business Office directory** | MCP `lookup_federal_osbp` — the small-business front door (OSBP/OSDBU office, director, contact, acquisition office, forecast URL) for a command/agency | Curated `src/data/dod-command-info.json` via `src/lib/utils/command-info.ts` (static, no LLM/IO) | Curated DoD/DLA/Navy/Army-weighted directory. Office structure + mailboxes are STABLE; director NAMES rotate — each carries a `director_verified` (YYYY-MM) stamp; absent = unverified/role-title. grounded=false = coverage gap, not proof the office doesn't exist. Quarterly refresh (names). |
| **Office-anchored open opps** | MCP `search_agency_opps_by_office` — open SAM.gov solicitations for a specific BUYING OFFICE, anchored on the 6-char DoDAAC prefixing the solicitation number (W912PL = USACE LA District) | Supabase `sam_opportunities` filtered by `solicitation_number ILIKE '<DODAAC>%'`; DoDAACs resolved via `src/lib/gov-contacts/dodaac-directory.ts` (`src/lib/opportunities/by-office.ts`) | Official SAM data; the DoDAAC anchoring avoids the whole-DoD firehose a department filter returns. `_meta.anchor`: "dodaac" = office-precise (DoD/DLA/Navy/Army); "department" = broad civilian preview (no DoDAAC path). grounded=false + anchor="dodaac" = genuinely nothing open now. |

## Built / curated sources (real provenance, needs periodic refresh)

| Source | What it powers | Built from | Refresh cadence | Last built |
|---|---|---|---|---|
| **Tier-2 / SBLO contractor DB** (2,700+) | Tier-2 teaming partners, SBLO contacts | `~/Bootcamp/compile-sblo-list.py` + `automated-sblo-research.py` → **SBA Prime Directory** (sba.gov), **DoD CSP Prime Directory** (business.defense.gov), **DHS OSDBU** (dhs.gov), + **company-website scraping** | **Quarterly** | Dec 2025 |
| **DoD command / OSBP directory** (170 commands) | OSBP-by-sub-agency, office structure | `src/data/dod-command-info.json` — gov org hierarchy. Structure is STABLE; only director names rotate. | Quarterly (names only) | Dec 2025 |
| **Agency pain points / intelligence** (3,045 pts, 307 agencies) | Pain points, agency priorities, "similar agencies" | `scripts/merge-agency-intelligence.js` → **GAO high-risk reports** (tagged `(Source: GAO)`) + **NDAA** (`~/Bootcamp/scan-ndaa-sections.py`) + USASpending spending patterns | Quarterly / on new GAO report | Apr 2026 |
| **DoDAAC directory** | Office code → office name | `dodaac_directory` table, from BigQuery FPDS awards | As FPDS data updates | Jun 2026 |
| **Forecast intelligence** (7,764) | `/forecasts` | 13 agency forecast portals (Excel/CSV/Puppeteer) — see `forecast_sources` table | Weekly (per-source) | rolling |
| **NAICS buyer vocabulary** (25,252) | keyword→NAICS lead selection, onboarding "buyers also say" terms, recompete/forecast work-word chips, alert keyword expansion (`VOCAB_ALERT_EXPANSION`) | `naics_vocabulary` table, from `scripts/build-naics-vocabulary.ts` → **live USASpending award text** (top award descriptions per NAICS) cleaned by **cross-NAICS TF-IDF** (a term appearing across too many codes = filler, dropped). Read via `src/lib/market/vocabulary.ts`. | On rebuild (static; re-run the script when NAICS spend patterns shift materially — no cron) | Jul 2026 |

---

## Full inventory (acquisition due-diligence)

A complete sweep (2026-06-08) accounts for **every** data source in the platform.
This is the acquisition data asset — provenance + refresh plan for each.

**Totals:** 28 static data files · 80+ Supabase tables · 27 live external APIs ·
50+ build/scrape scripts · ~400K+ prod records.

### Static data files (28) — all have a build pipeline
`contracts-data.json` (9,450 awards, USASpending), `prime-contractors-database.json`
(2,768 + SBLO, SBA/DHS/DoD dirs), `tribal-businesses-database.json` (SBA 8a/HUBZone/
WOSB), `contractors.json` (2,768), `agency-pain-points.json` (3,045 pts / 307 agencies,
GAO+NDAA), `psc-naics-crosswalk.json` (GSA), `naics-codes.json` (Census/OMB),
`agency-spending-complete.json` (USASpending), `psc-codes.json` (GSA), `dod-command-info.json`
(gov org), `agency-aliases.json`, `agency-budget-data.json` (OMB/Treasury), `naics-top100.ts`
(USASpending), `agencies-seo.ts`, + ~14 smaller curated/snapshot files.

### Supabase tables (80+) — grouped
Opportunities (`sam_opportunities` 29K, `aggregated_opportunities` 50K, `multisite_sources`,
`scrape_log`), users (`user_profiles`, `user_notification_settings`, `user_business_profiles`,
`user_pipeline`, `user_past_performance`, vault tables), briefings (`briefing_templates`,
`briefing_log` 100K+, `briefing_dead_letter`, `briefing_system_health`), alerts (`alert_log`
100K+), payments (`purchases`, `stripe_*`), RAG (`mindy_rag_documents`, `mindy_rag_chunks` 50K),
intel (`agency_intelligence` 557, `agency_forecasts` 7,764, `forecast_sources`/`_sync_runs`,
`naics_vocabulary` 25,252 — buyer-words per NAICS from USASpending award text + TF-IDF),
ops (`tool_errors`, `tool_health_metrics`, `api_provider_status`, `cron_jobs`, `sam_api_cache`),
contacts (`federal_contacts` 123K, `dodaac_directory`).

### Live external APIs (27)
SAM.gov (5 endpoints: opportunities/awards/entity/hierarchy/subaward), USASpending (4),
Grants.gov (2), NIH Reporter, SBIR.gov, GSA (Acquisition Gateway forecasts + CALC rates),
GovInfo (GAO reports), **SEC EDGAR** (company_tickers + companyfacts + submissions),
**Federal Register** (documents), LLMs (Groq/OpenAI/Anthropic/Grok/Perplexity), Stripe.

### Build/scrape scripts (50+)
`~/Bootcamp/`: compile-sblo-list, scrape-dhs-*, scan-ndaa-sections, search-sba-dsbs-tribal-8a,
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
| **Quarterly** | SBLO/tier-2, tribal DB, pain points (GAO/NDAA), agency intel, NAICS-top100 | re-run `compile-sblo-list.py`, `search-sba-dsbs-tribal-8a.py`, `merge-agency-intelligence.js` |
| **Annual** | NAICS/PSC codes (OMB/GSA), agency budgets (FY rollover), DoDAAC, DoD command names, NDAA | per official release |
| **As-published** | Forecasts (per-agency), SBA goaling | import scripts |

### Needs attention (flagged for acquisition cleanup)
- **Stale snapshots:** `december-hit-list.json`, `december-spend-forecast.json` — refresh or remove.
- **Opinion-based:** `agency-sat-friendliness.json` — re-derive statistically from USASpending or remove.
- **Manual-drift risk:** `federal-events-sources.json`, `agency-procurement-sources.json` (URLs break) — quarterly verify.
- **Not yet built:** Phase 3-4 forecast scrapers (HHS/Treasury/EPA/USDA/DOD); 20+ DOE-lab multisite scrapers.
- **Validate:** OpenGov IQ enrichment — run `validate-opengov-idiq-against-usaspending.js` monthly.

### Acquisition-readiness actions (the moat)
1. Define a staleness SLA per source (SAM ≤24h, budgets ≤1mo, contractors ≤3mo).
2. Convert manual refresh scripts → scheduled crons (priority: contractors, forecasts, intel).
3. Keep this registry current — it IS the data-lineage doc a buyer's diligence will ask for.

### Tooling (live — #30/#31)
- **Registry table:** `data_sources` (migration `20260608_data_sources_registry.sql`), seeded from this doc.
- **Command Center view:** `GET /api/admin/data-sources?password=...` — every source by category + freshness + a `needsRefresh` list.
- **Freshness watchdog:** `GET /api/cron/check-data-freshness` — **quarterly** (dispatcher cron_jobs, `0 13 1 1,4,7,10 *`). Flags any curated source past its cadence (quarterly >100d, annual >380d) + names the refresh script. When overdue it **EMAILS the refresh checklist** (cron runs unattended). The refreshes are HUMAN-run scrapers — we never auto-stamp `last_built` (that would fake freshness); after running a script, mark it done with `?stamp=<source key>`. The discipline that keeps the data layer provably MAINTAINED.
  - **Live-sync monitoring (added 2026-06-25):** the watchdog also checks LIVE pipelines by table recency via `LIVE_SYNC_CHECKS` (no stamping — reads `max(updated_at)`). First covered: **`federal_contacts`** (daily SAM POC sync) — if the newest row is >3d old the cron is likely down and it alerts. Closes the gap where a silently-broken daily contacts sync raised no alarm. **For this alert to be timely the dispatcher should fire this job daily** (quarterly-only catches a down sync up to 3 months late).
- **Office rosters (#16):** `GET /api/app/federal-contacts?facets=office-roster&agency=&office=` builds COMPLETE per-buying-office contact lists from DoDAAC-decoded offices (DoD/DLA/Navy; civilian = agency preview). Foreign-filtered.

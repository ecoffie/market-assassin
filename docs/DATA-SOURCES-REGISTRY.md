# Mindy Data Sources Registry

> **Purpose:** the authoritative, permanent record of where EVERY data source in
> Mindy comes from and whether it's real. Eric's principle: every fact must trace
> to a real source. This is that trace. Surfaced in the **Command Center → Data
> Sources** view (like the Forecast list) with last-updated + refresh cadence.
>
> **Rule for future work:** before calling any dataset "unverified," trace its
> BUILD PIPELINE (the scraper / merge script that produced it) — provenance lives
> in the build, not always in an inline `source` field.

_Last verified: 2026-06-08 · updated 2026-07-11 (added NAICS buyer vocabulary source)_

---

## Live API sources (real-time, no refresh needed)

| Source | What it powers | Endpoint | Provenance |
|---|---|---|---|
| **USASpending — awards** | Market totals, top agencies, suggest-codes $, teaming primes, bid/no-bid competitors | `api.usaspending.gov/api/v2/search/spending_by_category/*` | Official federal award data. Fiscal year via `fiscalYearTimePeriod()` (auto-rolls). |
| **USASpending — IDV/IDIQ** | IDV/IDIQ contracts (real UEIs, $, award IDs) | `spending_by_award` w/ `award_type_codes:[IDV_*]` (`src/lib/idv-search.ts`) | Official. The task-order granularity. |
| **USASpending — offices** | Office-level drill-down | `spending_by_award` → `Awarding Office` | Official, aggregated per office. |
| **SAM.gov** | Opportunities, `federal_contacts` POCs | `api.sam.gov/opportunities/v2` | Official federal solicitation data. |
| **Grants.gov** | Federal grants | `api.grants.gov/v1/api/search2` | Official. |

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

**Totals:** 28 static data files · 80+ Supabase tables · 24 live external APIs ·
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

### Live external APIs (24)
SAM.gov (5 endpoints: opportunities/awards/entity/hierarchy/subaward), USASpending (4),
Grants.gov (2), NIH Reporter, SBIR.gov, GSA (Acquisition Gateway forecasts + CALC rates),
GovInfo (GAO reports), LLMs (Groq/OpenAI/Anthropic/Grok/Perplexity), Stripe.

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

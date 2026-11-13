# Mindy SEO recovery: November 2026

Running record of the recovery from the July to September 2026 indexing collapse (Search Console:
10,173 indexed on 2026-08-16 → 1,347 on 2026-11-07). Keep it current; it replaces chat history.

## Shipped
| PR | What | Production evidence |
|---|---|---|
| #1993 | Cold cache never 404/noindex on contractor pages (bounded live lookup, 5xx on failure) | 260/260 sampled contractor URLs 200 + indexable (2026-11-13) |
| #1994 | Per-family sitemaps, data-dated lastmod, opportunities 798 → ~9.5K, crawlable links | 8 sitemaps valid, 0 duplicates; hub links 408/408 200 |
| #1995 | Award/forecast/awards pages 5xx instead of noindex; `/api/cron/seo-materialize` (daily `cron_jobs` row) | /forecasts + /awards 200 indexable |
| #1996 | Award "not found" cached 7 days, versioned by lookup-table build | negative stamped with build, legacy 90-day entries retired |
| #1997 | Facet sitemap deterministic, route-valid, 700 URLs | 700/700 200 + indexable + self-canonical |
| this PR | Atomic, validated award lookup rebuild, run after the weekly ingest | see below |

## Award lookup tables
`award_detail_lookup` (serves `/awards/[id]`) and `piid_lookup` (serves `/contracts/[piid]`) are derived
from `usaspending.awards`. They were last rebuilt 2026-06-02 (newest action 2026-04-23) while the
warehouse ran to 2026-11-04, so every award since late April read as "not found".

Rebuilt 2026-11-13 08:33 UTC with `scripts/rebuild-award-lookups.ts`: 54,374,856 award rows and
49,376,705 PIID rows, newest action 2026-11-04 (= warehouse), 23/23 probes, ~42.7 GB scanned; 228/228
monitored award requests returned 200 during the run.

Runbook:
- Dry run: `npx tsx scripts/rebuild-award-lookups.ts`
- Rebuild: `npx tsx scripts/rebuild-award-lookups.ts --go [--probe <award_id>]`
- Roll back: `npx tsx scripts/rebuild-award-lookups.ts --rollback` (copies `<table>__prev` back)
- Runs automatically after a successful weekly ingest (`.github/workflows/bq-awards-ingest.yml`, Sundays
  14:00 UTC): the step runs only if the import and its post-apply verification succeeded (a delayed or
  failed USAspending export fails the import step, so the rebuild is skipped), with `--skip-if-current`
  so a week with no new data costs one ~0.4 GB check instead of a ~43 GB rebuild.
- Freshness alert: the daily `check-data-freshness` cron (13:05 UTC, ops Slack) compares the lookups'
  last successful source date with the warehouse's (`bq_awards` clocks) and alerts when they lag more
  than 36h after a merge, when the last rebuild failed, or after a rollback.
- Outcome log: Supabase `data_sources` row `bq_award_lookups`.
- Never run `build-lookup-tables.sh` (retired: it drops production tables before rebuilding).
- Do not bump `DATA_VERSION` after a rebuild: negatives are versioned by the table build time.

## Search Console actions
Done: `https://getmindy.ai/sitemap-index.xml` submitted 2026-11-13 (downloaded, 0 errors). Older
registrations kept until the index is processed.

Pending (UI only; no API):
1. Validate Fix on **Soft 404**: safe (36/36 sampled are contract pages, all now 200 + indexable).
2. **Not found (404)**: **do not validate yet.** Classified 2026-11-13 (below): 17% of the examples
   still answer 5xx. Validate only after the tab fix (#2025) is live and a re-run shows ~0 5xx.
3. Request indexing (verified 200, indexable, self-canonical on 2026-11-13):
   - https://getmindy.ai/contractors/accenture-inc/contracts
   - https://getmindy.ai/contractors/cherokee-nation-businesses-llc/contracts
   - https://getmindy.ai/contractors/compass-medical-provider-llc/contracts
   - https://getmindy.ai/contractors/caddell-construction-co-de-llc/contracts
   - https://getmindy.ai/contractors/emergent-llc/contracts
   - https://getmindy.ai/contractors/cynergy-professional-systems-llc/contracts
   - https://getmindy.ai/contractors/sanmina-sci-corporation/contracts
   - https://getmindy.ai/contractors/the-trustees-of-columbia-university-in-the-city-of-new-york
   - https://getmindy.ai/contractors/a2-labs-llc
   - https://getmindy.ai/contractors/aegis-defence-services-limited

## Not found (404) classification: 2026-11-13
Search Console export (issue "Not found (404)", all known pages): 7,338 affected, 1,000 examples
(500 profiles, 416 `/contracts`, 2 `/contracts/2`, 65 `/naics`, 17 `/agencies`). 951 last crawled
in August. Every URL fetched from production (Googlebot UA, redirects followed, failures retried),
every slug checked in BigQuery (`recipients_rollup_merged`, `recipients`, and the alias resolver).

| Type | URLs | 200 | 308 to canonical | Real 404 | False 5xx (real contractor) | 5xx (no data match) | False 404 |
|---|---|---|---|---|---|---|---|
| Profile | 500 | 414 | 4 | 0 | 78 | 4 | 0 |
| Contracts | 418 | 333 | 4 | 0 | 79 | 2 | 0 |
| NAICS tab | 65 | 58 | 5 | 1 | 0 | 0 | 1 |
| Agencies tab | 17 | 14 | 1 | 0 | 0 | 0 | 2 |
| **All** | **1,000** | **819** | **14** | **1** | **157** | **6** | **3** |

- **Original 404 defect fixed:** 833 of 1,000 are a real 200 or a correct 308.
- **All 72 tab 200s are noindex in the "being refreshed" state** (row cache cold), not the thin
  (<5 rows) rule. Correct for a 404 validation (not a 404); tab rows have no warmer.
- **157 false 5xx = cold cache with the contractor cold budget spent** (`rl:seo-cold:*` was at
  contractor 780 / contracts 2,326 against the default 200/day). 161 of the 162 slugs were in the
  warm queue; 161 were moved to the front of the priority queue on 2026-11-13 (+10,000 score,
  the "has Search Console impressions" tier; prior scores in the PR thread).
- **3 false 404s:** tabs resolved aliases cache-only (`valkyrie-enterprises-inc/naics`,
  `the-university-of-dayton/agencies`, `general-dynamics-corporation/agencies`). Fixed in #2025.
- **7 slugs exist nowhere in the data** (e.g. `ii-vi-incorporated`, `young-and-rubicam-inc`):
  should be real 404s; 6 answer 5xx until a budgeted lookup confirms the absence.
- **No obsolete routes.**

Evidence (kept in git; the scratchpad copy is temporary):
- `docs/seo-recovery/gsc-404-examples-2026-11-13.csv`: the raw Search Console export (Table.csv)
- `docs/seo-recovery/gsc-404-classification-2026-11-13.csv`: per-URL status, final status,
  robots, redirect target, data match, alias canonical, classification
- `docs/seo-recovery/crawl-gsc-examples.py`: the crawler
  (`python3 -I crawl-gsc-examples.py <Table.csv> <out.json>`, 6 concurrent, Googlebot UA)

Warming math: priority warms are capped at 2,000 per UTC day, 100 per hourly run (`23 * * * *`,
`WARM_PRIORITY_DAILY_CAP` / `WARM_PRIORITY_PER_RUN`). The warmer resolves only slugs that are
themselves rollup or single-UEI names. **Alias slugs and nonexistent slugs are "skipped" by the
warmer** and resolve only through the daily cold budget on a real request.

- Contractor warming: priority queue (#1998), seeded after deploy.
- Award cold budget stays 4,000/day; re-measure distinct demand after the rebuild.
- 3,473 queued contractor slugs resolve only via the alias path, which stays disabled.

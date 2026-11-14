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
2. **Not found (404)**: **do not validate until the 2026-11-14 re-run (below) is reviewed.** No
   false 404s remain; 80 of 1,000 still answer 5xx, 77 of them `/contracts` pages blocked by the
   contracts cold budget.
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
  `the-university-of-dayton/agencies`, `general-dynamics-corporation/agencies`). Fixed in #2025
  (merged + deployed 2026-11-14 00:30 UTC, `ab82b851`).
- **7 slugs exist nowhere in the data** (e.g. `ii-vi-incorporated`, `young-and-rubicam-inc`):
  should be real 404s; 6 answer 5xx until a budgeted lookup confirms the absence.
- **No obsolete routes.**

Evidence (kept in git; the scratchpad copy is temporary):
- `docs/seo-recovery/gsc-404-examples-2026-11-13.csv`: the raw Search Console export (Table.csv)
- `docs/seo-recovery/gsc-404-classification-2026-11-13.csv`: per-URL status, final status,
  robots, redirect target, data match, alias canonical, classification
- `docs/seo-recovery/crawl-gsc-examples.py`: the crawler
  (`python3 -I crawl-gsc-examples.py <Table.csv> <out.json>`, 6 concurrent, Googlebot UA)

## Not found (404) re-run: 2026-11-14 00:33 UTC
Same 1,000 URLs, same crawler, 3 minutes after #2025 reached production and 33 minutes after the
UTC budget reset. Per-URL results: `docs/seo-recovery/gsc-404-classification-2026-11-14-rerun.csv`
(adds `tab_state` and the previous run's final status).

| Type | URLs | 200 indexable | 308 to canonical | 200 noindex (intentional) | Genuine 404 | False 404 | Temporary 5xx |
|---|---|---|---|---|---|---|---|
| Profile | 500 | 449 | 15 | 29 thin | 4 | 0 | 3 |
| Contracts | 418 | 334 | 5 | 0 | 2 | 0 | 77 |
| NAICS tab | 65 | 0 | 5 (noindex) | 59 rows not cached | 1 | 0 | 0 |
| Agencies tab | 17 | 0 | 3 (noindex) | 14 rows not cached | 0 | 0 | 0 |
| **All** | **1,000** | **783** | **28** | **102** | **7** | **0** | **80** |

The 308 column counts redirects whose target answers 200. The 8 tab redirects land on noindex
tabs (rows not cached).

- **False 404s: 0.** The three tab URLs 308 to their canonical tabs; `tcom-...` tab is a genuine 404.
- **Genuine 404s: 7**, all slugs that exist nowhere in the data (6 were 5xx on 2026-11-13).
- **Intentional noindex: 102.**
  - 29 profiles hit the existing thin rule (`< $25K` or `< 2 awards`). This includes single-award
    joint ventures such as Salado Isolation Mining ($1.9B, 1 award). That's by design, not a
    cache failure.
  - 73 tab pages (81 counting the 8 reached by redirect) are noindex because their ROWS are not
    cached (see below). None are thin, none render a table.
- **Temporary 5xx: 80.**
  - 77 `/contracts` pages: all 77 contractors resolve (74 profiles 200, 3 redirect). The contracts
    page-data key is cold and the contracts cold budget was spent (215 by 00:33, 298 by 00:35
    against 200/day). The warm cron does not warm the `/contracts` page key (`warmSlug` warms the
    profile sections only), so these depend on the daily budget.
  - 3 profiles: alias slugs (`the-afx-group-llc`, `indica-labs-inc`, `royal-arc-welding-company`)
    whose alias key is not yet cached. The warmer skips alias slugs, so they also depend on the
    daily budget.
- **The 161 prioritized contractors:** drained by the 23:23 and 00:23 UTC warm runs (160 left the
  queue; the one remaining, `the-university-of-dayton`, was re-added at score 1 by a live miss and
  now resolves through its cached alias). Identity cache: 138 cached, 12 alias cached, 6 confirmed
  absent, 5 alias key still cold. Of the 157 URLs that were false 5xx on 2026-11-13: 38 now answer
  200 indexable, 12 a 308, 27 200 thin-noindex, 3 a profile 5xx (alias) and 77 a `/contracts` 5xx
  (above). The 6 no-data 5xx are now genuine 404s.
- **Queue health after the +10,000 bump:** no residue. 5,157 queued, top scores back at the normal
  725, warms today 85 of 2,000, legacy set 9,061. The bump only reordered work.

## NAICS / agencies tabs: thin vs not cached
Both render `noindex, follow`, for different reasons. Only the first is a content judgement.

| State | `data-subpage-state` | Meaning | Fix |
|---|---|---|---|
| **Thin** | none (table renders) | Data answered with 1 to 4 rows (`SUBPAGE_MIN_ROWS = 5`) | None. Intentional. |
| **No rows** | `none` | Data answered with zero rows | None. Intentional. |
| **Not cached** | `unavailable` | Row key (`all-naics` / `all-agencies`) is cold. No warmer fills it and the tab never reads BigQuery live | Only a tab-row warmer would change this |

On 2026-11-14 every one of the 81 tab pages in the sample was **not cached**. None were thin. So
the noindex on these tabs today is a cache-state outcome, not a judgement that the tab is
worthless. The rows exist for most of these contractors (the profile's top-NAICS / top-agency
sections are warm). This section only records the distinction. It does not propose a tab-indexing
project: the tabs stay out of the sitemap until rows are cached
(`subpageSitemapEligible`). Note that when a data source can't answer, contractor *resolution*
returns a 5xx (#2025) while the *rows* return noindex. A 5xx for cold rows would mean a 5xx on
nearly every tab indefinitely, and Google slows crawling of a host that serves many 5xx.

Warming math: priority warms are capped at 2,000 per UTC day, 100 per hourly run (`23 * * * *`,
`WARM_PRIORITY_DAILY_CAP` / `WARM_PRIORITY_PER_RUN`). The warmer resolves only slugs that are
themselves rollup or single-UEI names. **Alias slugs and nonexistent slugs are "skipped" by the
warmer** and resolve only through the daily cold budget on a real request.

- Contractor warming: priority queue (#1998), seeded after deploy.
- Award cold budget stays 4,000/day; re-measure distinct demand after the rebuild.
- 3,473 queued contractor slugs resolve only via the alias path, which stays disabled.

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
| #2001 | Atomic, validated award lookup rebuild, run after the weekly ingest | see "Award lookup tables" |
| #2025 | NAICS/agencies tabs resolve through `resolveContractorForPage` | 3 false 404s → 308; genuine 404s stay 404 |
| #2031 | Serving-table build reads child UEIs; real size check + one-time override; queue supersession; 36h queued alert | build 12 promoted 2026-11-14 (below) |
| this PR | Validator reads pages in a total order and refuses duplicate/missing pages; BigQuery cost labels | regression test; no data change |

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
2. **Not found (404)**: **on hold until the final audit (below) is reviewed.** The durable
   `/contracts` table was rebuilt and promoted on 2026-11-14 (source 2026-11-04).
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

## Not found (404) re-run 2: 2026-11-14 01:35 UTC
After a one-off authenticated preview run of the (closed) #2029 page-1 warmer filled the KV keys
for the 76 contractors behind the 77 failing `/contracts` URLs. Per-URL results (status, final
URL, robots, canonical, cache): `docs/seo-recovery/gsc-404-classification-2026-11-14-rerun2.csv`.

| Result | Count |
|---|---|
| 200 | 958 |
| 308 to a 200 canonical | 34 |
| Indexable | 881 (466 profiles, 415 `/contracts`) |
| Intentional noindex | 111 (81 tabs, rows not cached; 30 thin profiles) |
| Genuine 404 | 7 |
| False 404 | 0 |
| Temporary 5xx | 1 (`performant-financial-corporation/contracts/2`) |

Every 200 and every redirect target is self-canonical.

**#2029 closed, not merged.** Warming `/contracts` page 1 per contractor from the cron billed
280 GiB for 157 cold pages in that one run (rows query about 1.8 GiB each, up to 12 GB; count
query 21 GiB), against 45 GiB for every other warm query. Per-contractor live reads are the wrong
shape for this page. The durable serving table is the right one (next section).

## Durable `/contracts` serving table: dry run, 2026-11-14
Read-only. No staging write, no promotion, no job state changed.

**Root cause of the staleness.** `awards-refresh` (daily 11:00 UTC) checks upstream freshness and
enqueues an `awards_build_jobs` row whenever the warehouse moved. The build itself runs in
`/api/cron/awards-build-worker`, and **nothing schedules that worker**: there is no `cron_jobs`
row and no `vercel.json` entry. Jobs 3 and 4 (Aug 25, Aug 30) were run by hand. Jobs 5 to 12
(2026-09-07 to 2026-11-09, upstream 2026-09-04 to 2026-11-04) are all `queued`, 0 attempts.
`awards-refresh` reports `success` because enqueueing succeeded, so nothing alerted.

**Measurements**

| Item | Value |
|---|---|
| Live generation | `2026-08-28-build-4-a1-c75cc3c6`, promoted 2026-08-30, source as of 2026-08-28 (78 days stale) |
| Live rows | 23,434 pages, 9,613 contractors (3 retired generations also retained; `awards-prune` is dry-run only) |
| Upstream source | 2026-11-04 (job 12) |
| Build query estimate | **17.25 GiB** dry run (`BUILD_QUERY`, cap `MAX_BYTES_BILLED` 20 GiB, about 14% headroom). Aug 30 actual: about 4 min |
| Eligible contractors | top 12,000 rollups by total obligated (same set as the sitemap) |
| Expected output, query as-is | **9,576 contractors, 23,415 page rows** |
| Expected output, child-UEI fix | **12,000 contractors, 30,978 page rows** |
| Coverage analysis cost | 1.39 GiB, run once |

**Defect in the build query (and in the older `scripts/build-awards-serving-pages.ts`).** Both
scope awards with `a.recipient_uei = rollup_uei`: only the parent UEI's own awards. The page's
live reader uses every child UEI (`recipient_uei IN UNNEST(child_ueis)`). Result in the top
12,000: **2,424 contractors have no rows at all** (all their awards sit under child UEIs) and
**2,205 more are undercounted**. That is why the table holds 9,613 contractors, not 12,000.

**Coverage of the pages from the audit**

| Pages | Covered as-is | Covered only with the child-UEI fix | Outside the top 12,000 |
|---|---|---|---|
| 77 formerly failing `/contracts` URLs | 1 | 68 (incl. `belcan-llc`, `manson-construction-holding-company` via their canonicals) | 8 (`swiss-steel-holding-ag`, `pae-government-services-inc`, `veteran-enterprise-technology-services-llc`, `r2c-inc`, `ayers-saint-gross-incorporated`, `entergy-arkansas-inc`, `norvel-f-wood-jr`, `hitachi-zosen-corporation` → `nac-international-inc`) |
| `performant-financial-corporation/contracts/2` | no (0 parent actions) | yes (263 child actions, pages 1 to 3) | |

The 8 outside the top 12,000 are never in the durable table under any design. They rely on KV
(now warm) and the render-time contracts budget.

**Schema.** `awards_serving_pages` columns (`recipient_uei, page_number, page_size, data_version,
lifecycle, row_count, payload, contract_count, displayed_action_count, total_action_count,
displayed_obligated, source_as_of, generated_at, payload_checksum`) match what the worker writes
and what `readServedPageState()` reads (`recipient_uei` = rollup UEI, `page_size` 50, version from
the `awards_active_version` pointer). No migration is needed.

**Staging isolation.** The worker writes `lifecycle='staging'` under a new, never-reused
`data_version`, validates it, runs a plausibility check, promotes with one RPC
(`promote_awards_version`, pointer flip, no zero-live window), reads production back, and on any
failure deletes only its own staging version. The live generation is untouched until the RPC.
Readers select by the pointer, so staging rows are invisible. **Do not use
`scripts/build-awards-serving-pages.ts`:** it writes `data_version = DATA_VERSION`, promotes by
retiring live first (a zero-live window), and never moves the pointer, so its output would never
be served.

**Risks**
1. **Backlog:** `claimNextJob()` takes the OLDEST queued job. Scheduling the worker as-is would run
   up to 8 builds (about 17 GiB each, about 140 GiB) and label generations with stale source
   versions. Jobs 5 to 11 must be marked superseded first (a write; needs approval).
2. **Plausibility gate:** it refuses to promote if contractors or pages move more than 10% from
   live. The child-UEI fix moves contractors +25% and pages +32%, so the first fixed build needs
   an explicit, one-time, logged tolerance override.
3. **Cost headroom:** 17.25 GiB against a 20 GiB cap. Warehouse growth (or the child-UEI join)
   could exceed it. The fixed query must be dry-run before raising anything.
4. **KV precedence:** pages read KV before the table, so pages with a live KV entry keep serving
   that entry until its TTL. No cache is cleared (intended), but the new data shows gradually.
5. **Retention:** retired generations are kept (prune is dry-run only). Each generation is
   about 1.05M award objects. Fine for now; watch storage.

**Safe rebuild plan (not executed; each step needs approval)**
1. *PR:* scope `BUILD_QUERY` by child UEIs (keep `recipient_uei` = rollup UEI as the row key),
   retire the old script, make the plausibility gate accept a one-time override, and alert
   when a queued build job is older than 36h (the monitoring gap that hid this). Dry-run the
   new query for bytes before merge.
2. *Data:* mark jobs 5 to 11 `superseded` (7 rows), leaving job 12 (source 2026-11-04).
3. *Build:* run the worker once by hand for job 12. Staging write, validate (counts, coverage,
   page counts, source date, checksums, sample records for 5 known contractors), plausibility
   with the override, atomic promote, read-back. A failure leaves the August generation live.
4. *Verify:* `performant-financial-corporation/contracts/2` and a sample of the 68 serve from the
   table (`servedFrom: 'table'`) with the 2026-11-04 as-of date.
5. *Schedule:* insert a `cron_jobs` row for `awards-build-worker`, after verifying the route on
   prod. The worker returns `idle` with no job, so a frequent tick is free. Builds then follow
   the weekly ingest through `awards-refresh`'s freshness gate (one build per upstream advance).
6. *Search Console:* re-run the 1,000-URL audit once, then decide on the 404 validation.

## Durable `/contracts` serving table: production rebuild, 2026-11-14
Executed with #2031 deployed (`3ac645e2`) after the migration
`20261114_awards_build_jobs_supersede_override.sql` (applied `--only`, checksum `1333fd7f98679225`).

| Item | Value |
|---|---|
| Superseded | jobs 5-11 (exactly 7 rows), `superseded_by = 12`; rows kept |
| One-time override | job 12 only: source 2026-11-04, recipients 11,900-12,100, pages 30,500-31,500, authorized 2026-11-14 02:40 UTC |
| Build | job 12, attempt 1, `worker-44323649`, 387 s; BigQuery job `job_V1nSgb_yz6u07Csao9tfeVJCDvZS` billed **17.255 GiB** (cap 20 GiB) |
| Promoted generation | **`2026-11-04-build-12-a1-6a6edf7a`**, 2026-11-14 02:47:39 UTC, source as of **2026-11-04** |
| Counts | **12,000 contractors, 30,978 pages, 1,435,246 award rows** (equal to the dry run) |
| Integrity (direct SQL) | 0 duplicate pages, 0 page gaps, 0 wrong page counts, 0 wrong row totals, 0 missing checksums or source dates |
| Size check | live 9,613 / 23,434 → 12,000 / 30,978 (+24.8% / +32.2%), passed by the job-12 override; recorded in job telemetry |
| **Rollback** | previous generation **`2026-08-28-build-4-a1-c75cc3c6`** (23,434 pages, `retired`, recorded as `previous_version`). Repoint with `promote_awards_version` to roll back. `awards-prune` is dry-run only. |
| Production checks | 20/20 sampled `/contracts` pages 200, indexable, self-canonical, full tables, incl. `performant-financial-corporation/contracts/2`; 11 had no KV entry, so they were served from the table; the contracts cold budget was unchanged (634 → 634), so no live BigQuery |

Found during verification and fixed in this PR: the validator paged by `recipient_uei` alone
(not unique), so its telemetry said 1,435,307 rows against 1,435,246 in the table. It now
orders by `(recipient_uei, page_number)` and refuses a read with duplicate or missing pages.

**Scheduling:** `cron_jobs` row `awards-build-worker` (`15 * * * *`, `timeout_ms` 800000:
fire-and-forget, `dispatched`). Idle with no claimable job (about 1 s, no BigQuery). New source
versions come from `awards-refresh` (11:00 UTC daily) after each weekly ingest.

## Final 404 audit: 2026-11-14 03:17 UTC (after the rebuild and worker schedule)
Same 1,000 URLs, same crawler. Per-URL results (status, final URL, robots, canonical,
self-canonical, tab state, top-12,000 membership):
`docs/seo-recovery/gsc-404-classification-2026-11-14-final.csv`. The audit made no
BigQuery lookups: the contractor cold budget stayed at 196 and the contracts budget (already
past 200) only counted refusals (678 → 688).

| Result | Profile | Contracts | NAICS tab | Agencies tab | Total |
|---|---|---|---|---|---|
| 200 indexable | 466 | 407 | 0 | 0 | **873** |
| 200 noindex (intentional) | 30 thin contractor | 0 | 64 rows not cached | 17 rows not cached | **111** |
| ...of which reached by 308 to canonical | 18 | 8 | 5 | 3 | **34** |
| Genuine 404 | 4 | 2 | 1 | 0 | **7** |
| False 404 | 0 | 0 | 0 | 0 | **0** |
| Temporary 5xx | 0 | 9 | 0 | 0 | **9** |

Every 200 is self-canonical.

**All 9 temporary 5xx are `/contracts` pages of contractors outside the current top 12,000**
(`hess-construction-company-llc`, `abt-associates-international-inc`,
`bellamy-management-services-llc`, `american-contractor-and-technology-inc`,
`alliant-alliance-llc`, `first-care-ohio-llc`, `linfield-hunter-and-junius-inc`,
`chatmon-vjr-jv-llc`, `standard-bent-glass-llc`). **This is a regression from the promotion:**
all 9 were 200 at 01:35 UTC and all 9 are in the retired 2026-08-28 generation. Their rank fell
below 12,000 between the August and November rollups, so the new build excluded them. In total,
**251 contractors in the old generation are absent from the new one** (2,638 were added, so
the size check could not see it). Without a table row, their `/contracts` pages depend on KV and
the render-time contracts budget (already spent each day by about 00:30 UTC).

Candidate fix (not done, needs approval): keep any contractor present in the live generation
eligible for the next build ("sticky" eligibility, at most 251 more today), and make validation
report contractors dropped against live. A rollback would restore the 251 but drop 2,638.

## Single-award contractors noindexed by the thin-profile rule (policy review, no change)
The profile rule noindexes `total_obligated < $25K || award_count < 2`
(`src/app/contractors/[slug]/page.tsx`). That treats a single high-value award as low value.
2,596 contractors have one award worth $1M or more (581 at $10M or more, 119 at $100M or more;
`recipients_rollup_merged`, 2026-11-14). The largest is Alliance for Energy Innovation, LLC at
$8.16B. Full list: `docs/seo-recovery/single-award-noindexed-ge-1m-2026-11-14.csv`. Recorded for a
later indexing-policy decision. Their indexability is unchanged in this workstream.

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

## Open items
- Contractor warming: priority queue (#1998), seeded after deploy.
- Award cold budget stays 4,000/day; re-measure distinct demand after the rebuild.
- 3,473 queued contractor slugs resolve only via the alias path, which stays disabled.

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
2. **Not found (404)**: on hold until the reason's example URLs are exported and classified.
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

## Open items
- Contractor warming: priority queue (#1998), seeded after deploy.
- Award cold budget stays 4,000/day; re-measure distinct demand after the rebuild.
- 3,473 queued contractor slugs resolve only via the alias path, which stays disabled.

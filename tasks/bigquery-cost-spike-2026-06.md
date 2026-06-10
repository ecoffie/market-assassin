# BigQuery Cost Spike — June 2026 (diagnosis + fix)

**Symptom:** GCP/BigQuery cost $2,075 for June 1-10 (+1,949% vs prior), forecast
$2,581/mo (+2,449%). Normal is a few $/day. (Billing → Reports, project `market-assasin`.)

## Root cause (grounded)
**A cache-miss STORM, not a broken query.** On **June 1** the BQ cache version was
bumped to `v3-2026-06` (`src/lib/bigquery/cache.ts` DATA_VERSION) — necessary, because
the data changed (subawards 903K→1M, new clustered lookup tables). But the bump
**invalidates 100% of the KV cache at once.**

Then the public SEO surface — thousands of crawlable URLs (`/awards/[id]`,
`/contractors/[slug]`, `/top/[slug]`, `/agencies/[slug]`, all in the sitemap + allowed
in robots.txt) — got re-crawled by Google/Bing. Every first hit after the wipe =
**cold KV miss → BQ scan → re-cache.** Thousands of unique long-tail URLs × cold-miss
scans = the storm. Nobody pre-warmed the cache after the bump, so **crawlers paid the
re-warm cost in BQ bytes.**

**Ruled out (dry-run measured):** the clustered queries are cheap — `fetchActivity`
EXISTS = 0.02 GB, contractor search = 0.01 GB, awards-by-recipient = 0.00 GB. The
clustering works. `/awards/[id]` is ISR 7-day (fine). `refresh-bq-rollups` is monthly.

## The fix (priority order)

### 1. ✅ HARD DAILY QUOTA (console — the brake; Eric, June 10)
GCP → IAM & Admin → Quotas → BigQuery "Query usage per day" → set a hard ceiling.
Set to **1 TiB/day (~$6/day)** as the emergency brake; raise to 3 TiB once the cache
is warm. This physically caps the spend no matter what the code does. (A "custom quota
exceeded for QueryUsagePerDay" error confirms it's active.)

### 1b. ✅ Refresh QUARTERLY, not monthly (Eric, June 10 — cost cut)
USASpending data changes slowly; the aggregate picture barely shifts month to month.
Monthly DATA_VERSION bumps = **12 cache-wipe storms/year**; quarterly = **4** (67%
fewer). Aligns with the curated-source quarterly cron (`0 13 1 1,4,7,10 *`, task #31).
Cache TTL raised 30d → **90d** so results stay warm across a full quarter.
Tradeoff (immaterial for market research): a page may show data up to ~3mo old.

### 2. NEVER bump DATA_VERSION without a pre-warm (process fix)
The cache-version bump is a loaded gun: it wipes everything, and crawlers re-warm it at
BQ cost. After ANY DATA_VERSION bump:
- **Pre-warm** the heavy/long-tail keys (a warm-cache cron over the top
  contractors/awards/agencies) BEFORE crawlers hit cold, OR
- **stage** the bump (only invalidate the keys whose data actually changed, not all),
  OR keep the OLD version readable as a fallback while the new one warms.
- At minimum: bump on a low-traffic window + watch BQ cost for 24h.

### 3. Cache the one uncached user-facing call (hygiene)
`market-research.ts:168` `fetchActivity` uses raw `bqQuery` (cheap, but uncached + the
gov-buyer feature). Wrap in `queryCached` with a UEI-set+NAICS key. Low urgency.

### 1c. ✅ SEO is CACHE-ONLY; Mindy gets live BQ (Eric, June 10 — launch priority)
`queryCached` now defaults `cacheOnly: true` — a cache MISS returns `[]` (graceful
empty) instead of a cold BQ scan. So the public SEO long-tail can NEVER drive a
cold-miss cost storm from crawler traffic; pages stay indexable (empty/"updating" on
a cold miss, real once warm). **Authenticated Mindy paths opt INTO live BQ** by passing
`liveBq:true` through the shared wrappers (the 6 `/api/app/*` BQ routes + the
gov-buyer fetchActivity + getBqContractorHistory). Convention going forward: **default
cache-only; pass `liveBq:true` ONLY for authenticated Mindy callers.** Wrappers touched:
`agencies.ts` (getOfficesForAgency, getOfficesForAgencyNaics, getAgencySatForNaics),
`recipients.ts` (getRollupBySlug, getRecipientBySlug, getRecipientByUei,
getTopAgenciesForRecipient, getRecentAwardsForRecipient, getTopNaicsForRecipient,
getYearlyTotalsForRecipient, getYearlyByAgencyForRecipient).

### 4. Consider: rate-limit / noindex the deep long-tail
If crawler-driven cold-misses keep hurting, either add `revalidate` (not
`force-dynamic`) on listing pages, or noindex the deepest long-tail award URLs so
crawlers don't force thousands of cold BQ scans.

## Status
- [x] Quota brake set — 1 TiB/day (Eric, console, June 10).
- [x] Refresh cadence → QUARTERLY + cache TTL 30d→90d.
- [x] DATA_VERSION pre-warm/cost warning documented in cache.ts header.
- [x] market-research fetchActivity wrapped in queryCached.
- [ ] Watch BQ cost tapers after quota + cache re-warms (24-48h, GCP Billing).
- [ ] (Future) Get BQ off the hot path — pre-compute SEO pages to Postgres so only
      the quarterly job touches BQ. Deferred PRD; bill is capped, not urgent.

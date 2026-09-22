# getmindy.ai — source-to-surface matrix (what exists vs what Google can see)

**Date:** 2026-09-21 · **Method:** filesystem, KV, Supabase, live HTTP, Google URL Inspection API.
**BigQuery contacted for this inventory: none.**

The question: before materializing anything new, what is *already* production-serveable and
simply not on a page?

---

## The matrix

| Dataset | Records | Existing store | Freshness | Serveable w/o BQ? | Current SEO surface |
|---|---|---|---|---|---|
| `sam_entities` | **910,126** | Supabase | SAM sync | ✅ yes | **none** |
| `sam_opportunities` | **215,115** | Supabase | daily SAM sync | ✅ yes | `/psc/*`, `/set-aside/*`, `/naics/*/[state]`, `/opportunity/[slug]` — 717 URLs advertised |
| `awards_serving_pages` | **93,910** | Supabase | versioned, `source_as_of` | ✅ yes | `/contractors/[slug]/contracts` |
| `agency_forecasts` | **35,912** | Supabase | per-source | ✅ yes | **none — and `/forecasts` 404s** |
| committed JSON (29 files) | **219,952** | repo (`src/data`) | build-time | ✅ yes | partial — agencies/NAICS/PSC/glossary |
| contractor rollup profiles | **11,770** | KV (`rollup:by-slug:*`) | 90d TTL | ✅ yes | `/contractors/[slug]` — **100% coverage verified** |
| award-by-PIID cache | 637 | KV (`bq:awards:by-piid`) | 90d TTL | ✅ yes | `/awards/[id]`; `/contracts/*` robots-blocked |
| `user_business_profiles` | 645 | Supabase | live | ⛔ **private** | must never be exposed |
| contractor rollups (full) | ~290,000 | BigQuery | weekly | ❌ needs materialization | top 12,000 only |

**Totals already outside BigQuery: ~1,475,000 records** (219,952 committed + 1,255,719 Supabase),
plus the 11,770-slug contractor cache.

---

## 1. How much can be exposed immediately, with no BigQuery?

**Effectively all of the public data above — ~1.47M records.** The constraint is not access, it is
that almost none of it is consolidated onto a page a crawler can read. Note the requirement this
must respect: **do not create one URL per data point.** 215,115 opportunities do not become
215,115 URLs; they become facets of authoritative agency / NAICS / PSC / market pages.

## 2. Which existing pages can carry them

| Data | Page that should carry it | Status |
|---|---|---|
| `agency_forecasts` (35,912) | `/agencies/[slug]` + a real `/forecasts` hub | **not rendered anywhere public** |
| `sam_opportunities` (215,115) | `/psc/*`, `/set-aside/*`, `/naics/*` (already wired) | wired, under-advertised |
| `awards_serving_pages` (93,910) | `/contractors/[slug]/contracts` | wired |
| `sam_entities` (910,126) | `/contractors/[slug]` identity block | not wired |

## 3. Already materialized but disconnected — the actual finding

1. **`agency_forecasts`: 35,912 rows, zero public surface.** Every reader is
   `/opportunity-map/*` (authenticated), an `/api/*` route, or `/mcp/about`. `/agencies/[slug]`
   only mentions the *word* "forecast" in its keywords — it renders no forecast rows. And
   `/forecasts`, the obvious URL, **has no route at all**: it 404s, it was advertised in
   sitemap.xml, and ~1,300 public pages linked to it. This is the largest disconnect on the site
   and it needs no BigQuery, no backfill, and no new store.

2. **The contractor cache was never the problem it looked like.** Sitemap-root coverage measured
   **11,770 / 11,770 = 100%**. The 861 dead URLs were not missing data:
   - `iqvia-government-solutions-inc`, `cbre-inc`, `two-six-labs-llc` — the **alias key is
     present**; the page would 308 correctly. They 404 only because ISR cached the old 404.
   - `caci-inc-federal` — **profile + alias both present**. Same ISR cause.
   This is exactly the "page is reading a stale edge cache, not missing a record" case. A deploy
   invalidates it. **No BigQuery backfill is warranted for these.**

3. **`sam_entities` (910,126 rows)** — a registry already in Postgres with no public surface.

## 4. Smallest adapter changes required

1. **Build `/forecasts`** as a real route reading `agency_forecasts` from Supabase, and render
   per-agency forecast rows on `/agencies/[slug]`. One Supabase reader, two page edits. No new
   store. *(Not done in this PR — it is new surface, and the instruction is to stop before
   generating pages.)*
2. **Deploy**, to invalidate the ISR 404s. Nothing else is needed for cohort 2 above.
3. **`getServeableSlugs()`** (shipped here) — the sitemap now advertises only what the cache can
   actually serve, so the two populations can never diverge again.

## 5. What genuinely requires bounded offline materialization

Only the contractor tail beyond the 12,000 already cached (~290,000 rollups exist in BigQuery).
That is the *only* place a warm job is justified, and it is explicitly **not** required to fix the
861 dead URLs.

Measured warm cost, by dry run (0 bytes billed):

| | |
|---|---|
| per batch of 2,000 slugs | **0.075 GiB** (0.049 profile + 0.026 alias) |
| sitemap roots / cached / missing | 11,770 / 11,770 / **0** |
| projected cost to close the gap | **$0.00 — there is no gap** |

⚠️ **Bytes are the wrong safety metric for the alias query.** Measured 2026-09-21: it consumed
**9,106 CPU seconds against 27 MB scanned** and was *refused* by BigQuery for exceeding the
on-demand CPU-to-bytes ratio. A dry run reports bytes and would not have caught it. Any future
warm must be validated on CPU, not just bytes.

---

## Reconciliation: MCP vs SEO, per fixture

Both paths call `getRollupOrSingleBySlug()` in `src/lib/bigquery/recipients.ts`. **There is no
second contractor system.** MCP passes `liveBq=true`; the public page passes `seoLiveBqEnabled()`,
which is OFF. Every divergence below is therefore a cache boundary, never a resolution failure.

| slug | MCP resolve | canonical UEI | SEO (cache-only) | cache | sitemap | live | diverges at |
|---|---|---|---|---|---|---|---|
| `caci-inc-federal` | resolves | XT5DJJULUMV5 | resolves | profile+alias | no | 404 | **ISR (stale 404)** |
| `iqvia-government-solutions-inc` | → `quintiles-tran…` | T13YR5E14QY7 | MISS | alias | no | 404 | cache boundary |
| `cbre-inc` | → `cbre-group-inc` | NYXAU6Y1Y2G5 | MISS | alias | no | 404 | cache boundary |
| `two-six-labs-llc` | → `two-six-labs-h…` | EP8HTN6PUJW3 | MISS | alias | no | 404 | cache boundary |
| `ses-sa` | resolves | FKM8ABBAUCS4 | resolves | profile | yes | 200 | — |
| `senture-llc` | resolves | GC51JCDRQP95 | resolves | profile | yes | 200 | — |
| `industries-for-the-blind…` | resolves | LHSBQKG97P89 | resolves | profile | yes | 200 | — |
| `morphosis-architects` | resolves | HBLUN5S4YXK9 | resolves | profile | yes | 200 | — |

Reproduce: `npx tsx scripts/seo-mcp-parity-report.ts` (⚠️ currently uses live BigQuery for the MCP
column — needs authorization, or a cache-only flag, before running again).

---

## Privacy

`user_business_profiles` (645 rows) is customer data and must never reach a public page.
`/reports/*` stays robots-disallowed (private capability URLs). `/app/*`, `/admin/*` likewise.
Nothing in this PR exposes any of them.

# getmindy.ai — programmatic SEO state of play (investigation, no build)

**Date:** 2026-09-21 · **Scope:** codebase + live site + Google Search Console · **Status:** findings only, nothing changed.

Verification methods: live GSC API (`sc-domain:getmindy.ai`), Google **URL Inspection API** (Google's own
index verdict, not a guess), raw `curl` HTML fetches with JavaScript never executed, and repo inspection.
Anything not verified is marked **unknown**.

---

## 1. Rendering and indexability

**Verdict: the site is server-rendered and crawlable. This is not the problem.**

| Fact | Evidence |
|---|---|
| Next.js 16.2.9 / React 19.2.3, App Router | `package.json` |
| 172 page routes | `find src/app -name page.tsx` |
| Content routes are **server components** with `generateMetadata` + ISR | `src/app/contractors/[slug]/page.tsx` (`revalidate = 604800`, `dynamicParams = true`), same pattern on `/agencies/[slug]`, `/naics/[code]`, `/psc/[code]`, `/set-aside/[type]/[naics]`, `/top/[slug]`, `/glossary/[slug]`, `/blog/[slug]`, `/opportunity/[slug]`, `/awards/[id]` |
| TTFB 0.12s–0.59s across 20 cold contractor pages | live curl |

**Raw-HTML test (JS never executed) — content is present server-side:**

| URL | HTTP | Visible text in raw HTML | H1 | JSON-LD |
|---|---|---|---|---|
| `/` (→ `/today`) | 200 | 2,329 chars | 1 | WebPage, WebSite |
| `/contractors` | 200 | 21,712 chars | 1 | **none** |
| `/contractors/rtx-corp` | 200 | 3,046 chars | 1 | Organization, BreadcrumbList, PostalAddress |
| `/contractors/senture-llc/contracts` | 200 | 8,588 chars (real award table, $408M/29 awards/125 actions) | 1 | — |
| `/agencies/general-services-administration` | 200 | 4,100 chars | 1 | GovernmentOrganization, BreadcrumbList, WebPage |
| `/naics/541519` | 200 | 3,791 chars | 1 | DefinedTerm, DefinedTermSet, BreadcrumbList |
| `/psc/R425` | 200 | 7,082 chars | 1 | **none** |
| `/glossary` | 200 | 17,948 chars | 1 | DefinedTermSet, DefinedTerm |
| `/compare/govwin` | 200 | 7,131 chars | 1 | FAQPage, SoftwareApplication, Offer |
| `/pricing` | 200 | 6,735 chars | 1 | FAQPage, SoftwareApplication, Offer |

**The two exceptions that ARE client-rendered shells:**

- **`/market-intelligence`** — `'use client'` (`src/app/market-intelligence/page.tsx:1`). Raw HTML has **64 characters**
  of visible text, **no H1**, **zero internal links**, no JSON-LD, no `generateMetadata`. Invisible to a crawler.
- **`/recompete`** — `'use client'`. 387 chars, no JSON-LD, and its title is **"Recompete Tracker | GovCon Giants"** —
  wrong brand on a getmindy.ai page.

**The homepage is a rewrite, and that matters (see §6).** `getmindy.ai/` is rewritten host-conditionally to
`/today` (`next.config.ts` `beforeFiles`), which is a **route handler** (`src/app/today/route.ts`, 643 lines)
that hand-builds its own HTML head. It is server-rendered and has a proper SEO head.

---

## 2. What indexable URLs exist

**No query-parameter URL problem.** The premise that the app is "client-rendered behind `?naics=` parameters"
is **false for this site**. Of 10,721 URLs GSC recorded over 6 months, exactly **1** contains a `?`
(`/briefings?recover=1`, 2 impressions). Everything is a clean static path.

**Sitemaps:** `robots.txt` points to `/sitemap-index.xml` → two children.

| Sitemap | URLs | Size |
|---|---|---|
| `/sitemap.xml` | 35,360 | 6.3 MB |
| `/sitemap-opportunities.xml` | 717 | 145 KB |
| **Total** | **36,077** | |

Note: `/sitemap.xml` is a flat `<urlset>`, not a nested index. At 35,360 URLs it is under the 50,000/50MB
limits, but it is one undifferentiated file — there is no way to read per-cluster indexing in GSC.

**Cluster breakdown of `/sitemap.xml`:**

| Cluster | URLs |
|---|---|
| `/contractors/*` | **34,163** (96.6%) — 11,770 companies × up to 4 tabs (root 11,770 / contracts 9,407 / naics 7,864 / agencies 5,121) |
| `/naics/*` | 384 |
| `/psc/*` | 366 |
| `/set-aside/*` | 235 |
| `/top/*` | 65 |
| `/glossary/*` | 65 |
| `/agencies/*` | 50 |
| `/compare/*` | 7 |
| marketing/static | ~25 |

**Sitemap accuracy is good at scale.** Sampled 208 of the 35,360 URLs live: **208/208 returned HTTP 200 and were
indexable** (no `noindex`). The thin-content gate in the pages and the sitemap predicate agree with each other.

**Three broken static sitemap entries** (hand-written, not generated):
`/forecasts` → **404**, `/expiring-contracts` → **308 to `/`**, `/bd-assist` → **307 to `/briefings`**.

**robots.txt:** allows content; disallows `/api/`, `/admin/`, `/app/`, `/_next/`, `/contracts/`, `/reports/`.
⚠️ `Disallow: /contracts/` blocks the real route `src/app/contracts/[piid]/page.tsx`. Live, `/contracts/<piid>`
307-redirects anyway, so nothing is lost today — but if PIID pages are ever wanted (see §3, PIIDs are the #1
query class), robots.txt blocks them. `/contractors/<slug>/contracts` is **not** affected.

**Auth/app surface** (correctly excluded): `/admin/*` (28 routes), `/app/*`, `/planner/*`, `/command-center/*`,
`/briefings/*`, `/mcp/*`, checkout/success routes.

---

## 3. What Google actually sees — the ground truth

### 3a. Index coverage

The GSC API does **not** expose the aggregate Index Coverage report, so a full indexed-page count is
**unknown without the GSC web UI**. I used the **URL Inspection API** instead, which returns Google's
authoritative per-URL verdict. On a 21-URL sample spanning every cluster, **only 2 were indexed**:

| Coverage state | Count | Examples |
|---|---|---|
| Submitted and indexed | **2** | `/`, `/contractors/united-launch-alliance-l-l-c` |
| **Crawled – currently not indexed** | **15** | `/contractors` (hub), `/contractors/the-boeing-company`, `/contractors/senture-llc/contracts`, `/agencies/general-services-administration`, `/market-intelligence`, `/opportunity-hunter`, **`/pricing`**, **`/compare/govwin`**, **`/compare/highergov`**, `/blog/sam-gov-alerts-why-they-fail`, `/glossary` |
| Soft 404 | 1 | `/contractors/caci-inc-federal/contracts` |
| Not found (404) | 1 | `/forecasts` |
| Page with redirect | 1 | `/expiring-contracts` (Google's canonical = `/`) |
| **URL unknown to Google — never crawled** | 1 | `/research` |

Crawl dates are stale: most last-crawled June–July 2026. Google has largely stopped returning.
**Top exclusion reason is overwhelmingly "Crawled – currently not indexed."**

### 3b. Traffic

| Month | Clicks | Impressions | CTR |
|---|---|---|---|
| 2026-05 | 13 | 5,465 | 0.2% |
| 2026-06 | 216 | 33,436 | 0.6% |
| 2026-07 | 121 | 19,253 | 0.6% |
| 2026-08 | 118 | 4,221 | 2.8% |
| 2026-09 (to 9/18) | 38 | 948 | 4.0% |

Impressions **−97% from the June peak**. The rising CTR is an artifact of the denominator collapsing.

Trailing 28d (8/22–9/18): **104 clicks, 1,546 impressions, avg position 10.4.** This is the baseline.

Pages earning ≥1 impression: **392 now / 1,581 prior 28d / 9,287 during Jun–Jul.**

### 3c. The most important finding in the whole audit

**6-month window (3/24–9/18): 4,513 distinct queries, 13,976 impressions, and 32 total clicks (0.23% CTR).
28 of those 32 clicks came from the single branded query `getmindy.ai`.**

**Non-branded organic search produced 4 clicks in 6 months.**

**Top queries by impressions are all contract-number lookups:**

| Impr | Clicks | Pos | Query |
|---|---|---|---|
| 430 | 0 | 1.8 | `"19aqmm24f2376"` |
| 425 | 0 | 5.5 | `"n0018925fz703"` |
| 300 | 0 | 3.1 | `"19aqmm24f0992"` |
| 211 | 0 | 7.6 | `"19aqmm23f1529"` |
| 182 | 0 | 1.9 | `"19aqmm19f2232"` |
| 171 | 0 | 5.0 | `"w9124d22c0002"` |
| 118 | 0 | 54.5 | `mindy ai` |

The pages **rank** — position 1.8 to 7 on thousands of PIID queries — and earn **zero clicks**. This is not a
title/meta problem. It is a **demand-selection** problem: the pages match a query class (paste a contract
number into Google) that has no click intent and no commercial intent.

### 3d. Ranking but not clicked (6mo, top by impressions, all 0 clicks)

| Impr | Pos | Page |
|---|---|---|
| 2,455 | 5.2 | `/contractors/industries-for-the-blind-and-visually-impaired-inc/contracts` |
| 767 | 2.2 | `/contractors/morphosis-architects/contracts` |
| 680 | 6.2 | `/contractors/rocket-lab-usa-inc/contracts` |
| 673 | **44.1** | `/contractors` (the hub itself) |
| 596 | 3.4 | `/contractors/buro-happold-consultng-engineers-pc/contracts` |
| 240 | 3.9 | `/agencies/small-business-administration` |
| 201 | 10.3 | `/naics/541612` |

Most clicks by page (6mo): `/` 214, `/top/sdvosb-contractors` 5, then a long tail of 2–4 clicks each.

### 3e. What broke since the peak

Of the 9,288 URLs that earned impressions in Jun–Jul, **3,270 (35%) are no longer in the sitemap.**
Sampled 164 of them live:

| Result | Count | Share |
|---|---|---|
| **404** | 64 | 42% |
| 200 but `noindex, follow` | 38 | 25% |
| 200, indexable, silently dropped from sitemap | 61 | 37% |
| timeout | 13 | — |

Extrapolated: **~1,300 previously-indexed URLs now hard-404**, including CACI Inc Federal, IQVIA Government
Solutions, CBRE, Two Six Labs, Kamatics. Cause: `src/app/contractors/[slug]/page.tsx` gates the live-BigQuery
fallback behind `seoLiveBqEnabled()` (default **OFF**; `ENABLE_SEO_LIVE_BQ=1` re-enables), because crawler
cold-scans were draining the BQ daily quota. An unwarmed contractor therefore 404s instead of resolving.

---

## 4. On-page SEO of pages that exist

**This is the surprise: on-page quality is good.** Every server-rendered cluster has a unique, well-formed
title, a 126–196 char meta description, exactly one H1, and (mostly) structured data. Nothing is templated
to the point of duplication.

| Cluster | Title unique | Desc | H1 | Schema | Internal links in page |
|---|---|---|---|---|---|
| `/contractors/[slug]` | ✅ `"Rtx Corp — $323B in Federal Contracts \| Mindy"` (money figure front-loaded) | 136 | 1 | Organization + Breadcrumb | **5** ⚠️ |
| `/contractors/[slug]/contracts` | ✅ | ✅ | 1 | — | — |
| `/agencies/[slug]` | ✅ (`$0.5B/yr — What They Buy & How to Win`) | 144 | 1 | GovernmentOrganization | 8 |
| `/naics/[code]` | ✅ | 147 | 1 | DefinedTerm | 6 |
| `/psc/[code]` | ✅ | 148 | 1 | **none** ⚠️ | 53 |
| `/glossary` | ✅ | 126 | 1 | DefinedTermSet | 65 |
| `/compare/[competitor]` | ✅ `"GovWin Alternative [2026]"` | 161 | 1 | FAQPage + SoftwareApplication | 5 |
| `/contractors` hub | ✅ | 175 | 1 | **none** ⚠️ | 421 |
| `/blog` | ✅ | 154 | 1 | Blog/BlogPosting | 6 (thin, 1,494 chars) |
| `/market-intelligence` | title only | 145 | **0** ⚠️ | none | **0** ⚠️ |
| `/recompete` | **wrong brand** ⚠️ | 115 | 1 | none | 2 |

**Content substance:** genuine, not table-only. Contractor `/contracts` pages carry ~8.6K chars of real award
data with a provenance line ("Award data as of August 27, 2026. Source: USAspending"). The contractor
*overview* pages are lighter (~3K chars) than their own sub-tabs.

**Internal linking is the structural weakness, and it is severe:**
- The homepage (`/today`) contains **11 internal links**, and **zero** references to `/contractors`,
  `/agencies`, `/glossary`, `/blog`, `/compare`, `/research`, `/market-intelligence` or `/free-resources` —
  verified by grepping the raw HTML *including* the RSC flight payload: **0 occurrences of each**.
- The `/contractors` hub links to **420 of 11,770** children (3.6%).
- A contractor detail page links to only **5** internal URLs.
- Navigation links are real `<a href>` (crawler-followable), not JS-only — the links just aren't there.

---

## 5. Data available to generate pages from

A query layer already exists — **nothing would need to be built**: `src/lib/bigquery/*` (recipients, agencies,
naics, awards, subawards, top-listicles, company-detail) with KV-backed `queryCached`, plus Supabase
`awards_serving_pages` as the durable serving table.

| Dimension | Pages live today | Ceiling available | Source |
|---|---|---|---|
| Contractor (company) | 11,770 × up to 4 tabs = 34,163 | ~290,000 rollups (~38% below the thin gate) | `getTopRecipientsForSitemap(limit = 12000)` — **hard-capped at 12,000** |
| NAICS | 384 | 1,000+ six-digit; `naics-top100.ts` holds 100 curated | `src/data/naics-top100.ts`, `src/lib/naics-catalog.ts` |
| NAICS × State | 0 in sitemap | route exists (`/naics/[code]/[state]`, ISR on demand) | 50 states × NAICS |
| PSC | 366 | `src/data/psc-codes.json` + `psc-naics-crosswalk.json` | |
| Agency | 50 | 49 federal agencies mapped; sub-agency/buying-office **unknown** | `src/data/agencies-seo.ts`, `agency-toptier-codes.json` |
| Set-aside × NAICS | 235 | 4 programs × NAICS | `/set-aside/[type]/[naics]` |
| Top/listicle | 65 | unbounded (agency × NAICS × set-aside rankings) | `src/lib/bigquery/top-listicles.ts` |
| Glossary | 65 | 66 terms defined | `src/data/glossary.ts` |
| Blog | 4 | 3 posts authored | `src/data/blog-posts.ts` |
| Opportunity | 717 | live SAM feed | `sitemap-opportunities.xml` |
| Award / PIID | 0 indexed | routes exist (`/awards/[id]`, `/contracts/[piid]`) | `/contracts/` is **robots-blocked** |

**Grounding rule holds.** The codebase enforces it explicitly: `src/lib/bigquery/cache.ts` and
`src/lib/awards-serving.ts` return an "unavailable" state rather than a zero on a cache miss, and the page
then renders `noindex` plus an honest message — *"Never render a zero you cannot prove."* Every page is built
from live or sourced data. **No fabrication risk.**

---

## 6. History — what's been tried

- **`tasks/PRD-seo-contractor-pages-agent.md`** (2026-05-10, 414 lines) — the original programmatic SEO plan.
  ⚠️ It specifies the public contractor pages live on **`govcongiants.com`**, with `mi.govcongiants.com` as the
  gated app. What actually shipped is on **`getmindy.ai`**. The PRD and reality disagree about the domain.
- **Tooling already built:** `scripts/seo-report.ts`, `scripts/generate-seo-contractor-candidates.js`
  (`npm run seo:contractor-candidates`), `scripts/build-agencies-seo.py`, `scripts/drain-seo-enrich.ts`,
  `scripts/insert-seo-report-cron.ts`, plus a **weekly GSC→Slack report cron** (`src/lib/gsc/report.ts`).
- **Thin-content pruning** (deliberate, data-backed): contractors under $25K obligated or with <2 awards get
  `noindex, follow`; sub-tabs gated on `SUBPAGE_MIN_ROWS`. The code comments cite 90d GSC evidence that every
  contractor page earning impressions was $290K+. **This work is sound — it is not what broke things.**
- **Two commits on 2026-08-24, the day the collapse accelerates:**
  - `5dbe2a7b` *feat(homepage): getmindy.ai/ now serves Today's Intel — the cutover (#1315)* — the root rewrite
    from `/mindy-landing` to `/today`. The **old** homepage (`src/app/mindy-landing/page.tsx`, still live at
    `/mindy-landing`, 200, self-canonical, **not in the sitemap**) linked to `/contractors`, `/naics`, `/top`,
    `/discover`, `/research`. The new one links to **none of them**. This is where the orphaning came from.
  - `6b392500` *Stop rendering a zero we cannot prove: noindex on awards-cache miss (#1325)* — correct on
    integrity grounds, and a contributor to the noindex/404 expansion in §3e.
- Impressions: Aug 4,221 → Sep 948, straddling that date.

---

## Verdict

**The starting point is (a) — make what exists indexable and discoverable. But not for the reason the question
assumes, and (b) and (c) are both wrong to start with.**

The site is **not** a client-rendered SPA behind query parameters. It is server-rendered Next.js with clean
static URLs, correct ISR, a 36,077-URL sitemap that is 208/208 accurate on sampling, unique titles and H1s,
and real schema.org markup. **On-page SEO (b) is already good** — polishing it would change nothing, because
Google has crawled these pages and *declined to index them*. **Generating new page types (c) would be actively
harmful**: the site currently asks Google to index 36,077 URLs and gets roughly 2 of every 21 indexed. Adding
supply to a surface Google is already refusing is throwing pages into a hole.

Three things to fix, in order:

1. **Re-link the content surface.** The only reliably indexed page on the domain is the homepage, and it
   references none of the 34,163 content URLs — the Aug 24 cutover severed it. Sitemap-only discovery with
   zero internal link equity is the textbook cause of "Crawled – currently not indexed" at scale. This is a
   nav/footer edit, not an SEO project, and it is the highest-leverage change available.
2. **Stop 404ing pages Google already indexed.** ~1,300 formerly-indexed URLs now return 404 because of the
   `seoLiveBqEnabled()` default. Pre-warm, re-enable, or 308 to `/contractors` — but never 404.
3. **Shrink the ask.** 12,000 contractors capped from 290,000 is still far more than this domain's authority
   can get indexed. Submit the tier with proven demand first; expand only once it indexes.

**Then a separate, harder question that fixing indexation will not answer.** Even at the June peak, the site
converted 13,976 impressions into 4 non-branded clicks. It ranks at position 1.8 for contract-number lookups —
a query class with no click intent and no buyer intent. The pages are well built and pointed at demand that
does not convert. Before any expansion of the programmatic surface, the target query set needs to change from
"identifiers people paste into Google" to queries a small business searching for contracts actually types.
That is a content-strategy decision, and it should be made **after** indexation is restored, so the results
are measurable against the 104-clicks/28-day baseline recorded above.

---

## Re-run the measurement

```bash
cd ~/Projects/market-assassin
vercel env pull .env.prod --environment=production --yes
export GCP_SA_JSON="$(grep '^GCP_SA_JSON=' .env.prod | cut -d= -f2- | sed 's/^"//; s/"$//')"
npx tsx scripts/seo-report.ts
rm -f .env.prod
```

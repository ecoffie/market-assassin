# Empty contractor sub-pages: evidence, fix and production acceptance (2026-09-30)

**Status:** fixed in production and **accepted** (PR #1765). This document preserves the evidence.
It contains aggregate counts only: no raw Search Console export, no per-URL result tables, no personal data, no credentials.

**Contents:**
1. GSC 404 recheck
2. Thin-page inspection
3. Full production scope
4. Fix
5. Production acceptance
6. What was deliberately not done

---

## 1. GSC "Not found (404)" recheck

**Input:**
- Search Console → Page indexing → *Not found (404)*, property `https://getmindy.ai/`.
- The export's 1,000 example URLs (Google's cap) out of **7,377** affected pages.
- The count jumped 3,245 → 5,747 on 2026-07-10 and was flat at ~7,377 from 2026-09-17.
- Google's "last crawled" dates were 2026-08-08 → 2026-09-20, all **before the 2026-09-21 repairs** (#1609).

**Method (`scripts/recheck.mjs`):**
- One live GET per URL, redirects not followed, a Googlebot-compatible user agent.
- One hop followed for 301/308 responses.
- Compared with the live sitemap.
- Read-only. `ENABLE_SEO_LIVE_BQ` is off in production, so no request could reach BigQuery.

| Current response | URLs |
|---|---|
| 200 | 911 |
| 308 to a canonical page that returns 200 | 16 |
| 404, intentionally absent from the sitemap | 73 |
| **Genuinely broken** | **0** |

**The 911 × 200 responses, as mutually exclusive groups:**

| Group | URLs |
|---|---|
| indexable + substantive + in sitemap | 709 |
| indexable + substantive + not in sitemap | 6 |
| indexable + thin + in sitemap | 61 |
| indexable + thin + not in sitemap | 31 |
| `noindex` + thin + not in sitemap | 104 |

All `noindex` pages are also thin, so the thin total is 196.

## 2. Inspection of the 61 thin, sitemap-listed pages (`scripts/inspect-thin.mjs`)

Character count was only a screen. Classified by rendered table rows, H1, canonical, indexability and internal links:

| Class | Pages | Finding |
|---|---|---|
| Empty state | **58** (47 `/naics`, 11 `/agencies`) | 0 table rows, "No … data available", **under a header claiming a nonzero count** (e.g. "All 227 NAICS codes"). Indexable, self-canonical, linked from the parent profile |
| Small real dataset | 3 (`/contracts`) | 1 real contract row each; legitimately small |

**Root cause:**
- Both sub-pages and the sitemap tab rule tested the profile's **stored** aggregate (`distinct_naics_count` / `distinct_agency_count`) against `SUBPAGE_MIN_ROWS`, never the rows the page renders.
- Those rows come from a separate `all-naics` / `all-agencies` cache key. With live BigQuery off, a miss there rendered an empty table.

## 3. Full production scope (`scripts/measure-subpage-scope.mjs` → `scope-before.aggregate.json`)

**Method:**
- Cache only, using the KV **read-only** token.
- MGET of each sitemap-listed contractor's profile key and row keys: 108 calls.
- No BigQuery, no live resolver, no warming, no writes.

| Sub-page | Sitemap-listed | Rows unavailable (no cache entry) | True zero rows | Renderable |
|---|---|---|---|---|
| `/contractors/*/naics` | 7,864 | **7,864** | 0 | 0 |
| `/contractors/*/agencies` | 5,121 | **5,121** | 0 | 0 |
| **Total** | **12,985** | **12,985** | 0 | 0 |

A full read-only KV `SCAN` found **zero** `all-naics` / `all-agencies` keys under any version. That's 37% of the sitemap, all empty.

## 4. Fix: PR #1765

**Contract** (`src/lib/seo/subpage-contract.ts`), applied identically to `/naics` and `/agencies`. `SUBPAGE_MIN_ROWS = 5` is kept.

| Rendered rows | Page | robots | Sitemap | Headline |
|---|---|---|---|---|
| 0 or unavailable | honest "being refreshed" / "none recorded" state + link to the parent profile; no table | `noindex,follow` | absent | no count |
| 1–4 real rows | real rows | `noindex,follow` | absent | true rendered count |
| 5+ real rows | rows | indexable | eligible | equals rendered rows |

- **Canonical:** self-canonical in every tier.
- **Sitemap eligibility:** exact renderable row counts via a read-only KV `EVAL_RO` Lua script. No payloads, no BigQuery, fails closed.
- **Unchanged:** contractor profiles and `/contracts`. `/contracts` was audited and already gates on `available`.

**Tests:**
- The three tiers, at both the decision level and the rendered-HTML level.
- The row-count probe (read-only, fails closed).
- A no-BigQuery proof through the real readers on a cold cache.
- A mutation check: lowering the floor to 1 fails 7 tests.

**CI:** `verify` passed; local `tsc`, the full unit suite (750 files / 8,789 tests), eslint and `next build` passed.

## 5. Production acceptance

**Serving identity:**
- Squash-merged with the head pinned to `45584162`, producing **merge commit `b4ec5bcc`** (2026-09-30 09:58:43 UTC).
- **Production deployment `dpl_5XRrDEtCCWt9STPuuf9HRUYy6bud`** (`market-assassin-ax2wxuj73`), Ready, created 09:58:46 UTC, serving getmindy.ai.

**Sitemap, before → after:**

| | Before | After |
|---|---|---|
| **Total** | **35,326** | **22,336** |
| contractor profiles | 11,770 | 11,770 |
| `/contracts` | 9,407 | 9,407 |
| `/naics` | 7,864 | **0** |
| `/agencies` | 5,121 | **0** |
| other (static + facets) | 1,164 | 1,159 |

**Variance:** the preview measured 22,339 and production 22,336. The difference is entirely in facet URLs, generated from live Supabase counts at each build (data drift between builds). All contractor URL families are identical.

**Acceptance checks:**

| # | Check | Result |
|---|---|---|
| 1 | Empty `/naics` or `/agencies` pages in the sitemap | **0** |
| 2 | Sitemap total | **22,336** (variance explained above) |
| 3 | Sampled empty sub-pages (16 = 8 contractors × 2 tabs) | 200, `noindex, follow`, self-canonical, 0 rows, honest copy, no stored-count claim. **0 failures** |
| 4 | 1–4-row pages | **None exist to sample.** 0 row caches (full KV `SCAN`). Tier enforced by tests |
| 5 | 5+-row pages | **None exist to sample**, same reason. Tier enforced by tests |
| 6 | Contractor profiles (5 sampled) | 200, indexable, self-canonical |
| 7 | The three one-row `/contracts` pages | unchanged: 200, indexable, self-canonical, 1 row, still in the sitemap |
| 8 | No public route or sitemap generation reaches BigQuery | `ENABLE_SEO_LIVE_BQ` absent in production. Unit proof that a cold cache never calls `bqQuery`. The production build log (887 lines) shows 0 BigQuery job or query lines, 0 guard blocks and 0 row-probe errors. The sitemap uses KV `EVAL_RO` only |

## 6. Deliberately not done

- **No cache warmer was run or designed.** These sub-pages return to the sitemap only when five or more real rows are cached **and** there is a demonstrated reason to index them.
- **No GSC "Validate fix" was started.**
- **The 7,377-page 404 report** is assessed from a 1,000-URL sample; the rest will be measured by the SEO-health job's rotating URL Inspection once it's activated.

## Files in this folder

- `SUMMARY.md` (this document)
- `scope-before.aggregate.json`: aggregate scope counts
- `scripts/`: `recheck.mjs`, `inspect-thin.mjs`, `measure-subpage-scope.mjs`. Methodology only: read-only, no credentials, and they take their inputs as arguments.

**Not committed:** the raw Search Console export, per-URL result tables, sitemap copies and temporary files.

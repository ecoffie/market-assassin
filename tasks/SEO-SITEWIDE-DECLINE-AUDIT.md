# getmindy.ai site-wide impression decline — audit in progress

**Opened 2026-08-25.** Status: **breakpoint identified, root cause NOT yet confirmed.**

## Standing statement for any status report

> The awards cache defect materially harmed `/contracts` and explains approximately
> half of the measured site-wide impression loss. A separate site-wide decline
> remains under investigation. Traffic recovery has not yet been demonstrated.

## 1. The breakpoint is mid-to-late JULY, not August

Weekly impressions (GSC, sc-domain:getmindy.ai):

| Week | Impressions |
|---|---|
| Jun 15–21 | 12,430 |
| Jun 22–28 | 3,172 |
| Jul 6–12 | 8,826 |
| Jul 13–19 | 4,500 |
| **Jul 20–26** | **1,237** ← floor reached |
| Jul 27–Aug 2 | 1,279 |
| Aug 3–9 | 1,079 |
| Aug 10–16 | 1,572 |
| Aug 17–23 | 909 |

The site fell to ~1,200/week in the week of **July 20** and has stayed there.

**The August 18 Google spam update is NOT the primary cause.** The site had already
been at the floor for four weeks when that rollout began. It may have contributed to
the tail (Aug 17–23 is the lowest week) but cannot explain the collapse.

An earlier drop around **June 22** is also visible (12,430 → 3,172). Whether these are
one cause or two is unresolved.

## 2. Like-for-like attribution (Jul 1–23 vs Aug 1–23, 23 days each)

| | Jul 1–23 | Aug 1–23 | per-7d |
|---|---|---|---|
| Total | 18,427 | 4,256 | 5,608 → 1,295 |
| `/contracts` | 8,790 | 1,682 | 2,675 → 512 |
| Everything else | 9,637 | 2,574 | 2,933 → 783 |

- `/contracts` = **50.2%** of the decline (an earlier 82% figure compared a 31-day
  month against 23 days and was wrong).
- `/contracts` fell **80.9%**; everything else fell **73.3%**. Similar magnitude —
  this is not solely the awards bug.

## 3. Segmentation

**By page family** (Jul 6–19 → Aug 10–23, impressions / distinct pages):

| Family | Before | After | Pages retained |
|---|---|---|---|
| `/contractors/*/contracts` | 6,518 / 1,200 | 1,032 / 266 | 22% |
| `/contractors/*` overview | 3,809 / 1,322 | 1,181 / 462 | 35% |
| `/opportunity/*` | 1,622 / 624 | 114 / 87 | 14% |
| `/contractors/*/naics` | 700 / 359 | 73 / 38 | 11% |
| `/contractors/*/agencies` | 668 / 300 | 26 / 21 | 7% |
| homepage | 131 / 1 | 174 / 1 | **grew** |

Every family collapsed together. **The homepage grew** — which argues against a
manual action or domain-level penalty, since those suppress everything.

**By device:** desktop −82%, mobile −78%, tablet −92%.
**By country:** usa −82%, can −87%, ind −58%, mex −100%.
Uniform across every segment — rules out demand shift, seasonality, or a
device/geo-specific issue.

## 4. Ranking loss vs disappearance — DISAPPEARANCE

| | Jul 6–19 | Aug 10–23 |
|---|---|---|
| Distinct queries | **1,454** | **25** |
| Impressions | 3,765 | 99 |

- Queries that vanished entirely: **1,442** (3,667 impressions)
- Queries that survived: **12** (98 → 60 impressions)
- Surviving queries' avg position: 47.6 → 57.6

Pages are not ranking worse. They have **left the index**. 2,893 contractor pages
earned impressions in July and zero in August.

## 5. The pages are healthy NOW

Spot-checked the top lost pages as Googlebot. Most return **HTTP 200, indexable,
with a self-referencing canonical**:

    582 impr  HTTP 200  index    /contractors/industries-for-the-blind.../contracts
    422 impr  HTTP 200  index    /contractors/morphosis-architects
    283 impr  HTTP 200  index    /contractors/rocket-lab-usa-inc/contracts
    232 impr  HTTP 404  --       /contractors/buro-happold-consultng-engineers-pc/contracts
    270 impr  HTTP 200  NOINDEX  /contractors/the-timken-company/contracts/2   (paginated: correct)

`robots.txt` is clean (`Allow: /`, disallows only `/api/ /admin/ /app/ /_next/
/contracts/ /reports/`). Sitemap index and both child sitemaps return 200.

So the current serving state does not explain the deindexing — consistent with
damage done during the outage window and not yet re-crawled.

## 6. Open questions — NOT yet answered

1. **What happened around July 20?** Nothing in the merge log for Jul 14–26 is
   obviously SEO-affecting (all Opportunity-Map/MCP work). Needs correlation with
   deploy timestamps, not just merge dates.
2. **The June 22 drop** — same cause, or separate?
3. **GSC UI data not accessible via API:** manual actions, security issues,
   page-indexing report, crawl stats, sitemap submission history. **These require a
   human to check** and could settle the question immediately.
4. **`/opportunity/*` churn:** the sitemap holds 842 URLs; 624 pages had impressions
   in July. SAM opportunities expire, so some decay is expected — but the scale
   needs quantifying separately from the contractor-page loss.

## 7. What was NOT done, and why

- **No IndexNow submission.** Google is not an IndexNow participant, and the
  Indexing API is restricted to job postings and livestreams. Neither is a valid
  lever for these pages. Sitemap + URL Inspection is the correct path.
- **No sitemap resubmission yet** — pending the breakpoint explanation.
- **No new SEO work, homepage edits, or bulk indexing requests.**

## 8. Cohort prepared (NOT submitted)

`tasks/contracts-recovery-cohort.json` — 18 URLs stratified TOP / MIDDLE / DEEP by
July impressions, each verified to serve 200 and be indexable. Baseline window
2026-07-06..2026-07-19. For URL-Inspection tracking at +7/+14/+28 days once the
audit concludes.

Six candidates were excluded: 2 return 404, 4 are legitimately noindexed
(paginated `/contracts/2` pages, which is correct behavior).

## 9. Sitemap reconciliation — no defect

9,639 served recipients − 5 duplicate-slug collisions − 197 thin-content
(<$25K obligated or <2 awards) = **9,437 emitted**. Both gates are deliberate and
predate the incident. The sitemap is correct as-is.

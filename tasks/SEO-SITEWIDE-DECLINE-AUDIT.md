# getmindy.ai site-wide impression decline — audit in progress

**Opened 2026-08-25.** Status: **leading hypothesis, NOT proven.** See section 10 and
the causation caveat in 10a.

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

---

# 10. LEADING HYPOTHESIS (2026-08-25, from the GSC Coverage export)

## The finding

**Google crawled ~7,300 contractor URLs and recorded them as 404. Those same URLs
serve HTTP 200 today.**

⚠️ **This is consistent with the outage. It does not prove the outage caused the
July 20 collapse.** See 10a.

The Page Indexing report:

| Bucket | Pages |
|---|---|
| **Indexed** | **6,930** |
| Not indexed | **26,600** |
| ├ Crawled – currently not indexed | 13,797 |
| ├ **Not found (404)** | **7,303** |
| ├ **Soft 404** | **2,924** |
| ├ Blocked by robots.txt | 2,016 |
| └ Excluded by 'noindex' | 370 |

Over **10,200** URLs Google knows about are 404 or soft-404, against 6,930 indexed.

## What the export actually shows

From the exported *Not found (404)* sample (999 rows, all contractor pages):

**Crawl dates cluster in a five-day burst:**

| Date | URLs crawled |
|---|---|
| 2026-08-08 | 95 |
| 2026-08-09 | 150 |
| **2026-08-10** | **237** |
| 2026-08-11 | 142 |
| **2026-08-12** | **229** |
| Aug 13–21 | 7–26/day |

**853 of 999 (85%) were crawled Aug 8–12.** After Aug 12 the rate collapses to
single/low-double digits per day.

**They are not broken now:** of 40 sampled across the whole export, **36 return
HTTP 200** today. Of 25 that are *also in the current sitemap*, **25/25 return 200**.

**They are not phantom slugs:** 121 of 200 sampled 404 URLs are IN the current
sitemap. This is not the June 2026 `contractors.json` phantom-slug pattern — these
are pages we are correctly advertising, which were broken when Google last looked.

Only 4 of 40 are genuinely still 404 (`electromech-technologies-llc`,
`city-of-jacksonville`, `city-light-and-power-awp-llc/contracts`,
`gilbane-exyte-a-joint-venture/agencies`) — a small real-defect residue worth
separate triage.

## Why this is the leading hypothesis

It fits the puzzle in section 3: every page family collapsed together while the
homepage grew. A ranking penalty would not spare the homepage; a **crawl-time
outage** would — the homepage does not depend on the awards serving path. Fitting
the evidence is not the same as being proven by it.

The mechanism was never demotion. It was **deindexing**: Google crawled thousands
of contractor URLs during the outage, got 404/soft-404, and dropped them. Section 4
measured the result — 1,454 distinct queries became 25, with 1,442 vanishing
entirely rather than sliding down the rankings.

## Revised attribution (provisional)

The earlier framing — "`/contracts` is ~50% of the loss; a *separate* site-wide
decline remains under investigation" — is probably too conservative, but the
single-cause version is **not yet established**. Both halves *plausibly* trace to
the same event. The awards defect took down `/contracts` *content*, and the resulting
404/soft-404 responses got the broader contractor URL space deindexed. `/opportunity`
decay is likely separate (SAM opportunities legitimately expire) and still unquantified.

**The August 18 Google spam update remains ruled out** — the crawl damage was done
Aug 8–12 and the impression floor was reached the week of July 20.

## What this means for recovery

The pages are healthy. Nothing needs fixing in the serving path — that work is done
(#1346, #1353, #1357). What remains is **getting Google to re-crawl and re-index**,
which is a validation-and-patience problem, not a code problem.

The GSC "Validation: Failed" flags on the 404 and Soft 404 rows are from earlier
attempts, made while the pages were still broken. **They should now be re-validated**
— this time the pages actually serve 200.

## 10a. THE CAUSATION GAP (must be closed before claiming causation)

**The August 8–12 crawl burst cannot by itself explain a July 20 breakpoint.**

What the crawl dates establish: on Aug 8–12 Google encountered ~7,300 URLs
returning 404. What they do NOT establish: that those URLs were already 404 on
July 20, or that the awards outage began then.

A crawl date records when Google *looked*, not when the page *broke*. Google may
have been re-crawling in August URLs it had already dropped weeks earlier, in which
case the Aug 8–12 burst is a **symptom of the deindexing, not its cause**.

**Evidence still required:**

1. **Deployment history** — when did the awards serving path actually start
   returning 404/empty? Vercel deployment timestamps for mid-July, not merge dates.
2. **Server logs / analytics** — 404 rate on `/contractors/*` through July.
3. **GSC crawl stats** (Settings → Crawl stats) — response-code distribution over
   time. This would show a 404 spike in July directly, and is the single most
   decisive artifact still missing.
4. **The June 22 drop** (12,430 → 3,172 weekly) — still entirely unexplained and
   predates any awards-outage theory.

Until at least one of these lands, the record says: **the outage is consistent with
the 404 bucket; it is not established as the cause of the July 20 collapse.**

## Recommended sequence (NOT yet executed)

1. **Triage the 4 genuine 404s** — small, real, unrelated to the outage.
2. **Re-run validation** on *Not found (404)* and *Soft 404* in GSC. This is the
   correct lever: it asks Google to re-crawl the exact affected set.
3. **Resubmit the sitemap** (`sitemap-index.xml`).
4. **URL-Inspect the prepared 18-URL cohort** (`tasks/contracts-recovery-cohort.json`)
   as the measured sample.
5. **Measure at +7 / +14 / +28 days** against the Aug 17–23 trough of 909 impressions.

Expect weeks, not days: ~10,200 URLs must be re-crawled on a domain whose crawl
budget was just spent discovering they were broken.

---

# 11. ALL THREE BUCKETS CLASSIFIED (2026-08-25)

Exports pulled for the three largest non-indexed buckets. **Two distinct causes**,
cleanly separable.

## Bucket A — Not found (404): 7,303 · THE OUTAGE

Covered in section 10. 85% crawled Aug 8–12, 90% serve 200 today. Recovery is
re-validation + re-crawl.

## Bucket B — Soft 404: 2,924 · MOSTLY OUTAGE DAMAGE (corrected 2026-08-25)

⚠️ **This section originally concluded the bucket was "the fix working as designed."
That was wrong — it generalised from a 15-URL sample.** Tested at scale:

| | Count (of 1,000 sampled) |
|---|---|
| **IN the current sitemap** | **752 (75%)** |
| Not in sitemap (unavailable-state) | 248 (25%) |

Of 19 sitemap-listed Soft 404s re-tested, **19 rendered full content and none were
noindexed**. They were broken when Google crawled them (Aug 19–22) and have since
recovered — the same pattern as bucket A.

So roughly **three quarters of this bucket is recoverable outage damage**, and only
the remaining quarter is the intentional fail-closed state.

**Revised action: include Soft 404 in the recovery validation, not just 404.**

**Reconciliation to the 2,133 unserved recipients:** the bucket does NOT map to them
1:1. No pagination variants appear (0 of 1,000 rows are `/contracts/N`; all are bare
`/contracts`), and the 1,000 sampled rows represent 1,000 distinct recipients. The
~25% not in the sitemap are consistent with unserved recipients; the ~75% in the
sitemap are not. Any claim that "2,924 Soft 404 = 2,133 unserved recipients" is
unsupported.

## (superseded) original bucket-B reasoning

**100% `/contractors/*/contracts`.** Crawled recently — Aug 19–22, *after* the
outage — which initially looked alarming. It is not.

The sample splits perfectly on sitemap membership:

| In sitemap | Rendered | Meaning |
|---|---|---|
| **Yes** (9/15) | 3,387–6,285 words | healthy, serving real award tables |
| **No** (6/15) | 469–523 words | the `noindex, follow` **unavailable state** |

Verified on `deloitte-consulting-llp/contracts`: `<meta name="robots"
content="noindex, follow">`, absent from the sitemap, ~487 words.

These are the **2,133 recipients (11,772 − 9,639) that have no served pages**.
The fail-closed design — added in #1346 — deliberately renders an honest
"unavailable" page instead of a false zero. Google classifies a thin noindex page
as Soft 404, which is the correct and expected outcome.

**Superseded — see the corrected block above.** The fail-closed reading holds for
only ~25% of the bucket.

## Bucket C — Crawled, currently not indexed: 13,797 · THIN SUB-PAGES

The largest bucket, and a **genuine live defect unrelated to the outage**.

| Family | Rows (of 999) | Rendered |
|---|---|---|
| `/contractors/*/naics` | 384 | 378–407 words |
| `/contractors/*/agencies` | 262 | 378–396 words |
| `/contractors/*` overview | 209 | 2,618–3,058 words (healthy) |
| `/opportunity/*` | 81 | ~1,119 words |

**646 of 999 (65%) are `/naics` + `/agencies` sub-pages at ~400 words, all
indexable, all in the sitemap.** The sitemap advertises **5,077 `/agencies` +
7,832 `/naics` = 12,909** such pages — closely matching the 13,797 bucket size.

**Why the existing gate misses them:** `SUBPAGE_MIN_ROWS = 5` gates on *row count*,
not rendered content. A contractor with 5–8 NAICS codes clears the gate and still
renders ~400 words. The gate is calibrated to the wrong quantity.

Google crawls these, finds almost no unique content, and declines to index — which
is the correct call on its part. The cost is **crawl budget**: ~12,900 low-value
URLs competing with the ~10,000 pages that need re-crawling for recovery.

## Correction to an earlier claim in this audit

I predicted the Soft 404 bucket would be thin `/naics` sub-pages. **That was wrong** —
Soft 404 is entirely `/contracts` unavailable-state pages. The thin sub-pages are in
*Crawled – not indexed* instead. The prediction was right about the defect and wrong
about which bucket it lands in.

Separately, I briefly flagged a "rendering defect" after seeing
`/contractors/leidos-inc/contracts` return 124 words. **Also wrong** — that URL is a
404 (not a served recipient, not in the sitemap), so I was measuring a 404 page.
Served `/contracts` pages render 1,821–4,324 words correctly. Check the status code
before judging the render.

## Gap closure (2026-08-25)

**Gap 1 — the ~10% of 404s that do not recover: CLOSED, no defects.**
All 999 exported URLs were probed: **907 return 200, 93 still 404 (9.3%)**,
extrapolating to ~680 of 7,303.

Of the 93 (88 distinct slugs):

| Classification | Count |
|---|---|
| Not in the BigQuery top-12,000 (below spend cutoff) | 64 |
| Present but below the thin gate (<$25K or <2 awards) | 24 |
| **Present, above the gate — a real defect** | **0** |
| In the current sitemap | **0** |

Every remaining 404 is an **intentional removal**. None is advertised in the
sitemap, so none should block validation.

*Policy note, not a defect:* the `<2 awards` gate excludes some very large
single-award recipients — e.g. `salado-isolation-mining-contractors-llc` at
**$1.67B on 1 award**, `msm-group-north-america-inc` at $635M. Worth revisiting
after recovery; a single enormous award is not the same as thin content.

## Revised priority

1. **Recovery first** (buckets A **and B**) — re-validate 404s, resubmit sitemap, measure.
2. **Then the thin-subpage gate** (bucket C) — raise/re-base `SUBPAGE_MIN_ROWS` on
   rendered content, or noindex + drop from sitemap below a real threshold. Do NOT
   ship during the recovery measurement window; it would confound the signal.
3. **Nothing for bucket B** — it is the fail-closed design behaving correctly.

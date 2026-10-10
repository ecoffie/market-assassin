# Apify cost audit — 2026-10-10

Read-only. Nothing in production, billing, schedules or datasets was changed.
Sources: Apify API (`/users/me`, `/users/me/limits`, `/users/me/usage/monthly`, `/actor-runs`,
`/schedules`, `/actor-tasks`, `/acts`, `/webhooks`, per-run dataset items with only
`solicitationNumber,indexFileDate` selected), Supabase `cron_jobs`, `cron_job_runs`, `dibbs_rfqs`,
`user_engagement`, and the code on `origin/main` (`src/app/api/cron/sync-dibbs/route.ts`,
`src/lib/dibbs/ingest.ts`, `src/lib/dibbs/direct.ts`).

---

## 1. What the $415.81 is

**Account:** the GovCon Giants Apify account. **Plan: Scale.** It costs $199/mo and
includes $199 of usage credit. Hard cap: `maxMonthlyUsageUsd = $500`. Billing cycle runs from the 8th to the 7th.

**Usage for the cycle Sep 8 → Oct 7 2026 was exactly $415.81:**

| Service | Quantity | USD |
|---|---|---|
| `PAID_ACTORS_PER_EVENT` (Store actor, billed per result) | 28,996 result items × $0.01434 | **$415.80** |
| `DATASET_READS` | 29,003 | $0.01 |
| Compute units, proxy, storage, data transfer | 0 | $0.00 |
| **Total** | | **$415.81** |

**How that becomes a $415.81 charge on Oct 7/8:** $199 Scale renewal for the new cycle (Oct 8 →
Nov 7) plus $216.81 overage for the closed cycle ($415.81 usage − $199 included credit). Because
the base price equals the included credit, the charge always equals total usage once usage passes $199.
⚠️ The Apify API doesn't expose invoices, so I couldn't see the line-item split. The figure matches
usage to the cent. **Confirm the split at console.apify.com → Billing → Invoices.**

**Is this normal?** Yes. This is the steady state, not a spike:

| Cycle | Usage | Note |
|---|---|---|
| Jun 8 – Jul 7 | $0.68 | pilot |
| Jul 8 – Aug 7 | **$499.996** | **hit the $500 hard cap**, which caused the documented DIBBS spend-cap outage |
| Aug 8 – Sep 7 | $321.96 | |
| Sep 8 – Oct 7 | **$415.81** | the charge in question |
| Oct 8 – Oct 10 (MTD) | $35.85 | 1 paid run in 3 days |

**Projection for the current cycle at the current rate:** last cycle averaged $13.86 per calendar
day, which gives **~$416 for the cycle** (range $320–$500 based on the last three cycles). The
invoice will be about the same, because usage is above the $199 floor.

## 2. Top cost-generating jobs

**There is exactly one job.** The account has 0 schedules, 0 tasks, 0 own actors and 0 webhooks. All
22 runs still retained (Apify keeps 31 days) are the same actor, started by API at exactly 08:00 UTC:

| | |
|---|---|
| Actor | `parseforge/dibbs-rfq-scraper` (id `uygfXaVUQwG89qWuy`), pinned build 1.0.40 |
| Pricing | PAY_PER_EVENT, `result-item` = **$0.01434** at the Silver/Scale tier. Optional detail and PDF events are off. |
| Caller | Mindy prod cron `cron_jobs.sync-dibbs`, `0 8 * * *`, route `/api/cron/sync-dibbs?maxItems=2500&daysBack=2` |
| Consuming project | **market-assassin (Mindy) only.** The `ma-*` folders holding `APIFY_TOKEN` are clones of this repo. The other repos only mention Apify in docs and research JSON. |
| Feeds | `dibbs_rfqs` (80,033 rows) → Opportunity Map **DLA mode**, `DibbsPanel`, `/api/app/dibbs`, opportunity-detail |
| Duplicate elsewhere? | No. BigQuery and SAM don't carry DIBBS small-buy RFQs. The only other source is DLA's own daily flat file, which `direct.ts` already reads for free. |

Most expensive runs in the cycle. Each $35.85 run is the 2,500-item cap:

| Run date | USD | Items billed | Unique solicitations | New vs. earlier runs |
|---|---|---|---|---|
| 09-10, 09-11, 09-16, 09-22, 09-25, 09-29, 10-07 | $35.85 each (10-07: $35.75) | 2,500 | 2,147–2,357 | 1,780–2,356 |
| 09-23 | $31.83 | 2,220 | 2,050 | 1,965 |
| 09-08 | $29.97 | 2,090 | **1,288** | 1,288 |
| 09-28 | $27.30 | 1,904 | 1,525 | 1,525 |
| 09-14 | $21.24 | 1,481 | 1,333 | 1,333 |
| 09-24 | $20.41 | 1,423 | 1,344 | 1,174 |
| 10-05 | $20.31 | 1,416 | **951** | 951 |
| 09-09 | $13.90 | 969 | 752 | 752 |
| 09-13, 09-20, 09-21, 09-27, 09-30, 10-01, 10-04 | $0.00 | 0–1 | — | — |

**Why some days have no Apify charge.** The cron asks for 2,500 items. That is over the cost guard's
threshold (`APIFY_MAX_ITEMS_BEFORE_DIRECT=800`), so it tries the **free direct fetcher** first.
Apify only runs if the direct path returns nothing.

- **Direct succeeded on about 8 of 33 days**, with no Apify run: 09-15, 09-17, 09-18, 10-02, 10-06, 10-09, 10-10. Verified in `dibbs_rfqs`: 1,903, 2,129 and 1,596 rows landed on 10-02, 10-06 and 10-09 in the direct path's row shape.
- On other days the direct path failed with "WAF blocked all 2 index file(s)" and Apify ran at the full cap.

## 3. Waste and duplicate processing (Sep 8 – Oct 7)

| Finding | Rows | $ | Avoidable? |
|---|---|---|---|
| **Duplicate line-items inside a run.** One solicitation appears once per delivery line (e.g. `SPE4A0-26-T-4708` × 70). The actor bills every line, then `upsertDibbsRfqs` collapses them to one row per solicitation. | 3,773 (13%) | **$54.10** | Not on the vendor side: the actor has no dedupe input (checked the build 1.0.40 input schema). Only avoided by not paying per row (see §5-B). |
| **Re-bought solicitations** already purchased in an earlier run | 1,014 | **$14.54** | Same as above |
| **Failed or starved runs** | 7 runs | **$0.00–$0.01** | Already free. Pay-per-result means failed runs don't bill. Not a cost problem. |
| Excess proxy, compute or storage | — | $0.00 | Nothing to cut. The vendor's residential proxy is bundled into the per-result price. |
| Duplicate schedules, orphan tasks, unconsumed jobs | — | $0 | **None exist** |
| Running more often than the source changes | — | — | No. DLA publishes one file per day and each run reads only the previous day's file. Daily is the correct frequency. |
| **Structural:** paying a vendor $0.0143/row for a free public flat file. About 2,500 rows/day is about $36/day. The vendor's real product is getting past DLA's F5 WAF. | 24,209 useful rows | **$347.16** | Yes, if we can reliably get past the WAF ourselves (§5-B) |

**Related coverage bug (not waste):** 9 of 15 paid runs hit exactly 2,500 items, so that day's file
had more rows than the cap. Mindy is paying the maximum price **and** missing the end of the file on
busy days. The direct path also caps at 2,500.

**Data-quality notes, out of scope:**
- Direct-path rows have no `buyerCode` or `scrapedAt`, so `buyer` is likely null on those days.
- The upsert keeps only the last line per solicitation, so per-line quantities are lost.

**Who uses it:** in the cycle, DLA mode logged 238 map events out of 92,195 (0.26%), from 28
signed-in non-staff customers plus 23 anonymous/staff, with 65 listing opens. That's about **$6.40
per listing open**. The feature is used but small. That's a product question for Eric, not
something this audit decides.

## 4. Jobs that can be stopped safely

**None without losing DLA coverage.** `sync-dibbs` is the only DIBBS feed. Stopping it freezes the
Map's DLA mode and DibbsPanel. RFQs close in about 7 days, so they would go stale within a week.
There are no orphan or duplicate jobs to turn off. Turning DIBBS off entirely saves about
$217/mo on Scale (usage falls to $0 but the $199 floor stays) or about $416/mo if the plan is also
cancelled. **That's a product decision for Eric, not a safe stop.**

## 5. Jobs that can be optimized (ranked)

| # | Change | Current $/mo | Expected savings | Risk to Mindy | Freshness impact | Effort | Reversible |
|---|---|---|---|---|---|---|---|
| **A** | **Direct-first retry ladder.** Add `?directOnly=1`. Try only the free direct fetcher at e.g. 08:00 / 11:00 / 14:00. Call Apify only in a last slot (e.g. 17:00) if no attempt ingested today's file. | ~$416 | **~$200–217** (usage to ~$150–200; the Scale floor caps the saving at $217). Assumes direct succeeds ~24% per attempt and attempts are independent. **Unproven:** Vercel egress may be sticky. | Low. Apify stays as backstop, same-day coverage kept | Worst case data lands ~9h later on WAF-blocked days | Low–medium: route param, a "today already ingested" check, 3 `cron_jobs` rows | Yes. Disable the rows |
| **B** | **Run the direct fetcher through Apify's residential proxy.** We already have `PROXY_RESIDENTIAL` at $7.50/GB. A day's file is well under 1 MB, so the proxy costs cents per month. The vendor gets past the WAF with exactly this proxy, so the same egress should work for our Puppeteer. The vendor actor becomes fallback only. | ~$416 | **~$350–400** usage reduction. Also fixes the 2,500 truncation for free (raise direct's cap). | Medium until a spike proves the WAF accepts it. Needs the Apify proxy password as a new Vercel env var, created by Eric (not rotated or exposed by me). | None. Same-day, and fuller files | Medium: spike first (local, one file, costs cents), then wire `proxy-server` into `launchBrowser` | Yes. Env flag, falls back to today's path |
| **C** | **Downgrade Scale → Starter** ($39/mo plan) **only after A or B** brings usage under ~$195/mo for a full cycle. | $199 floor | **~$160** more (with B: invoice about $40–60/mo) | Low. Per-result price goes up 2% ($0.01466). ⚠️ Check Starter's monthly usage cap and residential-proxy access before switching. | None | Click in console | Yes. Upgrade any time |
| D | Lower `maxItems` below 2,500 | — | Saves money by **dropping RFQs** | High: silent data loss | Coverage loss | Trivial | — |

**Not recommended:** D (it already truncates on busy days). Cancelling the $500 hard cap (it's what
stops a runaway bill). Retrying Apify (it bills again for the same rows, as in the documented $71.70
double run).

## 6. Estimated monthly savings

| Path | Expected monthly Apify bill | Savings vs. ~$416 |
|---|---|---|
| Do nothing | ~$416 (range $320–$500) | — |
| A only, stay on Scale | ~$199–230 | ~$190–217 |
| B (+ A as belt and braces), stay on Scale | $199 (floor) | ~$217 |
| **B + C (Starter)** | **~$40–60** | **~$355–375** |

## 7. Recommended immediate actions (all need your approval; nothing has been done)

1. **Confirm the invoice split** in the Apify console: expected $199 renewal + $216.81 overage.
2. **Approve a B spike.** Locally, run `fetchDibbsDirect` for one file through `proxy.apify.com`
   residential. Cost under $0.10. It's read-only against DLA and writes nothing to the DB. Pass/fail
   = real fixed-width rows vs. the DoD consent page.
3. If the spike passes → build B behind an env flag, keeping today's path as fallback. If it fails → build A.
4. After one full cycle under ~$195 → **downgrade to Starter** (C).
5. Separately, decide whether DLA mode is worth about $200–400/mo at its current usage (28 customers, 65 listing opens per cycle).

## 8. Risks and rollback

| Risk | Mitigation / rollback |
|---|---|
| B: WAF blocks residential + Puppeteer from Vercel | Flag off, so the cron falls back to today's direct → Apify chain unchanged. Spike first. |
| A: direct attempts aren't independent, so savings are smaller than estimated | The last-slot Apify call still guarantees same-day data. Delete the extra `cron_jobs` rows to revert. |
| A/B: DLA WAF tightens because of our extra attempts | At most 3 attempts/day, never a burst. Apify actor stays as backstop. |
| C: Starter limits (usage cap, proxy) are lower than Scale | Upgrade back in the console instantly. Only downgrade after a full low-usage cycle. |
| Over-cap outage (as in the Jul cycle) | Keep the $500 cap. Lower usage makes hitting it less likely. |
| Credentials | No token was printed or rotated. B needs a **new** proxy-password env var that Eric creates. |
| Vendor build breakage (1.0.41 incident) | Unchanged. The pin at 1.0.40 stays. B lowers our dependence on the vendor. |

---

### Reproduce

```bash
T=<APIFY_TOKEN from .env.local>
curl -s "https://api.apify.com/v2/users/me/usage/monthly?date=2026-10-01&token=$T"   # cycle Sep 8–Oct 7
curl -s "https://api.apify.com/v2/actor-runs?token=$T&limit=1000&desc=1"             # per-run usageTotalUsd
curl -s "https://api.apify.com/v2/users/me/limits?token=$T"                          # MTD + cap
```

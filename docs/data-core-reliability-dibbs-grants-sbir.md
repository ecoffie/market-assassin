# Data Core Reliability — DIBBS · Grants · Research & Lab Funding (SBIR)

**Status: AUDIT ONLY. No sync run, no job restarted, no data refreshed, no
freshness stamped, no cron changed, no source code modified, no counts changed,
no populations deduped, no producer repaired, no production data modified.**
**Date: 2026-09-13 · main `2f731a2c` (after the #1457 inventory-truth merge)**

> Holding records is not the same as having a reliable data feed.
> **Job success ≠ data advancement.**

All figures `SELECT`-only through the read-only client.

---

## Headline

**One domain is genuinely reliable, one is reliable-with-a-caveat, and one is
carrying two dead sources behind daily green checkmarks.**

The `snapshot-multisite-darpa` and `snapshot-multisite-nsf` crons have each reported
**`success` on 75 of 86 daily runs (errors only in a Jun 19-29 window)** while their data last advanced
**2026-04-05** and **never**, respectively. That is the exact failure this audit
was designed to catch, and it is invisible to every current monitor.

---

## Master table

| Domain | Source | Store | Rows | Producer | Cadence | Last Success | **Last Advance** | Latest Source Date | Failure Rate (90d) | Monitoring | Status |
|---|---|---|---|---:|---|---|---|---|---|---|---|
| **DIBBS** | DLA DIBBS flat files | `dibbs_rfqs` | **48,385** | `cron/sync-dibbs` → Apify **+ `direct.ts` fallback** | `0 8 * * *` | 2026-09-12 | **2026-09-12** | 2026-09-12 | 12 err / 61 runs (**19.7%**) | job status only | 🟡 **YELLOW** |
| **Grants** | Grants.gov | `grants_cache` | **2,126** (902 still open) | `cron/sync-grants` | `0 9 * * *` | 2026-09-12 | **2026-09-12** | 2026-09-11 | **0 err / 44 runs (0%)** | job status only | 🟢 **GREEN** |
| **Research** | NIH RePORTER | `aggregated_opportunities` | **1,316** | `snapshot-multisite-nih` | `0 4 * * *` | 2026-09-13 | **2026-09-08** | 2026-09-05 | 11 err / 86 runs (12.8%) | job status only | 🟡 **YELLOW** |
| **Research** | Grants.gov (research slice) | same | **63** | `snapshot-multisite-*` | daily | — | **2026-04-12** (154d) | 2026-04-10 | — | none | 🔴 **RED** |
| **Research** | DARPA BAA | same | **6** | `snapshot-multisite-darpa` | `0 5 * * *` | **2026-09-13** | **2026-04-05 (161d)** | 2026-04-01 | 11 err / 86 runs | job status only | 🔴 **RED** |
| **Research** | NSF (`nsf_sbir`) | same | **0** | `snapshot-multisite-nsf` | `0 6 * * *` | **2026-09-13** | **NEVER** | — | 11 err / 86 runs | job status only | 🔴 **RED** |
| **SBIR view** | NIH RePORTER only | same (`opportunity_type='sbir_sttr'`) | **42** | inherits NIH | `0 4 * * *` | 2026-09-13 | 2026-09-08 | 2026-09-04 | inherits | none | 🔴 **RED** (coverage) |

---

## A — DIBBS reliability 🟡 YELLOW

**Store** `dibbs_rfqs` · **48,385 rows** · **6,968 touched in 7d**, **29,036 in 30d** —
a genuinely active feed, not a historical dump.

**Producer** `cron/sync-dibbs` (`0 8 * * *`), enabled, `last_status: success`,
`last_run 2026-09-12`. `max(synced_at) = 2026-09-12` — **job success and data
advancement agree.**

**Two paths, and the historical issue is already solved.** `src/lib/dibbs/direct.ts`
documents it precisely: on **2026-08-01** the Apify vendor
(`parseforge/dibbs-rfq-scraper`) shipped build 1.0.41 with a syntax error in their
own source, the actor could not start, and DIBBS ingest stopped dead. `direct.ts`
was built to remove that single point of failure — DLA publishes one fixed-width
flat file per business day at `dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in<YYMMDD>.txt`.

**The silent-empty risk is explicitly guarded.** `waf-blocked-not-empty.unit.test.ts`
pins that a WAF block is reported as a *block*, not as "no data": blocked files are
counted separately from missing ones, a total block **throws with its cause**, a
partial block does **not** throw ("some data beats an exception"), and a genuine
no-data window does not throw either. This is the best-instrumented of the three.

**Why YELLOW, not GREEN:** a **19.7% error rate** over 90 days (12 errors / 61 runs,
most recent 2026-08-26) and **no advancement monitoring** — freshness is inferred
from job status. Nothing would alarm if the flat file stopped changing while the
job kept returning 200.

**Customer impact if ingest stops:** `/api/app/dibbs`, opportunity-detail and the
**opportunity map** serve progressively staler small-buy RFQs with no staleness
signal. No cache/fallback layer masks it — the table simply ages.

---

## B — Grants reliability 🟢 GREEN (with a scope caveat)

### What `grants_cache` represents
The **mirrored Grants.gov corpus** — `opp_number`, `agency`, `cfda_list`,
`award_ceiling`, `posted_date`/`close_date`, plus map coordinates. **2,126 rows,
902 still open.** Producer `cron/sync-grants` (`0 9 * * *`): **44 runs, 0 errors
in 90 days**, `max(synced_at) 2026-09-12`, latest source date 2026-09-11,
**1,619 rows touched in 7 days**. Job success and advancement agree, with the
cleanest record of the three.

### What the 1,331 grant rows in Research & Lab Funding represent
A **different population from a different producer**: 1,274 from `nih_reporter`
(NIH research funding notices) + 57 from `grants_gov`. They are research/lab
funding, not the general Grants.gov corpus.

### Overlap — measured, not merged
The only defensible common key is `grants_cache.opp_number` ↔
`aggregated_opportunities.external_id`. On that key: **28 rows overlap** — 1.3% of
`grants_cache`, 2.1% of the research corpus. **They are substantially distinct
populations.** Not deduped, not merged, per the brief.

⚠️ **The `grants_gov` slice inside the research corpus is dead** (last advance
2026-04-12, 154 days). That is a *research-domain* failure, not a `grants_cache`
failure — see below.

**Why GREEN:** repeatable producer, zero failures, demonstrable advancement,
current source dates. **Caveat:** monitoring is still job-status only, and
lifecycle is unverified — 1,224 of 2,126 rows are past their close date and
retained. Whether that is deliberate archive or absent expiry was **not
established** (Grey sub-finding).

---

## C — Research & Lab Funding reliability 🔴 RED

**One healthy source is masking two dead ones.** The logical dataset looks alive
(1,385 rows, 451 added in 30d) because **NIH alone carries it**.

| Source | Rows | Last advance | Age | Cron says |
|---|---:|---|---:|---|
| `nih_reporter` | 1,316 | 2026-09-08 | 5d | success/dispatched |
| `grants_gov` | 63 | **2026-04-12** | **154d** | — |
| `darpa_baa` | 6 | **2026-04-05** | **161d** | ✅ **success, 75 runs** |
| `nsf_sbir` | **0** | **NEVER** | — | ✅ **success, 75 runs** |

### The core finding
`snapshot-multisite-darpa` and `snapshot-multisite-nsf` have each logged **75
successful runs of 86** (errors confined to 2026-06-19..29; unbroken success since 2026-06-30). DARPA has written nothing
since **2026-04-05**. NSF has **never written a single row** — `nsf_sbir` is a
defined source in `snapshot-multisite/route.ts` (lines 148, 487) that has produced
zero records while reporting success on every run since 2026-06-30.

**A successful job here provably returns without advancing data.** This is not a
hypothetical; it is 75 successful runs per source, none of which wrote a row.

**Whether a source outage looks like an honest empty: YES, and it currently does.**
Nothing distinguishes "DARPA published nothing" from "our DARPA parser broke."

**Lifecycle:** rows are retained indefinitely — all 1,385 are `status: 'active'`,
including 6 BAA rows whose latest source date is **2025-06-27**. Stale source data
can and does remain indefinitely.

**Is "aggregated" a one-time experiment?** The evidence says **partly**: NIH is a
durable ingestion system; DARPA/NSF/grants_gov look like a one-time seed plus a
cron that no longer produces. The table name reflects an aspiration the pipeline
only fulfils for one source.

---

## D — SBIR-specific reliability 🔴 RED (coverage, not freshness)

The 42 `sbir_sttr` rows **are current** — `nih_reporter`, last advance 2026-09-08,
latest source date 2026-09-04. Freshness is fine.

**Coverage is the problem.** All 42 come from **NIH RePORTER only**.

**Does the product have enough source coverage to be called an SBIR search
product?** On this evidence, **no**:
- **SBIR.gov** (the government-wide SBIR/STTR system of record) — the `nsf_sbir` path comments *"SBIR.gov covers all agencies including NSF"*, and it has produced **0 rows**.
- **DoD SBIR/STTR** — a `dod_sbir_topics` table exists in Supabase but does not feed this corpus.
- **NSF, DOE, NASA, DHS SBIR** — absent.

SBIR/STTR spans **11 participating federal agencies**; Mindy currently indexes
**one**, and the page (post-#1457) correctly presents it as a 42-row view rather
than a comprehensive SBIR product. **The inventory is honest; the coverage is thin.**

---

## Answers

**1. Can we rely on DIBBS today?** **Qualified yes.** Data advances daily, a
vendor-outage fallback exists, and silent-empty is explicitly guarded. The 19.7%
error rate and absent advancement monitoring keep it Yellow.

**2. Can we rely on Grants today?** **Yes** for `grants_cache` — 0 failures in 90
days, advancing daily. **No** for the research corpus's `grants_gov` slice (154
days dead).

**3. Can we rely on SBIR/STTR today?** **No.** The 42 rows are fresh but come from
1 of ~11 SBIR agencies, and the SBIR.gov path has never produced a row.

**4. Weakest?** **Research & Lab Funding** — two sources dead behind green
checkmarks, one never functional.

**5. Source-side vs Mindy-side?**
- **Mindy-side:** NSF/`nsf_sbir` producing 0 rows for 75 successful runs; DARPA silent 161d while reporting success; no advancement monitoring anywhere.
- **Source-side (historical, already mitigated):** the Apify vendor's broken 1.0.41 build — fixed by `direct.ts`.
- **Unknown:** whether DARPA genuinely published nothing since April. Plausible (BAAs are infrequent) but **unproven**, and the system cannot currently tell.

**6. Historical records vs healthy feed?**
- Healthy feed: `dibbs_rfqs`, `grants_cache`, `nih_reporter`.
- Historical only: `darpa_baa` (6 rows, Apr), `grants_gov` slice (63 rows, Apr), BAA rows dated 2025-06-27.
- Never populated: `nsf_sbir`.

**7. Missing sources entirely?** SBIR.gov · DoD SBIR/STTR · NSF · DOE · NASA · DHS
SBIR programs.

**8. Which jobs need advancement monitoring?** **All five** — none has it.
Priority: `snapshot-multisite-darpa` and `-nsf` (proven false-green), then
`sync-dibbs` (19.7% errors), then `snapshot-multisite-nih` and `sync-grants`.

**9. Customer-promise impact?**
- **Highest:** SBIR — a product surface backed by 1 of 11 agencies.
- **High:** DIBBS — feeds the opportunity map; staleness would be invisible.
- **Moderate:** research corpus — "Research & Lab Funding" implies NIH+DARPA+NSF; only NIH is live.
- **Low:** `grants_cache` — healthy.

**10. Smallest repair plan per domain** *(NOT executed)*
- **Research (do first):** add a C1 advancement oracle per *source*, not per job — the dataset-level clock is masked by NIH. Then diagnose why `nsf_sbir` writes 0 and whether DARPA's silence is real. **The monitor must come first**, or a fix cannot be verified.
- **SBIR:** a product decision before an engineering one — either wire SBIR.gov (the system of record) or label the surface as NIH-scoped. Do not present 1-of-11 coverage as an SBIR search product.
- **DIBBS:** add an advancement oracle on `max(synced_at)`; investigate the 12 errors for a pattern (Apify vs direct).
- **Grants:** add an advancement oracle; separately decide the close-date lifecycle (1,224 expired rows retained).

---

## Reliability states

| Domain | Status | One-line basis |
|---|---|---|
| DIBBS | 🟡 YELLOW | advances daily, fallback + silent-empty guard; 19.7% errors, no advancement monitor |
| Grants (`grants_cache`) | 🟢 GREEN | 0/44 failures, advancing daily, current source dates |
| Research & Lab Funding | 🔴 RED | 2 sources dead + 1 never functional behind 75 green runs each |
| — NIH RePORTER | 🟡 YELLOW | genuinely advancing; 12.8% errors, no advancement monitor |
| — DARPA BAA | 🔴 RED | 75 successful runs, last advance 2026-04-05 |
| — NSF (`nsf_sbir`) | 🔴 RED | 75 successful runs, **never** wrote a row |
| — Grants.gov slice | 🔴 RED | 154 days dead |
| SBIR/STTR view | 🔴 RED | fresh but 1 of ~11 agencies; SBIR.gov never produced a row |
| Lifecycle/expiry (all three) | ⚪ GREY | retention policy not established |

---

## Compliance

No sync run · no job restarted · no data refreshed · no freshness stamped · no
cron schedule changed · no source code modified · no counts changed · no
populations deduped · no producer repaired · no production data modified. The
only write is this document.

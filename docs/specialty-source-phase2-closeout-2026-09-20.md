# Specialty sources — Phase-II closeout (Workstream C)

**Date:** 2026-09-20 · Re-measured against production. The parked classifications
(2026-09-13) were **not** assumed correct — two have changed.

## Re-measured state

| Source | Store | Rows (was) | Last data advance | Behind | Parked | **Now** |
|---|---|---:|---|---:|---|---|
| **DIBBS** | `dibbs_rfqs` | **57,816** (48,385) | 2026-09-19 | 1d | 🟡 | **CONTROLLED_PARTIAL** — advancing, +9,431 rows |
| **Grants** | `grants_cache` | **2,149** (2,126) | 2026-09-20 | 0d | 🟢 | **CLOSED** (pending registration) |
| **Research · NIH** | `aggregated_opportunities` | **1,416** (1,316) | 2026-09-14 | **6d** | 🟡 | **REQUIRES_REPAIR** — degraded |
| **Research · grants_gov slice** | same | 63 | 2026-04-12 | **161d** | 🔴 | **REQUIRES_REPAIR** — dormant |
| **Research · DARPA BAA** | same | 6 | 2026-04-05 | **168d** | 🔴 | **REQUIRES_REPAIR** — dormant |
| **Research · NSF SBIR** | same | **0** | **NEVER** | — | 🔴 | **BLOCKED_CONTROLLED** — never produced a row |
| **SBIR** | `opportunity_type='sbir_sttr'` | **42** | inherits NIH | 6d | 🔴 | **REQUIRES_REPAIR** — 1 of ~11 agencies |

## 🔴 The headline: 60 green checkmarks over two corpses

30-day run outcomes, measured exactly (`status` **and** `http_status`):

| Job | Runs | Outcome | Data written |
|---|---:|---|---|
| `snapshot-multisite-darpa` | 30 | **30 × `success` / HTTP 200** | **nothing for 168 days** |
| `snapshot-multisite-nsf` | 30 | **30 × `success` / HTTP 200** | **never, not once** |
| `snapshot-multisite-nih` | 30 | **30 × `dispatched` / NULL** | 6 days stale |
| `sync-dibbs` | 30 | 26 success · 3 error · 1 dispatched | advancing |
| `sync-grants` | 30 | 29 success · 1 error (500) | advancing |

**DARPA and NSF report a clean HTTP 200 every day while producing nothing.**

⚠️ **A correction I had to make mid-audit:** I first counted NIH's 30
non-`success` runs as failures. They are `dispatched` — the outcome was never
reported. **Unknown is not failed.** The same unresolved-outcome pattern already
flagged for `institute-legislation-sync`, `precompute-opp-intel` and
`sync-decision-makers` affects NIH too; its job row cannot prove anything either
way, which is precisely why a *data* clock is required.

## Why the masking works

`aggregated_opportunities` has **one dataset-level clock** (`max(scraped_at)`).
Healthy NIH traffic holds it near today, so the corpus reads fresh while two of
its three contributing sources are dead. And `nsf_sbir` appears **nowhere in the
table**, so a `GROUP BY source` over it structurally *cannot* surface the
absence — the one source that has never worked is the one a table-only query
cannot see.

## What this PR adds

- **`research_source_advancement()`** — per-source rows, last scrape, latest
  source date, and a state (`current` / `content_stale` / `dormant` /
  `never_advanced`).
- **`research_expected_sources()`** — expected-vs-observed, so a configured
  source that has never written a row is *named* rather than missing.
- **Six `data_source_instances` rows.** These four specialty sources currently
  have **zero** control-plane coverage, so today they cannot be flagged stale
  even in principle — silence is indistinguishable from absence.
- A TS reader whose `corpusHeadline()` refuses to call a corpus healthy while any
  source is dead.

Registration is **truthful, not aspirational**: DARPA and the grants slice go in
as `content_stale` + `intervention_state='required'`; **NSF goes in as
`unmeasured`**, because we have never observed it — calling it "stale" would
imply it once worked. `upstream_population` stays NULL for all six: none exposes
a countable upstream total, and a guessed denominator is worse than an absent one.

## What this PR does NOT do

- **Repairs nothing.** DARPA is not investigated, NSF is not wired, SBIR coverage
  is not expanded, no schedule is changed, no retention is touched — all of which
  the park explicitly forbade without a product decision.
- Writes no row to any specialty table.
- Does not change `sync-dibbs`, `sync-grants` or any multisite job.

## Production action required after merge — YES

1. `npm run migrate` (dry-run) → `npm run migrate -- --go`
2. Verify through PostgREST: `npm run db:check -- data_source_instances source_key`
3. `select * from research_source_advancement();` → nih 6d, grants_gov 161d, darpa 168d
4. `select * from research_expected_sources();` → `nsf_sbir` present, `ever_advanced=false`
5. `npm run db -- data_source_instances --eq dataset_key=specialty_feeds --select source_key,source_state`
   → 6 rows; `research_nsf_sbir` = `unmeasured`

**Rollback:** `DROP FUNCTION research_source_advancement, research_expected_sources;`
and `DELETE FROM data_source_instances WHERE dataset_key='specialty_feeds';`
No source data is touched.

## Decisions the reviewer still owns

1. **SBIR coverage** — 42 rows from 1 of ~11 agencies. Product decision, unchanged.
2. **DARPA / NSF** — repair, or retire and stop running crons that report success
   over nothing? Running them as-is is the worst option: it manufactures evidence.
3. **NIH** — 6 days stale and its job never resolves; it is the sole SBIR feed.
4. Whether `dispatched`-forever jobs should fail loudly across the whole dispatcher.

# SEO closeout (2026-09-30): empty contractor sub-pages fixed; buyer-intent work deferred

**Status:** CLOSED.

**Delivered and accepted in production:** the empty contractor sub-page fix, PR #1765.

**Deferred:** the buyer-intent pilot. The research and decision are kept privately in GOS (`04_rnd/mindy-buyer-intent-2026-09-29`).

This record is sanitized: aggregate counts only, no credentials, no raw personal or search data.

---

## Delivered: empty contractor NAICS/agency sub-pages (PR #1765)

| Item | Value |
|---|---|
| Merge | **`b4ec5bcc`** (squash, head pinned to `45584162`), 2026-09-30 09:58:43 UTC |
| Production deployment | **`dpl_5XRrDEtCCWt9STPuuf9HRUYy6bud`** (`market-assassin-ax2wxuj73`), Ready, created 09:58:46 UTC, serving getmindy.ai |
| Sitemap | **35,326 → 22,336** URLs |
| Empty sub-pages removed from the sitemap | **all 12,985** (7,864 `/naics` + 5,121 `/agencies`) |
| Unchanged | contractor profiles (11,770), `/contracts` (9,407) |
| Variance | the preview's 22,339 vs production's 22,336 is facet data drift between builds (live Supabase counts at build time); contractor families are identical |

**Contract now enforced** (`SUBPAGE_MIN_ROWS = 5`, self-canonical in every tier):

| Rendered rows | Page | robots | Sitemap |
|---|---|---|---|
| 0 or unavailable | honest "being refreshed" state | `noindex,follow` | absent |
| 1–4 real rows | real rows shown | `noindex,follow` | absent |
| 5+ real rows | rows shown, headline = rendered rows | indexable | eligible |

**Production acceptance:**

| # | Check | Result |
|---|---|---|
| 1 | Empty `/naics` or `/agencies` pages in the sitemap | **0** |
| 2 | Sitemap total | **22,336** (variance explained above) |
| 3 | Sampled empty sub-pages (16) | 200, `noindex, follow`, self-canonical, honest copy, no stored-count claim. 0 failures |
| 4 | 1–4-row pages | none exist to sample (0 row caches); enforced by tests |
| 5 | 5+-row pages | none exist to sample; enforced by tests |
| 6 | Contractor profiles | indexable |
| 7 | The three one-row `/contracts` pages | unchanged: indexable, 1 row, in the sitemap |
| 8 | BigQuery | **zero activity** (below) |

**Zero BigQuery activity:**
- `ENABLE_SEO_LIVE_BQ` is absent in production.
- A unit proof shows a cold cache never calls `bqQuery`.
- The production build log (887 lines) has 0 BigQuery job or query lines and 0 guard blocks.
- The sitemap's row counts use a read-only KV `EVAL_RO` only.
- Every measurement in this work used the KV read-only token or read-only SELECTs.

**Evidence:** `tasks/gsc-404-recheck-2026-09-30/SUMMARY.md` and the aggregate JSON and methodology scripts beside it.

## Deferred: buyer-intent pilot

A small pilot enhancing a few existing SEO pages is **deferred**. The research, including internal usage metrics, is intentionally **not** in this public repo; it lives in the private GOS repo. No pilot page has been edited.

## Deferred items (in order)

1. **Activate SEO-health and Slack monitoring.**
   - Done: Gates 1–2 (routes deployed; the `seo_health_*` migration applied and verified).
   - Blocked at Gate 3: `MINDY_OPS_SLACK_CHANNEL` isn't present in production.
   - Then the manual run, the watchdog test, the pilot-URL baseline, and proposed `cron_jobs` rows (approval required).
2. **Fix the two canonical-discovery parser defects** (blocking for any page using canonical discovery):
   - P1: "washington dc" resolves to the state WA (and "tennessee valley authority" to TN), in `src/lib/discovery/intent.ts` `STATE_PHRASES`.
   - P2: inconsistent agency concept keys, in `src/lib/discovery/intent.ts` `AGENCY_LEXICON`.
3. **Reconsider the buyer-intent pilot** only after items 1 and 2 are done and verified (details private, in GOS).
4. **Evaluate cache warming only if evidence justifies restoring sub-pages.**
   - Sub-pages return only with 5+ real cached rows **and** a demonstrated reason to index them.
   - No warmer has been designed or run.
5. **Revisit GSC "Validate fix"** after Google recrawls the repaired site. Not started.

## Access and housekeeping state

- **GCP:** the temporary resource-scoped Token Creator binding on `mindy-bq-reader` was **removed** after the GSC pull. The project IAM was never changed. Two disabled user-managed SA keys still exist; deleting them is a separate future decision.
- **Credentials:** none were written to disk, the repo or this record. Short-lived GSC tokens lived only in process memory.
- **Raw data:** the raw GSC export, per-URL result tables and sitemap copies were deleted, not committed.

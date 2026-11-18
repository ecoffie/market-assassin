# Agent 3 — Freshness honesty (2026-11-18)

**Goal:** Stop false-green freshness (empty SBIR success, DIBBS current-while-disabled, null advancement clocks, SAM active/expired contradictions) with honesty-only changes. Specialty repair stays PARKED.

**Branch:** `chore/data-core-freshness-honesty-2026-11-18`  
**Base:** `origin/main` @ `c6c9c0864`

## Measured BEFORE (live 2026-11-18)

| Surface | Before |
|---|---|
| `sync-dod-sbir` | enabled, `last_status=success`, HTTP 200 every 6h |
| `dod_sbir_topics` | **0** rows |
| `sync-dibbs` | enabled=false since 2026-11-02; `max(synced_at)=2026-11-02` |
| `dibbs_dla_flat_files` | `source_state=current`, null clocks, held 57,816 vs live 103,076 |
| Same null-clock `current` | `sam_opportunities_sam_gov`, `grants_gov_api`, `forecast_dhs_apfs`, `forecast_doe_osbp` |
| SAM entities Active+past expiry | **157,787** |
| SAM active + past deadline | **25,846** |
| SAM active + null deadline | **10,297** |

## DONE (this PR)

1. **sync-dod-sbir reporting** — `decideDodSbirExecuteOutcome`: api-down / empty corpus → `success:false`, HTTP 503, `cronOutcome:error` + disclosure. Route wired + `reportCronOutcome`.
2. **Park migration** — `20261118_park_false_green_freshness.sql`: disable `sync-dod-sbir`; DIBBS → `content_stale`+`blocked`+live held count; null-clock automated currents → `unmeasured`.
3. **Control-plane reader** — `honestInstanceState`: refuses CURRENT without `last_verified_ingest`/`last_data_advance`; disabled producer → STALE. Wired into `/api/admin/data-inventory`.
4. **Freshness watchdog** — LIVE_SYNC_CHECKS for `dibbs_rfqs.synced_at` and `dod_sbir_topics.synced_at` (data clock ≠ last attempt).
5. **SAM reader honesty** — `deriveSolicitationStatus`: null deadline → `unknown` not open; SEO `opportunityStatus` cannot claim open without a future deadline; `deriveRegistrationStatus` + entity fallback + market-research expiry gate.

**Tests:** 117+ focused unit tests green (outcome, registration, resolve, inventory-model, freshness-honesty migration lock, SEO, entity fallback/failover).

## AFTER (expected once merged + migration applied)

| Surface | After |
|---|---|
| sync-dod-sbir execute api-down | HTTP 503, success false, disclosure, cron error |
| cron_jobs sync-dod-sbir | enabled=false (after migrate) |
| dibbs instance | content_stale / blocked; held ≈ 103k |
| null-clock SAM/grants/DHS/DOE | unmeasured (inventory falls back to table clock) |
| Entity / solicitation readers | Expired / unknown when clocks contradict stored flags |

## REMAINING

- Apply migration: `npm run migrate -- --go --only 20261118_park_false_green_freshness.sql` (**needs Eric**).
- Merge this PR (Agent 5 + Agent 4). Do not merge #2165 from this lane.
- Re-measure control-plane after migrate; optional: check-data-freshness remasure that *writes* clocks (0.1 full remeasure) — not in this PR.
- Specialty DIBBS/SBIR **coverage/repair** still PARKED.

## Needs Eric approval

1. Migration apply (`--only 20261118_park_false_green_freshness.sql`).
2. Merge to main (Agent 5 sequencing; this session does not merge or `vercel --prod`).

## Principles applied

- **Laziness Protocol** — honesty helpers + one park migration; no specialty reopen.
- **Fix Root Causes** — stop success on empty/api-down; refuse CURRENT without data clocks.
- **Encode Lessons in Structure** — outcome helper + migration lock tests.
- **Prove It Works** — live before numbers + unit tests.

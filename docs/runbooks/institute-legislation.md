# Runbook — Living legislation Institute source (`institute_legislation`)

**Dataset:** `strategic_intelligence`
**Instance:** `institute_legislation`
**Discovery:** https://api.congress.gov/v3/bill
**Cron:** `/api/cron/institute-legislation-sync` — **ENABLED** weekly (`cron_jobs` row
`institute-legislation-sync`, `40 13 * * 0` = Sundays 13:40 UTC, since 2026-09-20).
**Status: LIVE (operational) — FROZEN 2026-09-23.** `POTETO — NDAA Legislative Intelligence Live ✓`
(DISCOVER → CLASSIFY → INGEST → PROVENANCE → CORRECT → FRESHNESS → SCHEDULE).
**Control plane:** `intervention_state=none_required`, `manual_action_type=NULL` (unparked
2026-09-23 after production sync 0/0/29 on #1643 and `--post` 18/18 green). `source_state` stays
`upstream_quiet` — the TRUE data state (newest dated NDAA text 2026-07-30, beyond the 45-day
recess threshold), not a fault. Runs on `GOVINFO_API_KEY` (api.data.gov, accepted by
api.congress.gov) by decision; a separately named `CONGRESS_API_KEY` is not required.
⚠️ **Operationally live ≠ customer product.** The Institute legislative corpus is NOT yet wired to
a customer surface. The corrected FY2026 NDAA pain points (PL 119-60 cited) are customer-facing
independently of this collector.
*(Previously `PARKED / BLOCKED_CONTROLLED`, #1596, 2026-09-21 → 2026-09-23.)*
*(This line said "NOT YET ENABLED (Gate 5)" until 2026-09-22, two days after the row was enabled.)*

## What this source is

Congress API → `institute_sources` (one row per legislative **version**) → optional
derived pain point with an `intelligence_changes` history row. Authenticated with the
existing api.data.gov key (`CONGRESS_API_KEY` or `GOVINFO_API_KEY`); this is *not*
govinfo.gov, whose key is separately recorded invalid.

## Why it exists

Mindy had no legislative watcher at all. "FY2026 NDAA" existed only as 45 hardcoded
prose strings produced by a script outside the repo with the bill number hardcoded, so
FY2027 could only arrive if a human re-ran it. Those 45 strings are **not** authoritative
NDAA records (they cite S.2296, which never became law) and remain a separate open
remediation — nothing here reads or blesses them.

## Two jobs, deliberately separate

| Job | Mechanism |
|---|---|
| **Discovery** | `discoverSince` scans a `fromDateTime`-bounded window; completeness is MEASURED against the API's own `pagination.count` |
| **Tracking** | `knownMeasures` re-polls every measure already in the corpus **by identity** |

A page/time ceiling yields `coverage: partial`, and the cursor does **not** advance —
so a bounded scan can never claim "no such legislation exists". Measured live: S.4784
sat at feed position 2,948 and vanished from a 1,500-row scan that still reported
success. That is the failure this design removes.

## One row per version — never collapse the family

`119-HR8800-IH` / `-RH` / `-EH`, `119-S4784-RS`, `119-HRPT-698`, `119-SRPT-127`,
`119-SRPT-39` **and** `119-SRPT-39-ERRATA`, `119-S1071-ENR` / `-PUBLIC-LAW` are all
distinct identities under `UNIQUE (source_type, document_number)`. Congress lists
separate artifacts under one report number (a report and its errata, both `part: 1`),
so the citation qualifier is part of the key.

## Clocks (never conflate)

One successful execution writes **both** views — the `data_sources.notes` sentinel and the
`data_source_instances` control plane — from the same values (same `pollAt`, same source
advance). Before 2026-09-23 only the notes were stamped, so the control plane sat at its
seed time (notes said 2026-09-23, control plane said 2026-09-20).

| Concept | Control plane | Notes sentinel | Advances when |
|---|---|---|---|
| **polled** | `last_poll`, `last_successful_check` | `lastPoll` | A successful, stampable run checked Congress (`last_successful_check` only on complete coverage) |
| **source advanced** | `last_source_advance` | `lastSourceAdvance` | Newest **dated** legislative publication held — a document's own version/issue date only |
| **ingested** | `last_data_advance` | — | Mindy's corpus actually changed (insert or source-field update) |
| (verified) | `last_verified_ingest` | — | Reconciliation finished with no failure, block or partial |
| **intelligence changed** | — | `lastIntelligenceChange` | A legislative derivation actually changed |

⚠️ **Source advance is never bill-record metadata.** Congress edits bill records (actions,
cosponsors) without publishing text. An undated version (e.g. `119-S1071-ENR`) carries the
bill's `updateDate` as its per-document `source_watermark` — that column means *record
activity*, not publication — and it contributes **nothing** to the source-advance clock
(`legislativeSourceAdvance`). No dated document → `null` (unknown), never an invented date.

The run never writes `source_state`, `intervention_state` or `manual_action_type` — the
parked state is operator-owned.

**Open follow-up (general reliability, not this source):** `reportCronOutcome` closes the
job's *newest* `cron_job_runs` row regardless of which invocation it is, so a manual
execution on 2026-09-23 stamped `success` onto the 2026-09-20 scheduled row (its real
outcome is unknown). Tracked with #1593's completion-reporting work.

`upstream_population` is **NULL** — we never counted the upstream universe.
`held_population` = `count(*)` of `institute_sources` where `source_type IN
('introduced_bill','enacted_law','committee_report')`.

⚠️ **Cadence is 7 days, not GAO's 1.** Congress does not publish daily and recesses for
weeks; the legislation clocks use a 45-day quiet threshold (GAO uses 14). Do not copy
GAO's cadence here — an August recess would otherwise read as a broken ingest.

## Ingestion is change-aware

An unchanged artifact is a genuine no-op: no UPDATE, no `updated_at` churn.
`hasSourceFieldChanges` compares source-derived fields only — `retrievedAt` is excluded
(stamped every poll) and `updated_at` is never compared (a consequence of writing).
A steady-state poll over an unchanged corpus reports `inserted 0 / updated 0 /
unchanged N`, so any future `evidenceUpdated > 0` is real signal.

## Expected steady state

```
coverage: complete   scanned == reportedTotal
inserted: 0   updated: 0   unchanged: <held_population>
failed: 0     collectFailures: 0
```

## Triage

| Symptom | Meaning |
|---|---|
| `discoveryState: source_unavailable`, HTTP 502 | API/transport failed. **Not** "no legislation" |
| `coverage: partial` | Ceiling hit before covering the window; cursor did not advance. Raise `maxPages`/`budgetMs` or let the next run re-cover |
| `not_yet_introduced` with `coverage: complete` | Genuine: the API answered and no matching measure exists |
| `unknown_incomplete_scan` | A ceiling — absence is **not** established |
| `evidenceUpdated` > 0 on an unchanged corpus | Investigate: something source-derived really changed, or a writer is churning a field |
| `knownReadError` set | Corpus read failed — tracking is UNKNOWN, not empty. Do not stamp clocks |

## Legal status is per VERSION, never inferred (2026-09-22)

`raw.becameLaw` is a fact about the **measure** and is stamped on every version, so S.1071 *as
introduced* carries `becameLaw: true`. Consumers must read the per-version fields instead:

| field | meaning |
|---|---|
| `legislativeStage` | `introduced` · `reported` · `passed_chamber` · `enrolled` · `enacted` · `other` — from the version code |
| `lawStatusAtIngestion` | `enacted` (the public law / the signed enrolled text) · `superseded_by_enactment` (an earlier version of a bill that became law — **not** law) · `not_enacted` |
| `measureRole` | `authorization_vehicle` (the FY's NDAA) · `amends_prior_act` ("To amend the NDAA for FY1994…") · `other` |
| `fiscalYear` / `amendsFiscalYear` | `fiscalYear` only for vehicles; an amending bill records the year it **amends** |

The run's headline `discoveryState` is the **current fiscal year's** vehicle state
(`currentFiscalYear`, `fiscalYearStates`). It previously aggregated every family and reported
`enacted` because FY2026 became law while FY2027 was House-passed.

## Health invariant (stronger than "the cron returned 200")

`scripts/acceptance/poteto-ndaa-legislative-live.mts` — read-only. Reads Congress **directly**
(text versions + committee reports of every discovered authorization vehicle) and fails unless
Mindy holds every one with provenance, on a legislation-only clock, and not behind Congress.
`--post` adds per-version legal status (valid after the first execute run on the new code).

## FY2026 historical claims

The 45 `"FY2026 NDAA: …"` strings in `src/data/agency-pain-points.json` were audited against
PL 119-60 and S. 2296: 32 enacted (citation added), 6 misstated (corrected — e.g. the CAS
threshold is $100M, not $35M), 6 proposed-only (SkyFoundry, S. 2296 §882) + 1 unverifiable
(retired). Every original, its evidence and reason: `src/data/ndaa-fy26-claim-corrections.json`.

## Related

- `src/lib/institute/legislation.ts` — collector + version/identity contract
- `src/lib/institute/legislation-discovery.ts` — watermarked discovery + identity tracking
- `src/lib/institute/legislation-clocks.ts` — recess-tolerant freshness
- `scripts/seed-institute-legislation-source.ts` — this registration (dry-run by default)

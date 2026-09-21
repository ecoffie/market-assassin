# Runbook — Living legislation Institute source (`institute_legislation`)

**Dataset:** `strategic_intelligence`
**Instance:** `institute_legislation`
**Discovery:** https://api.congress.gov/v3/bill
**Cron:** `/api/cron/institute-legislation-sync` — **ENABLED**, weekly `40 13 * * 0`
**Control state:** ⛔ **PARKED / BLOCKED_CONTROLLED** — see the next section before
acting on anything below.

## ⛔ PARKED / BLOCKED_CONTROLLED — the credential dependency

Set 2026-09-21 (`supabase/migrations/20260921_park_institute_legislation.sql`).
The live control-plane row says so; this runbook exists so a human reads the same fact:

| `data_source_instances.institute_legislation` | value | means |
|---|---|---|
| `source_state` | `upstream_quiet` | the DATA is not advancing. **Never `current`** |
| `intervention_state` | `blocked` | a human is blocked, and knows why |
| `manual_action_type` | `credential_renewal` | ⚠️ **the blocker is a MISSING CREDENTIAL** |

**The blocker, explicitly: `CONGRESS_API_KEY` is ABSENT in production.** Re-verified
2026-09-21 — `vercel env ls production` returns a `GOVINFO_API_KEY` row and **no**
`CONGRESS_API_KEY` row at all. `congressApiKey()` is
`CONGRESS_API_KEY || GOVINFO_API_KEY || ''` (`src/lib/institute/legislation.ts:60`), so
the collector still runs on the fallback and the route's `missing_api_key` 502 guard
never fires. The configured credential for this source simply does not exist. This is a
**config** fact — not a mystery, and not an upstream outage.

**Unblock = provision `CONGRESS_API_KEY`, then wire the corpus to a surface.** Both
halves are required: the 29 held rows reach **zero** customer surfaces today, so a key
alone changes nothing a customer can see.

⚠️ **The job stays ENABLED on purpose.** Unlike DARPA/NSF it emits no false-green: its
outcome is reported terminally (#1593) and, structurally, **this route never writes
`data_source_instances`** — so no scheduled run can stamp `source_state`,
`last_data_advance` or any instance clock while the source is parked. EXECUTION success
(`cron_job_runs.status`) and DATA advancement (`last_source_advance`) are separate
records; a `success` run over an unchanged corpus is the expected steady state and must
never be read as the corpus having advanced.

Do **not** clear these two states because a run looked healthy. Only the two unblock
steps above may clear them.

## What this source is

Congress API → `institute_sources` (one row per legislative **version**) → optional
derived pain point with an `intelligence_changes` history row. Authenticated with an
api.data.gov key (`CONGRESS_API_KEY` **or** the `GOVINFO_API_KEY` fallback currently in
use — see the parked section above); this is *not* govinfo.gov, whose key is separately
recorded invalid.

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

| Clock | Advances when |
|---|---|
| `last_poll` | Every real Congress API check attempt |
| `last_successful_check` | Feed read succeeded and parsed |
| `last_verified_ingest` | Complete-coverage reconciliation (never on `partial`) |
| `last_data_advance` | Held rows actually changed |
| `last_source_advance` | Newest legislative **publication** date held (never Mindy time) |

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

## ⚠️ Derived pain points are stamped `source: 'gao'` — including legislative ones

`deriveFromInstituteSource` (`src/lib/strategic-intel/derive.ts:102`) hardcodes
`source: 'gao'` on **every** derived pain point, and the customer reader
`loadSourcedPainPointsForAgency` selects `.eq('source', 'gao')`. So that filter does
**not** separate legislation from GAO — a legislative derivation would pass straight
through it onto `/api/pain-points`, MCP `get_agency_intel`, `target-market-research` and
`agency-hierarchy`, labelled `source_type: 'gao'`.

**Measured 2026-09-21: exposure is ZERO, and the reason is the OTHER gate.** All 29 held
titles are checked against `isDefensiblePainPoint` → `PROBLEM_MARKERS`, and **0 of 29**
match, so no legislative pain point has ever been derived (production: 0 rows in
`agency_pain_points_db` citing a legislative `institute_source_id`, 0 rows in
`intelligence_changes`; all 24 pain points are genuine GAO reports).

⚠️ **This is a near miss, not a design.** `PROBLEM_MARKERS` includes `oversight`,
`needed`, `improvements`, `gaps`, `delays` — ordinary committee-report vocabulary. The
first NDAA report title carrying one of those words would be written as a GAO-sourced
claim. **Before provisioning `CONGRESS_API_KEY`, give the derivation a real provenance
value** (or gate it off for `LEGISLATIVE_SOURCE_TYPES`).

## Related

- `src/lib/institute/legislation.ts` — collector + version/identity contract
- `src/lib/institute/legislation-discovery.ts` — watermarked discovery + identity tracking
- `src/lib/institute/legislation-clocks.ts` — recess-tolerant freshness
- `scripts/seed-institute-legislation-source.ts` — this registration (dry-run by default)

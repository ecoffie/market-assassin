# SSA OSDBU Contracting Forecast — runbook

| | |
|---|---|
| source_key | `forecast_ssa_osdbu` |
| dataset | `forecast_intelligence` |
| ingest | **manual / controlled** (production egress is blocked) |
| reachability watch | `/api/cron/ssa-source-watch` — `35 14 * * *` |
| ingest cron | **none** — deliberately not scheduled |
| identity | **APP #** → `SSA-<APP#>` (source-native) |
| producer | `src/lib/forecasts/ssa-ingest.ts` |
| ledger | `docs/ssa-provenance-repair-2026-09-14.md` |

## Discovery — semantic, never a hardcoded filename

Page: `https://www.ssa.gov/osdbu/contract-forecast-intro.html`

1. Scope to the **`Contracting Forecast`** section.
2. Keep links whose **text** carries an explicit `FY<YY>` label and whose href is machine-readable (`.xlsm`/`.xlsx`/`.csv`).
3. Select the **highest FY** among those.

⚠️ **Never select by filename date, and never take the Main Menu link.** The page lists the
canonical `SBF_SSASy_Report_06222026.xlsm` (FY26, Contracting Forecast section) *and* a stale
`SBF_SSASy_Report_12112026.xlsm` (Main Menu). `12112026` parses as the **later** date, so any
filename-based rule picks the wrong file. Guarded by `tests/unit/ssa-ingest.test.ts`.

⚠️ **Do not hardcode `06222026`.** SSA republishes under a new filename each edition.

## WAF contract (Akamai)

A bare or UA-only request gets **403**. Required headers, all measured:

`User-Agent` (browser) · `Accept` · `Accept-Language` · `Sec-Fetch-Dest/Mode/Site/User` ·
`Sec-Ch-Ua` / `-Mobile` / `-Platform` · `Upgrade-Insecure-Requests` ·
**`Referer` = the discovery page** on the workbook GET.

Requests are paced with bounded backoff. **Do not hammer the site.**

- **HEAD is not authoritative** — SSA refuses it (403) even when GET succeeds.
- **HTTP status is not authoritative** — the WAF can return **200 with an HTML body**. The
  producer validates the **PK / `0x504b`** signature separately. A 200 + HTML is `not_xlsm`.

## Failure semantics — a source failure is never "0 forecasts"

| Condition | Reported as | source_state |
|---|---|---|
| 403 after retries | `source_access_blocked` (retryable) | `unreachable` |
| 200 + HTML/WAF body | `not_xlsm` | `unreachable` |
| 404 (retired URL) | `source_retired` | `unreachable` |
| No FY link in the section | `discovery_failure` | `unmeasured` |
| xlsx read throws | `parse_failure` | `unmeasured` |
| No `APP #` header row | `source_schema_failure` | `unmeasured` |
| Duplicate APP # | `identity_failure` | `unmeasured` |
| Blank APP # | counted `rejectedNoIdentity` (row skipped) | — |
| Insert/update receipt mismatch | `receipt_mismatch` | — |

The old URL `…/small_business_forecast.htm` is **retired (404)** and must never be retried.

## Workbook shape

Header row is found by locating the row containing `APP #` (row 4 today, **not** row 0).
The sheet repeats its 15 columns at offsets ~35 and ~51 — **print-layout bands, always empty**.
Only the first band is data.

15 source-owned columns: `SITE Type · APP # · REQUIREMENT TYPE · DESCRIPTION · EST COST PER FY ·
PLANNED AWARD DATE · EXISTING AWD # · CONTRACT TYPE · INCUMBENT VENDOR · NAICS · NAICS DESCRIPTION ·
TYPE OF COMPETITION · NET VIEW TOTAL OBLIGATED AMT · PLACE OF PERFORMANCE · ULTIMATE COMPLETION DATE`

8 of them are populated only on recompetes (~32/125). Their absence must never erase a held value.

## Conventions (existing — do not invent new ones)

- `estimated_value_min/max` is **bigint**; values are `Math.round`ed. `523932.39` → `523932`,
  so cents are **not** churn.
- `set_aside_type` comes from `normalizeSetAside(TYPE OF COMPETITION)` and is **distinct** from
  `competition_type` (which keeps the raw phrase).
- `raw_data` is stored as a **JSON object** — never `JSON.stringify(row)`. See the ledger.
- Null-over-value: source NULL + held non-NULL **preserves the held value**.

## Lifecycle

SSA publishes **no** status column. `REQUIREMENT TYPE` is procurement *nature*, not state.
Therefore **absence ≠ deletion**: rows missing from the current workbook are **historical
retained** (45 today: FY2025 4, FY2026 41) and keep their data. `DELETE = 0`.

**`last_synced_at` advances only for rows present in the current source.** A poll is not proof a
historical row was observed.

## Populations (keep separate)

| | |
|---|---|
| Raw current upstream | 125 |
| Current represented | 125 / 125 |
| Historical retained | 45 |
| **Physical SSA rows** | **170** |

## Checks

```bash
npm run db -- data_source_instances --eq source_key=forecast_ssa_osdbu
npm run db -- agency_forecasts --count --eq source_agency=SSA          # 170
curl -s "$HOST/api/cron/ssa-forecast-sync?dry=1&password=$ADMIN_PASSWORD" | jq '.reconciliation'
```

Dry mode is **read-only** — it writes no rows and moves no clocks.


---

# ⛔ PRODUCTION ACCESS IS BLOCKED (2026-09-14)

**SSA/Akamai rejects Mindy's Vercel egress at the network level.** Measured simultaneously,
identical headers, identical code:

| From | Result |
|---|---|
| Residential IP, paced | **200**, 34,520 bytes |
| Vercel production, 4 attempts | **403** |

This is a **reputation/egress block, not a request-shape problem** — no header tuning fixes it.
`ssa-forecast-sync` is therefore **NOT scheduled**; a daily job that always fails is worse than
no job. `/api/cron/ssa-source-watch` measures the condition instead.

**Do not implement WAF-evasion infrastructure** (residential proxies or similar). The remediation
is explicit allowlisting.

## What the data state actually means

- **DATA QUALITY:** current as of the last successful verification (2026-09-14, against the
  125-row FY26 workbook, fingerprint `caf6783339154fe28e67b75edde38c30`, source clock
  `2026-07-01T17:19:36Z`).
- **PRODUCTION CURRENTNESS MONITORING:** blocked by source access.

Those are different claims. Mindy is **not** continuously verifying SSA currentness from
production, and must not be described as if it were. Stored rows remain valid and must not be
degraded because the fetch path is blocked.

## The reachability watch

`/api/cron/ssa-source-watch` (`ssa-source-watch`, `35 14 * * *`) probes the discovery page with
the proven header set and bounded retries. It **never touches `agency_forecasts`**.

**A blocked result is a SUCCESSFUL watch** (`success: true`, `sourceReachability: "blocked"`) —
the job's purpose is to measure a known-blocked condition, so it must not mark itself `error`
every day. *Job success ≠ source health. Job success ≠ data advancement.*

Clocks on a blocked run: **`last_poll` advances. Nothing else moves.**
`last_successful_check`, `last_verified_ingest`, `last_data_advance`, `last_source_advance`, the
fingerprint and both populations are all preserved — today's inability to fetch is not evidence
that upstream changed or emptied.

One alert per distinct condition via the shared `shouldSendAlert`/`fingerprint` gate (fails open,
re-reminds at 72h). Repeated identical blocked runs do **not** re-alert.

**Recovery is never silent.** If a probe succeeds, the watcher sets `unmeasured` + `required`
(the schema has no `reachable_pending_verification`) and alerts *"run the production dry
reconciliation before re-enabling automated ingest"*. It does **not** ingest, and it does **not**
flip `ingest_mode` back to `automated`.

## Controlled refresh procedure (until access is restored)

Run from an environment that can reach SSA **without bypassing access controls**:

1. `npm run verify:env` — must pass.
2. Fetch via the **canonical semantic discovery** (Contracting Forecast section → highest
   `FY<YY>` label). Never a hardcoded filename, never the Main Menu link.
3. Validate the **PK/`0x504b`** signature — a 200 can still be an HTML WAF body.
4. Record **fingerprint · Last-Modified · ETag · row count**.
5. Verify **APP # uniqueness** and that the header row / print-layout bands parse correctly.
6. **Dry reconciliation first.** Inspect matched / new / changed / historicalRetained.
7. Mutate only if the reconciliation is semantically safe (see the accounting identities above).
8. Verify receipts, then prove **idempotency** with a second run.
9. Update `data_source_instances` (`last_successful_check`, `last_verified_ingest`,
   `last_data_advance` only if data actually advanced) and record the run.

⚠️ **Never** "download a file by hand and upload whatever it is." A controlled refresh requires
the same provenance verification as the automated path — the whole point of this source's history
is that an unverified file is how the stale edition and the destroyed `raw_data` got in.

## Allowlisting — the real fix

Target state: a **stable Mindy outbound IP/range** that SSA explicitly permits.

⚠️ **Establish the stable egress FIRST.** Do not ask SSA to "allow Vercel" generically — Vercel's
egress is dynamic and there is no range they can meaningfully allowlist. Confirm whether the
production fetch path can present a fixed IP/range (dedicated egress, NAT, or a fixed-IP worker)
before opening the request.

Request packet to prepare:

| Field | Value |
|---|---|
| Organization | Mindy (GovCon Giants AI) |
| Purpose | Retrieval of the **public** SSA OSDBU contracting forecast |
| Discovery URL | `https://www.ssa.gov/osdbu/contract-forecast-intro.html` |
| Fetch behavior | One discovery page + one workbook GET per run |
| Frequency | ~once daily; no high-rate scraping |
| Contact | `support@getmindy.ai` |
| Outbound IP/range | *(to be supplied once a stable egress exists)* |

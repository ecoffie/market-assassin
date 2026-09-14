# SSA OSDBU Contracting Forecast — runbook

| | |
|---|---|
| source_key | `forecast_ssa_osdbu` |
| dataset | `forecast_intelligence` |
| ingest | **automated** |
| route | `/api/cron/ssa-forecast-sync` |
| schedule | `35 14 * * *` |
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

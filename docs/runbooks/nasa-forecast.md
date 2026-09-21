# Runbook — NASA Acquisition Forecast (AUTOMATED)

**Status: fully automated. No routine human action required.**

## The source

```
https://www.hq.nasa.gov/office/procurement/forecast/AcqForecastNew.xlsx
  200 · PK ✓ · ~89 KB · sheet "Forecast" · 46 columns · 147 rows
  ETag "2b24017b4c3fe3ceb10437150279f758" · Last-Modified 2026-08-04T18:03:05Z
```

⚠️ **The published page is a DataTables/JS shell — but browser automation is NOT
needed.** The prior classification *"page loads, JS shell, 0 data rows → needs a
dynamic fetch"* was half right: the shell is real, the conclusion was wrong. The
page's own `Assets/JS/NAFNEW.js` names two static workbooks. Read the page's
script, don't drive a browser.

**`AwardeeDetails.xlsx` is NOT an award/lifecycle register.** It carries an
identical 46-column schema and 146 SourceIDs — a near-copy of the forecast, zero
rows of its own, and **none** of the 42 retained historical SourceIDs. It cannot
resolve historical lifecycle.

## Identity — NASA SourceID, source-native

147 rows, 147 populated, 147 distinct, 0 duplicates. `external_id` = SourceID.

⚠️ **Runtime identity is SourceID ONLY.** The one-time title/NAICS/buying-office
crosswalk that recovered 146 legacy rows is **RETIRED** and must never re-enter
runtime matching. Proven: the post-migration reconciliation matched 147/147 on
SourceID alone.

## Currentness

ETag + the **final** XLSX `Last-Modified` + a content fingerprint over the
workbook bytes. NASA exposes **no edition/version concept**, so
`latest_upstream_revision` / `latest_held_revision` stay NULL — never invented.

## Field contract — four legacy mappings were WRONG and are repaired

| Mindy field | NASA column | note |
|---|---|---|
| `naics_description` | NAICS Description[16] | held had **PSC text** (`"SPACE VEHICLES"`) |
| `psc_code` / `psc_description` | [13] / [14] | held were **empty on all 225 rows** |
| `poc_name` / `poc_email` | Tech POC Name[9] / TechnicalPOC[8] | a **named individual**, as on every other agency |
| `description` | Description[43] **only** | 147/147; `Summary[29]` matched held 1/37 |

**Unmodelled on purpose:** `SmallBusinessSpecialist*` (matched 0/37 held rows —
mapping it would replace real technical contacts with center mailboxes),
`HQMissionDirectorate`, `Summary[29]`.

`bureau` / `contracting_office` / `program_office` all hold the **Center**
(`KSC`), measured 37/37. `fiscal_year` / `anticipated_quarter` are
**Mindy-derived**; `map_*` is enrichment. One whitelist drives both diffing and
updates.

## Lifecycle ≠ membership

NASA publishes New · Revised · **Awarded** · **Withdrawn** inside the current
workbook. Cross-tab over all 147 rows:

```
N/A × Revised 110 · Awarded × Awarded 16 · N/A × New 11
Withdrawn × Withdrawn 8 · (null) × Revised 1 · N/A × Awarded 1   = 147
```

Precedence: explicit **Withdrawn** wins from either column; else **Awarded** from
either; else the AcquisitionStatus value. (SourceID 10072 is the lone one-sided
case; 10126 has a null AwardedOrWithdrawn.)

**An Awarded or Withdrawn row is still part of the 147 current population** while
NASA publishes it. Do not filter currentness to active-only.

## Customer state is orthogonal

**SourceID 9947** is `Withdrawn` upstream *and* tracked in `user_pipeline`. The
forecast row carries `Withdrawn`; the pipeline row stays at `stage: tracking`.
**Source lifecycle must never mutate customer intent.**

## Null never erases a held value

`source NULL + held non-NULL` → preserve. Exception: the three proven
legacy-mis-mapped fields, where preserving a value in the wrong semantic field
would be preserving an error.

## Populations

```
current upstream      147     current represented   147 / 147
current naf_xlsx      147     current naf_grid        0
historical excel       42     physical rows         189
```

Rows absent from today's workbook are **RETAINED** — absence is not deletion
authority. The 42 historical rows are lifecycle-**UNKNOWN**, not withdrawn.

## Canonicalization history (one-time, 2026-09-13)

37 Mindy-created duplicate `naf_grid` rows retired · 109 Mindy-derived ids
migrated to SourceID · 1 new SourceID inserted · 42 historical rows retained.
Crosswalk: `docs/nasa-canonicalization-crosswalk.json`.

⚠️ **A multi-step source migration MUST run in one database transaction.** The
first attempt completed all five mutation stages internally, then failed on a bug
in its own final verification query — and rolled back cleanly to 225 rows /
146 naf_grid / 79 excel. Without the transaction that would have left a
half-migrated corpus with 37 unique-key collisions pending.

## Operating it

Cron `nasa-forecast-sync`. `?dry=1` plans without writing anything. A healthy
unchanged run returns `new 0, updated 0, unchanged 147, dataAdvanced false` and
does **not** advance `last_data_advance`.

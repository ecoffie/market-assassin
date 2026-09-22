# Runbook — DOJ Forecast (AUTOMATED)

**Status: fully automated. No routine human action required.**

## The source

A single XLSX, sheet **`Sheet2`** (34 columns):

```
https://www.justice.gov/media/1381791/dl        → 301 →
https://www.justice.gov/jmd/media/1381791/dl    → 200, XLSX (~1.87 MB)
```

⚠️ This source was classified **REPAIR_REQUIRED — "file moved, relocate the
published file."** That was wrong. Nothing moved that mattered: a `/jmd` path
prefix is handled by a redirect the fetcher already follows, and `Sheet2` is
intact. The real problem was that nobody re-probed it.

## ⚠️ NEVER READ METADATA FROM THE REDIRECT

The 301 response carries **its own** `Last-Modified` (the redirect resource's —
observed Sep 11) which is **not** the workbook's (Aug 27). Reading the first
response attributes the redirect page's age to the forecast file and silently
mis-dates the source clock. Always take `Last-Modified` from the **final 200**.

A browser User-Agent is used, consistent with other federal hosts that serve
non-browser agents a soft-404 instead of a 403.

## Identity — DOJ's Action Tracking Number, with TWO limits

DOJ publishes an ATN per row (`FY26-BOP-1540-343`) and the held corpus already
stores it as `external_id`. It is **not** a globally stable key:

**1. Duplicates within one workbook.** Measured on 2026-08-27: 7 ATNs carry
genuinely different rows (18 rows total). The **entire group** is rejected — not
"first wins" (which discards real procurements) and not a synthetic composite key
(which would make Mindy the author of an identity DOJ never issued).

**2. Reuse across editions.** An ATN unique in today's workbook may name a
*different procurement* than the one Mindy stored earlier:

| ATN | held | upstream |
|---|---|---|
| `FY26-DEA-1524-1` | Chief Counsel Contractor Support | Personal Protective Equipment |
| `FY26-FBI-1549-0091` | NAPU FY26 Q3 Helicopter Hoist Repair | 9mm Ammunition |
| `FY26-USMS-1544-0050` | Parking Services | Real Property Management Services |

These are `crossEditionIdentitySuspect`: the held row is retained, nothing is
written, and **no second row is inserted under the same ATN**.

**The guard is deterministic, never fuzzy.** `canonicalTitle()` strips only
transformations proven present in the real matched population — DOJ solicitation
codes (`2026-SG-0036`, which move between prefix and suffix), case, and
punctuation. There is no edit-distance threshold, no similarity score, no model
judgement. Two titles are mechanically equal or they are not the same record.

## NULL never erases a held value

`source NULL + held non-NULL` → **preserve the held value**. DOJ gives us no
field-level deletion semantics, so a field it stopped publishing is
`SOURCE_NO_LONGER_SUPPLIES_VALUE`, never `DELETE_VALUE`. Measured on the
activation run: **13 rows / 17 field-values** protected (poc_email, poc_name,
pop_country, estimated_value_max, pop_state, title).

This applies to UPDATES only. A genuinely new row stores NULL where DOJ supplies
NULL — we do not fabricate history for a record we have never seen.

## Field ownership

**DOJ owns 22 fields** (`DOJ_SOURCE_OWNED_FIELDS`). One list drives BOTH the diff
and the update payload.

**Mindy owns** `map_lat` / `map_lng` / `map_loc_source` (348 held rows are
geocoded) and the derived `anticipated_quarter` / `fiscal_year`. The quarter comes
from the **award** date (97.9% match against the held corpus), not the
solicitation date (24.9%).

⚠️ Bracketed place tokens (`[Nationwide]`, `[International]`) belong in
**`pop_state`** with `pop_city` NULL — that is the held convention on 92 rows.

## Rows absent from today's workbook are RETAINED

165 held rows are not in the current feed. DOJ publishes no deletion semantics,
so absence is not proof a record died. **Never delete because today's workbook
omits a row.**

Two further rows (`Active`, `DOJ:**LES** Xone Outrider`) carry unusable legacy
identities — see `docs/doj-corrupt-row-disposition.md`. They are retained,
quarantined, and counted separately as `corruptLegacyIdentity`.

## Population semantics — read before calling DOJ "behind"

```
rawUpstream                     467
withinWorkbookIdentityRejected   18   (7 duplicate-ATN groups)
crossEditionIdentitySuspect       3
safeCurrentUpstream             446   ← what DOJ identifies well enough to represent
safeCurrentRepresented          446
historicalRetained              165
heldAmbiguous                     3
corruptLegacyIdentity             2
physicalRows                    619
```

**Do NOT report "467 of 467 ingested."** DOJ can be CURRENT while 21 source rows
remain unrepresentable — that is a source-quality limitation, stated plainly, not
a pipeline failure.

## Operating it

The cron is `doj-forecast-sync`. `?dry=1` plans without writing anything.

A healthy unchanged run returns `inserted 0, updated 0, unchangedSafe 446,
dataAdvanced false` and does **not** advance `last_data_advance`.

# DOJ — disposition of 2 corrupt legacy identities (2026-09-13)

## What they are

Two of the 500 held DOJ rows carry an `external_id` that is not an Action
Tracking Number:

| stored `external_id` | title | bureau | value band |
|---|---|---|---|
| `Active` | AVPSS for PGA's VMB | ATF-1560 | $2,000,001 – $3,000,000 |
| `DOJ:**LES** Xone Outrider` | **LES** Xone Outrider | USMS-1544 | $4,000,001 – $5,000,000 |

⚠️ **These are NOT column-misaligned garbage rows.** An early reading of them as
"misaligned" was wrong. Every other field is coherent and high quality: real
6-digit NAICS with matching descriptions, real POC names and `@atf.gov` /
`@usdoj.gov` emails, value bands, set-aside types, place of performance, and
Mindy geocoding (`map_lat`/`map_lng`, `map_loc_source: city`).

The defect is confined to identity. The June importer had no ATN for these rows
and fell back to whatever cell it found — a **status value** (`Active`) and a
**title** — rather than rejecting the row for want of identity.

## Evidence gathered (2026-09-13, against the 2026-08-27 workbook)

| probe | result |
|---|---|
| exact title match in current upstream | **0** for both |
| token `AVPSS` / `PGA` anywhere in any cell | **0 rows** |
| token `Xone` / `Outrider` anywhere in any cell | **0 rows** |
| blank-ATN rows in the current workbook | **0** |

No deterministic correction exists: DOJ's current publication contains no record
that represents either procurement, under any column.

## Disposition: RETAIN, quarantined from the identity scheme

Both rows are **retained unchanged**. They are neither repaired nor deleted.

- **Not repaired** — there is no source-backed identity to repair them *to*.
  Assigning an ATN would make Mindy the author of an identity DOJ never issued.
- **Not deleted** — absence from today's workbook is not deletion authority
  (the same rule that retains the 165 absent-upstream rows). These were real
  FY2026 DOJ procurements when captured, and the surrounding data is sound.
- **Not counted as matchable** — they are excluded from the valid-identity
  population so they can never match, update, or be mistaken for current records.

They are reported separately as `corruptLegacyIdentity: 2`, never folded into
`historicalRetained`.

## Why this cannot recur

The upstream defect is gone — the current workbook has **zero** blank-ATN rows —
and the new producer rejects any row without a source-provided unique ATN rather
than substituting a fallback value. A row with no identity is counted as
`identityRejected`, never inserted under an invented key.

## If DOJ ever republishes them

A future workbook carrying a real ATN for either procurement would arrive as a
normal `NEW_PROVEN` insert. The quarantined legacy row would then be a genuine
duplicate-by-content, and merging it would need its own evidence and approval —
explicitly NOT a fuzzy title join.

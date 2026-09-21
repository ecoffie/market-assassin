# SSA provenance + legacy repair — audit ledger (2026-09-14)

One transaction repaired every malformed `raw_data` value in the SSA corpus and the legacy
`set_aside_type` defect, then ingested the current edition. This file is the durable evidence
that the 45 historical rows were repaired **from their own original edition** — not
reconstructed, guessed, or back-filled from the current workbook.

## The defect

`scripts/import-ssa-forecasts.js` wrote `raw_data: JSON.stringify(row)` into a **jsonb**
column. A JSON *string* stored as jsonb is indexed character by character, so all 60 rows
imported 2026-04-06 held ~258 single-character keys (`{`, `"`, `S`, `I`, `T`, `E` …) where the
source row belonged. Nothing errored; provenance was silently destroyed for five months.
Fixed to `raw_data: row`; guarded by `tests/unit/ssa-raw-data.test.ts`.

A second, independent defect: all 15 rows carrying a competition value stored the **raw phrase**
`"an unrestricted competition"` in `set_aside_type`, duplicating `competition_type` —
`normalizeSetAside()` never reached stored data. Classified **LEGACY_FIELD_REPAIR**, not source drift.

## Source editions (both frozen immediately before the write)

| | CURRENT | HISTORICAL (repair evidence only) |
|---|---|---|
| URL | `https://www.ssa.gov/osdbu/assets/docs/SBF_SSASy_Report_06222026.xlsm` | `https://www.ssa.gov/osdbu/assets/docs/SBF_SSASy_Report_12112026.xlsm` |
| SHA-256 | `caf6783339154fe28e67b75edde38c30750e56b015c79a2df7c8b9a25ac7ebf7` | `9514c1b3c6863bad4e223b40ce20b509f1d119df42c846dc0a378d6964cc6977` |
| ETag | `"ef64-6558fe54d5a00-gzip"` | `"d14c-647fb90257040-gzip"` |
| Last-Modified | `2026-07-01T17:19:36Z` | `2026-01-09T21:54:01Z` |
| Rows | 125 (125 distinct APP #) | 60 (60 distinct APP #) |

Discovery page: `https://www.ssa.gov/osdbu/contract-forecast-intro.html`

## Corroboration for the historical repair

- **APP # mapping: 60/60** held ids present in the original edition, **one-to-one**, 0 duplicates.
- **45/45** of the absent-upstream rows present in that edition.
- Deterministic corroboration on three independent fields — **60/60**: `DESCRIPTION` containment,
  `NAICS` equality, `SITE Type` equality. No fuzzy matching, no threshold, no embeddings.

## Receipts

| | |
|---|---|
| Inserts | 110 |
| Existing rows physically updated | 60 |
| — current `raw_data` repair (current edition) | 15 |
| — historical `raw_data` repair (original edition) | 45 |
| — legacy `set_aside_type` repair | 15 (4 matched + 11 historical) |
| — genuine `incumbent_contract_number` refresh | 4 |
| Deletes | 0 |
| Identity migrations / canonicalization | 0 |

Post-commit: physical **170**, current represented **125/125**, historical retained **45**
(FY2025 4 · FY2026 41), raw_data valid **170/170**, corrupt **0**, provenance debt **0**,
wrong-edition provenance **0**.

## Conventions used (existing, not invented)

- `estimated_value_min/max` are **bigint**; the producer rounds (`Math.round`). `523932` vs
  `523932.39` are therefore equal under the established contract and were **not** rewritten.
- Null-over-value: source NULL + held non-NULL preserves the held value.
  `nullProtectedRows = 0`, `nullProtectedValues = 0`.
- Absence is not deletion — SSA publishes no lifecycle column. `DELETE = 0`.

## Runtime rule

Steady-state identity is **APP # only**. The original edition is repair evidence and takes no
part in normal reconciliation; the producer must never depend on it.

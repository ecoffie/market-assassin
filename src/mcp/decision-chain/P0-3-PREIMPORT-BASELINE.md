# Pre-import baseline — RECONSTRUCTED, not captured live

The --all-naics run had already started when the snapshot was requested, so the
sam_entities table is mid-mutation. These figures are reconstructed from measurements
taken BEFORE the run, which are exact for the ones recorded and unavailable for the rest.

## Known exactly (measured earlier this session)

| Metric | Pre-import value | Source |
|---|---|---|
| sam_entities total rows | 493,237 | measured after the scoped 561720 run |
| sam_entities BEFORE scoped run | 491,323 | measured before any import |
| Active, not excluded, with NAICS | 416,736 | measured pre-import |
| Distinct entities across 9 evaluated NAICS | 152,702 | measured pre-import |
| 561720 active/non-excluded | 22,774 | measured after scoped run (was 21,933 before) |
| 561720 small (Y) | 20,074 | after scoped run |
| 561720 not small (N) | 2,336 | after scoped run |
| 561720 unknown | 0 | after scoped run |

## NOT captured, and unavailable retroactively

- per-NAICS counts for the other 8 evaluated codes at pre-import state
- search result counts for known queries
- dashboard "N contractors" values

These must be compared against the extract's authoritative totals instead of a
pre-state, or re-derived from the checkpoint's `updated` count (rows that already
existed) once the run completes.

## The reconstruction that still works

The importer reports `updated` vs `inserted` per run. Since every row it touches is
either one or the other:

    pre_import_rows_touched = updated
    new_rows                = inserted
    post_import_total       = 493,237 + inserted

So the delta is fully recoverable from the run's own reconciliation output even without
a live pre-snapshot. What is NOT recoverable is the per-NAICS and search-count detail.

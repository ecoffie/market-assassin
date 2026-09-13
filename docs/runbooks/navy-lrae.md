# Runbook — Navy LRAE forecast (MANUAL / identity_resolution)

**Status: automated ingest DISABLED. Identity contract unresolved.**

This runbook records ONLY procedures that have actually been proven. Where a step
is unproven it says so, rather than offering a plausible-sounding instruction.

## What this source is

The Navy Long Range Acquisition Estimates (LRAE) workbook. Mindy currently holds
**8,821 rows** from a past import whose provenance and identity rules were never
recorded.

## What IS proven

1. **Discovery works.** The newest published revision can be located and fetched
   programmatically (`src/lib/forecasts/navy-lrae.ts`).
2. **A browser User-Agent is REQUIRED.** With a custom UA the host returns a
   244-byte HTML soft-404; with a browser UA it returns the real XLSX
   (~4.1 MB observed). HTTP status is 200 in BOTH cases — detect the real file by
   its `PK` (`0x504b`) signature, never by status code.
3. **Currentness can be assessed** — we can determine whether upstream has
   advanced past what Mindy holds (`assessCurrentness`, `fingerprintChanged`).
4. **Reconciliation can be PLANNED read-only** (`planReconciliation`), and doing
   so is what caught the identity failure before any write.

## What is NOT proven — do NOT do these

- ❌ **Do NOT upload a newer workbook and refresh.** This will not repair the
  source. The planner reproduced **0 of 8,821** held rows from the published
  file: `matched: 0`, `NEW: 7,055`, `absent_upstream: 8,821`. Importing would
  have **duplicated the entire corpus**, not updated it.
- ❌ **Do NOT treat a balanced row count as identity proof.** Arithmetic
  reconciliation is not identity. The counts balanced while every single record
  failed to match.
- ❌ **Do NOT fuzzy-match to force a join.** A near-match on a forecast record is
  a different procurement, not the same one.

## The actual blocker

The legacy import's record-identity rule is unrecoverable from the stored data:
there is no retained key that maps a held row to a published row. Until an
identity contract is defined and validated, **no write to this source is safe.**

## What would unblock it

A controlled import procedure that (a) defines an explicit identity key against
the published workbook, (b) validates it against a human-verified sample, and
(c) is proven read-only before any mutation. This has **not been built**.

## What the watcher does today

The scheduled watcher reports whether upstream has advanced. It **does not
ingest**. An alert on this source means "Navy published something newer and
Mindy still cannot safely take it" — it is a standing blocked state, not a task
someone can close by uploading a file.

Closing the intervention requires evidence the held edition actually changed
(`resolveIntervention`); acknowledging the alert alone will not clear it.

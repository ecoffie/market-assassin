# Incident: promotion DDL applied outside the ledger

**Date:** 2026-08-25 · **Severity:** medium (no customer impact) · **Status:** contained; formal apply queued for 02:00 ET

## What happened

`scripts/test-promotion-safety.ts` ran against production. To release an advisory
lock for the concurrency test it issued `COMMIT`, which committed the migration the
outer transaction was holding. The run reported "22/22 passed, all rolled back"
while having applied DDL to production.

Two side effects: the function and trigger landed with no `schema_migrations`
record, and three synthetic test rows (ids 70492–70494) persisted.

## Impact

None to customers. Production served correctly throughout — pages 1–3 returned
HTTP 200 sub-second, page 1 `index,follow`, pointer unchanged at
`2026-08-11-build-3-a2` the entire time.

One real security exposure, unrelated to the COMMIT but found during it:
`promote_awards_version` is `SECURITY DEFINER` and Postgres grants `EXECUTE` to
`PUBLIC` by default on `CREATE FUNCTION`. Any signed-in Supabase user
(`authenticated`) could have moved the serving pointer. No evidence it was
exercised; the pointer's only changes trace to the worker.

## Ledger provenance

> Portions of this migration's DDL were committed prematurely by
> `test-promotion-safety.ts` issuing `COMMIT` during a rollback-intended
> production test. The official runner subsequently executed the complete
> idempotent migration, reconciled lifecycle metadata, verified the installed
> schema, and recorded the migration checksum. The ledger timestamp represents
> formal completion, not the first appearance of every schema object.

Deliberately NOT split into a second forward-only migration — that would leave the
original file permanently pending or require falsifying its status.

## Containment (complete, verified 2026-08-25)

| Item | Verification |
|---|---|
| `EXECUTE` revoked from PUBLIC/anon/authenticated | ACL `{postgres=X/postgres,service_role=X/postgres}` — no bare `=X/` entry |
| Denial proven by role assumption | anon DENIED · authenticated DENIED · fresh no-grant role DENIED · service_role ALLOWED |
| 3 leaked rows removed | deleted by exact id with `RETURNING` count assertion = 3; 0 remain by version, uei, or id |

## Root causes

1. **A test that could commit.** Rollback was a claim, not an enforced property.
2. **Default `PUBLIC` EXECUTE on a `SECURITY DEFINER` function.** The revoke is
   required, not decorative — and `PUBLIC` must be revoked first, or every
   role-level revoke is cosmetic.

## Fixes

- No `COMMIT` anywhere in the harness; a third connection releases the lock.
- Five teardown assertions: synthetic rows, pointer, ledger count, signature
  count, trigger state. The suite now proves it changed nothing.
- Delete-refusal tested under all three lifecycle labels, not just the current one.
- Migration reasserts restricted grants on every run.
- File header warns why this suite must never commit; recommends an isolated DB.

## Corrected along the way

An earlier claim that relabeling would "restore index usage" was **wrong**.
`readServedPage()` issues no `lifecycle` predicate, so the partial index on
`lifecycle='live'` can never apply. Measured: the read already uses
`awards_serving_pages_uniq` (nonpartial, exact lookup keys) at 4 buffers /
0.092ms, with an identical plan before and after relabeling. There is no
performance recovery here because there was no degradation. Do not add
`lifecycle` to the read query to make the partial index apply — that reintroduces
the second serving authority this work removes.

## Remaining

- 02:00 ET: `npm run migrate -- --go` (7-step checklist)
- Post-migration worker run with a NEW immutable generation id, proving lifecycle,
  pointer, cleanup protection, and job state stay aligned
- Only then schedule the daily freshness check

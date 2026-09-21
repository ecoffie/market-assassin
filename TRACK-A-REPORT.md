# Track A — BigQuery corporate-family cost repair

## Result

Implementation commit: `b83a9305c40e2de64327866b475b4d442873a610`

The shared BigQuery client now blocks the incident fingerprint before a job is
created, hard-quota errors fail once, all query jobs carry attribution labels,
and family expansion has a bounded/cached replacement over
`recipients_rollup_merged.child_ueis`.

## Root cause and runaway caller

The permitted bounded `JOBS_BY_PROJECT` probe confirmed the exact runaway SQL:

```sql
SELECT
  recipient_uei,
  ANY_VALUE(recipient_name) AS recipient_name,
  CAST(MAX(action_date) AS STRING) AS max_action_date
FROM `market-assasin.usaspending.awards`
WHERE COALESCE(parent_uei, recipient_uei) = @familyKey
GROUP BY recipient_uei
```

The function-wrapped predicate defeats `recipient_uei` cluster pruning. The job
history showed no labels and principal
`mindy-bq-reader@market-assasin.iam.gserviceaccount.com`.

The exact source symbol is not identifiable from tracked repository evidence:
the SQL is absent from `origin/main`, `198f06f5`, and all current refs. It is
consistent with a stale sibling/member-expansion implementation; current MRR
comments explicitly record that this full-family scan was removed after hanging
the Phase 1 runner. It is **not** current `batchParentEdgeLookup`, and current
`src/lib/awards-ingest/post-apply-verify.ts` does not contain the family query.

## Old and new query shapes

- Old family expansion: awards +
  `COALESCE(parent_uei, recipient_uei) = @familyKey`.
- New recipient-rollup expansion: `recipients_rollup_merged` +
  `rollup_uei IN UNNEST(@familyKeys)`, returning the stored `child_ueis`.
- Preserved MRR single lookup: awards +
  `recipient_uei = @uei`.
- Preserved MRR batch lookup: awards +
  `recipient_uei IN UNNEST(@ueis)`.

Dry-run estimates:

- Old full-family scan: `4,088,153,031` bytes = `3.807 GiB` per family.
- MRR clustered parent edge: `43,529,966` bytes = `0.041 GiB`.
- Rollup child array: `18,937,050` bytes = `0.018 GiB`.

Reduction:

- Clustered parent edge: `98.94%` per lookup.
- Rollup child array: `99.54%` per lookup.
- 416 uncached calls would fall from `1.547 TiB` to at most `16.865 GiB`
  (clustered parent lookup) or `7.337 GiB` (rollup lookup). Deduplication and
  process caching reduce repeated-family totals further.

## Controls added

- `bqQuery` rejects the unsafe family COALESCE equality before submitting a job.
- QueryUsagePerDay / `quotaExceeded` is non-retryable; transient 429/5xx retry
  behavior remains.
- Default `feature`, `tool`, `query_family` labels cover legacy calls; affected
  calls carry specific labels.
- New family expansion is capped at 64 MiB.
- MRR parent-edge single, batch, and recipients fallback are capped at 128 MiB.
- Family keys are normalized and deduplicated before one bounded query.
- Family results and MRR parent-edge promises are process-cached.
- Missing/failed rollup resolution returns explicit failure, never an
  authoritative zero-member family.
- The MRR current-state-not-point-in-time limitation and no-heuristics rule are
  unchanged.

## File manifest

- `src/lib/bigquery/client.ts`
- `src/lib/bigquery/client-retry-labels.unit.test.ts`
- `src/lib/bigquery/family-members.ts`
- `src/lib/bigquery/family-members.unit.test.ts`
- `src/lib/mrr/corporate-family.ts`
- `src/lib/mrr/corporate-family.unit.test.ts`
- `out/bq-family-repair-proof.json` (gitignored proof artifact)
- `TRACK-A-REPORT.md`

No file outside Track A ownership was edited.

## Verification

- `npx vitest run src/lib/bigquery src/lib/mrr/corporate-family.unit.test.ts`
  — 10 files, 67 tests passed.
- `npx tsc --noEmit` — passed.
- `git diff --check` — passed.
- IDE diagnostics — no linter errors.
- Existing `src/lib/bigquery/byte-ceiling.unit.test.ts` — 5 tests passed.

Tests prove repeat caching, duplicate-key batching, non-retry of quota errors,
job labels and byte caps, fail-closed missing/failure behavior, preservation of
the MRR clustered batch shape, and unchanged family-resolution semantics.

## Remaining limitations

- The originating deployed/manual source symbol cannot be named because the
  observed jobs were unlabelled and the SQL is absent from tracked refs.
- Track B must replace/stop any stale caller still running the old SQL. This
  commit blocks it after the shared client is deployed.
- `recipients_rollup_merged` is derived current-state data and can lag awards;
  missing rows fail closed.
- MRR parent linkage remains current-state, not point-in-time.
- Process caches reset on instance restart and retain results until bounded FIFO
  eviction.
- `getSimilarRecipients` is a different documented 4.48 GiB aggregate and was
  intentionally not changed.

## Conditions before restoring the custom QueryUsagePerDay override

1. Deploy this shared-client guard with Track B's caller replacement.
2. Stop/redeploy stale or manual runners emitting the unlabelled fingerprint.
3. Observe at least one complete workload cycle with zero old COALESCE-equality
   jobs.
4. Confirm replacement jobs have all three labels and remain below 64/128 MiB.
5. Confirm MRR resolved/unresolved/ambiguous behavior and fail-closed errors in
   the integrated build.
6. Confirm normal projected daily usage has safe headroom below the live
   custom QueryUsagePerDay override (mutable GCP configuration — do not assume
   a hardcoded TiB figure).

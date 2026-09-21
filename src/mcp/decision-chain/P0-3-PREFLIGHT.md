# P0-3 preflight — schema + ingestion done. Measurements for the import decision.

Steps 1 and 2 complete and green. **Bulk import NOT run**, per instruction.

## What shipped in this change

| File | Change |
|---|---|
| `supabase/migrations/20260824_sam_naics_small_business.sql` | 4 columns + 2 GIN indexes. **Written, NOT applied** — the runner needs a DB URL I don't have |
| `src/lib/sam/naics-small-business.ts` | The single shared normaliser |
| `src/lib/sam/naics-small-business.unit.test.ts` | 8 tests, incl. API↔bulk equivalence |
| `src/lib/sam/entity-api.ts` | Reads `sbaSmallBusiness` instead of dropping it |
| `scripts/import-sam-entity-extract.mjs` | Keeps the `Y`/`N` from field 34 |
| `src/app/api/cron/sync-gov-buyer-data/route.ts` | Persists map + projection + provenance |

**2,895 tests pass. Typecheck clean.**

### Y / N / unknown is preserved

Eric: *"I would not knowingly discard the N signal at ingestion again."*

`naics_small_business jsonb` is authoritative — `{"561720":"Y","541512":"N"}`, and a **missing
key means SAM did not say**, which `isSmallForNaics()` returns as `null` so callers must
handle it. `small_business_naics text[]` is a **derived** projection for GIN containment
queries; the test asserts it is always re-derivable from the map so the two cannot drift.

A bare code with no flag (`"541512"`) yields **no entry** — unknown, not N. That is exactly
what the old parser destroyed.

### One normaliser, two pipelines

`fromEntityApiNaicsList()` and `fromBulkExtractField()` both produce the same
`NaicsSbMap`, and the equivalence test feeds the same entity through both:

```
API:  [{naicsCode:'561720',sbaSmallBusiness:'N'}, {'332312','Y'}, {'423310','Y'}]
BULK: "332312Y~423310Y~561720N"
→ expect(api).toEqual(bulk)   ✓
```

## The four measurements

| # | Measurement | Value |
|---|---|---|
| 1 | **Newest available extract** | **`SAM_PUBLIC_MONTHLY_V2_20260802.ZIP`** — Aug 2 2026 |
| 2 | **File size** | **147,023,194 bytes (140.2 MB)** — verified via `Content-Range` |
| 3 | **Row count** | ~700K registrations (script header). **Not independently verified** |
| 4 | **Parse/write runtime** | **NOT MEASURED** |

**The configured default is stale.** `EXTRACT_FILENAME` = `SAM_PUBLIC_MONTHLY_V2_20260503.ZIP`
— May 3. Importing that would land size status **three months old on arrival**. `20260802`,
`20260705` and `20260607` all serve real ZIP bytes; the newest should be used.

### Why #4 is not measured

Measuring runtime requires downloading 140 MB and parsing ~700K rows. That is the import
itself minus the write, and the honest options are:

- **Dry run** — download + parse + count, no DB writes. Gives real parse throughput and
  validates that field 34 carries `Y`/`N` in production data rather than only in the layout
  doc. Costs one SAM request and ~140 MB of transfer.
- **Estimate** — decline to guess. A number I made up would be worse than none.

**Recommend the dry run before approving the import**, since it also verifies the parser
against real records — a header comment is not proof.

### Expected DB write volume

491,323 rows updated (the whole table gains the columns), each with a small jsonb map plus a
text[] — dominated by row rewrites rather than payload. **Not measured**; a dry run reporting
matched-row counts would size it properly.

## Not done, deliberately

- Migration **not applied** — needs `DATABASE_URL`/session-pooler access. `npm run migrate`
  then `-- --go` per rule #6.
- `market-research.ts` **still filters on `certifications`** — the P0-3 defect is not yet
  fixed at the query layer. That change should land only after the data exists, or it will
  return zero for a different reason.
- Advertised `set_aside` vocabulary **unchanged** (`tool-registry.ts:844` still lists EDWOSB
  and "Small Business", still omits VOSB).
- The 9 reserved backfill keys were **not used and are not needed** — one request fetches the
  extract.

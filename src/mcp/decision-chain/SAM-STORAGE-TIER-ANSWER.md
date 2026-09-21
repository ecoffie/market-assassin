# Where do SAM raw extracts live today? — investigated, and the answer changes the plan

Eric: *"where are the current SAM monthly ZIPs physically retained after import, and do you
already have a GCS/BigQuery raw SAM dataset or bucket? If yes, build on that."*

## Answer: nowhere, and no — but the pattern already exists for USASpending

### The SAM ZIP is not retained

`scripts/import-sam-entity-extract.mjs` downloads to **`/tmp/sam-extract/entities.zip`**,
parses it, and never copies it anywhere. On a worker or CI runner `/tmp` is ephemeral. The
140 MB `SAM_PUBLIC_MONTHLY_V2_20260802.ZIP` currently exists **only on this laptop**, because
I downloaded it during the P0-3 dry run.

**There is no raw SAM archive.** Every re-import re-downloads from SAM.

### No SAM dataset in BigQuery

`market-assasin` has exactly one dataset — **`usaspending`** (13 tables: `awards` 63M rows,
`recipients_rollup_merged`, pre-aggregated summaries). **No SAM dataset, no SAM tables.**

### But the exact pattern is already built, for USASpending

`scripts/usaspending-ingest/worker.js`:

```js
const BUCKET = 'market-assasin-usaspending-staging';
// gzip → gs://BUCKET/… → BigQuery load
// "Why gzip not raw CSV: BigQuery loads gzip directly."
```

And `src/lib/vault/vault-file-backup.ts` uses a **separate** backup bucket precisely so an
accidental delete of the live bucket cannot take the archive with it.

**So Mindy already has GCS + BigQuery ingestion with a documented rationale. SAM simply never
used it.**

## Revised design — Eric's tiering, using what exists

| Tier | Content | Where |
|---|---|---|
| **Raw immutable source** | the monthly SAM ZIP, as downloaded | **GCS**, e.g. `gs://market-assasin-sam-raw/entity/SAM_PUBLIC_MONTHLY_V2_YYYYMMDD.ZIP` |
| **Parsed historical rows** | one row per entity per snapshot, if SQL access is wanted | **BigQuery**, new `sam` dataset |
| **Normalized decision fields** | `naics_small_business`, `purpose_of_registration`, cert dates, JV/entity type, identity | **Supabase** (typed columns) |
| **Provenance pointer** | which snapshot a row came from | **Supabase** (small text columns) |

### What goes in Postgres instead of `raw_data`

Not a 7.5 GB jsonb blob. Just the pointer:

```
sam_source_type       text    -- 'sam_bulk_extract' | 'sam_entity_api'
sam_source_snapshot   text    -- 'SAM_PUBLIC_MONTHLY_V2_20260802.ZIP'
sam_ingested_at       timestamptz
sam_parser_version    text    -- bump when the parser's field mapping changes
sam_code_version      text    -- commit sha, when available
```

**~80 bytes/row ≈ 73 MB across 910,123 rows** — versus 7.5 GB for slimmed payloads or 75.8 GB
for full ones. Three of these already exist in spirit (`source`, `synced_at`,
`naics_sb_source`); this generalises them.

Recoverability comes from **the ZIP in GCS**, not from a column. A future field discovery
becomes: read the archived ZIP → re-parse → backfill the new typed column. **No re-download
from SAM, no 75 GB in Postgres.**

## Cost

| | |
|---|---|
| One monthly ZIP | 140 MB |
| 12 months retained | ~1.7 GB in GCS |
| GCS standard storage | ~$0.02/GB/month → **~$0.03/month** |
| Postgres provenance columns | ~73 MB |

Versus 7.5 GB of jsonb in a transactional database.

## What I recommend, and what needs your go-ahead

1. **Archive the ZIP on every import** — the importer already has the file in hand; add a GCS
   upload after a successful parse. Small change, and it is the piece that makes everything
   else recoverable.
2. **Provenance columns in Postgres** — migration, ~73 MB.
3. **Defer the BigQuery `sam` dataset** until something actually needs SQL over historical
   snapshots. The ZIP archive alone satisfies recoverability, and Eric noted BigQuery is not
   required just to keep raw blobs.

**Not implemented.** Item 1 needs a bucket name and confirmation that the GCS service account
(`GCP_SA_JSON`, already in prod env) has write access to a new bucket.

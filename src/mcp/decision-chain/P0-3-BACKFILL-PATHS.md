# P0-3 backfill — two paths sized. Bulk data wins decisively; 9 keys not needed.

Eric asked to size **SAM bulk data vs parallel Entity API (9 keys)** and pick the fastest
reliable source that preserves per-NAICS `sbaSmallBusiness` — explicitly not defaulting to a
partial backfill to avoid scale.

## Answer to the "cheaper question first"

> *"do we actually need one API request per entity? If SAM's downloadable entity-registration
> extracts already contain `sbaSmallBusiness`/NAICS assertions at the needed granularity, a
> bulk-data backfill could be dramatically better."*

**They do.** Verified two independent ways:

1. **Live Entity API** — `assertions.goodsAndServices.naicsList[]` entries carry
   `{naicsCode, naicsDescription, sbaSmallBusiness, naicsException}`. Didlake's 561720 entry
   is `sbaSmallBusiness: "N"`.
2. **The bulk extract layout**, documented in our own importer
   (`scripts/import-sam-entity-extract.mjs:111`):
   ```
   *   34 NAICS list (tilde, code+Y/N e.g. "332312Y~423310Y")
   ```
   The `Y`/`N` per code **is** the same per-NAICS flag. Our parser strips it:
   `tok.trim().slice(0,6).replace(/[^0-9]/g,'')`.

So the field is already in a file we already download — and is discarded in **both**
ingestion paths.

## The two paths

| | **Bulk extract** | **Entity API, 9 keys** |
|---|---|---|
| SAM requests | **1** (one 145MB ZIP) | **~41,674** (416,736 active-with-NAICS ÷ 10/page) |
| Quota consumed | ~1 of 1,000/day | 41,674 across the pool |
| Wall clock | download + local parse | ≥5 days at 9×1,000/day, before retries |
| Coverage | **whole registry** — no subset decision needed | whatever the run completes |
| Freshness | monthly snapshot (`SAM_PUBLIC_MONTHLY_V2_20260503.ZIP`) | live |
| Infra | local/worker (not serverless — 145MB, ~700K rows) | resumable 9-key worker pool |
| Failure modes | one download, one parse | per-key 429s, dead-letter queue, checkpoint reconciliation |

**Bulk wins by ~40,000×** on request count. Every requirement Eric listed for the worker pool
— idempotent/resumable, key throttling and rotation, progress reconciliation, no 1,000-row
trap, dead-letter failures — exists *because* the API path is fragile at this scale. The bulk
path makes most of them unnecessary rather than solving them.

**This also means the 9 keys are not needed for P0-3.** Keep them for what they were reserved
for; a full-registry re-import costs one request.

## Recommended split — no partial dataset

- **Backfill = full registry from the bulk extract.** Not a "recent/active" subset. Eric's
  concern about creating "another partial dataset Mindy has to reason around" is real, and
  the bulk path removes the reason to create one.
- **Entity API handles incremental refresh** — exactly its strength, and what the existing
  cron already does per (NAICS, state) slice.

## Corpus (measured, read-only)

| Slice | Count |
|---|---|
| Total `sam_entities` | 491,323 |
| Active, not excluded, with NAICS | 416,736 |
| Distinct across the 9 evaluated NAICS | 152,702 |
| NAICS slices ever API-synced | **8** (561720 not among them) |

## Blocked on two things, neither of which is code

1. **The 9 backfill keys are not available to me.** Production has 4 SAM vars
   (`SAM_API_KEY`, `_1`, `_2`, `_BACKUP`) and `.env.local` resolves to **2 distinct values**.
   Eric confirmed the 4 production keys are reserved for live traffic. The code supports
   `SAM_API_KEY_1..10`, so 9 is configurable — but per this document the API path is not the
   recommendation anyway. **One key is enough to fetch the extract.**
2. **Extract runtime is unmeasured.** 145MB download, ~700K rows, and I have not run it.
   Measure before the go-ahead; the re-import is a bulk write needing explicit approval
   (rule #11).

Also note: `EXTRACT_FILENAME` defaults to `SAM_PUBLIC_MONTHLY_V2_20260503.ZIP` — a **May 3
2026** snapshot. Whether a newer monthly file exists should be checked before importing, or
size status will be ~4 months stale on arrival.

## Ingestion fix does not wait for the backfill

Per Eric: *"Otherwise you're filling a bucket while the normal pipeline continues drilling a
hole in it."* Both parsers stop stripping the flag **first**, so every new/updated sync
carries it immediately, independent of when the historical import runs.

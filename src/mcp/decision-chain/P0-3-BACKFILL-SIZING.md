# P0-3 backfill sizing — read-only. The bulk extract already carries the field.

Sized before proposing any write, per rule #11. **Recommendation changed by what the sizing
found: no API backfill is needed at all.**

## Corpus

| Slice | Count |
|---|---|
| Total entities in `sam_entities` | 491,323 |
| Active, not excluded, with NAICS | 416,736 |
| **Distinct entities in the 9 evaluated NAICS** | **152,702** |
| Synced NAICS slices (`sam_entities_sync_state`) | **8** |

**`561720` — the P0-3 reproduction NAICS — is NOT among the 8 synced slices.** Its 21,933
rows arrived via the bulk extract, not the API cron.

## Why the API path cannot do this backfill

`ENTITY_PAGE_SIZE = 10` (SAM caps entity-API pages at 10) against a 1,000/day/key limit,
four production keys:

| Scope | SAM calls | At full 4-key quota | At current cron rate (40 calls/day) |
|---|---|---|---|
| Targeted (9 NAICS, 152,702) | 15,271 | **3.8 days** | **382 days** |
| Active w/ NAICS (416,736) | 41,674 | 10.4 days | 1,042 days |
| Full corpus (491,323) | 49,133 | 12.3 days | 1,228 days |

Even the *targeted* subset needs 382 days at the cron's deliberate rate, and consuming the
entire 4-key SAM quota for ~4 days would starve every other SAM-dependent feature.

**The API is the wrong instrument.** (This is also rule #7: a >1000-row job belongs in a
local runner, not an HTTP cron loop.)

## The finding that changes the recommendation

`scripts/import-sam-entity-extract.mjs` already exists — the public monthly extract, whole
registry in one 145MB ZIP, no per-record limit. Its own header documents the layout:

```
 *   34 NAICS list (tilde, code+Y/N e.g. "332312Y~423310Y")
```

**That `Y`/`N` IS `sbaSmallBusiness`, per NAICS, already in the file we already download.**

And the parser throws it away (line ~134):

```js
for (const tok of (fields[34] || '').split('~')) {
  const code = tok.trim().slice(0, 6).replace(/[^0-9]/g, '');   // <-- strips the Y/N
  if (code.length === 6) naicsCodes.push(code);
}
```

So the signal is discarded in **both** ingestion paths:

| Path | Field | Dropped at |
|---|---|---|
| Entity API (cron) | `naicsList[].sbaSmallBusiness` | `src/lib/sam/entity-api.ts:183` |
| Bulk extract (script) | field 34 `code+Y/N` | `scripts/import-sam-entity-extract.mjs:~134` |

## Recommendation

**Do not run an API backfill. Re-import from the bulk extract instead.**

1. **Schema** — add `small_business_naics text[]` to `sam_entities` (codes where the entity
   self-certifies small for that NAICS), keeping `certifications[]` for socioeconomic types.
   Migration via the runner, per rule #6.
2. **Both parsers** — stop stripping the flag. Extract path: keep the `Y`/`N` from field 34.
   API path: read `n.sbaSmallBusiness` in `entity-api.ts`. New/updated syncs then carry it
   immediately (Eric's stage 1).
3. **Backfill = one bulk extract re-import**, not 15,271 API calls. Same script, same 145MB
   download, already designed for this. Runs locally/on a worker.
4. **Targeted first pass** is available via the script's existing
   `NAICS=561720,541512,... ` env filter — closes P0-3 for the evaluated markets before any
   full-registry run.

Stage 2 sizing for the extract path (download volume, row throughput, runtime) is **not yet
measured** — the script exists but I have not run it. That measurement should precede the
go-ahead, and the re-import is a bulk write needing explicit approval.

## Provenance requirement (Eric)

The per-NAICS flag is a **self-certification** in SAM. Tool output must say, in substance:

> Small-business status is based on the entity's SAM representation for this NAICS and is
> self-certified unless otherwise indicated.

Note the extract distinguishes sources the current schema flattens: field 118 is
SBA-**certified** (8(a), HUBZone — vetted), field 32 is **self**-certified (WOSB/SDVOSB/VOSB).
Both currently land in one `certifications[]`. The refactor should keep them apart.

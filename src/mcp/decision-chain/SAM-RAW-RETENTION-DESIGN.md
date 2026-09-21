# SAM raw retention — design, sized before any write

**Step 1 of the preservation track.** Sized first; the measurement changed the design.

## The blocking finding: full payloads are not viable

| Variant | Per entity | × 910,123 rows |
|---|---|---|
| Full Entity API payload | 83,322 B | **75.8 GB** |
| Nulls stripped | 64,524 B | 58.7 GB |
| **Slimmed `repsAndCerts` + nulls stripped** | **8,252 B** | **7.5 GB** |
| No `repsAndCerts` at all | 5,609 B | 5.1 GB |

**91% of the payload is `repsAndCerts.certifications`** — 24 FAR provisions and 9 DFAR, each a
verbose, mostly-null answer object:

```json
{"provisionId":"FAR 52.204-3","listOfAnswers":[{"section":"52.204-3.d","questionText":null,
"answerId":null,"answerText":"TIN on file.","country":null,"company":null,
"highestLevelOwnerCage":null, ...}]}
```

Keeping `provisionId` + non-null `answerText` preserves the **decision-useful content** — which
provisions were answered and what was said — and discards null scaffolding. **10× smaller, no
loss of meaning.**

## Shape

```jsonc
raw_data: {
  "_p": {                                   // provenance, always present
    "src":  "sam_entity_api" | "sam_bulk_extract",
    "snap": "SAM_PUBLIC_MONTHLY_V2_20260802.ZIP",  // source snapshot/version
    "at":   "2026-08-24T05:00:00Z",                // ingestion timestamp
    "code": "b31c74a8"                             // code version, when available
  },
  "entityRegistration": {...},  "coreData": {...},
  "assertions": {...},          "repsAndCerts": { "far": [{p, a[]}], "dfar": [...] },
  "pointsOfContact": {...}
}
```

Nulls stripped throughout — a missing key means SAM did not supply it, consistent with the
tri-state rule already used for `naics_small_business`.

## Access rule (Eric)

> **Raw retention prevents information loss; typed materialization establishes product
> meaning.**

`raw_data` is a **provenance store, not a query surface.** Product code reads normalized
columns. If consumers query `raw_data` directly, each invents its own interpretation and the
schema stops meaning anything.

Enforcement: no index on `raw_data` beyond what provenance lookup needs, and a pre-push grep
guard is a candidate (`from('sam_entities').select('raw_data')` outside the ingestion path).

## PII note

`pointsOfContact` carries names and addresses. SAM redacts POC email/phone on the public API,
so the payload holds names + business addresses only. **Retained** — it is public registration
data and identity/hierarchy work needs it — but it is a reason `raw_data` must not be a
general query surface.

## Cost decision needed

**7.5 GB across 910,123 rows.** Not a write I make unasked (rule #11).

Options:
1. **Going forward only** — new/updated syncs carry `raw_data`; existing rows stay null until
   they next sync. Zero bulk write now, gradual coverage.
2. **Backfill from the extract already on disk** — one re-import pass, full coverage
   immediately, ~7.5 GB written at once.

Eric specified *"restricted `raw_data` population going forward"* — **option 1**, which is
also the cheaper and safer read. Recorded here so the choice is explicit rather than assumed.

## Not doing

- Not storing full `repsAndCerts` — 10× cost for null scaffolding.
- Not making `raw_data` queryable by product code.
- Not backfilling without an explicit go-ahead.

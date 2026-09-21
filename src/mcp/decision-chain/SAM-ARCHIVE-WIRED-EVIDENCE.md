# SAM archive wired + verified end to end — 2026-08-24

## 1. Migration — applied and read back

```
▶ 20260824_sam_provenance_pointers.sql ... ok (2468ms)
  ✓ Applied 1 migration(s).
```

Verified from `information_schema`, not from the success message:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `sam_source_type` | text | YES | none |
| `sam_source_snapshot` | date | YES | none |
| `sam_source_object` | text | YES | none |
| `sam_ingested_at` | timestamptz | YES | none |
| `sam_parser_version` | text | YES | none |
| `sam_code_version` | text | YES | none |

Indexes: `idx_sam_entities_source_object` and `idx_sam_entities_source_snapshot`, both partial
(`WHERE ... IS NOT NULL`). All three column comments present.

## 2. Run 1 — archive, then import

```
=== ARCHIVE CONFIRMED ===
  object:     gs://market-assasin-sam-raw/monthly/2026/08/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP
  sha256:     6723e865b3fa8ace1e69a5d3819b63c6d0abcd7d4f9eacf9ce03660b8fc77eac
  read-back:  6723e865b3fa8ace1e69a5d3819b63c6d0abcd7d4f9eacf9ce03660b8fc77eac
  generation: 1787596513471152
  bytes:      147,023,194
  uploaded
```

Import reconciliation — **both identities BALANCE**:

```
lines read 895,431 = parsed 895,429 + structural 2          BALANCES
kept      27,594  = upserted 27,485 + deduped 109 + failed 0 BALANCES
updated existing 27,485 · newly inserted 0
```

## 3. Fail-closed proven accidentally, before it was tested

The first attempt ran in a worktree whose `.env.local` lacked the credential:

```
FATAL Error: SAM_ARCHIVER_SA_JSON missing — refusing to import rows that cannot prove their source.
```

**Zero rows written.** The guard fired for real before it was deliberately exercised.

## 4. Run 2 — idempotent skip

```
  generation: 1787596513471152          ← identical
  IDEMPOTENT SKIP — byte-identical object already archived
```

Same generation. **No new object, no new version.**

## 5. Conflict test — same key, different bytes

Forged a file 8 bytes larger under the same deterministic key:

```
FATAL ArchiveChecksumConflict: Archive object monthly/2026/08/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP
  already exists with a DIFFERENT checksum.
  archived: 6723e865b3fa8ace1e69a5d3819b63c6d0abcd7d4f9eacf9ce03660b8fc77eac
  incoming: 44a00cbacdf6b1794203de38281e832a910c185d6f5c78c75f9616bfe51bdb8c
```

**Failed closed.** Post-conflict state confirms nothing was disturbed:

```
generation: 1787596513471152   (unchanged)
size:       147,023,194        (unchanged)
sha256:     6723e865…7eac      (unchanged)
object versions present: 1     ← no overwrite occurred
```

Stored object metadata:

| Key | Value |
|---|---|
| `snapshot_date` | 2026-08-02 |
| `parser_version` | v2-naics-sb |
| `code_version` | f037e17a |
| `ingested_at` | 2026-08-24T18:35:10.916Z |

## 6. SQL — rows resolve to the archived object

```sql
SELECT sam_source_object, sam_source_type, sam_source_snapshot,
       sam_parser_version, sam_code_version, count(*)
FROM sam_entities WHERE sam_source_object IS NOT NULL GROUP BY 1,2,3,4,5;
```

| field | value |
|---|---|
| `sam_source_object` | `monthly/2026/08/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP` |
| `sam_source_type` | `bulk_extract` |
| `sam_source_snapshot` | `2026-08-02` |
| `sam_parser_version` | `v2-naics-sb` |
| `sam_code_version` | `f037e17a` |
| **rows_stamped** | **27,485** |

Sampled rows — the four P0-3 performers, each resolving to the archived bytes:

| Firm | 561720 | sam_source_object |
|---|---|---|
| OS-DB-JV-2 LLC | **Y** | `monthly/2026/08/SAM_PUBLIC…ZIP` |
| NMI ALASKA, INC. | **Y** | `monthly/2026/08/SAM_PUBLIC…ZIP` |
| J & J MAINTENANCE INC | N | `monthly/2026/08/SAM_PUBLIC…ZIP` |
| DIDLAKE INC | N | `monthly/2026/08/SAM_PUBLIC…ZIP` |

**End-to-end lineage closed.** A Rule-of-Two determination citing these firms now traces to a
specific archived byte-sequence with a verified SHA-256 — not to "the August extract" as a
name.

## Ordering as implemented

```
parse → SHA-256 → deterministic key → upload/confirm → READ BACK metadata → THEN stamp provenance
```

- Archive failure ⇒ **no rows written at all** (proven in §3)
- DB failure after confirmed upload ⇒ archive **retained and reported**, never deleted. The
  archiver identity cannot delete anyway (`objectCreator`+`objectViewer` only).

## Scope note

This run was `NAICS=561720` — 27,485 rows of 910,123. **Remaining rows still carry NULL
`sam_source_object`**, which per the column comment means *"cannot prove which bytes produced
it"*, not *"no archive exists"*. A full `--all-naics` rerun would stamp the rest; that is a
bulk write and needs its own go-ahead.

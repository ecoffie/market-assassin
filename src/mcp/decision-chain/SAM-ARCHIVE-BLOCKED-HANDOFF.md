# SAM preservation — BLOCKED on admin setup. Handoff state.

**Everything that can be built without infrastructure administration is built.** The boundary
holds deliberately: app code and the coding agent do not create buckets, service accounts, or
IAM grants.

## The only blocker

| Step | Owner |
|---|---|
| Create `mindy-sam-archiver` identity | **Human/admin** |
| Create `gs://market-assasin-sam-raw`, versioning ON, no lifecycle deletion | **Human/admin** |
| Grant `objectCreator` + `objectViewer` on that bucket only | **Human/admin** |
| Add `SAM_ARCHIVER_SA_JSON` (base64) to prod env | **Human/admin** |

Commands in `SAM-ARCHIVE-SETUP-RUNBOOK.md`.

## First live test — isolate IAM correctness from importer correctness

Before touching the monthly archive path, prove the permission shape with a **harmless test
object**:

| Assertion | Expected |
|---|---|
| upload `_probe/hello.txt` | **allowed** |
| read it back | **allowed**, bytes match |
| checksum match | **equal** |
| list the prefix | **allowed** |
| delete it | **DENIED** |
| create a bucket | **DENIED** |

A delete that *succeeds* is a failed test — the grant is too broad and must be narrowed before
anything real is archived.

Only then run `archiveSamZip()` against the real August ZIP, twice, to prove the idempotent
skip path.

## Then, in order

```
apply provenance migration
  → wire importer
  → successful parse
  → checksum
  → archive confirmed stored
  → THEN stamp provenance
  → rerun importer idempotently
  → verify byte-identical skip
  → verify rows point at the archived object key
```

**The migration stays unapplied until the archive path is real.** Applying it early creates
provenance columns that can fill with partial or misleading state before the evidence store
exists — a row claiming lineage to an object that was never stored. That is the same
unknown-vs-none failure the columns are meant to prevent.

## Built and tested, waiting behind the blocker

| Artifact | State |
|---|---|
| `supabase/migrations/20260824_sam_provenance_pointers.sql` | Written, **NOT applied** |
| `scripts/lib/sam-archive.mjs` | Written — streamed SHA-256, immutable snapshot keys, `ArchiveChecksumConflict` |
| `src/mcp/decision-chain/sam-archive.unit.test.ts` | **8 passing** |
| `SAM-ARCHIVE-SETUP-RUNBOOK.md` | Admin commands |
| `SAM-ARCHIVE-IAM-FINDINGS.md` | Probe evidence: `mindy-bq-reader` has neither bucket-create nor object-write |
| Importer wiring | **Not written** — deliberately, needs real credentials |

## Remaining preservation-track work, after unblocking

1. Five-archetype diff (ordinary SB · socioeconomic · JV · grants-only · large/foreign) across
   Entity API **and** bulk extract
2. Materialize in priority order: `purposeOfRegistrationCode` → certification entry/exit dates
   → `naicsException` → entity/JV structure → identity/hierarchy
3. Measure each field's effect on a real Mindy decision **before** wiring it into ranking or
   eligibility

## Decision-chain ledger — unchanged and clean

| Item | Status |
|---|---|
| P0-1 | Closed — development stopped, holdout sealed, safety gate live |
| P0-2 | **CLOSED** — production verified |
| P0-3 | **CLOSED** — production verified |
| DEFECT-9A | **CLOSED** — production verified (cases 1 & 3) |
| DEFECT-9B | Open, **P1** — unordered retrieval still governs the supplier list |
| DEFECT-7, DEFECT-8 | Filed |
| SAM field audit (140 of 157 dropped) | Filed |
| Verification-provenance control | Filed |
| Testing debt (source-text guards) | Filed |
| Engineering standard (4 rules) | Written |

**No closed defect was reopened by the SAM work.**

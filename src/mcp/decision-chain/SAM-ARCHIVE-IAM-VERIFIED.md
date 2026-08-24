# SAM archive IAM — VERIFIED against the real credential, 2026-08-24

Isolation test run **before** any real evidence was archived, per Eric: prove IAM correctness
with a harmless probe object first, separately from importer correctness.

## Result — 6 of 6

```
identity: mindy-sam-archiver@market-assasin.iam.gserviceaccount.com
bucket:   market-assasin-sam-raw

  PASS  objects.create (upload)      _probe/iam-check-1787596316920.txt
  PASS  objects.get (readback)
  PASS  checksum match               bytes identical
  PASS  objects.list                 1 object(s) under _probe/
  PASS  objects.delete DENIED        correctly refused
  PASS  buckets.create DENIED        correctly refused
```

**A delete that succeeded would have been a FAILED test.** The two denials are the assertions
that matter — they prove the grant is narrow, not merely functional.

## Bucket configuration (verified by read-back, not by success messages)

| Setting | State |
|---|---|
| Versioning | **Enabled** |
| Uniform bucket-level access | **Enabled: True** (LockedTime 2026-11-22) |
| Location | US |
| Lifecycle | none — no auto-deletion |

## A tooling defect found along the way

**`gcloud storage buckets update --versioning` is a silent no-op** in the installed version.
Three attempts printed `Updating gs://market-assasin-sam-raw/...` and changed nothing;
`describe` returned `versioning: None` each time. Same for
`--uniform-bucket-level-access`.

`gsutil versioning set on` worked immediately and reported the resulting state.

**This is the session's own engineering standard, encountered in a CLI:** an operation that
reports success while doing nothing is indistinguishable from one that worked, unless the
result is read back. Had we trusted the success message, the evidence store would have no
versioning and nobody would have known until an overwrite destroyed an archive.

**Practice going forward:** for infrastructure settings, always `set` then `get`. Never accept
a progress message as proof.

## IAM policy as applied

```
roles/storage.objectCreator  → mindy-sam-archiver
roles/storage.objectViewer   → mindy-sam-archiver
```

Deliberately NOT `objectAdmin` (includes delete) and NOT any `buckets.*`.

**Scope caveat, stated rather than glossed:** the bucket policy also carries inherited
`projectEditor` / `projectOwner` → `roles/storage.legacyBucketOwner`, which **does** include
object deletion. So "cannot delete" is a guarantee about the **archiver service account**, not
about every principal in the project. A human with project-editor rights can still delete
archived objects. Normal GCP inheritance, not a misconfiguration — but the archive is
tamper-*resistant*, not tamper-*proof*, and anyone reasoning about its integrity should know
which of those it is.

## Probe residue

`_probe/iam-check-1787596316920.txt` remains in the bucket. It cannot be removed by the
archiver — that is the design working. An admin can delete it, or it can stay as a permanent
artefact of the day the permissions were verified.

## Unblocked — next in order

```
apply provenance migration
  → wire importer (parse → checksum → archive confirmed → THEN stamp provenance)
  → run against the August ZIP
  → rerun idempotently, verify byte-identical skip
  → verify rows point at the archived object key
```

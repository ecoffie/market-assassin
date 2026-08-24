# GCS permission probe — non-destructive. Nothing created, nothing modified.

Probed `GCP_SA_JSON` (base64-encoded in env) against the three questions.

## Identity

```
mindy-bq-reader@market-assasin.iam.gserviceaccount.com
project: market-assasin
```

**The name is the finding.** It was provisioned as a BigQuery *reader*, and its GCS grants
match that intent.

## Results

| # | Question | Answer |
|---|---|---|
| 1 | Can it **create a bucket**? | **NO** — `storage.buckets.list` denied |
| 2 | Can it **upload an object**? | **NO** — `storage.objects.create` denied on the existing usaspending bucket |
| 3 | Can it **read an object back**? | **Not reached** — write failed first |

Also: `storage.buckets.get` denied on `market-assasin-usaspending-staging`, and
`market-assasin-sam-raw` **does not exist**.

Project-level read succeeded (`getServiceAccount`), so credentials are valid and the project
is reachable — the denials are genuine IAM scope, not a broken key.

## This matches the security split Eric wanted

> *"If bucket creation is not allowed but object write is, that is fine operationally… I would
> not broaden the production service account to project-wide bucket-admin permissions just to
> make the importer self-provision infrastructure."*

Reality is one step tighter: the production identity has **neither** bucket-create **nor**
object-write. So the split is not just preferable, it is currently enforced.

## What is needed — minimal grants, not broad ones

### Admin identity (one-time, human)
Create the bucket and configure it. **Not automated, not the service account.**

```
gcloud storage buckets create gs://market-asasin-sam-raw \
  --project=market-assasin --location=US --uniform-bucket-level-access
```
(*note the correct spelling is `market-assasin-sam-raw` — the project name itself is spelled
`market-assasin`, one 's' in the second word, as used by the existing buckets*)

Suggested at creation time:
- **Object versioning ON** — an overwritten snapshot is otherwise unrecoverable
- **Lifecycle**: none initially. Monthly ZIPs at ~140 MB are ~$0.03/month for a year; deleting
  the evidence store to save cents would defeat its purpose.

### Importer identity (per-bucket, not project-wide)

Either grant the **existing** `mindy-bq-reader` object-level access on this **one** bucket, or
create a dedicated `mindy-sam-archiver`. **A dedicated identity is cleaner** — a BigQuery
reader gaining write access to an evidence store muddies the boundary the account name
currently makes obvious.

Minimum roles on `gs://market-assasin-sam-raw` only:

| Permission | Why |
|---|---|
| `storage.objects.create` | write the archive |
| `storage.objects.get` | re-materialize for backfill |
| `storage.objects.list` | find snapshots |

**Deliberately NOT granted:** `storage.objects.delete`, `storage.buckets.*`. An evidence store
the writer cannot delete from is the point — same reasoning as
`vault-file-backup.ts` using a separate bucket so a live-bucket accident cannot take the
archive with it.

## Object layout (Eric's spec)

```
monthly/2026/08/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP
```

Metadata on the object:

| Key | Value |
|---|---|
| `sha256` | checksum of the ZIP bytes |
| `snapshot_date` | `2026-08-02` |
| `parser_version` | bumped when field mapping changes |
| `code_version` | commit SHA |
| `ingested_at` | ISO timestamp |

The checksum is what lets a later re-materialization **prove the archive bytes match the
snapshot that produced the database rows** — provenance rule #3 applied to data rather than
code.

Upload happens **only after a successful parse**, so a corrupt download never becomes the
archive of record.

## Blocked

Cannot proceed without: the bucket created by an admin identity, and object-level grants for
whichever identity the importer uses. **No IAM was created or modified by this probe.**

# SAM archive — admin setup runbook (human, one-time)

**The coding agent does not touch IAM.** Everything below runs under an admin identity. Once
done, the importer wiring is already written and tested.

## 1. Create the dedicated identity

```bash
gcloud iam service-accounts create mindy-sam-archiver \
  --project=market-assasin \
  --display-name="Mindy SAM raw archive writer"
```

Dedicated, **not** a widened `mindy-bq-reader` — a BigQuery reader holding write access to an
evidence store muddies a boundary the account name currently makes obvious.

## 2. Create the bucket

```bash
gcloud storage buckets create gs://market-assasin-sam-raw \
  --project=market-assasin --location=US \
  --uniform-bucket-level-access

# Versioning ON — a backstop against accident, not a licence to supersede evidence.
gcloud storage buckets update gs://market-assasin-sam-raw --versioning
```

**No lifecycle deletion.** ~140 MB/month ≈ $0.03/year. Deleting the evidence that produced
historical Mindy conclusions to save cents would defeat the purpose.

## 3. Grant bucket-scoped object permissions ONLY

```bash
SA=mindy-sam-archiver@market-assasin.iam.gserviceaccount.com

gcloud storage buckets add-iam-policy-binding gs://market-assasin-sam-raw \
  --member="serviceAccount:$SA" --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://market-assasin-sam-raw \
  --member="serviceAccount:$SA" --role=roles/storage.objectViewer
```

`objectCreator` + `objectViewer` give create/get/list. **Deliberately NOT**
`roles/storage.objectAdmin` (includes delete) and **NOT** any `roles/storage.admin`. A writer
that cannot delete is the point — same reasoning as `vault-file-backup.ts` using a separate
bucket so a live-bucket accident cannot take the archive with it.

## 4. Key → production secret store

```bash
gcloud iam service-accounts keys create /tmp/sam-archiver.json --iam-account="$SA"
base64 -i /tmp/sam-archiver.json | pbcopy      # → Vercel env SAM_ARCHIVER_SA_JSON
rm /tmp/sam-archiver.json                       # do not leave the key on disk
```

Env var: **`SAM_ARCHIVER_SA_JSON`** (base64, matching the existing `GCP_SA_JSON` convention).

## 5. Verify (agent can run this once the key exists)

Re-run the permission probe against the new identity. Expected: bucket-create **denied**,
object create/get/list **allowed**, delete **denied**.

---

## What is already written and tested

| Artifact | Status |
|---|---|
| `supabase/migrations/20260824_sam_provenance_pointers.sql` | Written, **not applied** |
| `scripts/lib/sam-archive.mjs` | Written — key derivation, streamed SHA-256, conflict rule |
| `src/mcp/decision-chain/sam-archive.unit.test.ts` | **8 tests passing** |
| Importer wiring | **Not written** — needs credentials to be testable end-to-end |

## The ordering the importer must follow

```
download → SHA-256 → parse successfully → check archive → upload → THEN write provenance
```

Provenance is stamped on DB rows **only after** the archive is confirmed stored. Otherwise
Postgres claims "source archived" when archival failed — a row asserting lineage it cannot
prove.

## The rule worth restating

**Same name, different bytes is an ERROR, not a version.** Object names are snapshot-specific
and immutable, so an existing object with a different checksum means SAM republished under a
name we already trusted. `ArchiveChecksumConflict` surfaces it with both checksums. The
archived bytes may be the provenance for rows already in the database.

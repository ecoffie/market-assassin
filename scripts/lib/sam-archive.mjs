/**
 * SAM raw-archive helper — GCS is the immutable evidence store.
 *
 * ORDERING (Eric, 2026-08-24) — this is the load-bearing part:
 *
 *   download → SHA-256 → parse successfully → check archive → upload → THEN write provenance
 *
 * Provenance is stamped onto DB rows ONLY after the archive is confirmed stored. Otherwise
 * Postgres claims "source archived" when archival failed — a row asserting lineage it cannot
 * prove, which is the unknown-vs-none rule applied to provenance.
 *
 * SAME-NAME/DIFFERENT-BYTES IS AN ERROR, NOT A VERSION. Object names are snapshot-specific and
 * immutable by design, so an existing object whose checksum differs means SAM republished a
 * file under a name we already trusted. That must surface loudly. Versioning is a backstop
 * against accident, not a licence to silently supersede evidence.
 *
 * Credentials: a DEDICATED archiver identity with objects.create/get/list on this ONE bucket.
 * Deliberately NOT objects.delete and NOT buckets.* — a writer that cannot delete is the
 * point of an evidence store.
 */
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';

export const SAM_ARCHIVE_BUCKET = process.env.SAM_ARCHIVE_BUCKET || 'market-assasin-sam-raw';

/** SHA-256 of a file, streamed — never load 140 MB into memory. */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/**
 * `SAM_PUBLIC_MONTHLY_V2_20260802.ZIP` → `monthly/2026/08/SAM_PUBLIC_MONTHLY_V2_20260802.ZIP`
 * Snapshot-specific and immutable: the date is IN the name, so a new snapshot never collides
 * with an old one.
 */
export function archiveObjectKey(zipFilename) {
  const name = basename(zipFilename);
  const m = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return `monthly/unknown/${name}`;
  return `monthly/${m[1]}/${m[2]}/${name}`;
}

/** `...20260802.ZIP` → `2026-08-02` (the date the snapshot REPRESENTS). */
export function snapshotDate(zipFilename) {
  const m = basename(zipFilename).match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export class ArchiveChecksumConflict extends Error {
  constructor(key, existing, incoming) {
    super(
      `Archive object ${key} already exists with a DIFFERENT checksum.\n` +
      `  archived: ${existing}\n  incoming: ${incoming}\n` +
      `SAM appears to have republished a file under a name already trusted. Investigate ` +
      `before overwriting — the archived bytes may be the provenance for existing DB rows.`,
    );
    this.name = 'ArchiveChecksumConflict';
    this.key = key; this.existing = existing; this.incoming = incoming;
  }
}

/**
 * Archive the ZIP. Returns { key, sha256, bytes, skipped }.
 * @param {object} opts.storage  a @google-cloud/storage Storage instance
 * @param {string} opts.zipPath  local path to the downloaded ZIP
 * @param {object} opts.meta     { parser_version, code_version }
 */
export async function archiveSamZip({ storage, zipPath, meta = {} }) {
  const key = archiveObjectKey(zipPath);
  const sha = await sha256File(zipPath);
  const bytes = statSync(zipPath).size;
  const file = storage.bucket(SAM_ARCHIVE_BUCKET).file(key);

  const [exists] = await file.exists();
  if (exists) {
    const [m] = await file.getMetadata();
    const existingSha = m?.metadata?.sha256;
    if (existingSha && existingSha !== sha) throw new ArchiveChecksumConflict(key, existingSha, sha);
    // Byte-identical (or an archive predating checksums) — do NOT re-upload. Idempotent.
    return { key, sha256: sha, bytes, skipped: true };
  }

  await file.save(createReadStream(zipPath), {
    resumable: true,
    contentType: 'application/zip',
    metadata: {
      contentType: 'application/zip',
      metadata: {
        sha256: sha,
        snapshot_date: snapshotDate(zipPath) || '',
        parser_version: meta.parser_version || '',
        code_version: meta.code_version || '',
        ingested_at: new Date().toISOString(),
        source_bytes: String(bytes),
      },
    },
  });
  return { key, sha256: sha, bytes, skipped: false };
}

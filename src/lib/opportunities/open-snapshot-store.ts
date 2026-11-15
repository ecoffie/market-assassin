/**
 * OPEN SNAPSHOT STORE (Agent 3, 2026-11-15; Agent 5 cache review #3). Development only: OPEN_SNAPSHOT_RETRIEVAL stays off.
 *
 * Why: building the snapshot reads ~64 MB of TOASTed text from sam_opportunities (~10 paged reads, ~10 s). Done per warm
 * function instance — and again after every overflow — that is real load on the table FIND and the Map query. Instead
 * ONE writer (the build-open-snapshot cron route, run after each SAM sync) builds it and uploads a gzipped, checksummed
 * file to a PRIVATE Supabase Storage bucket; instances only download (≈20 MB) and verify.
 *
 * Safety:
 *   - The bucket is never created here. Creating it (private, service-role only) is an infrastructure step for Eric.
 *     Both the writer and the loader REFUSE a bucket that is missing or public (default grants exposed objects this week).
 *   - A downloaded file is used only if its format, row count and sha256 match what the writer recorded.
 *   - Any failure returns null to the caller, which then uses today's SQL path. Never a partial snapshot.
 */
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { OpenSnapshot } from './open-cache';

export const OPEN_SNAPSHOT_BUCKET = 'open-snapshots';
export const OPEN_SNAPSHOT_OBJECT = 'latest.json.gz';
const FORMAT = 1;

export interface SnapshotStore {
  /** null = bucket missing; otherwise whether it is public. */
  bucketIsPublic(): Promise<boolean | null>;
  put(path: string, bytes: Buffer): Promise<void>;
  get(path: string): Promise<Buffer | null>;
}

const rowsDigest = (rows: OpenSnapshot['rows']) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

export function serializeOpenSnapshot(s: OpenSnapshot): { bytes: Buffer; sha256: string } {
  const sha256 = rowsDigest(s.rows);
  if (s.count !== s.rows.length) throw new Error(`open-snapshot: count ${s.count} != rows ${s.rows.length}`);
  return { bytes: gzipSync(JSON.stringify({ format: FORMAT, builtAt: s.builtAt, count: s.count, sha256, rows: s.rows })), sha256 };
}

export function parseOpenSnapshot(bytes: Buffer): OpenSnapshot {
  const j = JSON.parse(gunzipSync(bytes).toString('utf8')) as { format: number; builtAt: string; count: number; sha256: string; rows: OpenSnapshot['rows'] };
  if (j.format !== FORMAT) throw new Error(`open-snapshot: unknown format ${j.format}`);
  if (!Array.isArray(j.rows) || j.rows.length !== j.count) throw new Error(`open-snapshot: row count mismatch (${j.rows?.length} vs ${j.count})`);
  if (isNaN(Date.parse(j.builtAt))) throw new Error('open-snapshot: bad builtAt');
  if (rowsDigest(j.rows) !== j.sha256) throw new Error('open-snapshot: checksum mismatch');
  return { builtAt: j.builtAt, count: j.count, rows: j.rows };
}

async function assertPrivate(store: SnapshotStore): Promise<void> {
  const pub = await store.bucketIsPublic();
  if (pub === null) throw new Error(`open-snapshot: bucket ${OPEN_SNAPSHOT_BUCKET} does not exist (create it private; infrastructure step)`);
  if (pub) throw new Error(`open-snapshot: bucket ${OPEN_SNAPSHOT_BUCKET} is PUBLIC; refusing to read or write`);
}

/** Writer (cron route). Throws on any problem; the route reports it. */
export async function writeOpenSnapshot(store: SnapshotStore, s: OpenSnapshot): Promise<{ gzipBytes: number; sha256: string }> {
  await assertPrivate(store);
  const { bytes, sha256 } = serializeOpenSnapshot(s);
  await store.put(OPEN_SNAPSHOT_OBJECT, bytes);
  return { gzipBytes: bytes.length, sha256 };
}

/** Loader (instances). null on ANY problem — the caller uses SQL. */
export async function loadOpenSnapshot(store: SnapshotStore): Promise<OpenSnapshot | null> {
  try {
    await assertPrivate(store);
    const bytes = await store.get(OPEN_SNAPSHOT_OBJECT);
    return bytes ? parseOpenSnapshot(bytes) : null;
  } catch (e) {
    console.error('[open-snapshot] load refused:', (e as Error).message);
    return null;
  }
}

/** Supabase Storage implementation (service-role client). Never creates the bucket. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseSnapshotStore(client: any): SnapshotStore {
  return {
    async bucketIsPublic() {
      const { data, error } = await client.storage.getBucket(OPEN_SNAPSHOT_BUCKET);
      if (error || !data) return null;
      return data.public === true;
    },
    async put(path, bytes) {
      const { error } = await client.storage.from(OPEN_SNAPSHOT_BUCKET).upload(path, bytes, { contentType: 'application/gzip', upsert: true });
      if (error) throw new Error(`open-snapshot: upload failed (${error.message})`);
    },
    async get(path) {
      const { data, error } = await client.storage.from(OPEN_SNAPSHOT_BUCKET).download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

/**
 * Durable storage for market-research deliverables (report DOCX, appendix DOCX,
 * evidence JSON).
 *
 * WHY: on Vercel the files are assembled in /tmp on whichever instance ran the
 * job. Every download request lands on another instance, so the files were
 * effectively never downloadable from getmindy.ai (measured 2026-10-06: 0/18).
 * Job metadata already lives in Vercel KV; the bytes now live in a PRIVATE
 * Supabase Storage bucket keyed by run id, using the same service-role pattern
 * as `vault-assets` / `pursuit-documents`.
 *
 * Ownership is NOT delegated to Storage: the bucket is private and only the
 * download route reads it, after checking the KV job's ownerEmail against the
 * verified session. Bytes are verified against the sha256 recorded at bind
 * time before they are served.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { isSafeMrrRunId, type MrrArtifactKind } from './workspace-constants';

export const MRR_ARTIFACT_BUCKET = 'mrr-artifacts';

const CONTENT_TYPE: Record<MrrArtifactKind, string> = {
  mrr: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  appendix: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  evidence: 'application/json',
};

export interface ArtifactStore {
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer | null>;
  /** File names stored under a run id. Throws when storage cannot be read. */
  list(runId: string): Promise<string[]>;
}

let override: ArtifactStore | null = null;
let bucketReady: Promise<void> | null = null;

/** Tests inject an in-memory store; production uses Supabase Storage. */
export function setMrrArtifactStoreForTests(store: ArtifactStore | null): void {
  override = store;
  bucketReady = null;
}

export function isMrrArtifactStorageConfigured(): boolean {
  if (override) return true;
  if (process.env.VITEST) return false;
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function client(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function ensureBucket(sb: SupabaseClient): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await sb.storage.getBucket(MRR_ARTIFACT_BUCKET);
      if (data) return;
      const { error } = await sb.storage.createBucket(MRR_ARTIFACT_BUCKET, { public: false });
      // A concurrent instance may have created it between the two calls.
      if (error && !/already exists/i.test(error.message)) {
        throw new Error(`could not create ${MRR_ARTIFACT_BUCKET} bucket: ${error.message}`);
      }
    })().catch((error) => {
      bucketReady = null;
      throw error;
    });
  }
  return bucketReady;
}

function supabaseStore(): ArtifactStore {
  return {
    async put(path, bytes, contentType) {
      const sb = client();
      await ensureBucket(sb);
      const { error } = await sb.storage
        .from(MRR_ARTIFACT_BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`artifact upload failed (${path}): ${error.message}`);
    },
    async get(path) {
      const { data, error } = await client().storage.from(MRR_ARTIFACT_BUCKET).download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async list(runId) {
      const { data, error } = await client().storage
        .from(MRR_ARTIFACT_BUCKET)
        .list(runId, { limit: 100 });
      if (error) throw new Error(`artifact list failed (${runId}): ${error.message}`);
      return (data ?? []).map((item) => item.name);
    },
  };
}

function store(): ArtifactStore {
  return override ?? supabaseStore();
}

/** Deterministic object path. Run ids are 22-char base64url; file names are validated basenames. */
export function artifactObjectPath(runId: string, fileName: string): string {
  if (!isSafeMrrRunId(runId)) throw new Error('artifact path refused: unsafe run id');
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error('artifact path refused: unsafe file name');
  }
  return `${runId}/${fileName}`;
}

export async function putMrrArtifact(
  runId: string,
  kind: MrrArtifactKind,
  fileName: string,
  bytes: Buffer,
): Promise<string> {
  const path = artifactObjectPath(runId, fileName);
  await store().put(path, bytes, CONTENT_TYPE[kind]);
  return path;
}

/**
 * Read a stored artifact and verify it against the hash recorded when the run
 * completed. A missing object or a hash mismatch returns null — the caller
 * reports the files as unavailable rather than serving the wrong bytes.
 */
export async function getMrrArtifactBytes(
  runId: string,
  fileName: string,
  expectedSha256: string,
): Promise<Buffer | null> {
  if (!isMrrArtifactStorageConfigured()) return null;
  let bytes: Buffer | null;
  try {
    bytes = await store().get(artifactObjectPath(runId, fileName));
  } catch (error) {
    console.warn('[mrr-artifacts] storage read failed', error);
    return null;
  }
  if (!bytes) return null;
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) {
    console.error(`[mrr-artifacts] sha256 mismatch for ${runId}/${fileName}`);
    return null;
  }
  return bytes;
}

/**
 * Which of the given file names are durably stored for this run.
 * `null` = storage could not be read (unknown), never "none stored".
 */
export async function storedMrrArtifactNames(runId: string): Promise<Set<string> | null> {
  if (!isMrrArtifactStorageConfigured() || !isSafeMrrRunId(runId)) return null;
  try {
    return new Set(await store().list(runId));
  } catch (error) {
    console.warn('[mrr-artifacts] storage list failed', error);
    return null;
  }
}

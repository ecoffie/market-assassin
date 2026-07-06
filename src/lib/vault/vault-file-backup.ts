import { SupabaseClient } from '@supabase/supabase-js';
import { VAULT_STORAGE_BUCKET } from './vault-data';

/**
 * Vault file backup — the one real gap in our backup story.
 *
 * WHY: Supabase's daily database backups explicitly DO NOT include Storage
 * objects (their dashboard says so, and PITR excludes them too). So the actual
 * customer files in `vault-assets` — resumes, capability statements, pricing
 * docs — have NO backup, even though the DB rows that reference them do. If a
 * file were deleted or the bucket corrupted, a DB restore would bring back the
 * metadata pointing at bytes that no longer exist.
 *
 * DESIGN: copy every object from `vault-assets` into a SEPARATE private bucket
 * (`vault-assets-backup`) on a schedule. A separate bucket means an accidental
 * delete/corruption of the live bucket doesn't take the backup with it, and it
 * needs no new credentials (same service-role client). This is the pragmatic
 * belt-and-suspenders tier; a fully off-provider copy (S3/R2) is a later tier if
 * a contract demands geographic/provider separation.
 *
 * SAFETY: read + copy only; NEVER deletes from the live bucket. Resumable +
 * incremental — skips objects already backed up at the same size (so a daily run
 * only copies new/changed files, not the whole bucket every night). Best-effort
 * per object: one failed copy is logged and the run continues.
 */

export const BACKUP_BUCKET = 'vault-assets-backup';

export interface BackupResult {
  scanned: number;
  copied: number;
  skipped: number;
  errors: { path: string; error: string }[];
  truncated: boolean;
}

interface StorageObj {
  name: string;
  id?: string | null;
  metadata?: { size?: number } | null;
}

/**
 * Recursively list every object under `prefix` in a bucket. Supabase's list()
 * is one directory level at a time; vault files live at `${email}/...` and
 * `${email}/resumes/...`, so we recurse. A folder entry has a null `id`.
 */
async function listAllObjects(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  out: { path: string; size: number }[],
  budget: { remaining: number },
): Promise<void> {
  if (budget.remaining <= 0) return;
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return;
  for (const entry of data as StorageObj[]) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    // A null id = a "folder" (prefix), not a file → recurse into it.
    if (entry.id == null && entry.metadata == null) {
      await listAllObjects(supabase, bucket, full, out, budget);
    } else {
      out.push({ path: full, size: entry.metadata?.size ?? -1 });
      budget.remaining -= 1;
      if (budget.remaining <= 0) return;
    }
  }
}

/**
 * Ensure the backup bucket exists (private). No-op if already there.
 */
async function ensureBackupBucket(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.storage.getBucket(BACKUP_BUCKET);
  if (!data) {
    await supabase.storage.createBucket(BACKUP_BUCKET, { public: false });
  }
}

/**
 * Copy new/changed vault files into the backup bucket. Incremental: an object
 * already present in the backup at the same size is skipped. `maxObjects` bounds
 * a single run (the cron re-fires to drain the rest). Returns per-run counts.
 */
export async function backupVaultFiles(
  supabase: SupabaseClient,
  opts: { maxObjects?: number } = {},
): Promise<BackupResult> {
  const maxObjects = opts.maxObjects ?? 500;
  const result: BackupResult = { scanned: 0, copied: 0, skipped: 0, errors: [], truncated: false };

  await ensureBackupBucket(supabase);

  // List live objects (bounded).
  const live: { path: string; size: number }[] = [];
  const budget = { remaining: maxObjects + 1 }; // +1 so we can detect truncation
  await listAllObjects(supabase, VAULT_STORAGE_BUCKET, '', live, budget);
  if (live.length > maxObjects) {
    result.truncated = true;
    live.length = maxObjects;
  }
  result.scanned = live.length;

  // Index the backup bucket once so we can skip unchanged files cheaply.
  const existing = new Map<string, number>();
  const backup: { path: string; size: number }[] = [];
  await listAllObjects(supabase, BACKUP_BUCKET, '', backup, { remaining: 100000 });
  for (const b of backup) existing.set(b.path, b.size);

  for (const obj of live) {
    const prior = existing.get(obj.path);
    // Skip if already backed up at the same known size (incremental).
    if (prior !== undefined && prior === obj.size && obj.size >= 0) {
      result.skipped += 1;
      continue;
    }
    try {
      // Download from live → upload to backup (upsert so a changed file overwrites).
      const { data: blob, error: dlErr } = await supabase.storage
        .from(VAULT_STORAGE_BUCKET)
        .download(obj.path);
      if (dlErr || !blob) throw new Error(dlErr?.message || 'download returned no data');
      const buffer = Buffer.from(await blob.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from(BACKUP_BUCKET)
        .upload(obj.path, buffer, { upsert: true });
      if (upErr) throw new Error(upErr.message);
      result.copied += 1;
    } catch (err) {
      result.errors.push({ path: obj.path, error: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return result;
}

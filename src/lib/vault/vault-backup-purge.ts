/**
 * Backup copies of deleted Vault files (proposed policy: 30-day recovery window, subject to
 * legal/contract review).
 *
 * The nightly backup (vault-file-backup.ts) copies `vault-assets` into `vault-assets-backup` and never
 * deletes. When a file is explicitly deleted with VAULT_COMPLETE_DELETION on, the deletion writes a purge
 * request into the backup bucket under `_purge-requests/<purge-after date>/…json`. Until that date the
 * copy remains recoverable; after it, purgeDueBackupCopies() removes the copies and then the request.
 * Nothing here deletes from the LIVE bucket. purgeDueBackupCopies is not scheduled by this change:
 * wiring it to a job is a separate, approved step.
 */
import { BACKUP_BUCKET } from './vault-file-backup';
import { isOwnedPath, isFolderEntry, LIST_PAGE, REMOVE_CHUNK, type VaultStorageLike } from './vault-delete';

export const BACKUP_RECOVERY_DAYS = 30;
export const PURGE_PREFIX = '_purge-requests';

export interface PurgeRequest {
  owner: string;
  paths: string[];
  requestedAt: string;
  purgeAfter: string;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Record that these backup copies may be purged after the recovery window. */
export async function markBackupCopiesForPurge(
  storage: VaultStorageLike,
  ownerEmail: string,
  paths: string[],
  now: Date = new Date(),
): Promise<{ ok: true; markerPath: string | null } | { ok: false; error: string }> {
  const owned = Array.from(new Set(paths.filter((p) => isOwnedPath(p, ownerEmail))));
  if (owned.length !== new Set(paths).size) return { ok: false, error: 'refused path(s) outside this vault' };
  if (!owned.length) return { ok: true, markerPath: null };
  const purgeAfter = new Date(now.getTime() + BACKUP_RECOVERY_DAYS * 86_400_000);
  const req: PurgeRequest = { owner: ownerEmail, paths: owned, requestedAt: now.toISOString(), purgeAfter: purgeAfter.toISOString() };
  const markerPath = `${PURGE_PREFIX}/${day(purgeAfter)}/${now.getTime()}-${Math.random().toString(36).slice(2, 10)}.json`;
  const bucket = storage.from(BACKUP_BUCKET);
  if (!bucket.upload) return { ok: false, error: 'backup storage cannot write purge requests' };
  const { error } = await bucket.upload(markerPath, JSON.stringify(req), { contentType: 'application/json', upsert: false });
  if (error) return { ok: false, error: `could not record the backup purge: ${error.message || 'unknown'}` };
  return { ok: true, markerPath };
}

export interface PurgeRunResult {
  requestsProcessed: number;
  copiesRemoved: number;
  /** Requested copies that were already absent from the backup (never backed up, or purged before). */
  alreadyAbsent: number;
  errors: string[];
}

/** Remove backup copies whose purge-after date has passed, then their requests. Never touches the live bucket. */
export async function purgeDueBackupCopies(storage: VaultStorageLike, now: Date = new Date()): Promise<PurgeRunResult> {
  const out: PurgeRunResult = { requestsProcessed: 0, copiesRemoved: 0, alreadyAbsent: 0, errors: [] };
  const bucket = storage.from(BACKUP_BUCKET);
  const { data: days, error } = await bucket.list(PURGE_PREFIX, { limit: LIST_PAGE });
  if (error) { out.errors.push(`could not list purge requests: ${error.message || 'unknown'}`); return out; }
  const today = day(now);
  for (const d of (days || []).filter(isFolderEntry).map((e) => e.name).filter((n) => n <= today).sort()) {
    const { data: markers, error: mErr } = await bucket.list(`${PURGE_PREFIX}/${d}`, { limit: LIST_PAGE });
    if (mErr) { out.errors.push(`could not list ${d}: ${mErr.message || 'unknown'}`); continue; }
    for (const m of (markers || []).filter((e) => !isFolderEntry(e))) {
      const markerPath = `${PURGE_PREFIX}/${d}/${m.name}`;
      try {
        if (!bucket.download) throw new Error('backup storage cannot read purge requests');
        const { data: blob, error: dErr } = await bucket.download(markerPath);
        if (dErr || !blob) throw new Error(dErr?.message || 'empty purge request');
        const req = JSON.parse(await blob.text()) as PurgeRequest;
        if (!req || typeof req.owner !== 'string' || !Array.isArray(req.paths)) throw new Error('malformed purge request');
        if (new Date(req.purgeAfter).getTime() > now.getTime()) continue;
        const paths = req.paths.filter((p) => isOwnedPath(p, req.owner));
        if (paths.length !== req.paths.length) throw new Error('purge request names a path outside its vault');
        let removed = 0;
        for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
          const { data, error: rErr } = await bucket.remove(paths.slice(i, i + REMOVE_CHUNK));
          if (rErr) throw new Error(rErr.message || 'remove failed');
          removed += (data || []).length;
        }
        out.copiesRemoved += removed;
        out.alreadyAbsent += paths.length - removed;
        const { error: delErr } = await bucket.remove([markerPath]);
        if (delErr) throw new Error(`copies removed but the request could not be cleared: ${delErr.message || 'unknown'}`);
        out.requestsProcessed += 1;
      } catch (err) {
        out.errors.push(`${markerPath}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
  }
  return out;
}

/**
 * Complete, owner-scoped deletion of Vault files, with receipts that count only what was actually
 * removed. Shared by account deletion (deleteAllVaultData) and explicit single-document Delete.
 *
 * Storage facts this module is built on (Supabase Storage):
 *   - list(prefix) returns ONE directory level, at most `limit` entries per call (paged by `offset`);
 *   - a sub-folder comes back as an entry with id === null and metadata === null;
 *   - remove(paths) deletes exact keys only (a folder path deletes nothing) and returns the objects
 *     it actually removed in `data`.
 *
 * Safety rules enforced here, whatever the caller passes:
 *   - every path removed must sit under `${ownerEmail}/` (never another account's prefix);
 *   - a listing or removal error makes the whole result an ERROR (never a partial "success");
 *   - the receipt counts removed objects from remove()'s own response, not the number requested.
 *
 * Destructive behaviour beyond the legacy top-level sweep is gated by VAULT_COMPLETE_DELETION
 * (src/lib/vault/flags.ts, default OFF) at the call sites.
 */

/** Minimal Storage surface (the service-role Supabase client satisfies it; tests pass a fake). */
export interface VaultStorageLike {
  from(bucket: string): {
    list(
      prefix: string,
      opts?: { limit?: number; offset?: number; sortBy?: { column: string; order: string } },
    ): Promise<{ data: StorageEntry[] | null; error: { message?: string } | null }>;
    remove(paths: string[]): Promise<{ data: { name?: string }[] | null; error: { message?: string } | null }>;
    upload?(path: string, body: Buffer | string, opts?: { contentType?: string; upsert?: boolean }): Promise<{ error: { message?: string } | null }>;
    download?(path: string): Promise<{ data: { text(): Promise<string> } | null; error: { message?: string } | null }>;
  };
}

export interface StorageEntry {
  name: string;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const LIST_PAGE = 1000;
export const REMOVE_CHUNK = 100;
/** Hard ceiling per call, so a runaway prefix can never turn into an unbounded loop. */
export const MAX_OWNED_OBJECTS = 50_000;

export function isFolderEntry(e: StorageEntry): boolean {
  return e.id === null && (e.metadata === null || e.metadata === undefined);
}

/** `${owner}/` with the owner normalised exactly as upload paths are written (as stored). */
export function ownerPrefix(ownerEmail: string): string {
  const owner = String(ownerEmail || '').trim();
  if (!owner || owner.includes('/') || owner.startsWith('.')) throw new Error('invalid vault owner');
  return `${owner}/`;
}

export function isOwnedPath(path: string, ownerEmail: string): boolean {
  const p = ownerPrefix(ownerEmail);
  return typeof path === 'string' && path.startsWith(p) && path.length > p.length && !path.split('/').includes('..');
}

export type ListResult = { ok: true; paths: string[] } | { ok: false; error: string; paths: string[] };

/**
 * Every FILE under `${owner}/`, recursing into sub-folders (generated/, resumes/, …) and paging past
 * LIST_PAGE entries per folder. Any listing error fails the whole listing.
 */
export async function listAllOwnedFiles(storage: VaultStorageLike, bucket: string, ownerEmail: string): Promise<ListResult> {
  const root = ownerPrefix(ownerEmail).slice(0, -1);
  const files: string[] = [];
  const folders: string[] = [root];
  while (folders.length) {
    const folder = folders.shift()!;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await storage.from(bucket).list(folder, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) return { ok: false, error: `could not list ${folder === root ? 'the vault folder' : 'a vault sub-folder'}: ${error.message || 'unknown'}`, paths: files };
      const page = data || [];
      for (const e of page) {
        if (!e?.name) continue;
        const full = `${folder}/${e.name}`;
        if (isFolderEntry(e)) folders.push(full);
        else files.push(full);
        if (files.length > MAX_OWNED_OBJECTS) return { ok: false, error: `more than ${MAX_OWNED_OBJECTS} files; stopped`, paths: files };
      }
      if (page.length < LIST_PAGE) break;
    }
  }
  return { ok: true, paths: files };
}

export interface RemoveReceipt {
  requested: number;
  removed: number;
  removedPaths: string[];
  /** Set whenever removed !== requested or any call failed. A receipt with an error is a failure. */
  error?: string;
  /** Set only when a Storage call itself failed or a path was refused (as opposed to a file already absent). */
  callError?: string;
}

/** Remove exact owned keys in chunks; the receipt counts what Storage says it removed. */
export async function removeOwnedFiles(storage: VaultStorageLike, bucket: string, ownerEmail: string, paths: string[]): Promise<RemoveReceipt> {
  const unique = Array.from(new Set(paths));
  const foreign = unique.filter((p) => !isOwnedPath(p, ownerEmail));
  if (foreign.length) {
    const msg = `refused ${foreign.length} path(s) outside this vault`;
    return { requested: unique.length, removed: 0, removedPaths: [], error: msg, callError: msg };
  }
  const removedPaths: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < unique.length; i += REMOVE_CHUNK) {
    const chunk = unique.slice(i, i + REMOVE_CHUNK);
    const { data, error } = await storage.from(bucket).remove(chunk);
    if (error) { errors.push(error.message || 'remove failed'); continue; }
    const names = new Set((data || []).map((d) => d?.name).filter((n): n is string => typeof n === 'string'));
    for (const p of chunk) if (names.has(p)) removedPaths.push(p);
  }
  const receipt: RemoveReceipt = { requested: unique.length, removed: removedPaths.length, removedPaths };
  if (errors.length) { receipt.error = errors[0]; receipt.callError = errors[0]; }
  else if (receipt.removed !== receipt.requested) receipt.error = `${receipt.requested - receipt.removed} of ${receipt.requested} file(s) were not removed`;
  return receipt;
}

/**
 * Delete every file under `${owner}/` (recursive, paged), then list again to prove nothing is left.
 */
export async function deleteAllOwnedFiles(storage: VaultStorageLike, bucket: string, ownerEmail: string): Promise<RemoveReceipt> {
  const listed = await listAllOwnedFiles(storage, bucket, ownerEmail);
  if (!listed.ok) return { requested: listed.paths.length, removed: 0, removedPaths: [], error: listed.error };
  const receipt = await removeOwnedFiles(storage, bucket, ownerEmail, listed.paths);
  if (receipt.error) return receipt;
  const after = await listAllOwnedFiles(storage, bucket, ownerEmail);
  if (!after.ok) return { ...receipt, error: `deleted, but could not confirm: ${after.error}` };
  if (after.paths.length) return { ...receipt, error: `${after.paths.length} file(s) still present after deletion` };
  return receipt;
}

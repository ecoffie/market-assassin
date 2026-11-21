/**
 * Explicit, permanent Delete of ONE Vault document — distinct from Archive.
 *
 *   Archive (unchanged, the default): sets archived_at. Reversible. Never purged automatically.
 *   Delete (this module, VAULT_COMPLETE_DELETION only): removes the stored file, the row (which holds
 *   extracted_text and doc_model), every later version of it (rows whose parent_id is this document),
 *   and marks the backup copies for purge after the recovery window.
 *
 * Owner-scoped on every read and write (user_email = the confirmed acting owner). Files go first, then
 * rows, so a retry after a partial failure is safe (an already-removed file counts as absent, not as an
 * error). Any Storage call failure stops before rows are deleted.
 */
import { VAULT_STORAGE_BUCKET } from './vault-data';
import { isOwnedPath, removeOwnedFiles, type VaultStorageLike } from './vault-delete';
import { markBackupCopiesForPurge } from './vault-backup-purge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VaultDocsDb = { from(table: string): any };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = 'user_boilerplate_docs';

export interface DocumentDeleteReceipt {
  documents: number;
  files: number;
  filesAlreadyAbsent: number;
  backupPurge: { markedFiles: number; error?: string };
}

export type DocumentDeleteResult =
  | { ok: true; receipt: DocumentDeleteReceipt }
  | { ok: false; status: number; code: 'not_found' | 'invalid' | 'storage_failed' | 'delete_failed' | 'inconsistent'; message: string; partial?: Partial<DocumentDeleteReceipt> };

type Row = { id: string; storage_path: string | null };

export async function hardDeleteVaultDocument(
  deps: { db: VaultDocsDb; storage: VaultStorageLike; now?: () => Date },
  input: { id: string; ownerEmail: string },
): Promise<DocumentDeleteResult> {
  const { id, ownerEmail } = input;
  if (!UUID_RE.test(id) || !ownerEmail) return { ok: false, status: 400, code: 'invalid', message: 'A valid document id is required.' };

  const { data: doc, error: docErr } = await deps.db.from(TABLE)
    .select('id, storage_path').eq('id', id).eq('user_email', ownerEmail).maybeSingle();
  if (docErr) return { ok: false, status: 500, code: 'delete_failed', message: 'Could not read the document.' };
  if (!doc) return { ok: false, status: 404, code: 'not_found', message: 'The document was not found.' };

  const { data: kids, error: kidErr } = await deps.db.from(TABLE)
    .select('id, storage_path').eq('parent_id', id).eq('user_email', ownerEmail);
  if (kidErr) return { ok: false, status: 500, code: 'delete_failed', message: 'Could not read the document versions.' };

  const rows: Row[] = [doc as Row, ...((kids as Row[]) || [])];
  const ids = Array.from(new Set(rows.map((r) => r.id)));
  const paths = Array.from(new Set(rows.map((r) => r.storage_path).filter((p): p is string => !!p)));
  if (paths.some((p) => !isOwnedPath(p, ownerEmail))) {
    return { ok: false, status: 500, code: 'inconsistent', message: 'A stored file is outside this Vault, so nothing was deleted.' };
  }

  const files = await removeOwnedFiles(deps.storage, VAULT_STORAGE_BUCKET, ownerEmail, paths);
  if (files.callError) {
    return { ok: false, status: 500, code: 'storage_failed', message: 'The file could not be deleted. Nothing else was changed. Try again.', partial: { files: files.removed } };
  }

  const { count, error: delErr } = await deps.db.from(TABLE)
    .delete({ count: 'exact' }).eq('user_email', ownerEmail).in('id', ids);
  if (delErr || typeof count !== 'number' || count !== ids.length) {
    return {
      ok: false, status: 500, code: 'delete_failed',
      message: 'The file was removed but the document record could not be fully deleted. Try again.',
      partial: { files: files.removed, documents: typeof count === 'number' ? count : 0 },
    };
  }

  let backupPurge: DocumentDeleteReceipt['backupPurge'] = { markedFiles: 0 };
  if (files.removedPaths.length) {
    const mark = await markBackupCopiesForPurge(deps.storage, ownerEmail, files.removedPaths, (deps.now ?? (() => new Date()))());
    backupPurge = mark.ok ? { markedFiles: files.removedPaths.length } : { markedFiles: 0, error: mark.error };
  }
  return {
    ok: true,
    receipt: { documents: count, files: files.removed, filesAlreadyAbsent: files.requested - files.removed, backupPurge },
  };
}

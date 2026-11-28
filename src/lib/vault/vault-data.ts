import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { vaultCompleteDeletionEnabled } from './flags';
import {
  isFolderEntry,
  listAllOwnedFiles,
  removeOwnedFiles,
  deleteAllOwnedFiles,
  LIST_PAGE,
  type StorageEntry,
  type VaultStorageLike,
} from './vault-delete';
import { markBackupCopiesForPurge } from './vault-backup-purge';

/**
 * Canonical definition of "a user's vault" — the single source of truth for
 * every table + Storage location that holds customer-owned vault data.
 *
 * WHY THIS EXISTS: the admin delete route (delete-mindy-user) hard-coded its own
 * table list and drifted — the 5 vault tables (added 2026-05-26) were never
 * added, so a "deleted" user's most sensitive PII (EIN, CAGE, security
 * clearances, contract references, resume text) survived deletion (audit
 * 2026-07-05). Centralizing the list here means export + self-serve delete +
 * admin delete all reference the SAME set, and adding a new vault table is a
 * one-line change that every consumer inherits — the drift can't recur.
 *
 * All vault tables are keyed by a plaintext `user_email` column and hold rows
 * that belong to exactly one owner.
 */

/** The five vault tables, keyed by `user_email`. */
export const VAULT_TABLES = [
  'user_identity_profile',
  'user_past_performance',
  'user_capabilities_library',
  'user_team_members',
  'user_boilerplate_docs',
] as const;

export type VaultTable = (typeof VAULT_TABLES)[number];

/** Private Storage bucket holding uploaded files (resumes, cap statements). */
export const VAULT_STORAGE_BUCKET = 'vault-assets';

export function getServiceSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface VaultTableExport {
  table: VaultTable;
  rows: Record<string, unknown>[];
  error?: string;
}

/**
 * Read every vault row a user owns, per table. Owner-scoped by `user_email`.
 * Returns full row data (used by the self-serve export). Storage FILES are
 * listed separately via listVaultStorageFiles.
 */
export async function readAllVaultData(
  supabase: SupabaseClient,
  email: string,
): Promise<VaultTableExport[]> {
  return Promise.all(
    VAULT_TABLES.map(async (table): Promise<VaultTableExport> => {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .eq('user_email', email);
        if (error) return { table, rows: [], error: error.message };
        return { table, rows: (data as Record<string, unknown>[]) || [] };
      } catch (err) {
        return { table, rows: [], error: err instanceof Error ? err.message : 'unknown' };
      }
    }),
  );
}

/**
 * List the Storage FILE paths a user owns (files are pathed `${email}/...`). Folder entries are never
 * reported as files. With VAULT_COMPLETE_DELETION on, this recurses into sub-folders (generated/,
 * resumes/) and pages past 1000; off, it reads the top level only and says when that is incomplete.
 */
export async function listVaultStorageFiles(
  supabase: SupabaseClient,
  email: string,
): Promise<{ paths: string[]; error?: string; incomplete?: string }> {
  try {
    const storage = supabase.storage as unknown as VaultStorageLike;
    if (vaultCompleteDeletionEnabled()) {
      const r = await listAllOwnedFiles(storage, VAULT_STORAGE_BUCKET, email);
      return r.ok ? { paths: r.paths } : { paths: r.paths, error: r.error };
    }
    const { data, error } = await storage.from(VAULT_STORAGE_BUCKET).list(email, { limit: LIST_PAGE });
    if (error) return { paths: [], error: error.message || 'unknown' };
    const entries = (data || []) as StorageEntry[];
    const paths = entries.filter((f) => f?.name && !isFolderEntry(f)).map((f) => `${email}/${f.name}`);
    const folders = entries.filter((f) => f?.name && isFolderEntry(f)).length;
    const notes = [
      folders ? `${folders} sub-folder(s) not included` : '',
      entries.length >= LIST_PAGE ? `more than ${LIST_PAGE} entries; later files not included` : '',
    ].filter(Boolean);
    return notes.length ? { paths, incomplete: notes.join('; ') } : { paths };
  } catch (err) {
    return { paths: [], error: err instanceof Error ? err.message : 'unknown' };
  }
}

export interface VaultDeleteResult {
  tables: { table: VaultTable; rows: number; error?: string }[];
  /**
   * `files` counts objects Storage confirmed it removed (never folder entries, never the number
   * requested). Any `error` means the Vault was NOT completely deleted.
   */
  storage: { files: number; requested: number; error?: string; backupPurge?: { markedFiles: number; error?: string } };
  totalRowsDeleted: number;
}

/**
 * Hard-delete every vault row + Storage file a user owns. Owner-scoped by
 * `user_email`. Used by BOTH the self-serve delete and the admin delete so the
 * two can never diverge. Best-effort per table (one table's error doesn't abort
 * the rest); returns per-table counts + errors for an honest response.
 */
export async function deleteAllVaultData(
  supabase: SupabaseClient,
  email: string,
): Promise<VaultDeleteResult> {
  const tables = await Promise.all(
    VAULT_TABLES.map(async (table): Promise<VaultDeleteResult['tables'][number]> => {
      try {
        const { error, count } = await supabase
          .from(table)
          .delete({ count: 'exact' })
          .eq('user_email', email);
        if (error) return { table, rows: 0, error: error.message };
        return { table, rows: count || 0 };
      } catch (err) {
        return { table, rows: 0, error: err instanceof Error ? err.message : 'unknown' };
      }
    }),
  );

  // Remove the user's Storage files (resumes, uploaded docs, generated files).
  const storage = await deleteVaultStorage(supabase, email);
  const totalRowsDeleted = tables.reduce((sum, t) => sum + t.rows, 0);
  return { tables, storage, totalRowsDeleted };
}

/**
 * Storage half of a Vault deletion.
 *   - VAULT_COMPLETE_DELETION on: every file under `${email}/` (recursive, paged), verified empty
 *     afterwards, and the backup copies marked for purge after the recovery window.
 *   - off (legacy): the top level only, as before, but the receipt counts only confirmed removals and
 *     reports anything it left behind (sub-folders, >1000 entries) as an error, never as success.
 */
export async function deleteVaultStorage(supabase: SupabaseClient, email: string): Promise<VaultDeleteResult['storage']> {
  const storage = supabase.storage as unknown as VaultStorageLike;
  try {
    if (vaultCompleteDeletionEnabled()) {
      const receipt = await deleteAllOwnedFiles(storage, VAULT_STORAGE_BUCKET, email);
      const out: VaultDeleteResult['storage'] = { files: receipt.removed, requested: receipt.requested };
      if (receipt.error) out.error = receipt.error;
      if (receipt.removedPaths.length) {
        const mark = await markBackupCopiesForPurge(storage, email, receipt.removedPaths);
        out.backupPurge = mark.ok ? { markedFiles: receipt.removedPaths.length } : { markedFiles: 0, error: mark.error };
        if (!mark.ok) out.error = [out.error, `files deleted, but their backup copies could not be scheduled for purge: ${mark.error}`].filter(Boolean).join('; ');
      }
      return out;
    }
    const listed = await listVaultStorageFiles(supabase, email);
    if (listed.error) return { files: 0, requested: 0, error: listed.error };
    const receipt = listed.paths.length
      ? await removeOwnedFiles(storage, VAULT_STORAGE_BUCKET, email, listed.paths)
      : { requested: 0, removed: 0, removedPaths: [] as string[] };
    const problems = [receipt.error, listed.incomplete ? `not deleted: ${listed.incomplete}` : ''].filter(Boolean);
    return problems.length
      ? { files: receipt.removed, requested: receipt.requested, error: problems.join('; ') }
      : { files: receipt.removed, requested: receipt.requested };
  } catch (err) {
    return { files: 0, requested: 0, error: err instanceof Error ? err.message : 'unknown' };
  }
}

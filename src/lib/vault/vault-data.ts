import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

/** List the Storage object paths a user owns (files are pathed `${email}/...`). */
export async function listVaultStorageFiles(
  supabase: SupabaseClient,
  email: string,
): Promise<{ paths: string[]; error?: string }> {
  try {
    const { data, error } = await supabase.storage
      .from(VAULT_STORAGE_BUCKET)
      .list(email, { limit: 1000 });
    if (error) return { paths: [], error: error.message };
    const paths = (data || []).map((f) => `${email}/${f.name}`);
    return { paths };
  } catch (err) {
    return { paths: [], error: err instanceof Error ? err.message : 'unknown' };
  }
}

export interface VaultDeleteResult {
  tables: { table: VaultTable; rows: number; error?: string }[];
  storage: { files: number; error?: string };
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

  // Remove the user's Storage files (resumes, uploaded docs).
  let storage: VaultDeleteResult['storage'] = { files: 0 };
  const { paths, error: listErr } = await listVaultStorageFiles(supabase, email);
  if (listErr) {
    storage = { files: 0, error: listErr };
  } else if (paths.length > 0) {
    try {
      const { error: removeErr } = await supabase.storage.from(VAULT_STORAGE_BUCKET).remove(paths);
      storage = removeErr ? { files: 0, error: removeErr.message } : { files: paths.length };
    } catch (err) {
      storage = { files: 0, error: err instanceof Error ? err.message : 'unknown' };
    }
  }

  const totalRowsDeleted = tables.reduce((sum, t) => sum + t.rows, 0);
  return { tables, storage, totalRowsDeleted };
}

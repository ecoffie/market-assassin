/**
 * Hard delete a Mindy user — Supabase Auth identity + every table row keyed
 * by user_email. Used to let someone start over after a broken onboarding
 * or to scrub testing accounts.
 *
 * Auth: admin password via ?password=... query param.
 *
 * GET  ?password=...&email=...     → dry-run, lists rows that would delete
 * POST ?password=...&email=...     → actually delete
 *
 * Returns counts per table + Supabase Auth deletion status.
 *
 * DESTRUCTIVE — no undo. Confirm with a dry-run first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  VAULT_TABLES,
  deleteAllVaultData,
  listVaultStorageFiles,
} from '@/lib/vault/vault-data';
// Single source of truth for the user_email-keyed tables — shared with the
// change-email re-key lib so the two can never drift (the 2026-07-05
// vault-omission lesson). Behavior here is unchanged: same 19 tables, same order.
import { USER_EMAIL_TABLES } from '@/lib/mindy/user-scoped-tables';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface TableResult {
  table: string;
  rows: number;
  error?: string;
}

async function countRows(supabase: ReturnType<typeof getSupabase>, table: string, email: string): Promise<TableResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase.from(table) as any)
      .select('*', { count: 'exact', head: true })
      .eq('user_email', email);
    if (error) return { table, rows: 0, error: error.message };
    return { table, rows: count || 0 };
  } catch (err) {
    return { table, rows: 0, error: err instanceof Error ? err.message : 'unknown' };
  }
}

async function deleteRows(supabase: ReturnType<typeof getSupabase>, table: string, email: string): Promise<TableResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase.from(table) as any)
      .delete({ count: 'exact' })
      .eq('user_email', email);
    if (error) return { table, rows: 0, error: error.message };
    return { table, rows: count || 0 };
  } catch (err) {
    return { table, rows: 0, error: err instanceof Error ? err.message : 'unknown' };
  }
}

async function deleteSupabaseAuthUser(supabase: ReturnType<typeof getSupabase>, email: string) {
  try {
    // Look up the auth user by email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error: listError } = await (supabase.auth.admin as any).listUsers();
    if (listError) {
      return { deleted: false, error: listError.message };
    }
    const user = list?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email);
    if (!user) {
      return { deleted: false, error: 'No Supabase Auth user with this email' };
    }
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return { deleted: false, userId: user.id, error: deleteError.message };
    }
    return { deleted: true, userId: user.id };
  } catch (err) {
    return { deleted: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const [tableCounts, vaultCounts, vaultFiles] = await Promise.all([
    Promise.all(USER_EMAIL_TABLES.map(t => countRows(supabase, t, email))),
    Promise.all(VAULT_TABLES.map(t => countRows(supabase, t, email))),
    listVaultStorageFiles(supabase, email),
  ]);
  const allCounts = [...tableCounts, ...vaultCounts];
  const totalRows = allCounts.reduce((sum, r) => sum + r.rows, 0);

  return NextResponse.json({
    mode: 'dry-run',
    email,
    tableCounts,
    vaultCounts,               // the 5 vault tables (previously silently skipped)
    vaultStorageFiles: vaultFiles.paths.length,
    totalRows,
    note: 'POST to this endpoint with the same email to actually delete. Vault tables + Storage files ARE now included.',
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Delete table rows first, then the auth user — if the auth deletion
  // somehow fails halfway, we'd rather have the orphan auth row than
  // orphan profile data.
  const tableDeletes = await Promise.all(USER_EMAIL_TABLES.map(t => deleteRows(supabase, t, email)));
  // Vault tables + Storage files via the shared lib (closes the audit gap).
  const vaultResult = await deleteAllVaultData(supabase, email);
  const totalRowsDeleted =
    tableDeletes.reduce((sum, r) => sum + r.rows, 0) + vaultResult.totalRowsDeleted;
  const tableErrors = [
    ...tableDeletes.filter(r => r.error),
    ...vaultResult.tables.filter(t => t.error).map(t => ({ table: t.table, rows: t.rows, error: t.error })),
    ...(vaultResult.storage.error ? [{ table: 'vault-assets (storage)', rows: 0, error: vaultResult.storage.error }] : []),
  ];

  const authResult = await deleteSupabaseAuthUser(supabase, email);

  return NextResponse.json({
    mode: 'executed',
    email,
    tableDeletes,
    vaultDeletes: vaultResult.tables,
    vaultStorageFilesDeleted: vaultResult.storage.files,
    totalRowsDeleted,
    tableErrors: tableErrors.length > 0 ? tableErrors : undefined,
    supabaseAuth: authResult,
    success: tableErrors.length === 0 && (authResult.deleted || authResult.error === 'No Supabase Auth user with this email'),
  });
}

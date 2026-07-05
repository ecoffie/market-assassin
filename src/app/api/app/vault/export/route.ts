import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import {
  getServiceSupabase,
  readAllVaultData,
  listVaultStorageFiles,
} from '@/lib/vault/vault-data';

export const dynamic = 'force-dynamic';

/**
 * Phase 1.2 — Self-serve vault export ("export your data anytime").
 *
 * GET /api/app/vault/export?email=<caller>
 * Returns the caller's COMPLETE vault as a downloadable JSON file, owner-scoped
 * by the AUTHENTICATED email (never the raw claimed email). Storage files are
 * listed (paths, not bytes) so the user knows what documents they hold; the
 * files themselves are downloaded through the existing signed-URL path.
 *
 * This makes the "you can export your data" trust claim TRUE (audit 2026-07-05
 * found no export path existed). Same auth + owner-scoping as every vault route.
 */
export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;
  const supabase = getServiceSupabase();

  const [tables, storage] = await Promise.all([
    readAllVaultData(supabase, userEmail),
    listVaultStorageFiles(supabase, userEmail),
  ]);

  // Shape the export as a self-describing document.
  const exportDoc = {
    _meta: {
      product: 'Mindy',
      export_type: 'vault',
      owner_email: userEmail,
      exported_at: new Date().toISOString(),
      note: 'This is your complete Mindy vault data. You own it. Storage files are listed by path; download each from the app.',
    },
    data: Object.fromEntries(tables.map((t) => [t.table, t.rows])),
    storage_files: storage.paths,
    errors: [
      ...tables.filter((t) => t.error).map((t) => ({ table: t.table, error: t.error })),
      ...(storage.error ? [{ storage: storage.error }] : []),
    ],
  };

  const filename = `mindy-vault-export-${userEmail.replace(/[^a-z0-9]/gi, '_')}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(exportDoc, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

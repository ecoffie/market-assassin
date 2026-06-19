/**
 * /api/admin/apply-doc-source-migration
 *
 * Applies supabase/migrations/20260601_pursuit_documents_doc_source.sql to prod.
 * That migration exists in the repo but was never run against the live DB, so
 * pursuit_documents has no `doc_source` column — and EVERY attachment insert
 * fails with "Could not find the 'doc_source' column" (PGRST204). That single
 * missing column is why attachment coverage was 0%.
 *
 * GET  ?password=...  → status (does the column exist?)
 * POST ?password=...  → add the column (idempotent)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

const DDL = `
ALTER TABLE pursuit_documents
  ADD COLUMN IF NOT EXISTS doc_source TEXT NOT NULL DEFAULT 'sam_public';
NOTIFY pgrst, 'reload schema';
`;

async function columnExists(): Promise<boolean> {
  // A select of the column fails with PGRST204 if it doesn't exist.
  const { error } = await getSupabase()
    .from('pursuit_documents')
    .select('doc_source')
    .limit(1);
  return !error;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ success: true, doc_source_column_exists: await columnExists() });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await getSupabase().rpc('exec_sql', { sql: DDL });
  if (error) {
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    applied: true,
    doc_source_column_exists: await columnExists(),
  });
}

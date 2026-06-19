/**
 * Apply SOW embedding columns to sam_opportunities.
 * GET /api/admin/apply-sow-embeddings-migration?password=xxx
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const statements = [
    `ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS sow_embedding JSONB`,
    `ALTER TABLE sam_opportunities ADD COLUMN IF NOT EXISTS sow_embedded_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_sam_sow_embed_todo ON sam_opportunities (sow_embedded_at NULLS FIRST) WHERE has_sow_doc = true AND sow_text IS NOT NULL`,
  ];

  const results: { step: string; success: boolean; error?: string }[] = [];

  for (const sql of statements) {
    const { error } = await supabase.rpc('exec_sql', { sql }).single();
    if (error && !error.message.includes('already exists')) {
      results.push({ step: sql.slice(0, 70), success: false, error: error.message });
    } else {
      results.push({ step: sql.slice(0, 70), success: true });
    }
  }

  const { error: verifyErr } = await supabase
    .from('sam_opportunities')
    .select('sow_embedding, sow_embedded_at')
    .limit(1);

  const ok = results.every((r) => r.success) && !verifyErr;

  return NextResponse.json({
    success: ok,
    verifyError: verifyErr?.message,
    results,
    ...(ok
      ? {}
      : {
          message: 'exec_sql unavailable — paste this in Supabase SQL editor',
          sql: statements.join(';\n') + ';',
        }),
  });
}

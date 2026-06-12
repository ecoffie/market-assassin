import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/admin/check-indexes?password=...
 *
 * Read-only diagnostic: confirms the load-reduction indexes from
 * 20260612_load_reduction_indexes.sql actually exist in Postgres (the migration
 * is hand-run in Supabase, so the SQL file being committed does NOT prove it ran).
 * Queries pg_indexes via the `exec` RPC.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const EXPECTED = [
  'idx_sam_opps_title_trgm',
  'idx_sam_opps_desc_trgm',
  'idx_sam_opps_posted_date',
  'idx_sam_opps_sol_num',
  'idx_fed_contacts_agency_trgm',
  'idx_fed_contacts_office_trgm',
  'idx_fed_contacts_name_trgm',
];

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // exec returns the SELECT result as JSON (the RPC used by the apply-* routes).
  const sql = `select indexname, tablename from pg_indexes
    where indexname in (${EXPECTED.map((n) => `'${n}'`).join(', ')})
    order by indexname;`;

  const { data, error } = await supabase.rpc('exec', { query: sql });

  if (error) {
    return NextResponse.json({ success: false, error: error.message, hint: 'exec RPC may differ — check pg_indexes manually' }, { status: 500 });
  }

  // `data` shape depends on the exec function; normalize to a found-name set.
  const rows: Array<{ indexname?: string; tablename?: string }> = Array.isArray(data) ? data : (data?.result || data?.rows || []);
  const found = new Set(rows.map((r) => r.indexname).filter(Boolean));
  const missing = EXPECTED.filter((n) => !found.has(n));

  // Also confirm the pg_trgm extension (the GIN indexes need it).
  const { data: extData } = await supabase.rpc('exec', {
    query: `select extname from pg_extension where extname = 'pg_trgm';`,
  });
  const extRows: Array<{ extname?: string }> = Array.isArray(extData) ? extData : (extData?.result || extData?.rows || []);
  const pgTrgmInstalled = extRows.some((r) => r.extname === 'pg_trgm');

  return NextResponse.json({
    success: true,
    allPresent: missing.length === 0,
    pgTrgmInstalled,
    expected: EXPECTED.length,
    found: [...found],
    missing,
    rawRows: rows,
    _rawExecData: data, // so we can see exec's actual return shape if normalization misses
  });
}

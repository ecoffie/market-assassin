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

  const sql = `select indexname, tablename from pg_indexes
    where indexname in (${EXPECTED.map((n) => `'${n}'`).join(', ')})
    order by indexname;`;

  // The DB exposes a few SQL-exec RPCs with differing signatures across migrations
  // (exec_sql{sql}, exec_sql{sql_query}, exec{query}). DDL routes only read .error,
  // so we don't know which returns SELECT rows. Try each until one returns data.
  const attempts: Array<{ fn: string; arg: Record<string, string> }> = [
    { fn: 'exec_sql', arg: { sql } },
    { fn: 'exec_sql', arg: { sql_query: sql } },
    { fn: 'exec', arg: { query: sql } },
    { fn: 'exec', arg: { sql } },
  ];

  let data: unknown = null;
  let lastError = '';
  let usedFn = '';
  for (const a of attempts) {
    const res = await supabase.rpc(a.fn, a.arg);
    if (!res.error && res.data != null) { data = res.data; usedFn = `${a.fn}(${Object.keys(a.arg)[0]})`; break; }
    if (res.error) lastError = res.error.message;
  }

  // Normalize whatever shape came back into a list of index names.
  const rows: Array<{ indexname?: string; tablename?: string }> = Array.isArray(data)
    ? (data as Array<{ indexname?: string; tablename?: string }>)
    : ((data as { result?: unknown[]; rows?: unknown[] })?.result as Array<{ indexname?: string }> || (data as { rows?: unknown[] })?.rows as Array<{ indexname?: string }> || []);
  const found = new Set(rows.map((r) => r.indexname).filter(Boolean));
  const missing = EXPECTED.filter((n) => !found.has(n));

  return NextResponse.json({
    success: data != null,
    execFnUsed: usedFn || 'NONE WORKED',
    lastError: usedFn ? undefined : lastError,
    allPresent: data != null && missing.length === 0,
    expected: EXPECTED.length,
    found: [...found],
    missing,
    rawRows: rows,
    _rawExecData: data,
  });
}

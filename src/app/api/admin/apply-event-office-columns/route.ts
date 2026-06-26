import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/**
 * POST /api/admin/apply-event-office-columns?password=...
 *
 * Adds the office-tagging columns to sam_events so an event can be scoped to its
 * real buying office (decoded from the solicitation-number DoDAAC) instead of the
 * department-level agency field. See src/lib/gov-contacts/event-office.ts.
 */
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // exec_sql runs ONE statement per call (it's the working RPC in this instance —
  // `exec` doesn't exist here). Run each separately.
  const statements = [
    `ALTER TABLE sam_events ADD COLUMN IF NOT EXISTS solicitation_number TEXT`,
    `ALTER TABLE sam_events ADD COLUMN IF NOT EXISTS inferred_dodaac TEXT`,
    `ALTER TABLE sam_events ADD COLUMN IF NOT EXISTS inferred_office TEXT`,
    `ALTER TABLE sam_events ADD COLUMN IF NOT EXISTS inferred_subagency TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_sam_events_inferred_subagency ON sam_events (inferred_subagency)`,
  ];
  const errors: string[] = [];
  for (const sql of statements) {
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) errors.push(`${sql.slice(0, 60)}… → ${error.message}`);
  }

  if (errors.length) {
    return NextResponse.json({ success: false, errors }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    message: 'sam_events office-tagging columns added (solicitation_number, inferred_dodaac, inferred_office, inferred_subagency).',
  });
}

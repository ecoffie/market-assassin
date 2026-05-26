import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

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

// Whitelist of fields the user can write — keeps the API
// resistant to junk payloads + makes upgrades explicit.
const WRITABLE_FIELDS = [
  'uei', 'cage_code', 'duns', 'ein',
  'legal_name', 'dba', 'year_founded', 'employee_count', 'annual_revenue',
  'certifications', 'primary_naics',
  'one_liner', 'elevator_pitch',
  'hq_state', 'hq_city', 'service_states',
  'contract_vehicles',
];

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const profile = body.profile || {};

  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { user_email: auth.email!, updated_at: new Date().toISOString() };
  for (const k of WRITABLE_FIELDS) {
    if (k in profile) row[k] = profile[k];
  }

  const { data, error } = await getSupabase()
    .from('user_identity_profile')
    .upsert(row, { onConflict: 'user_email' })
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, identity: data });
}

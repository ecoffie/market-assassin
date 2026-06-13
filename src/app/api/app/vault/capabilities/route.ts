import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { invalidateCapabilityVector } from '@/lib/alerts/capability-vector';

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

const WRITABLE = [
  'capability_name', 'description',
  'related_naics', 'related_psc', 'keywords',
  'evidence', 'tools_methods',
];

function pick(input: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const k of WRITABLE) if (k in input) out[k] = input[k] === '' ? null : input[k];
  return out;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const entry = body.entry || {};
  if (!email || !entry.capability_name || !entry.description) {
    return NextResponse.json({ success: false, error: 'Email, capability_name, description required' }, { status: 400 });
  }
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const row = { ...pick(entry), user_email: auth.email! };
  const { data, error } = await getSupabase().from('user_capabilities_library').insert(row).select().maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  void invalidateCapabilityVector(auth.email!); // capability text changed → re-embed
  return NextResponse.json({ success: true, entry: data });
}

export async function DELETE(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  const { error } = await getSupabase().from('user_capabilities_library')
    .update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_email', auth.email!);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  void invalidateCapabilityVector(auth.email!); // capability removed → re-embed
  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { invalidateCapabilityVector } from '@/lib/alerts/capability-vector';
import { embedVaultRow } from '@/lib/vault/embed-evidence';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

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
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  // Coach Mode: add the capability to the ACTIVE CLIENT's vault, not the coach's.
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const writeEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const row = { ...pick(entry), user_email: writeEmail };
  const { data, error } = await getSupabase().from('user_capabilities_library').insert(row).select().maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (data) await embedVaultRow(getSupabase(), 'capability', data, new Date().toISOString());
  void invalidateCapabilityVector(writeEmail); // capability text changed → re-embed
  return NextResponse.json({ success: true, entry: data });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const id = String(body.id || '').trim();
  const entry = body.entry || {};
  if (!email || !id) return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const writeEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const update = { ...pick(entry), updated_at: new Date().toISOString() };
  const { data, error } = await getSupabase().from('user_capabilities_library')
    .update(update).eq('id', id).eq('user_email', writeEmail).select().maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (data) await embedVaultRow(getSupabase(), 'capability', data, new Date().toISOString());
  void invalidateCapabilityVector(writeEmail); // capability text changed → re-embed
  return NextResponse.json({ success: true, entry: data });
}

export async function DELETE(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const writeEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const { error } = await getSupabase().from('user_capabilities_library')
    .update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_email', writeEmail);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  void invalidateCapabilityVector(writeEmail); // capability removed → re-embed
  return NextResponse.json({ success: true });
}

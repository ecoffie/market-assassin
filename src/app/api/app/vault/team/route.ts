import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
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
  'full_name', 'title', 'email', 'phone', 'linkedin_url',
  'years_experience', 'certifications', 'security_clearance',
  'bio_short', 'bio_full', 'role_type', 'is_key_personnel',
  'resume_storage_path', 'resume_filename',
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
  if (!email || !entry.full_name || !entry.title) {
    return NextResponse.json({ success: false, error: 'Email, full_name, title required' }, { status: 400 });
  }
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  // Coach Mode: a team member added while working as a client belongs to the
  // CLIENT's vault (synthetic email), not the coach's — matches vault/route.ts read.
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const ownerEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const row = { ...pick(entry), user_email: ownerEmail };
  const { data, error } = await getSupabase().from('user_team_members').insert(row).select().maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  // Semantic weave: key-personnel bios/certs become matchable evidence.
  if (data) await embedVaultRow(getSupabase(), 'person', data, new Date().toISOString());
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
  const ownerEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const update = { ...pick(entry), updated_at: new Date().toISOString() };
  const { data, error } = await getSupabase().from('user_team_members')
    .update(update).eq('id', id).eq('user_email', ownerEmail).select().maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (data) await embedVaultRow(getSupabase(), 'person', data, new Date().toISOString());
  return NextResponse.json({ success: true, entry: data });
}

export async function DELETE(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const ownerEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;
  const { error } = await getSupabase().from('user_team_members')
    .update({ archived_at: new Date().toISOString() }).eq('id', id).eq('user_email', ownerEmail);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

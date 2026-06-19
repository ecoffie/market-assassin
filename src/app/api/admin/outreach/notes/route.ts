/**
 * Outreach Notes — append-only call/email/observation notes per contact.
 *
 * GET    /api/admin/outreach/notes?password=...&contact_id=<uuid>
 *          List notes for a contact, newest first.
 * POST   /api/admin/outreach/notes?password=...
 *          Body: { contact_id, owner?, note_type?, summary?,
 *          what_they_value?, what_confused_them?, what_they_want_added?,
 *          next_action? }
 * DELETE /api/admin/outreach/notes?password=...&id=<uuid>
 *          Hard delete a single note.
 *
 * No PATCH — notes are an audit trail. To revise, post a new note.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const contactId = new URL(request.url).searchParams.get('contact_id');
  if (!contactId) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('internal_outreach_notes')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, notes: data || [] });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
  if (!contactId) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });

  const payload: Record<string, unknown> = { contact_id: contactId };
  for (const key of [
    'owner', 'note_type', 'summary', 'what_they_value', 'what_confused_them',
    'what_they_want_added', 'next_action',
  ]) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('internal_outreach_notes')
    .insert(payload)
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Touch the parent contact's last_contacted_at so the contacts list
  // surfaces freshly-noted rows. Best-effort — don't block the note
  // response if this fails.
  if (payload.note_type === 'call' || payload.note_type === 'email') {
    void supabase
      .from('internal_outreach_contacts')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', contactId)
      .then((res) => {
        if (res.error) console.warn('[outreach/notes] last_contacted_at touch failed:', res.error.message);
      });
  }

  return NextResponse.json({ success: true, note: data });
}

export async function DELETE(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from('internal_outreach_notes').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

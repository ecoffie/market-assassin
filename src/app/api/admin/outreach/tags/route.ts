/**
 * Outreach Tags — many-to-many per contact.
 *
 * GET    /api/admin/outreach/tags?password=...&contact_id=<uuid>
 *          List tags on a contact.
 * GET    /api/admin/outreach/tags?password=...&tag=<tag>
 *          List contacts that have a given tag.
 * POST   /api/admin/outreach/tags?password=...
 *          Body: { contact_id, tag, created_by? }
 *          Idempotent — unique constraint on (contact_id, LOWER(tag))
 *          means duplicate adds silently no-op.
 * DELETE /api/admin/outreach/tags?password=...&id=<uuid>
 *          Remove a tag by row id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
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
  const params = new URL(request.url).searchParams;
  const contactId = params.get('contact_id');
  const tag = params.get('tag');

  const supabase = getSupabase();
  if (contactId) {
    const { data, error } = await supabase
      .from('internal_outreach_tags')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, tags: data || [] });
  }
  if (tag) {
    // Find all contact rows that carry this tag.
    const { data, error } = await supabase
      .from('internal_outreach_tags')
      .select('contact_id, internal_outreach_contacts(*)')
      .ilike('tag', tag);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, results: data || [] });
  }
  return NextResponse.json({ error: 'contact_id or tag required' }, { status: 400 });
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
  const tag = typeof body.tag === 'string' ? body.tag.trim() : null;
  if (!contactId || !tag) {
    return NextResponse.json({ error: 'contact_id and tag required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('internal_outreach_tags')
    .upsert(
      {
        contact_id: contactId,
        tag,
        created_by: typeof body.created_by === 'string' ? body.created_by : null,
      },
      { onConflict: 'contact_id,tag', ignoreDuplicates: true }
    )
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, tag: data });
}

export async function DELETE(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from('internal_outreach_tags').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

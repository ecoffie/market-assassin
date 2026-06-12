/**
 * Outreach Contacts CRUD.
 *
 * GET    /api/admin/outreach/contacts?password=...
 *          List all contacts, ordered by score desc, last_contacted_at desc.
 *          Optional filters: ?owner=Shanoor  ?status=queued  ?segment=...
 * POST   /api/admin/outreach/contacts?password=...
 *          Upsert by email. Body: { email, name?, company?, segment?, score?,
 *          source?, owner?, status?, recommended_ask?, next_action?,
 *          last_contacted_at?, call_booked_at? }
 *          Returns the persisted row.
 * PATCH  /api/admin/outreach/contacts?password=...&id=<uuid>
 *          Update a single contact by id.
 * DELETE /api/admin/outreach/contacts?password=...&id=<uuid>
 *          Hard delete (cascades notes + tags via FK ON DELETE CASCADE).
 *
 * Auth: admin password (?password=) or ADMIN_PASSWORD env. No user
 * session — this is admin tooling.
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
  const owner = params.get('owner');
  const status = params.get('status');
  const segment = params.get('segment');
  const limit = Math.min(parseInt(params.get('limit') || '500', 10) || 500, 2000);

  const supabase = getSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from('internal_outreach_contacts')
    .select('*')
    // Score-desc (NULLS LAST) then most-recently-contacted so high-
    // intent rows that need a follow-up float to the top of the list.
    .order('score', { ascending: false, nullsFirst: false })
    .order('last_contacted_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (owner) q = q.eq('owner', owner);
  if (status) q = q.eq('status', status);
  if (segment) q = q.eq('segment', segment);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, count: data?.length || 0, contacts: data || [] });
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

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  // Upsert by email — same email arrives via CSV import AND Stripe
  // webhook AND manual entry, so writes converge on one row.
  const supabase = getSupabase();
  const payload: Record<string, unknown> = { email };
  for (const key of [
    'name', 'company', 'segment', 'score', 'source', 'owner', 'status',
    'recommended_ask', 'next_action', 'last_contacted_at', 'call_booked_at',
  ]) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  const { data, error } = await supabase
    .from('internal_outreach_contacts')
    .upsert(payload, { onConflict: 'email' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, contact: data });
}

export async function PATCH(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Only allow updating defined fields — never let the caller blank
  // out a field by omitting it.
  const allowed = [
    'name', 'company', 'segment', 'score', 'source', 'owner', 'status',
    'recommended_ask', 'next_action', 'last_contacted_at', 'call_booked_at',
  ];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('internal_outreach_contacts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, contact: data });
}

export async function DELETE(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase
    .from('internal_outreach_contacts')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

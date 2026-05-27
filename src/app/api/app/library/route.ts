/**
 * Auto-library API — browse the user's history of AI outputs.
 *
 * GET /api/app/library?email=&type=&q=&page=
 *   List view, paginated, filterable by content_type and free-text search
 *
 * GET /api/app/library?email=&id=
 *   Fetch one archived entry's full content (the JSONB payload)
 *
 * DELETE /api/app/library?email=&id=
 *   Soft-delete (sets archived_at)
 */

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

const PAGE_SIZE = 25;

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;
  const supabase = getSupabase();

  const id = request.nextUrl.searchParams.get('id');
  // Single-row fetch with full payload
  if (id) {
    const { data, error } = await supabase
      .from('user_generated_archive')
      .select('*')
      .eq('id', id)
      .eq('user_email', userEmail)
      .is('archived_at', null)
      .maybeSingle();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, entry: data });
  }

  // List view
  const type = request.nextUrl.searchParams.get('type') || '';
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  const page = Math.max(0, parseInt(request.nextUrl.searchParams.get('page') || '0', 10) || 0);

  let query = supabase
    .from('user_generated_archive')
    .select('id, content_type, content_subtype, title, agency, naics_code, content_text, source_notice_id, created_at', { count: 'exact' })
    .eq('user_email', userEmail)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (type) query = query.eq('content_type', type);
  if (q && q.length >= 2) {
    // Use ilike for small datasets; switch to FTS RPC if this gets slow
    query = query.or(`title.ilike.%${q}%,content_text.ilike.%${q}%,agency.ilike.%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    page,
    pageSize: PAGE_SIZE,
    total: count || 0,
    entries: data || [],
  });
}

export async function DELETE(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!email || !id) {
    return NextResponse.json({ success: false, error: 'Email and id required' }, { status: 400 });
  }
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { error } = await getSupabase()
    .from('user_generated_archive')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_email', auth.email!);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

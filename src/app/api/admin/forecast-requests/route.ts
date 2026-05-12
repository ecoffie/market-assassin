import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

// GET: List all forecast requests (admin view)
export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get('status') || 'pending';
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

  const query = getSupabase()
    .from('forecast_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status !== 'all') {
    query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Count by status
  const { data: stats } = await getSupabase()
    .from('forecast_requests')
    .select('status')
    .then((result: { data: { status: string }[] | null; error: unknown }) => {
      const counts = { pending: 0, in_progress: 0, fulfilled: 0, declined: 0 };
      (result.data || []).forEach((row: { status: string }) => {
        if (row.status in counts) {
          counts[row.status as keyof typeof counts]++;
        }
      });
      return { data: counts };
    });

  return NextResponse.json({
    success: true,
    requests: data || [],
    counts: stats,
  });
}

// POST: Update forecast request status
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { id, status, adminNotes, fulfilledBy } = body;

  if (!id || !status) {
    return NextResponse.json({
      success: false,
      error: 'Request id and status are required',
    }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    admin_notes: adminNotes || null,
    updated_at: new Date().toISOString(),
  };

  if (status === 'fulfilled') {
    update.fulfilled_at = new Date().toISOString();
    update.fulfilled_by = fulfilledBy || 'admin';
  }

  const { data, error } = await getSupabase()
    .from('forecast_requests')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, request: data });
}

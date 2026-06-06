/**
 * /api/app/pursuit-changes
 *
 * In-app feed of detected changes/amendments on the user's tracked pursuits
 * (written by the pursuit-changes cron). Drives the "⚠️ Amendment" badge on
 * pursuit cards + a "what changed" list.
 *
 * GET ?email=          → unacknowledged changes grouped by pursuit_id.
 * POST { email, pursuit_id? }  → acknowledge (clear badge) for a pursuit, or all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sb(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const { data, error } = await sb()
    .from('pursuit_change_log')
    .select('id, pursuit_id, notice_id, change_type, summary, old_value, new_value, detected_at')
    .eq('user_email', email)
    .eq('acknowledged', false)
    .order('detected_at', { ascending: false });

  if (error) {
    // Table may not exist pre-migration → degrade to empty (no badge), no crash.
    return NextResponse.json({ success: true, byPursuit: {}, total: 0 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byPursuit: Record<string, any[]> = {};
  for (const row of (data || [])) {
    (byPursuit[row.pursuit_id] ||= []).push(row);
  }
  return NextResponse.json({ success: true, byPursuit, total: (data || []).length });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let q = sb().from('pursuit_change_log').update({ acknowledged: true }).eq('user_email', email).eq('acknowledged', false);
  if (body.pursuit_id) q = q.eq('pursuit_id', body.pursuit_id);
  const { error } = await q;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

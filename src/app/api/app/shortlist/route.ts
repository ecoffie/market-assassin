/**
 * Anonymous opportunity shortlist.
 *
 * 2,021 people opened a listing on the Map last month and 53 kept it (2.6%).
 * The listing already explains WHY; `savePursuit` just would not let most of
 * them act — it calls `requireSignIn`, and 96% of map users are anonymous.
 *
 * This route is the anonymous-only path. It never touches a signed-in account's
 * pursuits: `/api/pipeline` is unchanged and still requires its MI session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isAnonId, addToAnonShortlist, claimAnonShortlist, ANON_SHORTLIST_SOURCE,
} from '@/lib/shortlist/anon-shortlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const anonId = typeof body.anonId === 'string' ? body.anonId : '';
  if (!isAnonId(anonId)) {
    // Deliberately NOT a fallback to a signed-in path: a caller with a session
    // should use /api/pipeline, which validates it.
    return NextResponse.json({ success: false, error: 'a well-formed anonId is required' }, { status: 400 });
  }

  if (body.action === 'claim') {
    const email = typeof body.email === 'string' ? body.email : '';
    const r = await claimAnonShortlist(db(), anonId, email);
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
    return NextResponse.json({ success: true, claimed: r.claimed, alreadyTracked: r.alreadyTracked });
  }

  const r = await addToAnonShortlist(db(), {
    anonId,
    noticeId: String(body.noticeId ?? ''),
    title: (body.title as string) ?? null,
    agency: (body.agency as string) ?? null,
    naicsCode: (body.naicsCode as string) ?? null,
    responseDeadline: (body.responseDeadline as string) ?? null,
  });
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
  return NextResponse.json({ success: true, saved: r.saved, duplicate: r.duplicate });
}

export async function GET(request: NextRequest) {
  const anonId = request.nextUrl.searchParams.get('anonId') ?? '';
  if (!isAnonId(anonId)) {
    return NextResponse.json({ success: false, error: 'a well-formed anonId is required' }, { status: 400 });
  }
  const { data, error } = await db()
    .from('user_pipeline')
    .select('notice_id,title,agency,naics_code,response_deadline,created_at')
    .eq('user_email', anonId.trim().toLowerCase())
    .eq('source', ANON_SHORTLIST_SOURCE)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, shortlist: data ?? [] });
}

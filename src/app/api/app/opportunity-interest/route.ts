/**
 * User-facing collaboration signal — "X others are tracking this" (Phase 2, badge).
 *
 * Given a set of notice_ids, returns the ANONYMOUS count of OTHER users tracking
 * each one (user_pipeline). Powers the in-app FOMO badge on opportunities.
 *
 * Rules:
 *  - Anonymous COUNTS only — never names/identities (privacy).
 *  - Excludes the requesting user from the count ("X OTHERS").
 *  - Only returns a count when it's >= MIN_SHOW (don't reveal "you're the only one"
 *    — a "1" badge is worse than no badge). MIN_SHOW is env-tunable.
 *  - User-authed via the MI session (same as other /app routes).
 *
 *   POST { email, noticeIds: string[] } -> { counts: { [noticeId]: number } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Minimum OTHER-trackers before we surface the badge (a lone "1" kills FOMO).
const MIN_SHOW = Number(process.env.COLLAB_BADGE_MIN) || 2;

export async function POST(request: NextRequest) {
  let body: { email?: string; noticeIds?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }); }
  const email = body.email?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const noticeIds = (body.noticeIds || []).filter(Boolean).slice(0, 200);
  if (!noticeIds.length) return NextResponse.json({ counts: {} });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ counts: {} });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Pull active (non-archived) trackers for these notices; count distinct OTHER users.
  const { data, error } = await supabase
    .from('user_pipeline')
    .select('notice_id, user_email')
    .in('notice_id', noticeIds)
    .neq('is_archived', true);
  if (error) return NextResponse.json({ counts: {} });

  const usersByNotice = new Map<string, Set<string>>();
  for (const r of data || []) {
    const u = (r.user_email || '').toLowerCase();
    if (!u || u === email) continue; // exclude the requester → "X OTHERS"
    let s = usersByNotice.get(r.notice_id);
    if (!s) { s = new Set(); usersByNotice.set(r.notice_id, s); }
    s.add(u);
  }

  const counts: Record<string, number> = {};
  for (const [nid, set] of usersByNotice) {
    if (set.size >= MIN_SHOW) counts[nid] = set.size; // only surface meaningful counts
  }

  // --- DEMO SAFETY NET (YT Live) ---------------------------------------
  // If COLLAB_DEMO_NOTICE_ID is set AND that notice is in the requested list,
  // force its badge count so the inline "X others tracking" is guaranteed on
  // screen during the demo. Unset the env after the live to resume real data.
  const demoId = process.env.COLLAB_DEMO_NOTICE_ID;
  if (demoId && noticeIds.includes(demoId)) {
    const demoCount = Number(process.env.COLLAB_DEMO_COUNT) || 7;
    counts[demoId] = Math.max(counts[demoId] || 0, demoCount);
  }
  // ---------------------------------------------------------------------

  return NextResponse.json({ counts }, { headers: { 'Cache-Control': 'no-store' } });
}

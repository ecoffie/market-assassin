/**
 * Anonymous opportunity shortlist — an unauthenticated WRITE endpoint.
 *
 * 2,021 people opened a listing on the Map last month and 53 kept it (2.6%),
 * because `savePursuit` called `requireSignIn` and 96% of map users are not
 * signed in.
 *
 * Three hard rules, each enforced here AND in the database:
 *   1. The client sends only a `noticeId`. It can never supply opportunity
 *      metadata (FK on `sam_opportunities`; nothing else is stored).
 *   2. A row here can never be owned by a real account (CHECK on `anon:` shape).
 *   3. Promotion into a real account's pursuits requires a VERIFIED MI session,
 *      and the account email is DERIVED from it — never read from the body.
 *
 * `/api/pipeline` is untouched.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import {
  isAnonId, addToAnonShortlist, claimAnonShortlist,
  countAnonShortlist, listAnonShortlist, MAX_ANON_SHORTLIST,
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

  const anonId = typeof body.anonId === 'string' ? body.anonId.trim().toLowerCase() : '';
  if (!isAnonId(anonId)) {
    return NextResponse.json({ success: false, error: 'a well-formed anonId is required' }, { status: 400 });
  }

  // ── PROMOTION — requires a VERIFIED session ──────────────────────────────
  // This used to accept an arbitrary `email` and write rows into that account's
  // pursuits. The account is now derived from the signed MI session, so a caller
  // cannot name whose pursuit space they write into.
  if (body.action === 'claim') {
    const session = requireMIAuthSession(request);
    if (!session.ok) return session.response;
    const verifiedEmail = session.session.email;
    if (!verifiedEmail) {
      return NextResponse.json({ success: false, error: 'session carries no account' }, { status: 401 });
    }
    const r = await claimAnonShortlist(db(), anonId, verifiedEmail);
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
    return NextResponse.json({ success: true, promoted: r.promoted, alreadyTracked: r.alreadyTracked });
  }

  // ── Abuse control on an unauthenticated write ────────────────────────────
  const ip = getClientIP(request);
  const perIp = await checkRateLimit(`shortlist:ip:${ip}`, 60, 3600);
  if (!perIp.allowed) return NextResponse.json({ success: false, error: 'rate limit exceeded' }, { status: 429 });
  const perAnon = await checkRateLimit(`shortlist:anon:${anonId}`, 30, 3600);
  if (!perAnon.allowed) return NextResponse.json({ success: false, error: 'rate limit exceeded' }, { status: 429 });

  const held = await countAnonShortlist(db(), anonId);
  // UNKNOWN is not zero: refuse rather than allow an unbounded write.
  if (held == null) {
    return NextResponse.json({ success: false, error: 'could not verify shortlist size' }, { status: 503 });
  }
  if (held >= MAX_ANON_SHORTLIST) {
    return NextResponse.json(
      { success: false, error: `an anonymous visitor may hold at most ${MAX_ANON_SHORTLIST} listings` },
      { status: 429 },
    );
  }

  // ONLY the notice id is accepted from the browser.
  const noticeId = typeof body.noticeId === 'string' ? body.noticeId : '';
  const r = await addToAnonShortlist(db(), anonId, noticeId);
  if (!r.ok) {
    const status = r.error === 'unknown noticeId' ? 404 : 400;
    return NextResponse.json({ success: false, error: r.error }, { status });
  }
  return NextResponse.json({ success: true, saved: r.saved, duplicate: r.duplicate });
}

/**
 * The notice ids this visitor has kept — so the Map can render "✓ Saved" on
 * load instead of making them click Save again to discover it is still there.
 */
export async function GET(request: NextRequest) {
  const anonId = (request.nextUrl.searchParams.get('anonId') ?? '').trim().toLowerCase();
  if (!isAnonId(anonId)) {
    return NextResponse.json({ success: false, error: 'a well-formed anonId is required' }, { status: 400 });
  }
  const ids = await listAnonShortlist(db(), anonId);
  if (ids == null) {
    // A failed read is UNKNOWN — do not report an empty shortlist, which the UI
    // would render as "nothing saved".
    return NextResponse.json({ success: false, error: 'could not read shortlist' }, { status: 503 });
  }
  return NextResponse.json({ success: true, noticeIds: ids });
}

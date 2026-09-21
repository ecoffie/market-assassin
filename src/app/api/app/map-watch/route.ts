/**
 * Map watches for ANONYMOUS visitors — the 96%.
 *
 * `/api/app/saved-searches` requires a verified MI session, which is correct for
 * an account's data. But 8,254 of the 8,583 monthly Opportunity Map users are
 * anonymous, so that endpoint cannot serve the traffic that actually uses the
 * map. This route is the deliberately-narrow anonymous path:
 *
 *   · it accepts a stable `anon:<uuid>` owner, or a verified session email
 *   · an anonymous watch is stored with `alerts_enabled = false` and can never
 *     be emailed (the alert cron filters `.eq('alerts_enabled', true)`)
 *   · it never returns anything but the caller's own rows
 *
 * It does NOT weaken `/api/app/saved-searches`; that route is untouched.
 *
 * ⚠️ Threat model, stated plainly: an anon id is client-supplied, so anyone
 * holding a given uuid can read or write that watch. A watch contains only
 * PUBLIC opportunity filter state (NAICS, agency, viewport) and no PII, and the
 * ids are v4 uuids. That is an accepted trade for letting 96% of the traffic
 * keep something. The moment a real email is attached the row is owned by that
 * email and the anon id no longer resolves it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { isAnonId, watchOwner, saveMapWatch, claimAnonWatch } from '@/lib/map-watch/anon-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Resolve the caller. An EMAIL owner must prove a session; an ANON owner needs
 * only a well-formed id. A caller supplying an email without a session is
 * refused rather than silently downgraded to anonymous — a downgrade would
 * write someone's watch into a stranger's key space.
 */
function resolveOwner(request: NextRequest, email: string | null, anonId: string | null) {
  if (email && email.includes('@')) {
    const session = requireMIAuthSession(request, email);
    if (!session.ok) return { owner: null as string | null, refusal: session.response };
    return { owner: email.trim().toLowerCase(), refusal: null };
  }
  const owner = watchOwner(null, anonId);
  return { owner, refusal: null };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email : null;
  const anonId = typeof body.anonId === 'string' ? body.anonId : null;

  // Upgrade path: attach a real email to anonymous watches and turn alerts on.
  if (body.action === 'claim') {
    if (!anonId || !email) {
      return NextResponse.json({ success: false, error: 'anonId and email are required' }, { status: 400 });
    }
    const r = await claimAnonWatch(db(), anonId, email);
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
    return NextResponse.json({ success: true, claimed: r.claimed, alertsEnabled: r.claimed > 0 });
  }

  const { owner, refusal } = resolveOwner(request, email, anonId);
  if (refusal) return refusal;
  if (!owner) {
    return NextResponse.json(
      { success: false, error: 'a verified email or a well-formed anonId is required' },
      { status: 400 },
    );
  }

  const r = await saveMapWatch(db(), {
    owner,
    mode: typeof body.mode === 'string' ? body.mode : undefined,
    filters: (body.filters as Record<string, unknown>) ?? {},
    bbox: (body.bbox as Record<string, number>) ?? null,
    name: typeof body.name === 'string' ? body.name : null,
  });
  if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 500 });

  return NextResponse.json({
    success: true,
    id: r.id,
    name: r.name,
    alertsEnabled: r.alertsEnabled,
    // The honest next step, so the UI never implies alerts it will not send.
    needsEmailForAlerts: !r.alertsEnabled,
  });
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const anonId = request.nextUrl.searchParams.get('anonId');
  const { owner, refusal } = resolveOwner(request, email, anonId);
  if (refusal) return refusal;
  if (!owner) {
    return NextResponse.json({ success: false, error: 'a verified email or a well-formed anonId is required' }, { status: 400 });
  }

  const { data, error } = await db()
    .from('saved_searches')
    .select('id,name,mode,filters,bbox,alerts_enabled,created_at')
    .eq('user_email', owner)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    anonymous: isAnonId(owner),
    watches: data ?? [],
  });
}

/**
 * /api/app/disa/preview-notices?email=
 *
 * DRY RUN. Returns the exact incumbent notices that WOULD be sent right now —
 * one per vehicle currently due for a stage (6mo/90d/30d) it hasn't been
 * notified at. Sends NOTHING. This is the demo centerpiece: DISA sees the
 * automated notices their manual process would have to type by hand.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { isDue, buildIncumbentNotice, type WatchedVehicle } from '@/lib/disa/vehicle-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const sb = getSupabase();
  const { data, error } = await sb
    .from('disa_watched_vehicles')
    .select('*')
    .eq('org_email', email);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const now = new Date();
  const vehicles = (data || []) as WatchedVehicle[];

  const notices = [];
  for (const v of vehicles) {
    const stage = isDue(v, now);
    if (!stage) continue;
    const notice = buildIncumbentNotice(v, stage, now);
    notices.push({
      vehicle_id: v.id,
      vehicle_piid: v.vehicle_piid,
      incumbent_name: v.incumbent_name,
      stage,
      to: notice.to,
      hasEmail: !!notice.to,
      subject: notice.subject,
      body: notice.body,
    });
  }

  return NextResponse.json({
    success: true,
    dryRun: true,
    wouldSend: notices.filter(n => n.hasEmail).length,
    blockedNoEmail: notices.filter(n => !n.hasEmail).length,
    notices,
  });
}

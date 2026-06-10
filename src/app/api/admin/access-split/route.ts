/**
 * Admin: Access Split — the paid / trial-active / trial-expired / free landscape.
 * Read-only GET. Lets you SEE the entitlement split before flipping MINDY_TRIAL_OPEN.
 *
 * Grounds every count in real data (Supabase user_profiles + the briefings gate).
 * Auth: ?password=<ADMIN_PASSWORD>.
 *
 * PRD-trial-vs-paid-access.md §6.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { isTrialOpen } from '@/lib/access/resolve-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const nowIso = new Date().toISOString();
  const head = { count: 'exact' as const, head: true };
  const n = async (q: PromiseLike<{ count: number | null }>) => (await q).count || 0;

  try {
    const [
      profilesTotal,
      paidBriefings,          // existing Pro gate (access_briefings=true)
      trialActive,            // trial_ends_at in the future
      trialExpired,           // trial_ends_at in the past
      notifAudience,          // total alert audience (the ~9,910)
    ] = await Promise.all([
      n(sb.from('user_profiles').select('*', head)),
      n(sb.from('user_profiles').select('*', head).eq('access_briefings', true)),
      n(sb.from('user_profiles').select('*', head).gt('trial_ends_at', nowIso)),
      n(sb.from('user_profiles').select('*', head).lt('trial_ends_at', nowIso)),
      n(sb.from('user_notification_settings').select('*', head)),
    ]);

    // access_source audit breakdown (sampled — fast)
    const { data: srcRows } = await sb
      .from('user_profiles')
      .select('access_source')
      .limit(2000);
    const sourceBreakdown: Record<string, number> = {};
    for (const r of srcRows || []) {
      const k = r.access_source || '(unset)';
      sourceBreakdown[k] = (sourceBreakdown[k] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      as_of: nowIso,
      trial_switch: isTrialOpen() ? 'OPEN (MINDY_TRIAL_OPEN)' : 'CLOSED',
      profiles: {
        total: profilesTotal,
        paid_pro: paidBriefings,             // permanent Pro (access_briefings)
        trial_active: trialActive,           // Pro via trial (while switch open)
        trial_expired: trialExpired,         // dropped to free
        free: Math.max(0, profilesTotal - paidBriefings - trialActive),
      },
      alert_audience_total: notifAudience,   // the ~9,910 email-only + profiled
      access_source_breakdown: sourceBreakdown,
      note:
        'paid_pro = existing briefings entitlement (the real "they paid" set). ' +
        'trial_active counts only while MINDY_TRIAL_OPEN is open. Email-only users ' +
        '(no profile row) are not counted as profiles — they are the activation backlog.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'query failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

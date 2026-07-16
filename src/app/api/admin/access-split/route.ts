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
import { getCountClient } from '@/lib/supabase/server-clients';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { isTrialOpen } from '@/lib/access/resolve-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // PRIMARY, not the replica: this route is almost entirely head-counts (the `head`
  // const below is reused 6×), and the replica 400s every HEAD request. Combined
  // with `n()` doing `.count || 0`, every number on this page was silently 0.
  // The one row read here is a limit(2000) sample — nothing worth offloading.
  return getCountClient();
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
      paidColumn,             // user_profiles.access_briefings=true (column-only mirror — UNDERCOUNTS)
      briefingsEnabled,       // user_notification_settings.briefings_enabled+active = the REAL current Pro audience
      trialActive,            // trial_ends_at in the future
      trialExpired,           // trial_ends_at in the past
      notifAudience,          // total alert audience (the ~9,910)
    ] = await Promise.all([
      n(sb.from('user_profiles').select('*', head)),
      n(sb.from('user_profiles').select('*', head).eq('access_briefings', true)),
      n(sb.from('user_notification_settings').select('*', head).eq('briefings_enabled', true).eq('is_active', true)),
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
      // THE REAL PAID SET = briefings_enabled+active (matches the dashboard ~749/481).
      // KV `briefings:` is the runtime gate; access_briefings column is a partial mirror
      // that UNDERCOUNTS (only ~26). NEVER seed a trial to a briefings_enabled user —
      // they are a past/current MI Pro payer (would wrongly get a trial then a downgrade).
      paid_pro_real: briefingsEnabled,
      paid_pro_column_only: paidColumn,      // the under-counting mirror (diagnostic)
      profiles: {
        total: profilesTotal,
        trial_active: trialActive,           // Pro via trial (while switch open)
        trial_expired: trialExpired,         // dropped to free
      },
      seeding_safety: {
        do_not_trial: briefingsEnabled,      // exclude these from any trial seeding
        rule: 'Trials go ONLY to users who are NOT briefings_enabled AND fail the KV gate.',
      },
      alert_audience_total: notifAudience,   // the ~9,910 email-only + profiled
      access_source_breakdown: sourceBreakdown,
      note:
        'paid_pro_real = briefings_enabled+active (the real current MI Pro audience; KV is the runtime gate). ' +
        'paid_pro_column_only is the under-counting Supabase mirror — do not seed off it. ' +
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

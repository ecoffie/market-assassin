import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * GET /api/admin/beta-conversion?password=...
 *
 * The beta-user conversion funnel for the Launch Command Center. Mirrors the
 * setup-invite-batch cron's selection logic so the dashboard shows the SAME
 * numbers the sender uses — no drift:
 *
 *   entitled  → users with access who SHOULD set up an account
 *   converted → entitled users who now have a real Supabase auth login
 *   invited   → entitled+no-login who already got the setup email
 *   remaining → entitled+no-login+not-invited (the live send queue)
 *
 * Plus a 14-day setup-invite send trend from email_provider_sends.
 *
 * Read-only. No BigQuery (Supabase + Auth admin only).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const COMP_TESTIMONIAL = new Set([
  'aj@cypherintel.com', 'pa.joof@pjaygroup.com', 'dare2dreaminc615@gmail.com',
  'olga@olaexecutiveconsulting.com', 'tavinalford@gmail.com',
]);

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function norm(e: unknown): string {
  return typeof e === 'string' ? e.toLowerCase().trim() : '';
}

async function fetchAllRows<T>(supabase: SupabaseClient, table: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 60000; from += PAGE) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (error) break;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchAuthEmails(supabase: SupabaseClient): Promise<Set<string>> {
  const emails = new Set<string>();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data?.users || []) {
      const e = norm(u.email);
      if (e) emails.add(e);
    }
    if ((data?.users || []).length < 1000) break;
  }
  return emails;
}

async function fetchEntitledEmails(supabase: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  const now = Date.now();

  const classifications = await fetchAllRows<{ email?: string; briefings_access?: string; briefings_expiry?: string }>(
    supabase, 'customer_classifications', 'email, briefings_access, briefings_expiry',
  );
  const entitledAccess = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
  for (const r of classifications) {
    const e = norm(r.email);
    if (!e || !entitledAccess.has(r.briefings_access || '')) continue;
    if (r.briefings_expiry && new Date(r.briefings_expiry).getTime() <= now) continue;
    out.add(e);
  }

  const profiles = await fetchAllRows<Record<string, unknown> & { email?: string }>(
    supabase, 'user_profiles',
    'email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings',
  );
  const ACCESS_FLAGS = ['access_hunter_pro', 'access_assassin_standard', 'access_assassin_premium', 'access_recompete', 'access_contractor_db', 'access_content_standard', 'access_content_full_fix', 'access_briefings'];
  for (const r of profiles) {
    const e = norm(r.email);
    if (!e) continue;
    if (ACCESS_FLAGS.some((f) => r[f] === true)) out.add(e);
  }

  // IMPORTANT: only briefings_enabled users count as entitled — this MUST match
  // the setup-invite cron's filter. Counting every notification-settings row
  // (the whole free daily-alert base, ~10k) inflated the denominator 13× and
  // made conversion read 2.8% instead of the real rate.
  const notif = await fetchAllRows<{ user_email?: string; briefings_enabled?: boolean }>(
    supabase, 'user_notification_settings', 'user_email, briefings_enabled',
  );
  for (const r of notif) {
    const e = norm(r.user_email);
    if (e && r.briefings_enabled === true) out.add(e);
  }

  return out;
}

/** Setup-invite sends from email_provider_sends, with a 14-day daily trend. */
async function fetchInviteSends(supabase: SupabaseClient): Promise<{ invited: Set<string>; trend: Array<{ date: string; count: number }> }> {
  const invited = new Set<string>();
  const byDay = new Map<string, number>();
  try {
    const rows = await fetchAllRows<{ user_email?: string; email_type?: string; sent_at?: string }>(
      supabase, 'email_provider_sends', 'user_email, email_type, sent_at',
    );
    for (const r of rows) {
      if (r.email_type !== 'mi_account_setup') continue;
      const e = norm(r.user_email);
      if (e) invited.add(e);
      if (r.sent_at) {
        const day = r.sent_at.slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + 1);
      }
    }
  } catch { /* table shape may differ — treat as none */ }
  const trend = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([date, count]) => ({ date, count }));
  return { invited, trend };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = sb();
    const [entitled, authEmails, sends] = await Promise.all([
      fetchEntitledEmails(supabase),
      fetchAuthEmails(supabase),
      fetchInviteSends(supabase),
    ]);

    let converted = 0;
    let invitedPending = 0; // invited, still no login
    let remaining = 0;      // entitled, no login, not invited
    for (const e of entitled) {
      if (COMP_TESTIMONIAL.has(e)) continue;
      if (authEmails.has(e)) { converted++; continue; }
      if (sends.invited.has(e)) { invitedPending++; continue; }
      remaining++;
    }

    const entitledTotal = [...entitled].filter((e) => !COMP_TESTIMONIAL.has(e)).length;
    const conversionRate = entitledTotal > 0 ? Math.round((converted / entitledTotal) * 1000) / 10 : 0;
    const PER_DAY = 150; // setup-invite send rate: 75 @ 14:00 + 75 @ 21:00 UTC
    const daysToDrain = Math.ceil(remaining / PER_DAY);

    return NextResponse.json({
      success: true,
      entitledTotal,
      converted,
      conversionRate,        // % of entitled who now have a login
      invitedPending,        // got the email, haven't set up yet
      remaining,             // still in the send queue
      perDay: PER_DAY,
      daysToDrain,
      sendTrend: sends.trend, // last 14 days of setup-invite sends
    });
  } catch (err) {
    console.error('[beta-conversion] error', err);
    return NextResponse.json({ success: false, error: 'Failed to compute funnel' }, { status: 500 });
  }
}

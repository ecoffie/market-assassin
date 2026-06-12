import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { UPGRADE_DRIP, dripForDay } from '@/lib/mindy/upgrade-drip';
import { isCampaignExcludedEmail } from '@/lib/mindy/campaign-exclusions';

/**
 * GET /api/cron/upgrade-drip
 *
 * Free→paid nurture drip. For each FREE user (briefings_enabled = false), sends
 * the day-1/3/7/14 value-first email when their signup age hits that exact day.
 * Deduped per (email, emailType) via email_provider_sends, so each email fires
 * once. Dispatcher-fired (cron_jobs row), not vercel.json.
 *
 * Value-first voice (not feature tour) — see src/lib/mindy/upgrade-drip.ts.
 * Marketing emailType → respects the global daily cap + suppression (a free user
 * won't get drip stacked on top of alerts).
 *
 * Modes:
 *   ?mode=preview (default) → who WOULD get which email today, no sends.
 *   ?mode=execute           → send.
 *   ?limit=N                → cap sends this run (default 200).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const CHECKOUT_URL = 'https://getmindy.ai/checkout/mindy-pro-monthly?utm_source=email&utm_medium=upgrade_drip';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function norm(e: unknown): string {
  return typeof e === 'string' ? e.toLowerCase().trim() : '';
}

function daysBetween(fromIso: string, now: number): number {
  const then = new Date(fromIso).getTime();
  if (Number.isNaN(then)) return -1;
  return Math.floor((now - then) / (24 * 60 * 60 * 1000));
}

interface NotifRow {
  user_email?: string;
  briefings_enabled?: boolean;
  created_at?: string | null;
  full_name?: string | null;
  first_name?: string | null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  const authed = password === ADMIN_PASSWORD || (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) || isDispatch;
  if (!authed) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const execute = url.searchParams.get('mode') === 'execute';
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));
  const supabase = sb();
  const now = Date.now();

  // 1) FREE users with a signup date (page past the 1000 cap).
  const freeUsers: NotifRow[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, briefings_enabled, created_at, full_name, first_name')
      .range(from, from + 999);
    if (error) break;
    for (const r of (data || []) as NotifRow[]) {
      if (r.briefings_enabled === true) continue;       // PRO — skip
      if (!r.created_at) continue;                       // no signup date → can't time it
      const e = norm(r.user_email);
      if (!e || isCampaignExcludedEmail(e)) continue;
      freeUsers.push(r);
    }
    if (!data || data.length < 1000) break;
  }

  // 2) Already-sent drip emails (dedup) — by (email, email_type).
  const sentKey = new Set<string>();
  const dripTypes = new Set(UPGRADE_DRIP.map((d) => d.emailType));
  for (let from = 0; from < 120000; from += 1000) {
    const { data, error } = await supabase
      .from('email_provider_sends')
      .select('user_email, email_type')
      .in('email_type', [...dripTypes])
      .range(from, from + 999);
    if (error) break;
    for (const r of (data || []) as Array<{ user_email?: string; email_type?: string }>) {
      sentKey.add(`${norm(r.user_email)}|${r.email_type}`);
    }
    if (!data || data.length < 1000) break;
  }

  // 3) Build the send queue: each free user whose signup age == a drip day AND
  //    who hasn't gotten that email yet.
  const queue: Array<{ email: string; first: string; day: number; emailType: string; subject: string; html: string }> = [];
  for (const u of freeUsers) {
    const e = norm(u.user_email);
    const age = daysBetween(u.created_at!, now);
    const drip = dripForDay(age);
    if (!drip) continue;
    if (sentKey.has(`${e}|${drip.emailType}`)) continue;
    const first = (u.first_name || u.full_name || '').toString().trim().split(' ')[0] || '';
    queue.push({
      email: e,
      first,
      day: drip.day,
      emailType: drip.emailType,
      subject: drip.subject,
      html: drip.html(first, CHECKOUT_URL),
    });
  }

  const slice = queue.slice(0, limit);

  if (!execute) {
    const byDay: Record<number, number> = {};
    for (const q of queue) byDay[q.day] = (byDay[q.day] || 0) + 1;
    return NextResponse.json({
      success: true,
      mode: 'preview',
      freeUsers: freeUsers.length,
      dueThisRun: queue.length,
      byDay,
      wouldSend: slice.length,
      sample: slice.slice(0, 10).map((q) => ({ email: q.email, day: q.day, subject: q.subject })),
    });
  }

  // 4) EXECUTE — send, spacing slightly so we don't hammer Resend.
  let sent = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const q of slice) {
    try {
      // sendEmail returns a plain boolean (true sent / false blocked-or-failed).
      const ok = await sendEmail({ to: q.email, subject: q.subject, html: q.html, emailType: q.emailType });
      if (ok) sent++;
      else failures.push({ email: q.email, error: 'blocked or failed (cap/suppression/provider)' });
    } catch (err) {
      failures.push({ email: q.email, error: err instanceof Error ? err.message : 'send failed' });
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    sent,
    failed: failures.length,
    dueRemaining: Math.max(0, queue.length - sent),
    failures: failures.slice(0, 10),
  });
}

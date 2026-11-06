/**
 * /api/cron/send-mobile-push — "N new opportunities" push for users of the Mindy app.
 *
 * Deliberately a SEPARATE job from daily-alerts: nothing here can slow or crash the email
 * send loop (the May 28–31 Mindy Insights incident). It reads what daily-alerts already
 * DELIVERED today (alert_log, alert_type='daily', delivery_status='sent', count > 0) and
 * pushes to those users' registered devices (mobile_push_tokens).
 *
 * Exactly-once per user/day: a mobile_push_log row is inserted as a CLAIM before sending
 * (unique user_email+push_date+push_type); a re-run skips anyone already claimed.
 *
 * Gates: MOBILE_PUSH_ENABLED='true' and at least one provider configured (APNs / FCM).
 * Schedule: cron_jobs row `send-mobile-push`, after the daily-alerts window.
 * Auth: dispatcher `Bearer $CRON_SECRET`, Vercel cron header, or ?password=ADMIN_PASSWORD.
 * `?preview=1` reports who would be pushed without sending or claiming.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { fetchAllPaged } from '@/lib/supabase/paged-read';
import { reportCronOutcome } from '@/lib/cron-self-report';
import { pushProvidersConfigured, sendPushToDevices, type DeviceRow } from '@/lib/push/send';
import { dailyAlertMessage } from '@/lib/push/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JOB = 'send-mobile-push';
const PUSH_TYPE = 'daily_alert';
const BUDGET_MS = 90_000;

type TokenRow = { user_email: string; token: string; platform: 'ios' | 'android' };
type AlertRow = { user_email: string; opportunities_count: number | null };

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const hasSecret = !!process.env.CRON_SECRET
    && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = !!process.env.ADMIN_PASSWORD
    && request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !isAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (process.env.MOBILE_PUSH_ENABLED !== 'true') {
    return NextResponse.json({ success: true, skipped: true, reason: 'MOBILE_PUSH_ENABLED is not true' });
  }
  const providers = pushProvidersConfigured();
  if (!providers.ios && !providers.android) {
    await reportCronOutcome(JOB, 'error', 'no push provider configured (APNS_* / FCM_SERVICE_ACCOUNT_JSON)');
    return NextResponse.json({ success: false, error: 'no push provider configured', providers }, { status: 500 });
  }

  const started = Date.now();
  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const date = request.nextUrl.searchParams.get('date') || new Date().toISOString().split('T')[0];
  const db = getWriteClient();

  try {
    // 1. Every active device, grouped by user.
    const tokens = await fetchAllPaged<TokenRow>(() =>
      db.from('mobile_push_tokens').select('user_email, token, platform').is('disabled_at', null).order('id'));
    const devicesByEmail = new Map<string, DeviceRow[]>();
    for (const t of tokens) {
      const list = devicesByEmail.get(t.user_email) || [];
      list.push({ token: t.token, platform: t.platform });
      devicesByEmail.set(t.user_email, list);
    }
    const emails = [...devicesByEmail.keys()];

    // 2. Who among them got a non-empty daily alert today, and who was already pushed.
    const delivered = new Map<string, number>();
    const done = new Set<string>();
    for (let i = 0; i < emails.length; i += 200) {
      const chunk = emails.slice(i, i + 200);
      const { data: alerts, error: alertErr } = await db
        .from('alert_log')
        .select('user_email, opportunities_count')
        .eq('alert_date', date)
        .eq('alert_type', 'daily')
        .eq('delivery_status', 'sent')
        .in('user_email', chunk);
      if (alertErr) throw new Error(`alert_log read failed: ${alertErr.message}`);
      for (const a of (alerts || []) as AlertRow[]) {
        const n = Number(a.opportunities_count);
        if (Number.isFinite(n) && n > 0) delivered.set(a.user_email, n);
      }
      const { data: logs, error: logErr } = await db
        .from('mobile_push_log')
        .select('user_email')
        .eq('push_date', date)
        .eq('push_type', PUSH_TYPE)
        .in('user_email', chunk);
      if (logErr) throw new Error(`mobile_push_log read failed: ${logErr.message}`);
      for (const l of logs || []) done.add((l as { user_email: string }).user_email);
    }

    const pending = [...delivered.entries()].filter(([email]) => !done.has(email));
    if (preview) {
      return NextResponse.json({
        success: true, preview: true, date, providers,
        devices: tokens.length, usersWithDevices: emails.length,
        alertedToday: delivered.size, alreadyPushed: done.size, wouldPush: pending.length,
      });
    }

    let pushed = 0, failedUsers = 0, sentDevices = 0, disabled = 0, outOfBudget = 0;
    const sampleErrors: string[] = [];
    for (const [email, count] of pending) {
      if (Date.now() - started > BUDGET_MS) { outOfBudget = pending.length - pushed - failedUsers; break; }

      // Claim first — a duplicate (another run got here) is a skip, not an error.
      const { error: claimErr } = await db.from('mobile_push_log')
        .insert({ user_email: email, push_date: date, push_type: PUSH_TYPE, status: 'claimed' });
      if (claimErr) {
        if (claimErr.code === '23505') continue;
        throw new Error(`claim failed: ${claimErr.message}`);
      }

      const outcome = await sendPushToDevices(db, devicesByEmail.get(email) || [], dailyAlertMessage(count));
      sentDevices += outcome.sent;
      disabled += outcome.disabled;
      const status = outcome.devices === 0 ? 'no_device' : outcome.sent > 0 ? 'sent' : 'failed';
      if (status === 'sent') pushed++; else failedUsers++;
      if (outcome.errors.length && sampleErrors.length < 5) sampleErrors.push(...outcome.errors.slice(0, 5 - sampleErrors.length));

      const { error: updErr } = await db.from('mobile_push_log')
        .update({ status, sent_count: outcome.sent, error: outcome.errors[0] || null })
        .eq('user_email', email).eq('push_date', date).eq('push_type', PUSH_TYPE);
      if (updErr) console.error('[send-mobile-push] status update failed', updErr.message);
    }

    const summary = {
      success: true, date, providers, pending: pending.length,
      pushedUsers: pushed, failedUsers, sentDevices, disabledTokens: disabled,
      remaining: outOfBudget, sampleErrors, ms: Date.now() - started,
    };
    await reportCronOutcome(JOB, failedUsers > 0 || outOfBudget > 0 ? 'partial' : 'success',
      failedUsers > 0 ? `${failedUsers} users failed: ${sampleErrors[0] || ''}` : undefined);
    return NextResponse.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await reportCronOutcome(JOB, 'error', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

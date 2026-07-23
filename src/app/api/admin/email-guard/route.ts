/**
 * /api/admin/email-guard — manage the email send guard (#58) + delivery health.
 *
 * GET  ?password=&email=<addr>  → that user's send volume (last 7d) + settings +
 *                                  suppression status. Diagnose "too many emails".
 * GET  ?password=                → top recipients by 24h volume + all suppressions
 *                                  + a `deliveryHealth` block (bounce/complaint rate
 *                                  from email_provider_events, last 7d). The monitor
 *                                  for "are alerts actually landing" — added Jul 23
 *                                  after the 3-mo dead-webhook blind spot. Only
 *                                  meaningful once the Resend webhook is live.
 * POST { action:'suppress', email, reason }   → add to suppression list
 * POST { action:'unsuppress', email }          → remove (re-enable email)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: NextRequest): boolean {
  const pw = req.nextUrl.searchParams.get('password');
  return pw === (process.env.ADMIN_PASSWORD);
}
function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sb();
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim();

  if (email) {
    // One user's email footprint.
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: sends, error: sendsErr } = await db.from('email_provider_sends')
      .select('email_type, event_source, subject, sent_at, status')
      .eq('user_email', email).gte('sent_at', since).order('sent_at', { ascending: false });
    const { data: supp, error: suppErr } = await db.from('email_suppressions').select('reason, source, created_at').eq('user_email', email).maybeSingle();
    const { data: settings, error: settingsErr } = await db.from('user_notification_settings').select('alert_frequency, unsubscribed').eq('user_email', email).maybeSingle();
    // Surface a query error rather than returning a misleading clean/empty footprint
    // (a bad/renamed column fails the WHOLE PostgREST query → data=null silently).
    const footprintErr = sendsErr || suppErr || settingsErr;
    if (footprintErr) {
      return NextResponse.json({ success: false, error: footprintErr.message }, { status: 500 });
    }
    // Per-day tally
    const byDay: Record<string, number> = {};
    for (const s of sends || []) { const d = String(s.sent_at).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
    return NextResponse.json({
      success: true, email,
      suppressed: !!supp, suppression: supp || null,
      alert_frequency: settings?.alert_frequency || null, unsubscribed: settings?.unsubscribed || false,
      sends7d: (sends || []).length, byDay, recent: (sends || []).slice(0, 20),
    });
  }

  // Overview: who's getting the most email + all suppressions.
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { data: recent } = await db.from('email_provider_sends').select('user_email').gte('sent_at', since);
  const counts: Record<string, number> = {};
  for (const r of recent || []) counts[r.user_email] = (counts[r.user_email] || 0) + 1;
  const topRecipients = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([email, count]) => ({ email, count }));
  const overCap = topRecipients.filter(r => r.count > Number(process.env.EMAIL_DAILY_CAP || 3));
  const { data: suppressions } = await db.from('email_suppressions').select('*').order('created_at', { ascending: false });

  // Delivery health (last 7d, from Resend webhook events). This is the monitor for
  // "are alerts actually landing" — the answer we were blind to for 3 months while
  // the webhook pointed at a dead domain. A bounce/complaint RATE is the signal;
  // raw counts alone don't tell you if a domain's reputation is degrading.
  const eventsSince = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: events, error: eventsErr } = await db
    .from('email_provider_events')
    .select('event_type, user_email, email_type, occurred_at')
    .gte('occurred_at', eventsSince)
    .order('occurred_at', { ascending: false });

  let deliveryHealth: Record<string, unknown>;
  if (eventsErr) {
    // Surface the error — never fabricate a clean 0 (a null/empty here could mean
    // the webhook is dead again, which is exactly the failure we're monitoring for).
    deliveryHealth = { ok: false, error: eventsErr.message };
  } else {
    const rows = events || [];
    const byType: Record<string, number> = {};
    for (const e of rows) {
      const t = String(e.event_type || 'unknown').replace(/^email\./, '');
      byType[t] = (byType[t] || 0) + 1;
    }
    const delivered = byType.delivered || 0;
    const bounced = byType.bounced || 0;
    const complained = byType.complained || 0;
    // Denominator = things that reached a terminal delivered/bounced state.
    const terminal = delivered + bounced;
    const bounceRate = terminal > 0 ? +(bounced / terminal * 100).toFixed(2) : null;
    const complaintRate = delivered > 0 ? +(complained / delivered * 100).toFixed(3) : null;
    // The addresses to actually look at. Real bounces/complaints on real users are
    // the definitive read (health-check @test.govcongiants.org bounces are expected).
    const problems = rows
      .filter(e => e.event_type === 'email.bounced' || e.event_type === 'email.complained')
      .filter(e => !String(e.user_email || '').includes('@test.govcongiants'))
      .slice(0, 40)
      .map(e => ({
        email: e.user_email,
        type: String(e.event_type).replace(/^email\./, ''),
        emailType: e.email_type,
        at: e.occurred_at,
      }));
    deliveryHealth = {
      ok: true,
      windowDays: 7,
      webhookLive: rows.length > 0,     // 0 events in 7d = webhook likely dead/unregistered
      totalEvents: rows.length,
      byType,
      delivered,
      bounced,
      complained,
      bounceRatePct: bounceRate,        // industry alarm line ≈ >2-5%
      complaintRatePct: complaintRate,  // industry alarm line ≈ >0.1%
      problems,                         // real-user bounces/complaints (test addrs excluded)
      problemCount: problems.length,
    };
  }

  return NextResponse.json({
    success: true,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP || 3),
    sent24h: (recent || []).length,
    topRecipients,
    overCapCount: overCap.length,
    overCap,
    suppressions: suppressions || [],
    deliveryHealth,
  });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = sb();
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  if (action === 'suppress') {
    const { error } = await db.from('email_suppressions').upsert({
      user_email: email, reason: body.reason || 'manual', source: 'admin',
    }, { onConflict: 'user_email' });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, suppressed: email });
  }
  if (action === 'unsuppress') {
    const { error } = await db.from('email_suppressions').delete().eq('user_email', email);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, unsuppressed: email });
  }
  return NextResponse.json({ success: false, error: 'unknown action (use suppress|unsuppress)' }, { status: 400 });
}

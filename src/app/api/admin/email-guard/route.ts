/**
 * /api/admin/email-guard — manage the email send guard (#58).
 *
 * GET  ?password=&email=<addr>  → that user's send volume (last 7d) + settings +
 *                                  suppression status. Diagnose "too many emails".
 * GET  ?password=                → top recipients by 24h volume + all suppressions.
 * POST { action:'suppress', email, reason }   → add to suppression list
 * POST { action:'unsuppress', email }          → remove (re-enable email)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: NextRequest): boolean {
  const pw = req.nextUrl.searchParams.get('password');
  return pw === (process.env.ADMIN_PASSWORD || 'galata-assassin-2026');
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
    const { data: sends } = await db.from('email_provider_sends')
      .select('email_type, event_source, subject, sent_at, status')
      .eq('user_email', email).gte('sent_at', since).order('sent_at', { ascending: false });
    const { data: supp } = await db.from('email_suppressions').select('reason, source, created_at').eq('user_email', email).maybeSingle();
    const { data: settings } = await db.from('user_notification_settings').select('alert_frequency, unsubscribed').eq('user_email', email).maybeSingle();
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
  return NextResponse.json({
    success: true,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP || 3),
    sent24h: (recent || []).length,
    topRecipients,
    overCapCount: overCap.length,
    overCap,
    suppressions: suppressions || [],
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

/**
 * POST /api/mindy-launch/send-reminder
 *
 * Sends a single June 27 Mindy Launch DAY-OF reminder through the guarded Mindy
 * sendEmail() path — Resend from the VERIFIED mail.getmindy.ai domain (same sender
 * as the confirmation), so it lands in the inbox. The funnels reminder cron
 * (govcongiants.com /api/cron/mindy-day-reminders) calls this per recipient instead
 * of sending from the unverified alerts@govcongiants.com path.
 *
 * Auth: shared secret. Accepts Authorization: Bearer <CRON_SECRET> OR
 * ?password=<ADMIN_PASSWORD>. Without it → 401.
 *
 * Body: { email, name?, variant? }  (variant: 'reminder' | 'live')
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendMindyLaunchReminderEmail } from '@/lib/mindy/launch-reminder-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const authorized =
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) ||
    (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { email?: string; name?: string; variant?: 'reminder' | 'live' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const email = body.email?.trim();
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  try {
    const ok = await sendMindyLaunchReminderEmail({
      to: email,
      name: body.name?.trim() || '',
      variant: body.variant === 'live' ? 'live' : 'reminder',
    });
    return NextResponse.json({ ok });
  } catch (err) {
    console.error('[mindy-launch/send-reminder] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'send failed' },
      { status: 500 },
    );
  }
}

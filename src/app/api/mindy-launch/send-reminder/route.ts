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
import { sendMindyLaunchLifetimeEmail } from '@/lib/mindy/launch-lifetime-email';
import { sendMindyApexOfferEmail } from '@/lib/mindy/apex-offer-email';

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

  let body: {
    email?: string;
    name?: string;
    variant?: 'reminder' | 'live' | 'lifetime' | 'apex-offer';
    phase?: 'deal' | 'lastcall' | 'extension' | 'finalclose';
  };
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
    const name = body.name?.trim() || '';
    // 'lifetime' = the POST-webinar Founders Lifetime offer (pricing). The pre-event
    // 'reminder'/'live' variants never carry pricing.
    const ok =
      body.variant === 'apex-offer'
        ? await sendMindyApexOfferEmail({ to: email, name })
        : body.variant === 'lifetime'
        ? await sendMindyLaunchLifetimeEmail({ to: email, name, phase: body.phase ?? 'deal' })
        : await sendMindyLaunchReminderEmail({ to: email, name, variant: body.variant === 'live' ? 'live' : 'reminder' });
    return NextResponse.json({ ok });
  } catch (err) {
    console.error('[mindy-launch/send-reminder] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'send failed' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/mindy-launch/send-confirmation
 *
 * Sends the July 25 Mindy Free Live Launch confirmation (save-the-date) through the
 * guarded Mindy sendEmail() path — Resend → Office365 as alerts@govcongiants.com,
 * with suppression + deliverability tracking. This is the SEND owner; govcongiants.com
 * funnels (/api/lead, source=mindy-launch) calls it after recording the signup.
 *
 * Auth: shared secret. Accepts Authorization: Bearer <CRON_SECRET> OR
 * ?password=<ADMIN_PASSWORD>. Without it → 401.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendMindyLaunchConfirmationEmail } from '@/lib/mindy/launch-confirmation-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // --- auth ---
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const authorized =
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) ||
    (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- payload ---
  let body: { email?: string; name?: string; getsZoom?: boolean };
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
    const ok = await sendMindyLaunchConfirmationEmail({
      to: email,
      name: body.name?.trim() || '',
      getsZoom: body.getsZoom,
    });
    return NextResponse.json({ ok });
  } catch (err) {
    console.error('[mindy-launch/send-confirmation] failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'send failed' },
      { status: 500 },
    );
  }
}

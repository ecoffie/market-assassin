/**
 * POST /api/mindy-launch/send-confirmation
 *
 * Sends the Mindy Free Live Launch confirmation (save-the-date) through the
 * guarded Mindy sendEmail() path — Resend → Office365 as alerts@govcongiants.com,
 * with suppression + deliverability tracking. This is the SEND owner; govcongiants.com
 * funnels (/api/lead, source=mindy-launch) calls it after recording the signup.
 *
 * Auth: shared secret. Accepts Authorization: Bearer <CRON_SECRET> OR
 * ?password=<ADMIN_PASSWORD>. Without it → 401.
 *
 * Response contract — the caller must read `status`, never infer a send from the
 * HTTP code alone (this used to answer 200 `{ ok: false }` for a blocked send):
 *   200 { ok: true,  status: 'accepted', provider, providerMessageId }  a provider accepted it
 *   422 { ok: false, status: 'blocked', reason }                         guard stopped it; nothing sent
 *   502 { ok: false, status: 'failed', error }                           both providers failed; nothing sent
 *   500 { ok: false, status: 'unconfirmed' }                             outcome unknown
 * Acceptance is not delivery. Each request sends at most one email, and there is no
 * idempotency store, so a caller must NOT retry a request whose outcome it didn't see.
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

  let outcome;
  try {
    outcome = await sendMindyLaunchConfirmationEmail({
      to: email,
      name: body.name?.trim() || '',
      getsZoom: body.getsZoom,
    });
  } catch (err) {
    console.error('[mindy-launch/send-confirmation] failed:', err);
    return NextResponse.json(
      { ok: false, status: 'failed', error: err instanceof Error ? err.message : 'send failed' },
      { status: 502 },
    );
  }
  if (outcome.status === 'accepted') {
    return NextResponse.json({ ok: true, ...outcome });
  }
  if (outcome.status === 'blocked') {
    console.error('[mindy-launch/send-confirmation] blocked:', outcome.reason);
    return NextResponse.json({ ok: false, ...outcome }, { status: 422 });
  }
  console.error('[mindy-launch/send-confirmation] provider accepted but did not report which one');
  return NextResponse.json({ ok: false, status: 'unconfirmed' }, { status: 500 });
}

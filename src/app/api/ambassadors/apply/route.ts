import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { parseAmbassadorApplication, notifySlackOfApplication } from '@/lib/ambassadors/application';
import { saveApplication } from '@/lib/ambassadors/store';
import { sendApplicationReceivedEmail } from '@/lib/ambassadors/emails';

export const dynamic = 'force-dynamic';

/** POST /api/ambassadors/apply — the public Mindy Ambassadors application (getmindy.ai/ambassadors). */
export async function POST(request: Request) {
  const ip = getClientIP(request);
  const rl = await checkRateLimit(`ambassador-apply:${ip}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: 'Too many applications from this connection. Please email admin@getmindy.ai.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  // Honeypot: bots fill the hidden "website2" field. Pretend success, store nothing.
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).website2 === 'string' && (body as Record<string, string>).website2.trim()) {
    return NextResponse.json({ success: true, message: 'Received' });
  }

  const parsed = parseAmbassadorApplication(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: 'Please fill in the highlighted fields.', errors: parsed.errors }, { status: 400 });
  }

  let saved: { status: 'saved' | 'already_ambassador' };
  try {
    saved = await saveApplication(parsed.app);
  } catch (err) {
    console.error('[ambassadors/apply] not saved:', (err as Error).message, parsed.app.email);
    return NextResponse.json(
      { success: false, message: 'We could not save your application right now. Please try again, or email admin@getmindy.ai.' },
      { status: 502 },
    );
  }
  if (saved.status === 'already_ambassador') {
    return NextResponse.json({ success: true, alreadyAmbassador: true, message: 'You are already a Mindy Ambassador.' });
  }

  // Saved: the notification and the confirmation email are best effort and never fail the request.
  await Promise.all([notifySlackOfApplication(parsed.app), sendApplicationReceivedEmail(parsed.app.email, parsed.app.name)]);
  return NextResponse.json({ success: true, message: 'Received' });
}

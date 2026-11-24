import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { deliverSupportRequest, parseSupportRequest, SUPPORT_INBOX_DEFAULT } from '@/lib/support/support-request';

export const dynamic = 'force-dynamic';

const FALLBACK = `We could not send your message right now. Please email ${SUPPORT_INBOX_DEFAULT} and we will reply quickly.`;

/** POST /api/support — the "Get help" widget and /support page. Delivers to the Mindy team. */
export async function POST(request: Request) {
  const ip = getClientIP(request);
  const rl = await checkRateLimit(`support:${ip}`, 8, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: `Too many requests. Please email ${SUPPORT_INBOX_DEFAULT}.` }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  // Honeypot: bots fill the hidden "website" field. Pretend success, send nothing.
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).website === 'string' && (body as Record<string, string>).website.trim()) {
    return NextResponse.json({ success: true, message: 'Sent' });
  }

  const parsed = parseSupportRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: 'Please fill in the highlighted fields.', errors: parsed.errors }, { status: 400 });
  }

  const sent = await deliverSupportRequest(parsed.input);
  if (!sent.ok) {
    console.error('[support] not delivered:', sent.error);
    return NextResponse.json({ success: false, message: FALLBACK }, { status: 502 });
  }
  return NextResponse.json({ success: true, message: 'Sent' });
}

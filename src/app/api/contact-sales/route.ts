import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIP } from '@/lib/rate-limit';
import { parseContactSales, sendContactSalesToSlack } from '@/lib/sales/contact-sales';

export const dynamic = 'force-dynamic';

/** POST /api/contact-sales — the public "Contact sales" form. Delivers to the team's Slack. */
export async function POST(request: Request) {
  const ip = getClientIP(request);
  const rl = await checkRateLimit(`contact-sales:${ip}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, message: 'Too many requests. Please email hello@getmindy.ai.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  // Honeypot: bots fill the hidden "website" field. Pretend success, send nothing.
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).website === 'string' && (body as Record<string, string>).website.trim()) {
    return NextResponse.json({ success: true, message: 'Sent' });
  }

  const parsed = parseContactSales(body);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: 'Please fill in the highlighted fields.', errors: parsed.errors }, { status: 400 });
  }

  const sent = await sendContactSalesToSlack(parsed.input);
  if (!sent.ok) {
    console.error('[contact-sales] not delivered:', sent.error, parsed.input.email);
    return NextResponse.json(
      { success: false, message: 'We could not send your request right now. Please email hello@getmindy.ai and we will reply quickly.' },
      { status: 502 },
    );
  }
  return NextResponse.json({ success: true, message: 'Sent' });
}

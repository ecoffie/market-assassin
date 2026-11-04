import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { registerContactForEvent } from '@/lib/ghl/event-registration';
import { normalizePhoneNumber } from '@/lib/ghl/sms';
import { normalizeAttribution } from '@/lib/mindy/lead-attribution';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * POST /api/events/lazy-contractors-blueprint/register
 * Registers a person for The Lazy Contractor's Blueprint: GHL contact tagged
 * "MD Lazy Contractors Blueprint" (+ "sms-opt-in" when they consent to texts).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  // Honeypot: real people never fill the hidden "website" field. Pretend success.
  if (str(body.website)) return NextResponse.json({ success: true });

  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const email = str(body.email, 254).toLowerCase();
  const phoneRaw = str(body.phone, 30);
  const smsConsent = body.smsConsent === true;
  const ownsBusiness = str(body.ownsBusiness, 20);
  const samRegistered = str(body.samRegistered, 20);

  if (!firstName) return NextResponse.json({ success: false, error: 'Please enter your first name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: 'Please enter a valid email.' }, { status: 400 });
  if (phoneRaw && !normalizePhoneNumber(phoneRaw)) {
    return NextResponse.json({ success: false, error: 'Please enter a valid phone number.' }, { status: 400 });
  }

  const attr = normalizeAttribution(body.attribution);
  const tags: string[] = [EVENT.ghlTag];
  if (smsConsent && phoneRaw) tags.push(EVENT.smsOptInTag);
  if (attr.utm_source) tags.push(`source-${attr.utm_source.toLowerCase()}`.slice(0, 60));

  const noteLines = [
    `Registered for ${EVENT.title} (${EVENT.dateLabel}) on getmindy.ai`,
    ownsBusiness ? `Owns a business: ${ownsBusiness}` : '',
    samRegistered ? `Registered in SAM.gov: ${samRegistered}` : '',
    `SMS consent: ${smsConsent && phoneRaw ? 'yes' : 'no'}`,
    attr.utm_source ? `Source: ${attr.utm_source}${attr.utm_campaign ? ` / ${attr.utm_campaign}` : ''}` : '',
  ].filter(Boolean);

  const result = await registerContactForEvent(
    { firstName, lastName, email, phone: phoneRaw, smsConsent, ownsBusiness, samRegistered },
    { tags, source: EVENT.title, note: noteLines.join('\n') },
  );

  if (!result.ok) {
    console.error('[lazy-blueprint-register] GHL failed', result.error);
    return NextResponse.json(
      { success: false, error: 'We could not save your seat. Please try again in a minute.' },
      { status: 502 },
    );
  }
  return NextResponse.json({ success: true });
}

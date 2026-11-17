import { NextRequest, NextResponse } from 'next/server';
import { registerContactForEvent } from '@/lib/ghl/event-registration';
import { normalizeAttribution } from '@/lib/mindy/lead-attribution';
import { EVENT_PLAN_GHL_TAG, EVENT_PLAN_TEMPLATE_URL } from '@/lib/events/event-action-plan';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * POST /api/event-action-plan — sign-up for the free Event Action Plan template
 * (getmindy.ai/event-action-plan).
 *
 *   { firstName, lastName?, email, phone?, eventName?, website (honeypot), attribution }
 *     → GHL contact tagged `event-action-plan-template`, then the template URL.
 *
 * A failed GHL write is a failed sign-up (the person is asked to retry), so every download is a
 * captured lead.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  if (str(body.website)) return NextResponse.json({ success: true, templateUrl: EVENT_PLAN_TEMPLATE_URL }); // honeypot

  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const email = str(body.email, 254).toLowerCase();
  const phone = str(body.phone, 30);
  const eventName = str(body.eventName, 120);
  if (!firstName) return NextResponse.json({ success: false, error: 'Please enter your first name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: 'Please enter a valid email.' }, { status: 400 });

  const attr = normalizeAttribution(body.attribution);
  const tags = [EVENT_PLAN_GHL_TAG];
  if (attr.utm_source) tags.push(`source-${attr.utm_source.toLowerCase()}`.slice(0, 60));

  const result = await registerContactForEvent(
    { firstName, lastName, email, phone: phone || undefined, smsConsent: false },
    {
      tags,
      source: 'Event Action Plan template',
      note: [
        'Downloaded the free Event Action Plan template on getmindy.ai/event-action-plan',
        eventName ? `Preparing for: ${eventName}` : '',
        attr.utm_source ? `Source: ${attr.utm_source}${attr.utm_campaign ? ` / ${attr.utm_campaign}` : ''}` : '',
      ].filter(Boolean).join('\n'),
    },
  );
  if (!result.ok) {
    console.error('[event-action-plan] GHL signup failed', result.error);
    return NextResponse.json({ success: false, error: 'We could not save your details. Please try again in a minute.' }, { status: 502 });
  }
  return NextResponse.json({ success: true, templateUrl: EVENT_PLAN_TEMPLATE_URL });
}

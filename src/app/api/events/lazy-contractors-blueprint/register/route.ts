import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, lazyBlueprintZoomEvent } from '@/lib/events/lazy-contractors-blueprint';
import { addZoomRegistrant, zoomConfigured } from '@/lib/zoom/client';
import { changeContactTags, registerContactForEvent } from '@/lib/ghl/event-registration';
import { normalizePhoneNumber, sendSmsToContact } from '@/lib/ghl/sms';
import { normalizeAttribution } from '@/lib/mindy/lead-attribution';
import { lazyBlueprintWelcomeSms, sendLazyBlueprintConfirmation } from '@/lib/events/lazy-blueprint-confirmation-email';

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
  // Phone is optional (2026-11-12: name + email is the whole first step); validate only when given.
  if (phoneRaw && !normalizePhoneNumber(phoneRaw)) {
    return NextResponse.json({ success: false, error: 'Please enter a valid phone number.' }, { status: 400 });
  }

  // Step 2 (optional, after the seat is saved): phone, text consent and the two questions.
  // Updates the same contact by email; no new Zoom link and no second confirmation email.
  if (body.step === 'details') {
    const tags = [EVENT.ghlTag, ...(smsConsent && phoneRaw ? [EVENT.smsOptInTag] : [])];
    const note = [
      `${EVENT.title}: follow-up details`,
      ownsBusiness ? `Owns a business: ${ownsBusiness}` : '',
      samRegistered ? `Registered in SAM.gov: ${samRegistered}` : '',
      `SMS consent: ${smsConsent && phoneRaw ? 'yes' : 'no'}`,
    ].filter(Boolean).join('\n');
    const r = await registerContactForEvent(
      { firstName, lastName, email, phone: phoneRaw, smsConsent, ownsBusiness, samRegistered },
      { tags, source: EVENT.title, note },
    );
    if (!r.ok) {
      console.error('[lazy-blueprint-register] details failed', r.error);
      return NextResponse.json({ success: false, error: 'We could not save that. Your seat is still saved.' }, { status: 502 });
    }
    if (smsConsent && phoneRaw && r.contactId) {
      try {
        const sms = await sendSmsToContact(r.contactId, lazyBlueprintWelcomeSms(firstName));
        if (sms.success) await changeContactTags(r.contactId, [EVENT.smsWelcomeTag], 'add').catch(() => {});
      } catch (err) {
        console.error('[lazy-blueprint-register] welcome SMS error', err instanceof Error ? err.message : err);
      }
    }
    return NextResponse.json({ success: true });
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

  // Personal Zoom link (tracks attendance per registrant). Best-effort: a Zoom problem
  // never blocks the registration; the person can be added later by the backfill.
  let joinUrl: string | null = null;
  const zoomEvent = lazyBlueprintZoomEvent();
  if (zoomEvent && zoomConfigured()) {
    try {
      joinUrl = (await addZoomRegistrant(zoomEvent.kind, zoomEvent.id, { email, firstName, lastName })).joinUrl;
    } catch (err) {
      console.error('[lazy-blueprint-register] Zoom registrant failed', err instanceof Error ? err.message : err);
    }
  }

  const result = await registerContactForEvent(
    { firstName, lastName, email, phone: phoneRaw, smsConsent, ownsBusiness, samRegistered },
    {
      tags,
      source: EVENT.title,
      note: noteLines.join('\n'),
      ...(joinUrl ? { customFields: [{ id: EVENT.ghlZoomFieldId, key: EVENT.ghlZoomFieldKey, field_value: joinUrl }] } : {}),
    },
  );

  if (!result.ok) {
    console.error('[lazy-blueprint-register] GHL failed', result.error);
    return NextResponse.json(
      { success: false, error: 'We could not save your seat. Please try again in a minute.' },
      { status: 502 },
    );
  }

  // Registered now: clear the "started but didn't finish" nudge tag.
  if (result.contactId) await changeContactTags(result.contactId, [EVENT.startedTag], 'remove').catch(() => {});

  // Confirmation email. The seat is already saved in GHL, so an email failure is logged,
  // not returned as a failed registration (a retry would create no new seat, only noise).
  try {
    const outcome = await sendLazyBlueprintConfirmation({ to: email, firstName, joinUrl });
    if (outcome.status !== 'accepted') console.error('[lazy-blueprint-register] confirmation not sent', outcome);
    else if (result.contactId) await changeContactTags(result.contactId, [EVENT.emailConfirmationTag], 'add').catch(() => {});
  } catch (err) {
    console.error('[lazy-blueprint-register] confirmation email error', err instanceof Error ? err.message : err);
  }

  // Welcome text, only for people who ticked the text-reminder box. Best-effort: sent to the
  // contact id GHL just returned (never re-matched by phone), and a failure is only logged.
  if (smsConsent && phoneRaw && result.contactId) {
    try {
      const sms = await sendSmsToContact(result.contactId, lazyBlueprintWelcomeSms(firstName));
      if (!sms.success) console.error('[lazy-blueprint-register] welcome SMS not sent', sms.optedOut ? 'opted out' : sms.error);
      else await changeContactTags(result.contactId, [EVENT.smsWelcomeTag], 'add').catch(() => {});
    } catch (err) {
      console.error('[lazy-blueprint-register] welcome SMS error', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({ success: true });
}

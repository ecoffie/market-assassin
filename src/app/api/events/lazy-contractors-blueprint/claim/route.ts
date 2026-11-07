import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, lazyBlueprintClaimState } from '@/lib/events/lazy-contractors-blueprint';
import { changeContactTags, findContactByEmail } from '@/lib/ghl/event-registration';
import { applyCreditOnce } from '@/lib/mcp/credits';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/events/lazy-contractors-blueprint/claim
 * Live attendees claim 100 extra Mindy credits, added to their balance on submit.
 * Only during the live window, only for emails registered for the event in GHL,
 * once per email (the credit key `lcb-2026-claim:<email>` is idempotent in Postgres).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  if (typeof body.website === 'string' && body.website) return NextResponse.json({ success: true }); // honeypot

  const state = lazyBlueprintClaimState();
  if (state === 'before') {
    return NextResponse.json({ success: false, error: 'The claim opens during the live event, Sat Nov 28 at 11:00 AM ET.' }, { status: 403 });
  }
  if (state === 'after') {
    return NextResponse.json({ success: false, error: 'This bonus was for live attendees only, and the live event has ended.' }, { status: 403 });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: 'Please enter a valid email.' }, { status: 400 });

  try {
    const contact = await findContactByEmail(email);
    if (!contact || !contact.tags.includes(EVENT.ghlTag.toLowerCase())) {
      return NextResponse.json(
        { success: false, error: "We couldn't find a registration with that email. Use the email you registered with." },
        { status: 404 },
      );
    }

    const result = await applyCreditOnce(`lcb-2026-claim:${email}`, email, EVENT.claimCredits, 'event_bonus');
    if (result.applied) {
      await changeContactTags(contact.id, [EVENT.claimTag], 'add').catch((err) =>
        console.error('[lazy-blueprint-claim] tag failed', err instanceof Error ? err.message : err),
      );
    }
    return NextResponse.json({
      success: true,
      alreadyClaimed: !result.applied,
      credits: EVENT.claimCredits,
      balance: result.newBalance,
    });
  } catch (err) {
    console.error('[lazy-blueprint-claim] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'We could not add your credits. Please try again in a minute.' }, { status: 502 });
  }
}

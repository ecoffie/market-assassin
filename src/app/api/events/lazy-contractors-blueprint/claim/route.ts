import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, lazyBlueprintClaimState } from '@/lib/events/lazy-contractors-blueprint';
import { changeContactTags, findContactByEmail } from '@/lib/ghl/event-registration';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';

export const dynamic = 'force-dynamic';

/**
 * POST /api/events/lazy-contractors-blueprint/claim
 * Live attendees claim $50 (250) in Mindy credits, added to their balance on submit.
 * Requires a signed-in Mindy session: the email comes from the verified session, never
 * from the request body. Only during the live window, only for emails registered for
 * the event in GHL,
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

  const email = await resolveMcpEmail(req);
  if (!email) {
    return NextResponse.json({ success: false, signIn: true, error: 'Please sign in to Mindy to claim your credits.' }, { status: 401 });
  }

  try {
    const contact = await findContactByEmail(email);
    if (!contact || !contact.tags.includes(EVENT.ghlTag.toLowerCase())) {
      return NextResponse.json(
        { success: false, notRegistered: true, email, error: `${email} isn't registered for the event. Sign in with the email you registered with.` },
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
      email,
    });
  } catch (err) {
    console.error('[lazy-blueprint-claim] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'We could not add your credits. Please try again in a minute.' }, { status: 502 });
  }
}

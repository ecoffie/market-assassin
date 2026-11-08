import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, LCB_CLAIM_QUESTIONS as Q, LCB_GHL_FIELDS, lazyBlueprintClaimState } from '@/lib/events/lazy-contractors-blueprint';
import { addContactNote, changeContactTags, findContactByEmail, updateContactFields } from '@/lib/ghl/event-registration';
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

    const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const one = (v: unknown, allowed: readonly string[]) => (allowed.includes(str(v)) ? str(v) : '');
    const fullName = str(body.name, 120);
    const company = str(body.company, 160);
    const sells = str(body.sells, 300);
    const years = one(body.years, Q.years);
    const revenue = one(body.revenue, Q.revenue);
    const sam = one(body.sam, Q.sam);
    const bids = one(body.bids, Q.bids);
    const challenge = one(body.challenge, Q.challenge);
    const stage = Q.stage.find((o) => o.value === str(body.stage, 20)) || null;
    const call = one(body.call, Q.call);
    const certs = (Array.isArray(body.certifications) ? body.certifications : [])
      .map((c) => str(c, 40))
      .filter((c) => (Q.certifications as readonly string[]).includes(c));
    if (!fullName) return NextResponse.json({ success: false, error: 'Please enter your name.' }, { status: 400 });
    if (!sells) return NextResponse.json({ success: false, error: 'Please tell us what your business sells.' }, { status: 400 });
    if (!years || !bids) return NextResponse.json({ success: false, error: 'Please answer how long you have been in business and how many federal bids you have submitted.' }, { status: 400 });

    const result = await applyCreditOnce(`lcb-2026-claim:${email}`, email, EVENT.claimCredits, 'event_bonus');
    if (result.applied) {
      const note = [
        `Claimed ${EVENT.claimCredits} live-event credits (${EVENT.title})`,
        `Name: ${fullName}`,
        company ? `Company: ${company}` : '',
        `Sells: ${sells}`,
        `In business: ${years}`,
        revenue ? `Annual revenue: ${revenue}` : '',
        sam ? `Registered in SAM.gov: ${sam}` : '',
        certs.length ? `Certifications: ${certs.join(', ')}` : '',
        `Federal bids submitted: ${bids}`,
        challenge ? `Biggest challenge: ${challenge}` : '',
        stage ? `Sounds most like: "${stage.label}"` : '',
        stage ? `Likely monthly budget: ${stage.budget}` : '',
        call ? `Wants a call: ${call}` : '',
      ].filter(Boolean).join('\n');
      const fields = [
        { id: LCB_GHL_FIELDS.industry, field_value: sells },
        ...(revenue ? [{ id: LCB_GHL_FIELDS.revenue, field_value: revenue }] : []),
        ...(stage ? [{ id: LCB_GHL_FIELDS.support, field_value: stage.support }] : []),
      ];
      await updateContactFields(contact.id, fields).catch((err) =>
        console.error('[lazy-blueprint-claim] fields failed', err instanceof Error ? err.message : err),
      );
      await addContactNote(contact.id, note).catch((err) =>
        console.error('[lazy-blueprint-claim] note failed', err instanceof Error ? err.message : err),
      );
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

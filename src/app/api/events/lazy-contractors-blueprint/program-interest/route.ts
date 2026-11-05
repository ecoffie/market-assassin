import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { registerContactForEvent } from '@/lib/ghl/event-registration';
import { normalizePhoneNumber } from '@/lib/ghl/sms';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = (v: unknown, allowed: string[]) => {
  const s = str(v, 40);
  return allowed.includes(s) ? s : '';
};

/**
 * POST /api/events/lazy-contractors-blueprint/program-interest
 * Interest form for the New Year program. Tags the GHL contact "MD LCB Program Interest"
 * (+ "MD LCB Program Hot" when they're ready to start in January) and saves the answers as a note.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  if (str(body.website)) return NextResponse.json({ success: true }); // honeypot

  const firstName = str(body.firstName, 80);
  const lastName = str(body.lastName, 80);
  const email = str(body.email, 254).toLowerCase();
  const phone = str(body.phone, 30);
  const sells = str(body.sells, 300);
  const sam = pick(body.sam, ['Yes', 'No', 'Not sure']);
  const bids = pick(body.bids, ['Never', '1-2', '3 or more']);
  const ready = pick(body.ready, ['Yes', 'Maybe', 'Not yet']);
  const call = pick(body.call, ['Yes', 'No']);

  if (!firstName) return NextResponse.json({ success: false, error: 'Please enter your first name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: 'Please enter a valid email.' }, { status: 400 });
  if (phone && !normalizePhoneNumber(phone)) {
    return NextResponse.json({ success: false, error: 'Please enter a valid phone number.' }, { status: 400 });
  }
  if (!ready) return NextResponse.json({ success: false, error: 'Please tell us when you could start.' }, { status: 400 });

  const tags: string[] = [EVENT.programInterestTag];
  if (ready === 'Yes') tags.push(EVENT.programHotTag);

  const note = [
    `Interested in the ${EVENT.programName} (${EVENT.programStartLabel})`,
    sells ? `Sells: ${sells}` : '',
    sam ? `Registered in SAM.gov: ${sam}` : '',
    bids ? `Federal bids submitted: ${bids}` : '',
    `Ready to start in January: ${ready}`,
    call ? `Wants a call: ${call}` : '',
  ].filter(Boolean).join('\n');

  const result = await registerContactForEvent(
    { firstName, lastName, email, phone, smsConsent: false },
    { tags, source: `${EVENT.title} — program interest`, note },
  );
  if (!result.ok) {
    console.error('[lazy-blueprint-program-interest] GHL failed', result.error);
    return NextResponse.json({ success: false, error: 'We could not save your answers. Please try again in a minute.' }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}

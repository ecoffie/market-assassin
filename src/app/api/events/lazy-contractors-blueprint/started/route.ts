import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { registerContactForEvent } from '@/lib/ghl/event-registration';
import { normalizeAttribution } from '@/lib/mindy/lead-attribution';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * POST /api/events/lazy-contractors-blueprint/started  { firstName, email }
 * Someone typed a name and email on the Mindy Day form but has not registered yet. Tag the GHL
 * contact `lcb-started-not-registered` (NOT the event tag) so a GHL workflow can email a reminder
 * to finish. Email only — no phone and no text consent were given. The register route removes the
 * tag. Always answers 200 so it can never get in the way of the form.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const firstName = str(body.firstName, 80);
  const email = str(body.email, 254).toLowerCase();
  if (!firstName || !EMAIL_RE.test(email)) return NextResponse.json({ success: true });

  const attr = normalizeAttribution(body.attribution);
  const tags: string[] = [EVENT.startedTag];
  if (attr.utm_source) tags.push(`source-${attr.utm_source.toLowerCase()}`.slice(0, 60));
  try {
    const r = await registerContactForEvent(
      { firstName, email, smsConsent: false },
      { tags, source: `${EVENT.title} (started form)`, note: `Started the ${EVENT.title} form on getmindy.ai but has not registered yet.` },
    );
    if (!r.ok) console.error('[lazy-blueprint-started] GHL failed', r.error);
  } catch (err) {
    console.error('[lazy-blueprint-started] error', err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ success: true });
}

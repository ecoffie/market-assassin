import { NextRequest, NextResponse } from 'next/server';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { LCB_SMS_STEPS, dueSmsSteps, firstNameFor } from '@/lib/events/lazy-blueprint-sms-sequence';
import { changeContactTags, listContactsByTag } from '@/lib/ghl/event-registration';
import { sendSmsToContact } from '@/lib/ghl/sms';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BUDGET_MS = 240_000;

/**
 * GET /api/cron/lazy-blueprint-sms — runs every 5 minutes (vercel.json).
 * Sends whichever scheduled text is in its window to every opted-in registrant who
 * hasn't had it yet, then tags them. Outside every window it does nothing.
 *
 * Auth: Vercel cron (Bearer CRON_SECRET) or ?password=ADMIN_PASSWORD.
 * ?preview=1 (admin) lists the schedule and who each step would reach, sending nothing.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '');
  const isAdmin = !!process.env.ADMIN_PASSWORD && sp.get('password') === process.env.ADMIN_PASSWORD;
  if (!isAdmin && !(process.env.CRON_SECRET && bearer === process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const optInTag = EVENT.smsOptInTag.toLowerCase();

  if (isAdmin && sp.get('preview')) {
    const registrants = await listContactsByTag(EVENT.ghlTag);
    const optedIn = registrants.filter((c) => c.tags.includes(optInTag) && c.phone);
    return NextResponse.json({
      success: true,
      message: 'Preview only. Nothing was sent.',
      data: {
        registrants: registrants.length,
        optedInWithPhone: optedIn.length,
        schedule: LCB_SMS_STEPS.map((s) => ({
          step: s.id,
          when: s.label,
          alreadySent: optedIn.filter((c) => c.tags.includes(s.tag)).length,
          example: s.text('Ann', 'https://us06web.zoom.us/w/…'),
        })),
      },
    });
  }

  const due = dueSmsSteps();
  if (!due.length) return NextResponse.json({ success: true, message: 'No text is scheduled right now', data: { sent: 0 } });

  const started = Date.now();
  const registrants = await listContactsByTag(EVENT.ghlTag);
  const results: Record<string, { sent: number; optedOut: number; failed: number; remaining: number }> = {};

  for (const step of due) {
    const todo = registrants.filter((c) => c.tags.includes(optInTag) && c.phone && !c.tags.includes(step.tag));
    const r = { sent: 0, optedOut: 0, failed: 0, remaining: 0 };
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(5, todo.length) }, async () => {
      while (i < todo.length) {
        if (Date.now() - started > BUDGET_MS) { r.remaining = todo.length - i; return; }
        const c = todo[i++];
        try {
          const joinField = c.customFields.find((f) => f.id === EVENT.ghlZoomFieldId);
          const joinUrl = typeof joinField?.value === 'string' && joinField.value.startsWith('http') ? joinField.value : null;
          const sms = await sendSmsToContact(c.id, step.text(firstNameFor(c.firstName), joinUrl));
          if (sms.success) r.sent++;
          else if (sms.optedOut) r.optedOut++;
          else { r.failed++; console.error('[lazy-blueprint-sms]', step.id, c.id, sms.error); continue; }
          // Tag after a send or an opt-out, so neither is ever retried.
          await changeContactTags(c.id, [step.tag], 'add');
        } catch (err) {
          r.failed++;
          console.error('[lazy-blueprint-sms]', step.id, c.id, err instanceof Error ? err.message : err);
        }
      }
    }));
    results[step.id] = r;
  }

  const failed = Object.values(results).reduce((n, r) => n + r.failed, 0);
  return NextResponse.json({ success: failed === 0, message: 'Sent scheduled texts', data: results }, { status: failed ? 207 : 200 });
}

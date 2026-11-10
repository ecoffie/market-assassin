import { NextRequest, NextResponse } from 'next/server';
import { findContactByEmail, changeContactTags, addContactNote, registerContactForEvent } from '@/lib/ghl/event-registration';
import { normalizePhoneNumber } from '@/lib/ghl/sms';
import { normalizeAttribution } from '@/lib/mindy/lead-attribution';
import { COURSE_GHL_TAG, QUIZ, stageByNumber, stageFromAnswers, stageGhlTag, type QuizAnswers } from '@/lib/course/govcon-roadmap';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * POST /api/course/roadmap — the free course's personalized roadmap (getmindy.ai/course/roadmap).
 *
 *   { action: 'signup', firstName, lastName, email, phone, attribution }
 *     → GHL contact tagged `free-govcon-roadmap`. A failed GHL write is a failed sign-up.
 *   { action: 'stage', email, answers }
 *     → stage is recomputed HERE from the answers (never trusted from the client), then the
 *       contact gets `govcon-roadmap-stage-<n>` and a note with the answers. Best-effort: the
 *       person still sees their roadmap if this fails.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  if (str(body.website)) return NextResponse.json({ success: true }); // honeypot

  const email = str(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ success: false, error: 'Please enter a valid email.' }, { status: 400 });

  if (body.action === 'signup') {
    const firstName = str(body.firstName, 80);
    const lastName = str(body.lastName, 80);
    const phone = str(body.phone, 30);
    if (!firstName) return NextResponse.json({ success: false, error: 'Please enter your first name.' }, { status: 400 });
    if (!phone || !normalizePhoneNumber(phone)) {
      return NextResponse.json({ success: false, error: 'Please enter a valid phone number.' }, { status: 400 });
    }
    const attr = normalizeAttribution(body.attribution);
    const smsConsent = body.smsConsent === true;
    const tags = [COURSE_GHL_TAG];
    if (smsConsent) tags.push('sms-opt-in');
    if (attr.utm_source) tags.push(`source-${attr.utm_source.toLowerCase()}`.slice(0, 60));
    const result = await registerContactForEvent(
      { firstName, lastName, email, phone, smsConsent },
      {
        tags,
        source: 'Free GovCon Roadmap course',
        note: [
          'Signed up for the free Federal Contracting Roadmap course on getmindy.ai/course',
          `SMS consent: ${smsConsent ? 'yes' : 'no'}`,
          attr.utm_source ? `Source: ${attr.utm_source}${attr.utm_campaign ? ` / ${attr.utm_campaign}` : ''}` : '',
        ].filter(Boolean).join('\n'),
      },
    );
    if (!result.ok) {
      console.error('[course-roadmap] GHL signup failed', result.error);
      return NextResponse.json({ success: false, error: 'We could not save your details. Please try again in a minute.' }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === 'stage') {
    const raw = (body.answers && typeof body.answers === 'object' ? body.answers : {}) as Record<string, unknown>;
    const answers: QuizAnswers = {};
    for (const q of QUIZ) {
      const v = str(raw[q.id], 20);
      if (q.options.some((o) => o.value === v)) answers[q.id] = v;
    }
    const n = stageFromAnswers(answers);
    const stage = stageByNumber(n)!;
    try {
      const contact = await findContactByEmail(email);
      if (contact) {
        await changeContactTags(contact.id, [stageGhlTag(n)], 'add');
        const lines = QUIZ.map((q) => `${q.text} ${q.options.find((o) => o.value === answers[q.id])?.label ?? '(no answer)'}`);
        await addContactNote(contact.id, [`GovCon Roadmap result: Stage ${n} — ${stage.name}`, ...lines].join('\n'));
      }
    } catch (err) {
      console.error('[course-roadmap] stage tag failed', err instanceof Error ? err.message : err);
    }
    return NextResponse.json({ success: true, stage: n });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}

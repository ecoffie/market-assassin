import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, lazyBlueprintZoomEvent } from '@/lib/events/lazy-contractors-blueprint';
import { addZoomRegistrant, getZoomAttendance, zoomConfigured } from '@/lib/zoom/client';
import { changeContactTags, listContactsByTag, updateContactFields, type TaggedContact } from '@/lib/ghl/event-registration';
import { classifyAttendance, hasZoomLink } from '@/lib/events/lazy-blueprint-attendance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Run `fn` over items, `n` at a time, collecting failures instead of stopping. */
async function each<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const t = items[i++];
      try { await fn(t); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
    }
  }));
  return errors;
}

function setup() {
  const zoomEvent = lazyBlueprintZoomEvent();
  const missing = [
    !zoomConfigured() && 'ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET',
    !zoomEvent && 'LCB_ZOOM_EVENT_ID',
  ].filter(Boolean) as string[];
  return { zoomEvent, missing };
}

/**
 * GET  /api/admin/lazy-blueprint-zoom?password=…  → preview: registrants, how many have a Zoom link.
 * POST /api/admin/lazy-blueprint-zoom?password=…&action=backfill
 *      Adds every registrant without a link to Zoom and saves the link on their GHL contact.
 * POST /api/admin/lazy-blueprint-zoom?password=…&action=attendance[&mode=execute]
 *      Reads Zoom's attendance report and tags each registrant mindy-day-attended or
 *      mindy-day-no-show. Preview by default; mode=execute writes the tags.
 */
export async function GET(req: NextRequest) {
  if (!verifyAdminPassword(req.nextUrl.searchParams.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const { zoomEvent, missing } = setup();
  try {
    const registrants = await listContactsByTag(EVENT.ghlTag);
    const withLink = registrants.filter((c) => hasZoomLink(c, EVENT.ghlZoomFieldId)).length;
    return NextResponse.json({
      success: true,
      message: missing.length ? `Not ready: set ${missing.join(', ')}` : 'Ready',
      data: { zoomEvent, registrants: registrants.length, withZoomLink: withLink, withoutZoomLink: registrants.length - withLink },
    });
  } catch (err) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  const { zoomEvent, missing } = setup();
  if (!zoomEvent || missing.length) {
    return NextResponse.json({ success: false, message: `Not ready: set ${missing.join(', ')}` }, { status: 400 });
  }
  const action = sp.get('action');

  try {
    const registrants = await listContactsByTag(EVENT.ghlTag);

    if (action === 'backfill') {
      const todo = registrants.filter((c) => c.email && !hasZoomLink(c, EVENT.ghlZoomFieldId));
      let linked = 0;
      const errors = await each(todo, 4, async (c: TaggedContact) => {
        const { joinUrl } = await addZoomRegistrant(zoomEvent.kind, zoomEvent.id, { email: c.email, firstName: c.firstName, lastName: c.lastName });
        await updateContactFields(c.id, [{ id: EVENT.ghlZoomFieldId, key: EVENT.ghlZoomFieldKey, field_value: joinUrl }]);
        linked++;
      });
      return NextResponse.json({
        success: errors.length === 0,
        message: `Added ${linked} of ${todo.length} registrants to Zoom`,
        data: { registrants: registrants.length, needed: todo.length, linked, skippedNoEmail: registrants.filter((c) => !c.email).length },
        ...(errors.length ? { errors: errors.slice(0, 20) } : {}),
      }, { status: errors.length ? 207 : 200 });
    }

    if (action === 'attendance') {
      const { participants, withoutEmail } = await getZoomAttendance(zoomEvent.kind, zoomEvent.id);
      const { attended, noShow, noEmail } = classifyAttendance(registrants, participants);
      const summary = {
        registrants: registrants.length,
        attended: attended.length,
        noShow: noShow.length,
        registrantsWithoutEmail: noEmail.length,
        zoomParticipants: participants.length,
        zoomParticipantsWithoutEmail: withoutEmail,
        showRate: registrants.length ? attended.length / registrants.length : null,
      };
      if (sp.get('mode') !== 'execute') {
        return NextResponse.json({ success: true, message: 'Preview only. Add mode=execute to write the tags.', data: summary });
      }
      const errors = [
        ...(await each(attended, 5, async (c) => {
          await changeContactTags(c.id, [EVENT.attendedTag], 'add');
          if (c.tags.includes(EVENT.noShowTag)) await changeContactTags(c.id, [EVENT.noShowTag], 'remove');
        })),
        ...(await each(noShow, 5, async (c) => {
          await changeContactTags(c.id, [EVENT.noShowTag], 'add');
          if (c.tags.includes(EVENT.attendedTag)) await changeContactTags(c.id, [EVENT.attendedTag], 'remove');
        })),
      ];
      return NextResponse.json({
        success: errors.length === 0,
        message: `Tagged ${attended.length} attended and ${noShow.length} no-show`,
        data: summary,
        ...(errors.length ? { errors: errors.slice(0, 20) } : {}),
      }, { status: errors.length ? 207 : 200 });
    }

    return NextResponse.json({ success: false, message: 'Unknown action: use action=backfill or action=attendance' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

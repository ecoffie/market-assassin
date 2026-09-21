import { NextResponse } from 'next/server';
import { MINDY_DAY } from '@/lib/mindy/mindy-day';

/**
 * The Apple/Outlook calendar file for Mindy Day.
 *
 * NOT built with `buildEventsIcs` (src/lib/events/ics.ts) on purpose: that helper writes
 * ALL-DAY events (DTSTART;VALUE=DATE) because its callers hold federal event dates with no
 * confirmed time. Mindy Day is a TIMED session, and an all-day block would put the wrong
 * thing on a registrant's calendar — the opposite of the point.
 *
 * MINDY_DAY.calendarDates is already the UTC range Google Calendar takes
 * ("20260822T140000Z/20260822T170000Z"), so start/end come from the SAME field the
 * Google button uses. One source, so the two buttons cannot disagree.
 */

/** RFC 5545: escape , ; \ and newlines in TEXT values. */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1: fold to 75 OCTETS, continuation lines start with a single space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const take = out.length === 0 ? 75 : 74;
    let end = Math.min(start + take, bytes.length);
    // never split a multi-byte character
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

export function GET() {
  const [dtStart, dtEnd] = MINDY_DAY.calendarDates.split('/');

  // A malformed config must not ship a broken calendar file.
  if (!/^\d{8}T\d{6}Z$/.test(dtStart || '') || !/^\d{8}T\d{6}Z$/.test(dtEnd || '')) {
    return NextResponse.json({ error: 'calendar dates unavailable' }, { status: 503 });
  }

  const description =
    `Free live working session: build your own federal market map with Mindy on real government data.\n\n` +
    `Join Zoom: ${MINDY_DAY.joinUrl}\n` +
    `Meeting ID: ${MINDY_DAY.meetingId} · Passcode: ${MINDY_DAY.passcode}\n\n` +
    `Zoom seats ${MINDY_DAY.zoomCapacity} — please join a few minutes early.` +
    (MINDY_DAY.livestreamUrl ? `\nIf the room is full: ${MINDY_DAY.livestreamUrl}` : '');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GovCon Giants//Mindy Day//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable UID: re-importing UPDATES the event instead of duplicating it.
    `UID:mindy-day-${MINDY_DAY.iso}@getmindy.ai`,
    `DTSTAMP:${dtStart}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    fold(`SUMMARY:${esc('Mindy Day — GovCon Giants')}`),
    fold(`DESCRIPTION:${esc(description)}`),
    fold(`LOCATION:${esc(MINDY_DAY.joinUrl)}`),
    fold(`URL:${esc(MINDY_DAY.joinUrl)}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="mindy-day-${MINDY_DAY.iso}.ics"`,
      'Cache-Control': 'public, max-age=300',
    },
  });
}

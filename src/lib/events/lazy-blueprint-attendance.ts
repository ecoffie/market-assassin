/**
 * Pure helpers for the Lazy Contractor's Blueprint Zoom sync: who still needs a link,
 * and who attended vs. no-show, matched by email.
 */
import type { TaggedContact } from '@/lib/ghl/event-registration';
import type { ZoomParticipant } from '@/lib/zoom/client';

/** Seconds in the session that count as attending (dropping in for a few seconds does not). */
export const MIN_ATTEND_SECONDS = 60;

export function hasZoomLink(c: TaggedContact, fieldId: string): boolean {
  const f = c.customFields.find((x) => x.id === fieldId);
  return typeof f?.value === 'string' && f.value.startsWith('http');
}

export function classifyAttendance(
  registrants: TaggedContact[],
  participants: ZoomParticipant[],
): { attended: TaggedContact[]; noShow: TaggedContact[]; noEmail: TaggedContact[] } {
  const seconds = new Map(participants.map((p) => [p.email, p.seconds]));
  const attended: TaggedContact[] = [];
  const noShow: TaggedContact[] = [];
  const noEmail: TaggedContact[] = [];
  for (const r of registrants) {
    if (!r.email) { noEmail.push(r); continue; }
    if ((seconds.get(r.email) || 0) >= MIN_ATTEND_SECONDS) attended.push(r);
    else noShow.push(r);
  }
  return { attended, noShow, noEmail };
}

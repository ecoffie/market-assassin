/**
 * How many NEW sam_events rows one extract-sam-events run may insert.
 * Rows whose notice_id is already stored are updates (date corrections) and are not capped.
 */
export const NEW_SAM_EVENTS_PER_RUN = 25;
export const NEW_CALENDAR_EVENTS_PER_RUN = 15;

export function capNewEvents<T extends { notice_id: string }>(
  events: T[],
  existingIds: Set<string> | null,
  cap: number,
): { writes: T[]; deferred: number; fresh: number } {
  if (!existingIds) return { writes: events, deferred: 0, fresh: events.length };
  const writes: T[] = [];
  let fresh = 0;
  let deferred = 0;
  for (const event of events) {
    if (existingIds.has(event.notice_id)) {
      writes.push(event);
      continue;
    }
    if (fresh < cap) {
      writes.push(event);
      fresh++;
    } else {
      deferred++;
    }
  }
  return { writes, deferred, fresh };
}

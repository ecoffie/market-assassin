/**
 * How many NEW sam_events rows one extract-sam-events run may insert.
 * Rows whose notice_id is already stored are updates (date corrections) and are not capped.
 * Past rows are marked expired_at; they are not deleted. SAM_EVENTS_PRUNE is a separate decision.
 */
export const NEW_SAM_EVENTS_PER_RUN = 25;
export const NEW_CALENDAR_EVENTS_PER_RUN = 15;
export const EXPIRE_PER_RUN = 200;

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

/** Ids whose event_date is before today. Undated rows are not expired. */
export function expireIds(
  rows: Array<{ id: string; event_date: string | null }>,
  todayStr: string,
  cap = EXPIRE_PER_RUN,
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (!row.id || !row.event_date || row.event_date >= todayStr) continue;
    ids.push(row.id);
    if (ids.length >= cap) break;
  }
  return ids;
}

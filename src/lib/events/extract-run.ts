/**
 * The plan for one extract-sam-events run, as pure functions (the route does the I/O).
 *
 *  R2  candidates = every notice behind a listed `sam_events` row (FIRST, so a time-budget cut
 *      can never drop them) + every active candidate, newest first. Not "the 500 newest".
 *  R3  each candidate's reading is reconciled against its solicitation family's current version.
 *  R4  every written row carries `extracted_at = runAt`: the column means "last re-read".
 *      Retirement: a listed row whose notice the current extractor no longer reads as an event is
 *      removed — the row is derived data and the next run recreates it if the notice reads as an
 *      event again. Guarded by a cap so a classifier regression cannot empty the table.
 */
import { familyKeyOf, isAttendable, reconcileFamilyEvents, type EventSourceNotice, type ReconciledEvent } from './event-currency';

/** Deletion guard: never retire more than this many rows, or more than this share of re-read listed rows. */
export const RETIRE_MAX_ROWS = 100;
export const RETIRE_MAX_SHARE = 0.25;

export function buildCandidateSet<T extends EventSourceNotice>(listedSources: T[], activeCandidates: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const n of [...listedSources, ...activeCandidates]) {
    if (!n?.notice_id || seen.has(n.notice_id)) continue;
    seen.add(n.notice_id);
    out.push(n);
  }
  return out;
}

/** Solicitation numbers whose families must be loaded: only candidates that read as attendable events. */
export function familiesToLoad(candidates: EventSourceNotice[], readings: Map<string, { type: string } | null>): string[] {
  const out = new Set<string>();
  for (const n of candidates) {
    const r = readings.get(n.notice_id);
    if (r && isAttendable(r.type) && familyKeyOf(n.solicitation_number)) out.add(n.solicitation_number as string);
  }
  return Array.from(out);
}

export interface PlannedEvent<T extends EventSourceNotice> {
  notice: T;
  event: ReconciledEvent;
}

export function planEvents<T extends EventSourceNotice>(candidates: T[], familyPool: EventSourceNotice[], today: Date): PlannedEvent<T>[] {
  const reconciled = reconcileFamilyEvents(candidates, familyPool, today);
  const out: PlannedEvent<T>[] = [];
  for (const n of candidates) {
    const event = reconciled.get(n.notice_id);
    if (event) out.push({ notice: n, event });
  }
  return out;
}

export interface RetirementPlan {
  noticeIds: string[];
  /** Why nothing was retired even though candidates existed (the cap), or null. */
  skipped: string | null;
  wouldRetire: number;
}

/**
 * Listed rows whose re-read notice no longer reads as an event. Only notices actually re-read this
 * run with a description count — a title-only reading is not enough evidence to remove a row.
 */
export function planRetirements(
  listedNoticeIds: string[],
  rereadSources: EventSourceNotice[],
  plannedIds: Set<string>,
): RetirementPlan {
  const byId = new Map(rereadSources.map((n) => [n.notice_id, n]));
  const reread = listedNoticeIds.filter((id) => byId.has(id));
  const candidates = reread.filter((id) => !plannedIds.has(id) && (byId.get(id)?.description || '').trim().length > 0);
  const cap = Math.min(RETIRE_MAX_ROWS, Math.floor(reread.length * RETIRE_MAX_SHARE));
  if (candidates.length > cap) {
    return { noticeIds: [], wouldRetire: candidates.length, skipped: `${candidates.length} listed row(s) no longer read as events, above the guard (${cap}) — nothing retired; check the classifier` };
  }
  return { noticeIds: candidates, wouldRetire: candidates.length, skipped: null };
}

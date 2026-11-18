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

/**
 * Pruning is REPORT-ONLY unless `SAM_EVENTS_PRUNE=apply` (Eric, 2026-11-17: no row is deleted until a
 * separate approval). The flag is not set in any environment. Report mode computes the same capped
 * proposal and records it; apply mode deletes exactly that proposal.
 */
export type PruneMode = 'report' | 'apply';
export function pruneMode(env: Record<string, string | undefined> = process.env): PruneMode {
  return env.SAM_EVENTS_PRUNE === 'apply' ? 'apply' : 'report';
}

export type PruneReason = 'no_event_on_reread';

export interface PruneProposal {
  id: string;
  notice_id: string;
  reason: PruneReason;
  stored_type: string | null;
  stored_date: string | null;
}

export interface RetirementPlan {
  /** Rows to delete in apply mode (empty when the guard tripped). */
  proposals: PruneProposal[];
  /** Why nothing is proposed even though candidates existed (the cap), or null. */
  skipped: string | null;
  wouldRetire: number;
}

/**
 * Listed rows whose re-read notice no longer reads as an event. Only notices actually re-read this
 * run with a description count — a title-only reading is not enough evidence to remove a row — and
 * only SAM-extracted rows (AI-discovered rows are never proposed).
 */
export function planRetirements(
  listedRows: Array<{ id: string; notice_id: string; event_type: string | null; event_date: string | null; source: string | null }>,
  rereadSources: EventSourceNotice[],
  plannedIds: Set<string>,
): RetirementPlan {
  const byId = new Map(rereadSources.map((n) => [n.notice_id, n]));
  const reread = listedRows.filter((r) => byId.has(r.notice_id) && (!r.source || r.source === 'sam_gov'));
  const candidates = reread.filter((r) => !plannedIds.has(r.notice_id) && (byId.get(r.notice_id)?.description || '').trim().length > 0);
  const cap = Math.min(RETIRE_MAX_ROWS, Math.floor(reread.length * RETIRE_MAX_SHARE));
  if (candidates.length > cap) {
    return { proposals: [], wouldRetire: candidates.length, skipped: `${candidates.length} listed row(s) no longer read as events, above the guard (${cap}) — nothing proposed; check the classifier` };
  }
  return {
    proposals: candidates.map((r) => ({ id: r.id, notice_id: r.notice_id, reason: 'no_event_on_reread' as const, stored_type: r.event_type, stored_date: r.event_date })),
    wouldRetire: candidates.length,
    skipped: null,
  };
}

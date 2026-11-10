/**
 * Event refresh — report-only default and reviewed batches (2026-11-10, PR #1960 revision).
 *
 * The refresh re-derives every upcoming event from its source notices. Its first run against
 * production would change 29 upcoming dates, 56 upcoming types and add 11 upcoming events, and it
 * would undo three hand-verified corrections. So nothing it proposes is written by default:
 *
 *   SAM_EVENTS_REFRESH          report (default, also when unset or unrecognised) · apply · off
 *   SAM_EVENTS_REFRESH_APPLY    categories to write in apply mode: new, date, adoption, type, restamp
 *   SAM_EVENTS_REFRESH_NOTICES  explicit notice ids to write in apply mode, whatever their category
 *
 * Every proposed change is classified into exactly one category, with its evidence:
 *   new       — no stored row
 *   date      — same type, different date
 *   adoption  — same type, date taken from the solicitation's current version (R3)
 *   type      — different event type (written ONLY when `type` is listed, or by notice id)
 *   unchanged — same type and date; `restamp` re-writes the row (extracted_at, office, location)
 *   uncertain — never written by a category: conflicts with a verified correction, or clears a
 *               stored date (the extractor no longer finds a date the row has). Notice id only.
 * Upcoming rows whose notice no longer qualifies are reported as uncertain too (never deleted).
 */
import type { ExtractedEvent, RefreshNotice } from './refresh';
import { extractEvent } from './refresh';
import type { VerifiedCorrection } from './verified-corrections';
import { familyIdentityKey } from '@/lib/sam/solicitation-family';

export type RefreshMode = 'report' | 'apply' | 'off';
export type ChangeCategory = 'new' | 'date' | 'adoption' | 'type' | 'unchanged' | 'uncertain';
export type ApplyCategory = 'new' | 'date' | 'adoption' | 'type' | 'restamp';
const APPLY_CATEGORIES: readonly ApplyCategory[] = ['new', 'date', 'adoption', 'type', 'restamp'];

export function refreshMode(raw: string | undefined): RefreshMode {
  const v = (raw || '').trim().toLowerCase();
  return v === 'apply' || v === 'off' ? v : 'report';
}

export function parseApplyCategories(raw: string | undefined): Set<ApplyCategory> {
  const out = new Set<ApplyCategory>();
  for (const t of (raw || '').split(',').map((x) => x.trim().toLowerCase())) {
    if ((APPLY_CATEGORIES as readonly string[]).includes(t)) out.add(t as ApplyCategory);
  }
  return out;
}

export function parseNoticeAllowlist(raw: string | undefined): Set<string> {
  return new Set((raw || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-f0-9]{32}$/.test(x)));
}

export interface StoredEvent { event_type: string; event_date: string | null }

export interface PlannedChange {
  notice_id: string;
  category: ChangeCategory;
  /** What the category would have been without the uncertainty rule (for review). */
  underlying: Exclude<ChangeCategory, 'uncertain'>;
  stored: StoredEvent | null;
  proposed: StoredEvent;
  /** Stored row is an attendable event dated today or later (or undated), or the new row would be one. */
  upcoming: boolean;
  adopted_from: string | null;
  evidence: ExtractedEvent['evidence'] | null;
  uncertain_reason?: 'conflicts_verified_correction' | 'clears_stored_date';
  verified?: VerifiedCorrection & { superseded: boolean; superseded_by: string | null };
}

const ATTENDABLE = new Set(['industry_day', 'webinar', 'conference']);

/**
 * Newer authoritative evidence against a verified correction: a notice in the same CONFIRMED
 * solicitation family (never a title match, never a blank solicitation number), posted after the
 * correction, that states this event type with a different date.
 */
export function supersedingNotice(
  v: VerifiedCorrection,
  source: RefreshNotice | undefined,
  familyNotices: RefreshNotice[],
  today: Date,
): string | null {
  if (!source) return null;
  const key = familyIdentityKey(source.solicitation_number, source.notice_id);
  if (!key.startsWith('sol:')) return null;
  for (const n of familyNotices) {
    if (familyIdentityKey(n.solicitation_number, n.notice_id) !== key) continue;
    if (!n.posted_date || n.posted_date.slice(0, 10) <= v.verified_on) continue;
    const ev = extractEvent(n, today);
    if (ev && ev.event_type === v.event_type && ev.event_date && ev.event_date !== v.event_date) return n.notice_id;
  }
  return null;
}

export function planRefresh(input: {
  events: ExtractedEvent[];
  stored: Map<string, StoredEvent>;
  noticesById: Map<string, RefreshNotice>;
  familyNotices: RefreshNotice[];
  verified: ReadonlyMap<string, VerifiedCorrection>;
  today: Date;
}): PlannedChange[] {
  const todayStr = input.today.toISOString().slice(0, 10);
  return input.events.map((e) => {
    const st = input.stored.get(e.notice_id) ?? null;
    const proposed = { event_type: e.event_type, event_date: e.event_date };
    const underlying: PlannedChange['underlying'] = !st ? 'new'
      : st.event_type !== e.event_type ? 'type'
      : st.event_date !== e.event_date ? (e.adopted_from ? 'adoption' : 'date')
      : 'unchanged';
    const upcoming = st
      ? ATTENDABLE.has(st.event_type) && (st.event_date === null || st.event_date >= todayStr)
      : ATTENDABLE.has(e.event_type) && (e.event_date === null || e.event_date >= todayStr);
    const change: PlannedChange = { notice_id: e.notice_id, category: underlying, underlying, stored: st, proposed, upcoming, adopted_from: e.adopted_from, evidence: e.evidence ?? null };
    const v = input.verified.get(e.notice_id);
    if (v && (v.event_type !== proposed.event_type || v.event_date !== proposed.event_date)) {
      const by = supersedingNotice(v, input.noticesById.get(e.notice_id), input.familyNotices, input.today);
      change.category = 'uncertain';
      change.uncertain_reason = 'conflicts_verified_correction';
      change.verified = { ...v, superseded: !!by, superseded_by: by };
    } else if (underlying === 'date' && st?.event_date && !e.event_date) {
      change.category = 'uncertain';
      change.uncertain_reason = 'clears_stored_date';
    }
    return change;
  });
}

/** The changes a run may write. Report/off mode writes nothing. */
export function selectWrites(changes: PlannedChange[], mode: RefreshMode, categories: Set<ApplyCategory>, notices: Set<string>): PlannedChange[] {
  if (mode !== 'apply') return [];
  return changes.filter((c) => {
    if (notices.has(c.notice_id)) return true;
    if (c.category === 'uncertain') return false;
    if (c.category === 'unchanged') return categories.has('restamp');
    return categories.has(c.category);
  });
}

export function summarize(changes: PlannedChange[]) {
  const by = (pred: (c: PlannedChange) => boolean) => changes.filter(pred).length;
  const cats: ChangeCategory[] = ['new', 'date', 'adoption', 'type', 'unchanged', 'uncertain'];
  return Object.fromEntries(cats.map((k) => [k, { total: by((c) => c.category === k), upcoming: by((c) => c.category === k && c.upcoming) }])) as Record<ChangeCategory, { total: number; upcoming: number }>;
}

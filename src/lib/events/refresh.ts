/**
 * Event refresh (R2–R4, 2026-11-10) — keeps every upcoming event current from its source notices.
 *
 * Audit (tasks/intelligence-infrastructure-audit-2026-11-09.md): extract-sam-events read only the 500
 * newest notices by posted_date, so after ~5 days an event row was frozen — 124 of 157 upcoming events
 * came from notices it would never read again, it never picked up extractor fixes or amendments posted
 * as NEW notices, and `extracted_at` recorded first insertion only.
 *
 *   R2  candidates = every active candidate notice + every notice behind an upcoming event row.
 *   R3  amendments: within a confirmed solicitation family (same solicitation number — the existing
 *       familyIdentityKey / selectCanonicalVersion), an older notice's event adopts the CURRENT
 *       version's date when the current version states the same event type with a date. A current
 *       version that does not repeat the event is NOT a cancellation: the older row keeps its own date.
 *   R4  extracted_at is written on every upsert — it now means "last re-read", which is what
 *       queryFederalEvents' undated window and the data-inventory freshness line already assume.
 */
import { classifyEvent, extractEventDate } from './classify';
import { familyIdentityKey } from '@/lib/sam/solicitation-family';
import { selectCanonicalVersion } from '@/lib/sam/resolve-solicitation';

export const CANDIDATE_NOTICE_TYPES = ['Special Notice', 'Presolicitation', 'Sources Sought'] as const;
export const ATTENDABLE_EVENT_TYPES = ['industry_day', 'webinar', 'conference'] as const;
const ATTENDABLE = new Set<string>(ATTENDABLE_EVENT_TYPES);

export interface RefreshNotice {
  notice_id: string;
  title: string;
  description: string | null;
  notice_type: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  solicitation_number: string | null;
}

export interface ExtractedEvent {
  notice_id: string;
  event_type: string;
  event_date: string | null;
  /** Set when the date came from the solicitation's current version (R3). */
  adopted_from: string | null;
}

/** The deployed extractor, for one notice. Null = not an event or notice. */
export function extractEvent(n: RefreshNotice, today: Date = new Date()): ExtractedEvent | null {
  const c = classifyEvent(n.title, n.description, today);
  if (!c) return null;
  return { notice_id: n.notice_id, event_type: c.type, event_date: extractEventDate(n.title, n.description, c, n.response_deadline, today), adopted_from: null };
}

/**
 * R3. `events` are the extracted events to be written; `familyNotices` holds every known notice
 * (any type, active or not) that shares a solicitation number with one of them. Returns the events
 * with adopted dates applied, plus the list of adoptions for reporting.
 */
export function adoptCurrentVersionDates(
  events: ExtractedEvent[],
  noticesById: Map<string, RefreshNotice>,
  familyNotices: RefreshNotice[],
  today: Date = new Date(),
): { events: ExtractedEvent[]; adopted: Array<{ notice_id: string; from: string | null; to: string; current_notice_id: string }> } {
  const families = new Map<string, RefreshNotice[]>();
  for (const n of familyNotices) {
    const key = familyIdentityKey(n.solicitation_number, n.notice_id);
    if (!key.startsWith('sol:')) continue; // no confirmed identity → never linked (title merges are forbidden)
    const list = families.get(key) ?? [];
    if (!list.some((x) => x.notice_id === n.notice_id)) list.push(n);
    families.set(key, list);
  }
  const currentEvent = new Map<string, { notice_id: string; ev: ExtractedEvent | null }>();
  const adopted: Array<{ notice_id: string; from: string | null; to: string; current_notice_id: string }> = [];
  const out = events.map((ev) => {
    if (!ATTENDABLE.has(ev.event_type)) return ev;
    const n = noticesById.get(ev.notice_id);
    if (!n) return ev;
    const key = familyIdentityKey(n.solicitation_number, n.notice_id);
    const fam = key.startsWith('sol:') ? families.get(key) : undefined;
    if (!fam || fam.length < 2) return ev;
    if (!currentEvent.has(key)) {
      const current = selectCanonicalVersion(fam);
      currentEvent.set(key, { notice_id: current!.notice_id, ev: current ? extractEvent(current, today) : null });
    }
    const cur = currentEvent.get(key)!;
    if (cur.notice_id === ev.notice_id) return ev;
    if (!cur.ev || cur.ev.event_type !== ev.event_type || !cur.ev.event_date) return ev; // not repeated ≠ cancelled
    if (cur.ev.event_date === ev.event_date) return ev;
    adopted.push({ notice_id: ev.notice_id, from: ev.event_date, to: cur.ev.event_date, current_notice_id: cur.notice_id });
    return { ...ev, event_date: cur.ev.event_date, adopted_from: cur.notice_id };
  });
  return { events: out, adopted };
}

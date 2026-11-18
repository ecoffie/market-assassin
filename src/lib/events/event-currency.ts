/**
 * Event currency — keep every listed `sam_events` row equal to what the extractor reads from the
 * CURRENT version of its notice's solicitation family. Pure functions; the cron, the freshness
 * watchdog and the `verify:oracles` drift probe all call these, so "what the row should say" has
 * one definition.
 *
 * Why this exists (tasks/intelligence-infrastructure-audit-2026-11-09.md §2–4): the extractor read
 * the 500 newest notices only, so after ~5 days a row was frozen forever. It never picked up an
 * extractor fix, a description backfill, or an amendment posted as a NEW notice under the same
 * solicitation number (TSA `TSA25-04-0644`: original said Nov 17, Amendment 1 said Nov 18, and the
 * two rows disagreed until a manual write).
 *
 * Family rule (R3):
 *  - Identity is the SAM solicitation number only (`isSolicitationIdentifier` + `normalizeIdentifier`,
 *    the same rule `groupRowsBySolicitationNumber` uses). A blank or non-identifier number has no
 *    family — title merges are forbidden (`shouldMergeOnTitleDodaacNaics() === false`). That is a
 *    known bound (GOCO), reported, never guessed around.
 *  - The current version is `selectCanonicalVersion` (newest posted).
 *  - When the current version yields the SAME attendable event type WITH a date, every older notice
 *    in the family whose own reading is that type adopts that date.
 *  - A current version that does not repeat the event (a newer RFP that simply omits the industry
 *    day) is NOT a cancellation: older rows keep their own reading.
 *  - Notices (rfi / forecast) never adopt: their date is their own response deadline.
 */
import { classifyEvent, extractEventDate } from '@/lib/events/classify';
import { isSolicitationIdentifier, selectCanonicalVersion } from '@/lib/sam/resolve-solicitation';
import { normalizeIdentifier } from '@/lib/sam/solicitation-family';

/** Attendable types — mirrors `ATTENDABLE_TYPES` in query.ts (kept local to avoid a client import cycle). */
export const CURRENCY_ATTENDABLE_TYPES = ['industry_day', 'webinar', 'conference'] as const;

export function isAttendable(type: string | null | undefined): boolean {
  return (CURRENCY_ATTENDABLE_TYPES as readonly string[]).includes(type || '');
}

/** The SAM notice columns the extractor needs. */
export interface EventSourceNotice {
  notice_id: string;
  title: string | null;
  description: string | null;
  notice_type?: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  solicitation_number: string | null;
  active?: boolean | null;
  /** When Mindy first stored the notice — used to tell "not yet seen by a run" from drift. */
  created_at?: string | null;
}

export interface NoticeEventReading {
  type: string;
  date: string | null;
}

export interface ReconciledEvent extends NoticeEventReading {
  /** The family's current notice whose date this row adopted; null when the row kept its own reading. */
  adoptedFrom: string | null;
}

/** What the extractor reads from ONE notice, in isolation. */
export function readNoticeEvent(n: EventSourceNotice, today: Date = new Date()): NoticeEventReading | null {
  const title = n.title || '';
  const c = classifyEvent(title, n.description, today);
  if (!c) return null;
  return { type: c.type, date: extractEventDate(title, n.description, c, n.response_deadline, today) };
}

/** Family key: the normalized SAM solicitation number, or null when the notice has no linkable identity. */
export function familyKeyOf(solicitationNumber: string | null | undefined): string | null {
  const raw = String(solicitationNumber || '').trim();
  if (!raw || !isSolicitationIdentifier(raw)) return null;
  return normalizeIdentifier(raw);
}

export function groupFamilies<T extends { solicitation_number: string | null }>(rows: Iterable<T>): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = familyKeyOf(r.solicitation_number);
    if (!k) continue;
    const list = out.get(k) || [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/**
 * Reconcile each target notice's reading against its family's current version.
 *
 * `targets` = notices whose rows will be written; `familyPool` = every known notice in the targets'
 * families (any notice type, active or not — identity, not status, defines a family). Targets are
 * added to the pool automatically. Returns one entry per target that reads as an event.
 */
export function reconcileFamilyEvents(
  targets: EventSourceNotice[],
  familyPool: EventSourceNotice[],
  today: Date = new Date(),
): Map<string, ReconciledEvent> {
  const byId = new Map<string, EventSourceNotice>();
  for (const n of [...familyPool, ...targets]) byId.set(n.notice_id, n);
  const families = groupFamilies(byId.values());
  const readings = new Map<string, NoticeEventReading | null>();
  const read = (n: EventSourceNotice) => {
    if (!readings.has(n.notice_id)) readings.set(n.notice_id, readNoticeEvent(n, today));
    return readings.get(n.notice_id) ?? null;
  };

  const out = new Map<string, ReconciledEvent>();
  for (const t of targets) {
    const own = read(t);
    if (!own) continue;
    let result: ReconciledEvent = { ...own, adoptedFrom: null };
    const key = familyKeyOf(t.solicitation_number);
    if (key && isAttendable(own.type)) {
      const current = selectCanonicalVersion(families.get(key) || []);
      if (current && current.notice_id !== t.notice_id) {
        const cur = read(current);
        // Same type AND a date → adopt. A missing or different event on the newest version is
        // not a cancellation, so the row keeps its own reading.
        if (cur && cur.type === own.type && cur.date) {
          result = { type: own.type, date: cur.date, adoptedFrom: current.notice_id };
        }
      }
    }
    out.set(t.notice_id, result);
  }
  return out;
}

// ── Liveness of the source notice (R5) ──────────────────────────────────────────────────────

/**
 * A row is hidden when its source notice is INACTIVE and past its response window. Inactive
 * alone is not enough (an archived notice can still have a future window), and a missing
 * deadline is not "past" — an unknown window is not a closed one.
 */
export function isRetiredSource(
  n: { active?: boolean | null; response_deadline?: string | null } | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!n || n.active !== false) return false;
  const deadline = (n.response_deadline || '').slice(0, 10);
  if (!deadline) return false;
  return deadline < today.toISOString().slice(0, 10);
}

export type HiddenReason = 'retired_source' | 'undated_closed_notice';

/** Independent evidence that the event still has a FUTURE date (Eric, 2026-11-17 safeguard). */
export interface FutureConfirmation {
  kind: 'family_newer_notice' | 'catalog' | 'other_source';
  /** YYYY-MM-DD, today or later. */
  date: string;
  /** What confirmed it: the newer notice id, the catalog entry name, or the other row's notice id. */
  ref: string;
}

/**
 * Why a stored row is not listed, or null when it is listed. Hiding never deletes or alters a row;
 * hidden rows stay in sam_events and are returned by readers asked for `includeHidden`.
 *
 *  - `retired_source`: the source notice is inactive AND past its response window.
 *  - `undated_closed_notice`: an UNDATED attendable event behind a notice whose response window has
 *    closed. Before R2 the extractor only re-read ~5 days of notices, so "re-read recently" implied
 *    "current"; now every active notice is re-read daily, and an industry day with no stated date on
 *    a notice whose responses closed has, as far as Mindy can tell, already happened (102 of 143
 *    undated rows after a simulated run, 2026-11-17). A dated row is judged by its own date.
 *
 * Safeguard: a row with an independent confirmation of a future date is NEVER hidden.
 */
export function hiddenReason(
  row: { event_type: string | null; event_date: string | null },
  n: { active?: boolean | null; response_deadline?: string | null } | null | undefined,
  today: Date = new Date(),
  confirmation: FutureConfirmation | null = null,
): HiddenReason | null {
  const todayStr = today.toISOString().slice(0, 10);
  if (confirmation && confirmation.date >= todayStr) return null;
  if (isRetiredSource(n, today)) return 'retired_source';
  if (row.event_date || !isAttendable(row.event_type)) return null;
  const deadline = (n?.response_deadline || '').slice(0, 10);
  return deadline && deadline < todayStr ? 'undated_closed_notice' : null;
}

export function isUnlistableRow(
  row: { event_type: string | null; event_date: string | null },
  n: { active?: boolean | null; response_deadline?: string | null } | null | undefined,
  today: Date = new Date(),
  confirmation: FutureConfirmation | null = null,
): boolean {
  return hiddenReason(row, n, today, confirmation) !== null;
}

/** Minimum confidence for another source's row to count as confirmation (when it carries one). */
export const CONFIRM_MIN_CONFIDENCE = 0.7;

export interface ConfirmationRow {
  notice_id: string;
  title: string | null;
  event_type: string | null;
  event_date: string | null;
  source?: string | null;
  confidence?: number | null;
  solicitation_number?: string | null;
}

export interface CatalogFutureDate {
  name: string;
  /** YYYY-MM-DD */
  start: string;
}

/** Same-event key the readers already dedup on: lowercased title, first 60 chars. */
export function eventTitleKey(title: string | null | undefined): string {
  return (title || '').toLowerCase().slice(0, 60);
}

/** A catalog entry names this event: its full name (parenthetical removed) or its acronym appears in the title. */
export function catalogNameMatches(title: string | null | undefined, name: string): boolean {
  const t = (title || '').toLowerCase();
  if (!t) return false;
  const full = name.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (full.length >= 8 && t.includes(full)) return true;
  const acronym = /\(([A-Z][A-Z0-9&-]{2,})\)/.exec(name)?.[1];
  return Boolean(acronym && new RegExp(`\\b${acronym.replace(/[&-]/g, '\\$&')}\\b`, 'i').test(title || ''));
}

/**
 * Independent future-date confirmation for each target row, from (in order):
 *  1. a NEWER notice in the same solicitation family (posted on or after this one) whose stored
 *     attendable row has a future date;
 *  2. a curated catalog entry whose verified `next_occurrence` is in the future and names the event;
 *  3. another source's row (not SAM-extracted) for the same event (same title key) with a future
 *     date and, when it carries a confidence, at least CONFIRM_MIN_CONFIDENCE.
 */
export function findFutureConfirmations(
  targets: ConfirmationRow[],
  ctx: { rows: ConfirmationRow[]; postedById: Map<string, string | null>; catalog: CatalogFutureDate[] },
  today: Date = new Date(),
): Map<string, FutureConfirmation> {
  const todayStr = today.toISOString().slice(0, 10);
  const future = ctx.rows.filter((r) => isAttendable(r.event_type) && r.event_date && r.event_date.slice(0, 10) >= todayStr);
  const byFamily = groupFamilies(future.map((r) => ({ ...r, solicitation_number: r.solicitation_number ?? null })));
  const otherByTitle = new Map<string, ConfirmationRow>();
  for (const r of future) {
    if (!r.source || r.source === 'sam_gov') continue;
    if (typeof r.confidence === 'number' && r.confidence < CONFIRM_MIN_CONFIDENCE) continue;
    const k = eventTitleKey(r.title);
    if (k && !otherByTitle.has(k)) otherByTitle.set(k, r);
  }
  const catalog = ctx.catalog.filter((c) => c.start >= todayStr);
  const out = new Map<string, FutureConfirmation>();
  for (const t of targets) {
    const key = familyKeyOf(t.solicitation_number);
    const mine = ctx.postedById.get(t.notice_id) || '';
    const newer = key
      ? (byFamily.get(key) || []).find((r) => r.notice_id !== t.notice_id && (ctx.postedById.get(r.notice_id) || '') >= mine && Boolean(ctx.postedById.get(r.notice_id)))
      : undefined;
    if (newer) { out.set(t.notice_id, { kind: 'family_newer_notice', date: newer.event_date!.slice(0, 10), ref: newer.notice_id }); continue; }
    const cat = catalog.find((c) => catalogNameMatches(t.title, c.name));
    if (cat) { out.set(t.notice_id, { kind: 'catalog', date: cat.start, ref: cat.name }); continue; }
    const other = otherByTitle.get(eventTitleKey(t.title));
    if (other && other.notice_id !== t.notice_id) out.set(t.notice_id, { kind: 'other_source', date: other.event_date!.slice(0, 10), ref: other.notice_id });
  }
  return out;
}

// ── Drift (R6) ──────────────────────────────────────────────────────────────────────────────

export interface StoredEventRow {
  notice_id: string;
  event_type: string | null;
  event_date: string | null;
  solicitation_number?: string | null;
}

export type DriftReason = 'date' | 'type' | 'no_event' | 'source_missing';

export interface DriftFinding {
  notice_id: string;
  reason: DriftReason;
  stored: { type: string | null; date: string | null };
  expected: { type: string | null; date: string | null };
  /** No linkable solicitation number — the documented blank-sol bound, excluded from the count. */
  blankSolBound: boolean;
  /** The notice or a family member arrived after the last extractor run: next run's job, not drift. */
  pendingNextRun: boolean;
}

export interface DriftReport {
  examined: number;
  drift: DriftFinding[];
  /** Drift that counts: excludes the documented blank-solicitation bound and pending-next-run rows. */
  countable: number;
  blankSolBound: number;
  pendingNextRun: number;
  /** Rows no reader lists (`isUnlistableRow`): retired source, or undated behind a closed notice. */
  retiredSourceHidden: number;
}

/**
 * Upcoming attendable rows whose stored type/date ≠ extractor(current family version).
 * Rows whose source notice is retired (R5) are not listed anywhere, so they are counted
 * separately, not as drift.
 */
export function computeEventDrift(
  stored: StoredEventRow[],
  sources: EventSourceNotice[],
  familyPool: EventSourceNotice[],
  today: Date = new Date(),
  /** The last extractor run (max sam_events.extracted_at). Rows touched by notices stored after it are pending. */
  lastRunAt: string | null = null,
  confirmations: Map<string, FutureConfirmation> = new Map(),
): DriftReport {
  const families = groupFamilies([...familyPool, ...sources]);
  const arrivedAfterRun = (n: EventSourceNotice | undefined): boolean => {
    if (!lastRunAt || !n) return false;
    const after = (x: EventSourceNotice) => Boolean(x.created_at && Date.parse(x.created_at) > Date.parse(lastRunAt));
    const key = familyKeyOf(n.solicitation_number);
    return after(n) || (key ? (families.get(key) || []).some(after) : false);
  };
  const sourceById = new Map(sources.map((s) => [s.notice_id, s]));
  const live: StoredEventRow[] = [];
  let retiredSourceHidden = 0;
  for (const row of stored) {
    if (isUnlistableRow(row, sourceById.get(row.notice_id), today, confirmations.get(row.notice_id) ?? null)) retiredSourceHidden++;
    else live.push(row);
  }
  const targets = live.map((r) => sourceById.get(r.notice_id)).filter((s): s is EventSourceNotice => Boolean(s));
  const expected = reconcileFamilyEvents(targets, familyPool, today);

  const drift: DriftFinding[] = [];
  for (const row of live) {
    const src = sourceById.get(row.notice_id);
    const blankSolBound = !familyKeyOf(src?.solicitation_number ?? row.solicitation_number ?? null);
    const pendingNextRun = arrivedAfterRun(src);
    const storedV = { type: row.event_type, date: row.event_date ? row.event_date.slice(0, 10) : null };
    if (!src) {
      drift.push({ notice_id: row.notice_id, reason: 'source_missing', stored: storedV, expected: { type: null, date: null }, blankSolBound, pendingNextRun });
      continue;
    }
    const e = expected.get(row.notice_id);
    if (!e) {
      drift.push({ notice_id: row.notice_id, reason: 'no_event', stored: storedV, expected: { type: null, date: null }, blankSolBound, pendingNextRun });
    } else if (e.type !== storedV.type) {
      drift.push({ notice_id: row.notice_id, reason: 'type', stored: storedV, expected: { type: e.type, date: e.date }, blankSolBound, pendingNextRun });
    } else if ((e.date || null) !== storedV.date) {
      drift.push({ notice_id: row.notice_id, reason: 'date', stored: storedV, expected: { type: e.type, date: e.date }, blankSolBound, pendingNextRun });
    }
  }
  const blank = drift.filter((d) => d.blankSolBound).length;
  const pending = drift.filter((d) => !d.blankSolBound && d.pendingNextRun).length;
  return { examined: live.length, drift, countable: drift.length - blank - pending, blankSolBound: blank, pendingNextRun: pending, retiredSourceHidden };
}

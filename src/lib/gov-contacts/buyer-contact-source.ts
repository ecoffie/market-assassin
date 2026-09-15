/**
 * Decision Makers — the SAM buyer-contact source, as PURE logic.
 *
 * The canonical live producer for `federal_contacts` is the contacts pull inside
 * `/api/cron/sync-gov-buyer-data`. Before this module it had no schedule of its own, no
 * checkpoint, and no clocks: it re-read the newest 10 pages of `sam_opportunities` on every
 * invocation with `offset` reset to 0, which is an ~11-day rolling window over a 207,986-notice
 * corpus. Measured 2026-09-14: 9,904 rows touched in 24h from 7,248 notices spanning
 * posted_date 2026-09-03 → 2026-09-13, while 125,515 rows (50.8%) had not been touched in 90+ days.
 *
 * Everything here is transport-free and DB-free so the checkpoint algebra and the
 * write-classification can be tested without a database. The runner
 * (`buyer-contact-run.ts`) owns Supabase, the lock and the clocks.
 *
 * ── WHY THE CURSOR IS `created_at`, NOT `posted_date` AND NOT AN OFFSET ──
 *
 * An OFFSET over a table that grows at the head skips rows: every insert shifts the whole
 * tail by one, so the next run's `offset` lands past records it never read.
 *
 * `posted_date` looks like the natural source-native order and is WRONG here, provably.
 * SAM notices are frequently ingested days after they were posted, so a notice can arrive
 * BEHIND a cursor that has already advanced past its date. Measured 2026-09-14 over all
 * 207,986 rows: 34,906 (16.8%) were created more than 2 days after their posted_date,
 * 9,587 more than 14 days, worst case 30 days. A `posted_date` cursor would silently skip
 * every one of those.
 *
 * `created_at` is our own corpus insertion time. It is 100% populated (0 nulls, measured),
 * it is set by a column DEFAULT so an upsert-update never rewrites it, and a new row always
 * receives `now()` — which is greater than any cursor value already reached. A backfill lane
 * ordered by `(created_at ASC, notice_id ASC)` therefore CANNOT be jumped by a new arrival,
 * whatever its posted_date. `notice_id` breaks ties so the ordering is total and the keyset
 * is exact.
 *
 * The cost of that choice is that `created_at` says nothing about a notice being UPDATED in
 * place, which is why there are two lanes (see `LaneName`).
 */

import { isUsableContactName } from './contact-quality';
import { CONTACT_KIND_GOVERNMENT, type ContactKind } from './contact-kind';

/** `data_source_instances.source_key` for this source. */
export const DM_SOURCE_KEY = 'decision_makers_sam_contacts';
/** `data_source_instances.dataset_key` — the domain this source belongs to. */
export const DM_DATASET_KEY = 'decision_makers';
/** `ops_alert_state.alert_key` for this source's health alert. */
export const DM_ALERT_KEY = 'decision-makers-source-health';
/** Advisory-lock token — one checkpoint owner at a time. */
export const DM_LOCK_TOKEN = 'decision-makers-sam-contacts';

/**
 * BACKFILL drains history forward through `created_at`; REFRESH re-reads a bounded recent
 * window so live edits to current notices are still captured.
 *
 * Both lanes are required. A pure backfill would abandon recent notices for as long as the
 * drain takes; a pure refresh is what the source already did, and it is what left 50.8% of
 * the corpus untouched for 90+ days.
 */
export type LaneName = 'backfill' | 'refresh';

/** A `sam_opportunities` row as this source reads it. */
export interface SourceNotice {
  notice_id: string;
  solicitation_number: string | null;
  department: string | null;
  office: string | null;
  sub_tier: string | null;
  posted_date: string | null;
  created_at: string;
  points_of_contact: unknown;
}

/** A `federal_contacts` row as this source writes it. */
export interface ContactRow {
  source_row_key: string;
  contact_fullname: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  department_ind_agency: string | null;
  office: string | null;
  sub_tier: string | null;
  role_category: string;
  /**
   * AUTHORITATIVE government/vendor classification, set EXPLICITLY on every write.
   *
   * Deliberately not a DB default: `source` and `role_category` became meaningless precisely
   * because every row inherited a value no producer asserted. This producer only ever emits
   * notice POCs, so the value is always `government_buyer` — stated, not inherited.
   */
  contact_kind: ContactKind;
  solicitation_number: string | null;
  posted_date: string | null;
  source: string;
  raw_data: unknown;
}

/** Keyset position in the backfill lane. */
export interface BackfillCursor {
  createdAt: string;
  noticeId: string;
}

export function normalizeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * A SAM POC `fullName` is garbage when an agency stuffs the field with buyer-lookup
 * instructions, or when SAM itself has no real name and falls back to a
 * "Telephone: 7175503112" placeholder (measured 2026-07-26: 1,348 rows carried that
 * verbatim as the contact's name).
 *
 * Kept byte-identical in behaviour to the filter it replaces — this pass is about the
 * schedule and the checkpoint, not about changing which people are extracted.
 */
export function isGarbageContactName(name: string | null): boolean {
  if (!name) return true;
  if (name.length > 80) return true;
  if (/\b(see|visit|email|contact the|please)\b/i.test(name)) return true;
  if (!isUsableContactName(name)) return true;
  return false;
}

export interface ExtractOutcome {
  rows: ContactRow[];
  /** POC slots present on the notice, before any filtering. */
  slots: number;
  /** Slots dropped because the name was unusable. */
  rejectedName: number;
  /** Slots dropped because there was neither an email nor a phone (useless for outreach). */
  rejectedNoContact: number;
}

/**
 * Flatten one notice's `points_of_contact` into contact rows.
 *
 * `source_row_key` is `<notice_id>::<slot index>` — the SAME key the live producer has always
 * written, so this lane converges with (never duplicates) the rows already held. The index is
 * the position in the upstream array, so re-reading a notice re-derives the same keys.
 */
export function extractContactRows(notice: SourceNotice): ExtractOutcome {
  const pocs = Array.isArray(notice.points_of_contact) ? notice.points_of_contact : [];
  const rows: ContactRow[] = [];
  let rejectedName = 0;
  let rejectedNoContact = 0;

  pocs.forEach((raw, idx) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const fullName = normalizeValue(c.fullName);
    const email = normalizeValue(c.email);
    const phone = normalizeValue(c.phone);

    if (isGarbageContactName(fullName)) { rejectedName++; return; }
    if (!email && !phone) { rejectedNoContact++; return; }

    rows.push({
      source_row_key: `${notice.notice_id}::${idx}`,
      contact_fullname: fullName,
      contact_title:
        normalizeValue(c.title) ||
        (c.type === 'primary' ? 'Primary Contact' : c.type === 'secondary' ? 'Secondary Contact' : null),
      contact_email: email,
      contact_phone: phone,
      department_ind_agency: normalizeValue(notice.department),
      office: normalizeValue(notice.office),
      sub_tier: normalizeValue(notice.sub_tier),
      role_category: 'contracting',
      contact_kind: CONTACT_KIND_GOVERNMENT,
      solicitation_number: normalizeValue(notice.solicitation_number),
      posted_date: normalizeValue(notice.posted_date),
      source: 'sam_opportunities_poc',
      raw_data: raw,
    });
  });

  return { rows, slots: pocs.length, rejectedName, rejectedNoContact };
}

// ───────────────────────── cursor algebra ─────────────────────────

export function encodeCursor(c: BackfillCursor): string {
  return `${c.createdAt}|${c.noticeId}`;
}

export function decodeCursor(s: string | null | undefined): BackfillCursor | null {
  if (!s) return null;
  const i = s.indexOf('|');
  if (i <= 0 || i === s.length - 1) return null;
  const createdAt = s.slice(0, i);
  const noticeId = s.slice(i + 1);
  if (!createdAt || !noticeId) return null;
  return { createdAt, noticeId };
}

/**
 * The new cursor after a backfill batch.
 *
 * Returns the LAST notice of the batch — never the max of anything, because the batch is
 * already returned in `(created_at, notice_id)` order and taking a max over an unsorted set
 * would jump the rows between. A partial/failed batch must pass only the notices it truly
 * processed, so the cursor can never advance past unread work.
 */
export function advanceCursor(prev: BackfillCursor | null, processed: SourceNotice[]): BackfillCursor | null {
  if (processed.length === 0) return prev;
  const last = processed[processed.length - 1];
  return { createdAt: last.created_at, noticeId: last.notice_id };
}

/** True when `b` is strictly ahead of `a` in the keyset order. */
export function cursorIsAhead(a: BackfillCursor | null, b: BackfillCursor | null): boolean {
  if (!b) return false;
  if (!a) return true;
  if (b.createdAt !== a.createdAt) return b.createdAt > a.createdAt;
  return b.noticeId > a.noticeId;
}

// ───────────────────────── write classification ─────────────────────────

/**
 * Fields that carry meaning. `updated_at` is deliberately absent: it is written on every
 * touch, so including it would make every row look mutated and `last_data_advance` would
 * advance on a run that changed nothing — the exact "job success is not data advancement"
 * defect this source is being built to avoid.
 */
const MEANINGFUL_FIELDS: Array<keyof ContactRow> = [
  'contact_fullname',
  'contact_title',
  'contact_email',
  'contact_phone',
  'department_ind_agency',
  'office',
  'sub_tier',
  'role_category',
  // Included so an UNCLASSIFIED legacy row counts as CHANGED and the drain repairs it in place
  // as it sweeps — the backfill covers the corpus, this keeps it converged afterwards.
  'contact_kind',
  'solicitation_number',
  'posted_date',
];

export interface WritePlan {
  inserts: ContactRow[];
  updates: ContactRow[];
  unchangedCount: number;
}

/**
 * Split incoming rows against what is already held.
 *
 * Only inserts + updates are written. An unchanged row is not re-upserted at all, which is
 * what makes a zero-mutation run genuinely observable instead of being hidden behind a
 * blanket `updated_at = now()`.
 */
export function classifyWrites(incoming: ContactRow[], existing: Map<string, Partial<ContactRow>>): WritePlan {
  const inserts: ContactRow[] = [];
  const updates: ContactRow[] = [];
  let unchangedCount = 0;

  for (const row of incoming) {
    const prior = existing.get(row.source_row_key);
    if (!prior) { inserts.push(row); continue; }
    const changed = MEANINGFUL_FIELDS.some((f) => (prior[f] ?? null) !== (row[f] ?? null));
    if (changed) updates.push(row);
    else unchangedCount++;
  }

  return { inserts, updates, unchangedCount };
}

// ───────────────────────── run accounting ─────────────────────────

export interface RunStats {
  noticesScanned: number;
  pocSlots: number;
  contactsExtracted: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejectedName: number;
  rejectedNoContact: number;
  apiFailures: number;
  parseFailures: number;
}

export function emptyStats(): RunStats {
  return {
    noticesScanned: 0, pocSlots: 0, contactsExtracted: 0,
    inserted: 0, updated: 0, unchanged: 0,
    rejectedName: 0, rejectedNoContact: 0,
    apiFailures: 0, parseFailures: 0,
  };
}

export function mergeStats(a: RunStats, b: RunStats): RunStats {
  return {
    noticesScanned: a.noticesScanned + b.noticesScanned,
    pocSlots: a.pocSlots + b.pocSlots,
    contactsExtracted: a.contactsExtracted + b.contactsExtracted,
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    rejectedName: a.rejectedName + b.rejectedName,
    rejectedNoContact: a.rejectedNoContact + b.rejectedNoContact,
    apiFailures: a.apiFailures + b.apiFailures,
    parseFailures: a.parseFailures + b.parseFailures,
  };
}

/**
 * Did the DATA move? Only row mutations count.
 *
 * A completed run over an unchanged corpus is a successful CHECK, never a data advance —
 * so `last_data_advance` stays where it is and the source correctly reads as
 * "we looked, nothing moved" rather than "fresh".
 */
export function dataAdvanced(stats: RunStats): boolean {
  return stats.inserted + stats.updated > 0;
}

/**
 * A run is a VERIFIED check only when it completed without swallowing failures. A run that
 * hit API or parse errors looked at an incomplete slice of the source, so it must not stamp
 * `last_successful_check` / `last_verified_ingest`.
 */
export function runVerified(stats: RunStats): boolean {
  return stats.apiFailures === 0 && stats.parseFailures === 0;
}

// ───────────────────────── traversal coverage ─────────────────────────

export interface CoverageInput {
  /** Notices in the corpus carrying at least one POC — the intended source universe. */
  eligibleNotices: number;
  /** Notices at or before the backfill cursor — i.e. traversed by this source. */
  visitedNotices: number;
  /** `created_at` of the oldest notice NOT yet traversed. Null when the drain is complete. */
  oldestUnvisitedCreatedAt: string | null;
}

export interface CoverageReport extends CoverageInput {
  remainingNotices: number;
  percentVisited: number | null;
  complete: boolean;
}

/**
 * How much of the intended universe has actually been TRAVERSED.
 *
 * Deliberately derived from the cursor, never from `federal_contacts.updated_at`: a notice
 * whose POCs are all rejected by the quality filter leaves no row behind, so row presence
 * under-reports traversal and row recency measures the writer, not the reader.
 */
export function coverageReport(input: CoverageInput): CoverageReport {
  const remainingNotices = Math.max(0, input.eligibleNotices - input.visitedNotices);
  const percentVisited = input.eligibleNotices > 0
    ? Math.round((input.visitedNotices / input.eligibleNotices) * 10000) / 100
    : null;
  return {
    ...input,
    remainingNotices,
    percentVisited,
    complete: input.eligibleNotices > 0 && remainingNotices === 0,
  };
}

// ───────────────────────── health / alerting ─────────────────────────

export type SourceHealth = 'current' | 'ingest_stale' | 'draining' | 'unmeasured';

export interface HealthInput {
  lastSuccessfulCheck: string | null;
  lastDataAdvance: string | null;
  now: Date;
  /** Days of silence after which the PRODUCER is presumed broken. */
  checkStaleDays: number;
  coverage: CoverageReport;
}

export interface HealthResult {
  state: SourceHealth;
  /** Days since the producer last completed a verified check. Null when never. */
  checkAgeDays: number | null;
  /** Days since rows last mutated. Null when never. */
  dataAgeDays: number | null;
  /** Should an ops alert fire? */
  alert: boolean;
  reason: string;
}

function ageDays(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * UNKNOWN IS NEVER STALE. A source that has never completed a check reports `unmeasured` and
 * alerts, because inability to verify is itself the finding — it is never reported as
 * healthy, and never as a confident staleness claim about the data.
 *
 * A source mid-drain is `draining`, not stale: it is behind on COVERAGE, which is a
 * different fact from the producer being down, and conflating them is what let a
 * head-window sweep look healthy for months.
 */
export function evaluateSourceHealth(input: HealthInput): HealthResult {
  const checkAgeDays = ageDays(input.lastSuccessfulCheck, input.now);
  const dataAgeDays = ageDays(input.lastDataAdvance, input.now);

  if (checkAgeDays === null) {
    return {
      state: 'unmeasured', checkAgeDays, dataAgeDays, alert: true,
      reason: 'no verified check has ever completed for this source',
    };
  }
  if (checkAgeDays > input.checkStaleDays) {
    return {
      state: 'ingest_stale', checkAgeDays, dataAgeDays, alert: true,
      reason: `producer has not completed a verified check in ${checkAgeDays}d (budget ${input.checkStaleDays}d)`,
    };
  }
  if (!input.coverage.complete) {
    return {
      state: 'draining', checkAgeDays, dataAgeDays, alert: false,
      reason: `catch-up in progress — ${input.coverage.percentVisited ?? 0}% of ${input.coverage.eligibleNotices} notices traversed, ${input.coverage.remainingNotices} remaining`,
    };
  }
  return {
    state: 'current', checkAgeDays, dataAgeDays, alert: false,
    reason: 'producer current and traversal complete',
  };
}

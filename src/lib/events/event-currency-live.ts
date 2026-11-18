/**
 * Read-only loaders for event currency (extract-sam-events, check-data-freshness, verify:oracles).
 * Every population read is paged with `.range()` — PostgREST silently caps an unranged read at
 * 1,000 rows, which is exactly the kind of truncation that hid the frozen rows in the first place.
 * Every error is surfaced, never coalesced to an empty list.
 */
import { CURRENCY_ATTENDABLE_TYPES, computeEventDrift, familyKeyOf, findFutureConfirmations, hiddenReason, type DriftReport, type EventSourceNotice, type HiddenReason, type StoredEventRow } from './event-currency';
import { catalogFutureDates } from './catalog-occurrences';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export const SOURCE_NOTICE_COLS =
  'notice_id, title, description, department, notice_type, posted_date, response_deadline, ui_link, solicitation_number, office, sub_tier, active, created_at';

/** How far back an undated attendable row stays listed — mirrors UNDATED_EVENT_DAYS in query.ts. */
export const CURRENCY_UNDATED_DAYS = 30;

const PAGE = 1000;
const IN_CHUNK = 150;

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, deadline?: number): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    if (deadline && Date.now() > deadline) return { rows, complete: false };
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return { rows, complete: true };
  }
}

async function inChunks<T>(values: string[], fetch: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await fetch(values.slice(i, i + IN_CHUNK));
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

/** Stored attendable rows a reader would list today: dated upcoming, or undated and recently re-read. */
export async function loadListedAttendableRows(sb: Sb, today: Date = new Date()): Promise<StoredEventRow[]> {
  const todayStr = today.toISOString().slice(0, 10);
  const undatedSince = new Date(today.getTime() - CURRENCY_UNDATED_DAYS * 86400_000).toISOString().slice(0, 10);
  const { rows } = await pageAll<StoredEventRow>((from, to) =>
    sb.from('sam_events')
      .select('notice_id, event_type, event_date, solicitation_number')
      .in('event_type', [...CURRENCY_ATTENDABLE_TYPES])
      .or(`event_date.gte.${todayStr},and(event_date.is.null,extracted_at.gte.${undatedSince})`)
      .order('notice_id', { ascending: true })
      .range(from, to));
  return rows;
}

/** A listed sam_events row of ANY type (dated upcoming, or undated and re-read recently). */
export interface ListedEventRow {
  id: string;
  notice_id: string;
  title: string | null;
  event_type: string | null;
  event_date: string | null;
  source: string | null;
  confidence: number | null;
  solicitation_number: string | null;
}

/** Every listed row of ANY type — the frozen-row set R2 must re-read. */
export async function loadListedRows(sb: Sb, today: Date = new Date()): Promise<ListedEventRow[]> {
  const todayStr = today.toISOString().slice(0, 10);
  const undatedSince = new Date(today.getTime() - CURRENCY_UNDATED_DAYS * 86400_000).toISOString().slice(0, 10);
  const { rows } = await pageAll<ListedEventRow>((from, to) =>
    sb.from('sam_events')
      .select('id, notice_id, title, event_type, event_date, source, confidence, solicitation_number')
      .or(`event_date.gte.${todayStr},and(event_date.is.null,extracted_at.gte.${undatedSince})`)
      .order('notice_id', { ascending: true })
      .range(from, to));
  return rows;
}

/** Notice ids behind every listed row of ANY type. */
export async function loadUpcomingEventNoticeIds(sb: Sb, today: Date = new Date()): Promise<string[]> {
  return Array.from(new Set((await loadListedRows(sb, today)).map((r) => r.notice_id)));
}

export async function loadNoticesById<T = EventSourceNotice>(sb: Sb, ids: string[], cols = SOURCE_NOTICE_COLS): Promise<T[]> {
  return inChunks<T>(Array.from(new Set(ids)), (chunk) => sb.from('sam_opportunities').select(cols).in('notice_id', chunk));
}

/** Every notice in the given families (any type, active or not). Matches the raw stored numbers. */
export async function loadFamilyPool<T extends EventSourceNotice = EventSourceNotice>(sb: Sb, solicitationNumbers: Array<string | null | undefined>, cols = SOURCE_NOTICE_COLS): Promise<T[]> {
  const raw = Array.from(new Set(solicitationNumbers
    .filter((s): s is string => Boolean(familyKeyOf(s)))
    .flatMap((s) => [s, s.trim(), s.trim().toUpperCase()])));
  if (!raw.length) return [];
  const rows = await inChunks<T>(raw, (chunk) => sb.from('sam_opportunities').select(cols).in('solicitation_number', chunk));
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.notice_id) ? false : (seen.add(r.notice_id), true)));
}

/** Active extractor candidates, newest first, paged until done or the deadline passes. */
export async function loadActiveCandidates<T = EventSourceNotice>(sb: Sb, noticeTypes: string[], deadline?: number, cols = SOURCE_NOTICE_COLS): Promise<{ rows: T[]; complete: boolean }> {
  return pageAll<T>((from, to) =>
    sb.from('sam_opportunities')
      .select(cols)
      .in('notice_type', noticeTypes)
      .eq('active', true)
      .order('posted_date', { ascending: false })
      .order('notice_id', { ascending: true })
      .range(from, to), deadline);
}

/** The live drift probe: listed attendable rows vs extractor(current family version). */
export async function measureEventDrift(sb: Sb, today: Date = new Date()): Promise<DriftReport & { listed: number; lastRunAt: string | null }> {
  const { data: last, error } = await sb.from('sam_events')
    // unranged-ok: single-row watermark read.
    .select('extracted_at').order('extracted_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const lastRunAt = (last?.extracted_at as string | undefined) ?? null;
  const all = await loadListedRows(sb, today);
  const stored = all.filter((r) => (CURRENCY_ATTENDABLE_TYPES as readonly string[]).includes(r.event_type || ''));
  const sources = await loadNoticesById(sb, stored.map((r) => r.notice_id));
  const pool = await loadFamilyPool(sb, sources.map((s) => s.solicitation_number));
  // The same future-date safeguard the readers apply, so the probe examines exactly what is listed.
  const postedById = new Map<string, string | null>([...pool, ...sources].map((n) => [n.notice_id, n.posted_date]));
  const confirmations = findFutureConfirmations(stored, { rows: all, postedById, catalog: catalogFutureDates(today.toISOString().slice(0, 10)) }, today);
  return { listed: stored.length, lastRunAt, ...computeEventDrift(stored, sources, pool, today, lastRunAt, confirmations) };
}

// ── R5: rows no reader lists (retired source, or undated behind a closed notice) ─────────

const RETIRED_TTL_MS = 15 * 60_000;
export interface HiddenRow {
  notice_id: string;
  reason: HiddenReason;
}
let _hidden: { day: string; at: number; rows: HiddenRow[] } | null = null;

/**
 * Listed rows that `hiddenReason` hides, with the reason. Rows with an independent confirmation of a
 * future date (newer family notice, curated catalog occurrence, another source) are never included.
 * Nothing is deleted or altered — readers exclude these with `.not('notice_id','in',…)` (exact
 * totals) and return them, labelled, when asked for `includeHidden`. Cached per instance for 15 min.
 * Returns null when it could not be established — the caller then does not filter.
 */
export async function loadHiddenRows(sb: Sb, today: Date = new Date()): Promise<HiddenRow[] | null> {
  const day = today.toISOString().slice(0, 10);
  if (_hidden && _hidden.day === day && Date.now() - _hidden.at < RETIRED_TTL_MS) return _hidden.rows;
  try {
    const rows = await loadListedRows(sb, today);
    const ids = Array.from(new Set(rows.map((r) => r.notice_id)));
    // Only notices that could be hidden: inactive, or past their response window.
    const notices = await inChunks<{ notice_id: string; active: boolean | null; response_deadline: string | null; posted_date: string | null }>(ids, (chunk) =>
      sb.from('sam_opportunities').select('notice_id, active, response_deadline, posted_date').in('notice_id', chunk).or('active.eq.false,response_deadline.lt.' + day));
    const noticeById = new Map(notices.map((n) => [n.notice_id, n]));
    const candidates = rows.filter((r) => noticeById.has(r.notice_id) && hiddenReason(r, noticeById.get(r.notice_id), today) !== null);
    const hidden = await withSafeguard(sb, rows, candidates, noticeById, today);
    _hidden = { day, at: Date.now(), rows: hidden };
    return hidden;
  } catch (e) {
    console.error('[events:liveness] could not establish hidden rows:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Apply the future-date safeguard to hide candidates; returns the rows that stay hidden, with reasons. */
async function withSafeguard(
  sb: Sb,
  rows: ListedEventRow[],
  candidates: ListedEventRow[],
  noticeById: Map<string, { active: boolean | null; response_deadline: string | null; posted_date: string | null }>,
  today: Date,
): Promise<HiddenRow[]> {
  if (!candidates.length) return [];
  // Posted dates for the candidates' family siblings that carry a future attendable date.
  const fams = new Set(candidates.map((c) => familyKeyOf(c.solicitation_number)).filter(Boolean));
  const todayStr = today.toISOString().slice(0, 10);
  const siblings = rows.filter((r) => fams.has(familyKeyOf(r.solicitation_number)) && r.event_date && r.event_date >= todayStr && !noticeById.has(r.notice_id));
  const postedById = new Map<string, string | null>(Array.from(noticeById.entries()).map(([id, n]) => [id, n.posted_date]));
  if (siblings.length) {
    const sib = await inChunks<{ notice_id: string; posted_date: string | null }>(siblings.map((r) => r.notice_id), (chunk) =>
      sb.from('sam_opportunities').select('notice_id, posted_date').in('notice_id', chunk));
    for (const n of sib) postedById.set(n.notice_id, n.posted_date);
  }
  const confirmations = findFutureConfirmations(candidates, { rows, postedById, catalog: catalogFutureDates(todayStr) }, today);
  const out: HiddenRow[] = [];
  for (const c of candidates) {
    const reason = hiddenReason(c, noticeById.get(c.notice_id), today, confirmations.get(c.notice_id) ?? null);
    if (reason) out.push({ notice_id: c.notice_id, reason });
  }
  return out;
}

/** Notice ids of hidden rows (see loadHiddenRows); null when unknown. */
export async function loadRetiredSourceNoticeIds(sb: Sb, today: Date = new Date()): Promise<string[] | null> {
  const rows = await loadHiddenRows(sb, today);
  return rows ? rows.map((r) => r.notice_id) : null;
}

/** PostgREST list literal for `.not('notice_id', 'in', …)`; null when there is nothing to exclude. */
export function notInList(ids: string[] | null): string | null {
  const safe = (ids || []).filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
  return safe.length ? `(${safe.join(',')})` : null;
}

/** Test hook: clear the per-instance cache. */
export function _resetRetiredCache(): void {
  _hidden = null;
}

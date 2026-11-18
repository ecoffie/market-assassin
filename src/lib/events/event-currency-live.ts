/**
 * Read-only loaders for event currency (extract-sam-events, check-data-freshness, verify:oracles).
 * Every population read is paged with `.range()` — PostgREST silently caps an unranged read at
 * 1,000 rows, which is exactly the kind of truncation that hid the frozen rows in the first place.
 * Every error is surfaced, never coalesced to an empty list.
 */
import { CURRENCY_ATTENDABLE_TYPES, computeEventDrift, familyKeyOf, isUnlistableRow, type DriftReport, type EventSourceNotice, type StoredEventRow } from './event-currency';

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

/** Notice ids behind every upcoming row of ANY type (the frozen-row set R2 must re-read). */
export async function loadUpcomingEventNoticeIds(sb: Sb, today: Date = new Date()): Promise<string[]> {
  const todayStr = today.toISOString().slice(0, 10);
  const undatedSince = new Date(today.getTime() - CURRENCY_UNDATED_DAYS * 86400_000).toISOString().slice(0, 10);
  const { rows } = await pageAll<{ notice_id: string }>((from, to) =>
    sb.from('sam_events')
      .select('notice_id')
      .or(`event_date.gte.${todayStr},and(event_date.is.null,extracted_at.gte.${undatedSince})`)
      .order('notice_id', { ascending: true })
      .range(from, to));
  return Array.from(new Set(rows.map((r) => r.notice_id)));
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
  const stored = await loadListedAttendableRows(sb, today);
  const sources = await loadNoticesById(sb, stored.map((r) => r.notice_id));
  const pool = await loadFamilyPool(sb, sources.map((s) => s.solicitation_number));
  return { listed: stored.length, lastRunAt, ...computeEventDrift(stored, sources, pool, today, lastRunAt) };
}

// ── R5: rows no reader lists (retired source, or undated behind a closed notice) ─────────

const RETIRED_TTL_MS = 15 * 60_000;
let _retired: { day: string; at: number; ids: string[] } | null = null;

/**
 * Notice ids of listed rows that `isUnlistableRow` hides: the source notice is inactive AND past its
 * response window, or the row is an undated attendable event behind a closed notice. Readers exclude
 * them with `.not('notice_id','in',…)` so their counts stay exact. Cached per instance for 15 min.
 * Returns null when it could not be established — the caller then does not filter.
 */
export async function loadRetiredSourceNoticeIds(sb: Sb, today: Date = new Date()): Promise<string[] | null> {
  const day = today.toISOString().slice(0, 10);
  if (_retired && _retired.day === day && Date.now() - _retired.at < RETIRED_TTL_MS) return _retired.ids;
  try {
    const todayStr = day;
    const undatedSince = new Date(today.getTime() - CURRENCY_UNDATED_DAYS * 86400_000).toISOString().slice(0, 10);
    const { rows } = await pageAll<StoredEventRow>((from, to) =>
      sb.from('sam_events')
        .select('notice_id, event_type, event_date')
        .or(`event_date.gte.${todayStr},and(event_date.is.null,extracted_at.gte.${undatedSince})`)
        .order('notice_id', { ascending: true })
        .range(from, to));
    // Only notices that could be hidden: inactive ones, or ones behind an undated attendable row.
    const undated = new Set(rows.filter((r) => !r.event_date && CURRENCY_ATTENDABLE_TYPES.includes(r.event_type as never)).map((r) => r.notice_id));
    const inactive = await inChunks<{ notice_id: string; active: boolean | null; response_deadline: string | null }>(Array.from(new Set(rows.map((r) => r.notice_id))), (chunk) =>
      sb.from('sam_opportunities').select('notice_id, active, response_deadline').in('notice_id', chunk).or('active.eq.false,response_deadline.lt.' + todayStr));
    const rowById = new Map(rows.map((r) => [r.notice_id, r]));
    const ids = inactive
      .filter((n) => (n.active === false || undated.has(n.notice_id)) && isUnlistableRow(rowById.get(n.notice_id)!, n, today))
      .map((n) => n.notice_id);
    _retired = { day, at: Date.now(), ids };
    return ids;
  } catch (e) {
    console.error('[events:liveness] could not establish unlistable rows:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** PostgREST list literal for `.not('notice_id', 'in', …)`; null when there is nothing to exclude. */
export function notInList(ids: string[] | null): string | null {
  const safe = (ids || []).filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
  return safe.length ? `(${safe.join(',')})` : null;
}

/** Test hook: clear the per-instance cache. */
export function _resetRetiredCache(): void {
  _retired = null;
}

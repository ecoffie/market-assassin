/**
 * Canonical notice identity — UUID vs solicitation number must not silently
 * become different records with different deadlines.
 *
 * A SAM solicitation number can have several notices (base + amendments).
 * Looking up by sol# used to pick an arbitrary/latest row; looking up by
 * notice UUID picked a specific one. The two paths then disagreed on
 * response_deadline. Compare against the SAME notice UUID, and when sol#
 * maps to several UUIDs, say so instead of presenting one deadline as fact.
 */

export function isNoticeUuid(s: string): boolean {
  const t = s.trim();
  return /^[a-f0-9]{32}$/i.test(t) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(t);
}

export function normalizeNoticeUuid(s: string): string | null {
  const t = s.trim().replace(/-/g, '').toLowerCase();
  return t.length === 32 && /^[a-f0-9]{32}$/.test(t) ? t : null;
}

/** Calendar-day comparison. Timezone/offset noise is not a real deadline change. */
export function deadlineDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = String(value).match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function deadlinesConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = deadlineDay(a);
  const db = deadlineDay(b);
  if (!da || !db) return false;
  return da !== db;
}

const ENGLISH_MONTH: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** "13 August 2026" → YYYY-MM-DD. Used for lot due-dates written in the synopsis. */
export function parseEnglishDate(value: string): string | null {
  const m = String(value || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return deadlineDay(value);
  const month = ENGLISH_MONTH[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`;
}

export interface LotDeadline {
  lot: string;
  date: string;
  excerpt: string;
}

export type DeadlineConflictReason = 'sibling_notices' | 'lot_due_dates';

/**
 * Lot 1 / Lot 2 due dates in the notice body. Sibling-notice calendar
 * disagreement is a different class — this is one synopsis naming two dates.
 */
export function extractLotDeadlines(text: string): LotDeadline[] {
  if (!text) return [];
  const out: LotDeadline[] = [];
  const seen = new Set<string>();
  const re = /\bLot\s+(\d+)[\s\S]{0,240}?\bdue\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const date = parseEnglishDate(m[2]);
    if (!date) continue;
    const lot = `Lot ${m[1]}`;
    const key = `${lot}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      lot,
      date,
      excerpt: m[0].replace(/\s+/g, ' ').trim().slice(0, 160),
    });
  }
  return out;
}

export function lotDeadlinesConflict(
  samDeadline: string | null | undefined,
  lots: LotDeadline[],
): boolean {
  if (!lots.length) return false;
  const days = new Set(lots.map((l) => l.date));
  if (days.size > 1) return true;
  const only = [...days][0];
  return deadlinesConflict(only, samDeadline);
}

/** PIEE / WAWF lives in the synopsis, not a SOW heading. */
export function detectPiee(text: string): boolean {
  return /\bPIEE\b|Procurement Integrated Enterprise Environment|piee\.eb\.mil|\bWAWF\b/i.test(text || '');
}

/** Extract PIEE / WAWF URLs named in synopsis text (external attachment hosts). */
export function extractPieeLinks(text: string): string[] {
  const src = text || '';
  const found = new Set<string>();
  const re = /https?:\/\/\S*piee\.eb\.mil\S*/gi;
  for (const m of src.matchAll(re)) {
    const url = m[0].replace(/[.,;:)\]}>]+$/, '');
    if (url) found.add(url);
  }
  return [...found];
}

/**
 * When the Combined Synopsis / SOW lives on PIEE rather than SAM resourceLinks,
 * "no SOW heading" must not be read as "no scope exists".
 */
export function pieeRetrievalLimitation(links: string[]): string | null {
  if (!links.length) return null;
  return (
    'Scope documents are hosted on PIEE (external), not as SAM.gov resourceLinks. ' +
    'Mindy did not retrieve or read those attachments — absence of a SOW heading in the ' +
    'synopsis text does not establish that no SOW exists in the unread PIEE package. ' +
    `External link(s): ${links.join(' | ')}`
  );
}

export type CachedNoticeRow = {
  notice_id: string;
  solicitation_number: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  title?: string | null;
};

export type NoticeResolution =
  | 'uuid'
  | 'solicitation_unique'
  | 'solicitation_latest'
  | 'none';

export interface ResolvedCachedNotice {
  selected: CachedNoticeRow | null;
  siblings: CachedNoticeRow[];
  deadline_conflict: boolean;
  resolution: NoticeResolution;
  /** Every notice UUID that shares this solicitation number (selected first). */
  notice_ids: string[];
}

function postedMs(row: CachedNoticeRow): number {
  const t = row.posted_date ? Date.parse(row.posted_date) : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Given rows already fetched for a query, pick the notice the caller named.
 *
 * UUID query → that UUID only. Never substitute a later amendment.
 * Sol# query → unique row, or the latest posted with siblings listed when
 * several notices share the number. Deadline conflict is true when those
 * siblings disagree on calendar day.
 */
export function resolveCachedNotices(query: string, rows: CachedNoticeRow[]): ResolvedCachedNotice {
  const empty: ResolvedCachedNotice = {
    selected: null, siblings: [], deadline_conflict: false, resolution: 'none', notice_ids: [],
  };
  if (!query.trim() || rows.length === 0) return empty;

  const uuid = normalizeNoticeUuid(query);
  if (uuid) {
    const hit = rows.find((r) => normalizeNoticeUuid(r.notice_id) === uuid) ?? null;
    return {
      selected: hit,
      siblings: [],
      deadline_conflict: false,
      resolution: hit ? 'uuid' : 'none',
      notice_ids: hit ? [hit.notice_id] : [],
    };
  }

  const want = query.trim();
  const exact = rows.filter((r) => (r.solicitation_number || '').trim() === want);
  const pool = exact.length > 0 ? exact : rows;
  if (pool.length === 0) return empty;

  if (pool.length === 1) {
    return {
      selected: pool[0],
      siblings: [],
      deadline_conflict: false,
      resolution: 'solicitation_unique',
      notice_ids: [pool[0].notice_id],
    };
  }

  const sorted = [...pool].sort((a, b) => postedMs(b) - postedMs(a));
  const selected = sorted[0];
  const days = new Set(sorted.map((r) => deadlineDay(r.response_deadline)).filter((d): d is string => !!d));
  return {
    selected,
    siblings: sorted.slice(1),
    deadline_conflict: days.size > 1,
    resolution: 'solicitation_latest',
    notice_ids: sorted.map((r) => r.notice_id),
  };
}

/**
 * Assemble the extraction corpus for a notice. Display paths may cap
 * `extracted_text`; the compliance-matrix path must pass the FULL text the
 * documents actually hold, otherwise a paste of the same files extracts more
 * requirements than notice-id retrieval.
 */
export function assembleNoticeSourceText(input: {
  sow_text?: string | null;
  description?: string | null;
  documents: Array<{
    filename?: string | null;
    extracted_text?: string | null;
    extracted_text_truncated?: boolean;
    char_count?: number | null;
  }>;
}): { text: string; attachment_count: number; truncated_attachments: number } {
  const parts: string[] = [];
  const sow = (input.sow_text || '').trim();
  const desc = (input.description || '').trim();
  if (sow && !/^https?:\/\//i.test(sow)) parts.push(sow);
  if (desc && !/^https?:\/\//i.test(desc)) parts.push(desc);
  let truncated_attachments = 0;
  for (const d of input.documents) {
    const body = (d.extracted_text || '').trim();
    if (!body) continue;
    const trueLen = d.char_count ?? body.length;
    if (d.extracted_text_truncated || trueLen > body.length) truncated_attachments += 1;
    parts.push(`--- ${d.filename || 'attachment'} ---\n${body}`);
  }
  return {
    text: parts.join('\n\n').trim(),
    attachment_count: input.documents.filter((d) => (d.extracted_text || '').trim()).length,
    truncated_attachments,
  };
}

export function attachmentLocationNote(source: 'mindy_signed' | 'sam_public' | null): string | null {
  if (source === 'mindy_signed') {
    return 'Stored copy on Mindy (signed URL, ~1 hour).';
  }
  if (source === 'sam_public') {
    return 'File lives on SAM.gov, not in Mindy storage. Fetch the public URL; it is an external attachment location.';
  }
  return 'No downloadable copy was located for this file.';
}

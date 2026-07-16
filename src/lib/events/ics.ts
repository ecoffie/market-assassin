/**
 * RFC 5545 iCalendar (.ics) builder for federal contracting events — the packaging
 * half of the one-shot calendar tool: "put a year of federal events on my calendar"
 * becomes ONE agent call instead of hand-copying dates.
 *
 * Pure + dependency-free (no transport, no IO, no console.log — stdout is the MCP wire).
 *
 * ⚠️ NO-FABRICATION CONTRACT: a calendar entry is an assertion that something happens
 * on a specific day. We therefore emit a VEVENT **only for an event carrying a real
 * source date**; undated events are SKIPPED and counted, never guessed onto a day.
 * This is why the curated `get_federal_event_series` catalog gets no .ics — it holds
 * cadence ("quarterly") and typical_month ("annual · March"), not confirmed instances.
 */
import { createHash } from 'crypto';

export interface IcsEventInput {
  /** YYYY-MM-DD. Anything else (null/empty/malformed) → skipped, never invented. */
  date: string | null;
  title: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface IcsResult {
  /** VCALENDAR text, CRLF-delimited. Empty string when no event carried a real date. */
  ics: string;
  /** base64 of `ics` — what the MCP tool ships. Empty string when there are no events. */
  base64: string;
  /** VEVENTs actually written (events with a real date). */
  eventCount: number;
  /** Events dropped for having no usable date — surfaced, not silently swallowed. */
  skippedUndated: number;
}

const PRODID = '-//GovCon Giants//Mindy Federal Events//EN';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 5545 §3.3.11 TEXT escaping. Order matters — backslash first. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 content lines are capped at 75 OCTETS. Fold on the octet budget
 * (not string length) so a multi-byte char can't push a line over, and never split
 * a UTF-8 sequence across the fold.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = 75; // subsequent lines get a leading space, so their budget is 74
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off to a UTF-8 boundary: 0b10xxxxxx is a continuation byte.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return chunks.join('\r\n ');
}

/** Strict YYYY-MM-DD → YYYYMMDD, rejecting impossible dates (2026-02-31, month 13…). */
function toIcsDate(date: string): string | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Round-trip guards against JS Date's silent overflow rollover.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

/** All-day DTEND is EXCLUSIVE (RFC 5545 §3.6.1) — a 1-day event ends the NEXT day. */
function nextDay(icsDate: string): string {
  const y = Number(icsDate.slice(0, 4));
  const m = Number(icsDate.slice(4, 6));
  const d = Number(icsDate.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, '0')}${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** Stable UID: same event → same UID across runs, so re-importing UPDATES rather than duplicates. */
function eventUid(e: IcsEventInput, icsDate: string): string {
  const hash = createHash('sha256')
    .update(`${icsDate}|${e.title.trim().toLowerCase()}|${(e.url || '').trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
  return `${hash}@getmindy.ai`;
}

/**
 * Build a VCALENDAR from events. `now` is injectable so tests are deterministic.
 * Events without a real, valid date are skipped and reported in `skippedUndated`.
 */
export function buildEventsIcs(events: IcsEventInput[], now: Date = new Date()): IcsResult {
  const stamp = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;

  const lines: string[] = [];
  let eventCount = 0;
  let skippedUndated = 0;

  for (const e of events) {
    const icsDate = e.date ? toIcsDate(e.date.trim()) : null;
    if (!icsDate) {
      skippedUndated++;
      continue;
    }
    const title = (e.title || '').trim() || 'Federal contracting event';

    // Keep the registration URL in the body too — some clients hide the URL property.
    const descParts: string[] = [];
    if (e.description?.trim()) descParts.push(e.description.trim());
    if (e.url?.trim()) descParts.push(`Registration: ${e.url.trim()}`);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${eventUid(e, icsDate)}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(icsDate)}`);
    lines.push(`SUMMARY:${escapeText(title)}`);
    if (e.location?.trim()) lines.push(`LOCATION:${escapeText(e.location.trim())}`);
    if (descParts.length) lines.push(`DESCRIPTION:${escapeText(descParts.join('\n\n'))}`);
    if (e.url?.trim()) lines.push(`URL:${escapeText(e.url.trim())}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
    eventCount++;
  }

  // An empty VCALENDAR is not a useful artifact — return nothing and let the caller
  // report the honest miss.
  if (eventCount === 0) return { ics: '', base64: '', eventCount: 0, skippedUndated };

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...lines,
    'END:VCALENDAR',
  ]
    .map(foldLine)
    .join('\r\n');

  const ics = `${calendar}\r\n`; // RFC 5545: final line needs its terminator
  return { ics, base64: Buffer.from(ics, 'utf8').toString('base64'), eventCount, skippedUndated };
}

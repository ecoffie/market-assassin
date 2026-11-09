/**
 * Event classification and event-date extraction for SAM notices (extract-sam-events cron).
 *
 * Two defects this replaces, both measured 2026-11-09:
 *  1. An industry-day phrase ANYWHERE in the body typed the notice `industry_day`, and the type was
 *     checked before RFI words — so a draft RFP mentioning an "upcoming Industry Day" with no date
 *     became an attendable event.
 *  2. When no date parsed, the event date fell back to the notice's RESPONSE DEADLINE. The VA Air
 *     Ambulance industry day is "December 10-11, 2026" in its own text, but the range did not parse,
 *     so it was stored as Saturday Dec 5 — the response deadline.
 *
 * Evidence an attendable event needs: the event phrase in the TITLE, or the phrase in the body with
 * a parsed future date right next to it. The second keeps genuine events whose titles do not say so
 * ("Chemical Toilets" — "INDUSTRY DAY – NOVEMBER 17, 2026"; "GUN WEAPON SYSTEMS (GWS) Request for
 * Information" — "will host an in-person Industry Day ... on 19 November 2026").
 */

const ATTENDABLE_PHRASES: Record<'industry_day' | 'webinar', string[]> = {
  industry_day: [
    'industry day',
    'vendor day',
    'industry conference',
    'vendor outreach',
    'market research event',
    'industry engagement',
    'industry forum',
    'partnership forum',
    'pre-solicitation conference',
    'presolicitation conference',
    'pre-proposal conference',
    'preproposal conference',
    'pre-bid conference',
    'prebid conference',
    // A genuine event that was typed `forecast`: "Small Business Event - Acquisition Executive
    // Small Business Forum". Forecasts are not attendable, so it needs its own phrase.
    'small business event',
    'small business forum',
    'matchmaking',
  ],
  webinar: ['webinar', 'virtual event', 'online session', 'video conference', 'zoom meeting'],
};

// Whole words: "rfi" as a substring matched "waRFIghter" and typed food-service notices as RFIs.
const RFI = /\b(requests? for information|rfis?|sources sought|market survey)\b/i;
const FORECAST = ['forecast', 'projection', 'upcoming procurement', 'planned acquisition'];

/** How far (characters) a date may sit from the event phrase and still be that event's date. */
const DATE_WINDOW = 300;

export type EventEvidence = 'title' | 'description_dated' | 'keyword';

export interface EventClassification {
  type: string;
  evidence: EventEvidence;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};
const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';
const RANGE = '(?:\\s*(?:-|–|—|&ndash;|&mdash;|to|through|thru)\\s*(?:' + MONTH + '\\.?\\s+)?\\d{1,2})?';
const DATE_PATTERNS: { re: RegExp; parts: (m: RegExpExecArray) => [number, number, number] }[] = [
  // "December 10, 2026" · "December 10-11, 2026" · "Dec. 10 – Dec 11, 2026"
  { re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${RANGE},?\\s+(\\d{4})\\b`, 'gi'), parts: (m) => [Number(m[4]), MONTHS[m[1].toLowerCase()], Number(m[2])] },
  // "19 November 2026" · "10-11 December 2026"
  { re: new RegExp(`\\b(\\d{1,2})(?:\\s*(?:-|–|&ndash;|to)\\s*\\d{1,2})?\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, 'gi'), parts: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])] },
  // "11/19/2026" · "11/19/26"
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g, parts: (m) => [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]) - 1, Number(m[2])] },
];

/** Words that, just before a date, make it a deadline rather than the event. */
const DEADLINE_CUE = /\b(due|respon[sd]\w*|submi\w*|deadline|no later than|closing|closes|close of business|rsvp|register by|registration closes)\b[^.]{0,40}$/i;

interface FoundDate { iso: string; index: number }

/** Every parseable date in `text` that is today or later (UTC) and not cued as a deadline. */
export function findEventDates(text: string, today: Date = new Date()): FoundDate[] {
  const todayIso = today.toISOString().slice(0, 10);
  const out: FoundDate[] = [];
  for (const { re, parts } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const [y, mo, d] = parts(m);
      if (!(mo >= 0 && mo <= 11) || d < 1 || d > 31) continue;
      const dt = new Date(Date.UTC(y, mo, d));
      if (dt.getUTCMonth() !== mo) continue; // Feb 30 etc.
      const iso = dt.toISOString().slice(0, 10);
      if (iso < todayIso) continue;
      if (DEADLINE_CUE.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
      out.push({ iso, index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function phraseIndexes(text: string, phrases: string[]): number[] {
  const lower = text.toLowerCase();
  const idx: number[] = [];
  for (const p of phrases) {
    for (let i = lower.indexOf(p); i >= 0; i = lower.indexOf(p, i + 1)) idx.push(i);
  }
  return idx;
}

/** The date nearest an event phrase, within DATE_WINDOW characters; null when none qualifies. */
function nearestDate(text: string, phrases: string[], today: Date): string | null {
  const dates = findEventDates(text, today);
  const at = phraseIndexes(text, phrases);
  let best: { iso: string; dist: number } | null = null;
  for (const d of dates) {
    for (const i of at) {
      const dist = Math.abs(d.index - i);
      if (dist <= DATE_WINDOW && (!best || dist < best.dist)) best = { iso: d.iso, dist };
    }
  }
  return best?.iso ?? null;
}

export function classifyEvent(title: string, description: string | null, today: Date = new Date()): EventClassification | null {
  const t = title.toLowerCase();
  for (const [type, phrases] of Object.entries(ATTENDABLE_PHRASES)) {
    if (phrases.some((p) => t.includes(p))) return { type, evidence: 'title' };
  }
  const body = description || '';
  for (const [type, phrases] of Object.entries(ATTENDABLE_PHRASES)) {
    if (nearestDate(body, phrases, today)) return { type, evidence: 'description_dated' };
  }
  const text = `${title} ${body}`;
  if (RFI.test(text)) return { type: 'rfi', evidence: 'keyword' };
  if (FORECAST.some((k) => text.toLowerCase().includes(k))) return { type: 'forecast', evidence: 'keyword' };
  return null;
}

/**
 * The event's own date, or null when the notice does not state one. For an attendable event this
 * never falls back to the response deadline: an unknown date is reported as unknown. A notice
 * (rfi / forecast) is not an event — its date in sam_events is the notice's response deadline, as it
 * always was, and is shown as a notice, never as something to attend.
 */
export function extractEventDate(
  title: string,
  description: string | null,
  classification: EventClassification,
  responseDeadline: string | null,
  today: Date = new Date(),
): string | null {
  if (classification.type === 'rfi' || classification.type === 'forecast') {
    return responseDeadline?.split('T')[0] || null;
  }
  const phrases = ATTENDABLE_PHRASES[classification.type as keyof typeof ATTENDABLE_PHRASES] || [];
  // Title first, so a title-evidenced event can take a date from the opening of the body.
  return nearestDate(`${title}\n${description || ''}`, phrases, today);
}

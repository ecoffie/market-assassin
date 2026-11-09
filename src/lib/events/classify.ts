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

/**
 * Acquisition MILESTONES, not events (2026-11-09). NASA KSC SIMO lists "Contract award: On or about
 * February 11, 2027 · Contract start: April 1, 2027" and the old extractor stored April 1, 2027 as
 * an industry-day date. Tested against the clause right before the date (see precedingClause), so
 * "approx." inside "Contract phase-in (approx. 45 days):" does not hide the cue.
 */
const MILESTONE_CUE = /\b(contract (start|award|begin\w*|commence\w*|phase[- ]in)|award date|anticipated award|phase[- ]in|period of performance|performance (start|period|begin\w*)|commence\w*|(draft )?(rfp|rfq|rfi|solicitation|draft solicitation) (release|issuance)|release date|solicitation issuance|issu(e|es|ing|ance of) the solicitation|bid opening)\b[^\n]{0,50}$/i;

/** A sentence break: newline, or terminal punctuation followed by a capital letter. */
const SENTENCE_BREAK = /\n|[.!?;]\s+(?=[A-Z])/;

/** The text between the start of the date's own clause and the date. */
function precedingClause(text: string, index: number): string {
  const before = text.slice(Math.max(0, index - 80), index);
  const parts = before.split(SENTENCE_BREAK);
  return parts[parts.length - 1];
}

/**
 * Phrases that point at a list of dates further down ("JPL will host three webinars on the dates
 * listed below", then three dated lines ~330 characters later — outside DATE_WINDOW).
 */
const LIST_CUE = /^[^\n.]{0,60}?\b(on the (following )?dates? (listed )?below|on the following dates?|dates? listed below|event dates?\s*:|schedule\s*:)/i;
const LIST_WINDOW = 1200;

/**
 * An explicitly LABELED event or session date (2026-11-09). USCG "Doing Business with the USCG":
 * "Upcoming Session Details … Date: November 18, 2026 … Format: Virtual Webinar", followed by a
 * "Tentative Future Schedule" of later quarterly sessions. Proximity picked a later session; the
 * label names the one that is next. The label must be the WHOLE clause before the date (so
 * "Response Date:" or "Award Date:" never qualify — those are also removed by the deadline and
 * milestone cues), and THIS event type's own phrase must sit within DATE_WINDOW of it ("Format:
 * Virtual Webinar"). A session header alone is not enough: USCG's body opens with "Office of Small
 * Business and Industry Engagement", and a header-only rule typed the webinar an industry day.
 */
const SESSION_LABEL = /^\s*(?:(?:event|session|meeting|webinar|conference)\s+)?dates?(?:\s*(?:and|&)\s*times?)?\s*:\s*(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s*)?$/i;

/**
 * A date the notice itself says was replaced (2026-11-09). TSA Domestic Aviation Design Industry Day:
 * "Date : Tuesday, November 17, 2026 9:00 AM EDT (Amendment 1 updated this date to November 18,
 * 2026)". The struck date is never the event; the replacement date is found on its own.
 */
const SUPERSEDED_AFTER = /^[^\n]{0,60}?\b(updated|changed|moved|rescheduled|postponed|revised)\b[^\n]{0,40}?\bto\b/i;

interface FoundDate { iso: string; index: number }

/** Every parseable date in `text` that is today or later (UTC) and not cued as a deadline or milestone. */
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
      if (MILESTONE_CUE.test(precedingClause(text, m.index))) continue;
      if (SUPERSEDED_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 120))) continue;
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

/**
 * The date nearest an event phrase, within DATE_WINDOW characters; null when none qualifies.
 *
 * A date AFTER the phrase may sit anywhere in the window. A date BEFORE the phrase counts only in
 * the phrase's own paragraph (no line break between): SIMO's "SECTION 6: INDUSTRY ENGAGEMENT"
 * heading follows a milestone list, and the date above a heading belongs to the previous section.
 * Paragraph, not sentence: Navy RCO "The Disruptor Days event will occur starting the Week of
 * November 30, 2026 … The event will … brief their products in a traditional industry day format"
 * puts a genuine event's date in the sentence before the phrase. Milestone dates in the same
 * paragraph ("bid opening", "issuing the solicitation") are removed by MILESTONE_CUE instead.
 *
 * When no date qualifies and the phrase points at a list ("on the dates listed below"), the first
 * qualifying date within LIST_WINDOW after the cue is the event's date.
 */
function nearestDate(text: string, phrases: string[], today: Date): string | null {
  const dates = findEventDates(text, today);
  const at = phraseIndexes(text, phrases);
  // A labeled session date wins over proximity; past dates were already dropped, so the first
  // labeled date in reading order is the next session.
  for (const d of dates) {
    if (!SESSION_LABEL.test(precedingClause(text, d.index))) continue;
    if (at.some((i) => Math.abs(i - d.index) <= DATE_WINDOW)) return d.iso;
  }
  let best: { iso: string; dist: number } | null = null;
  for (const d of dates) {
    for (const i of at) {
      const dist = Math.abs(d.index - i);
      if (dist > DATE_WINDOW || (best && dist >= best.dist)) continue;
      if (d.index < i && text.slice(d.index, i).includes('\n')) continue;
      best = { iso: d.iso, dist };
    }
  }
  if (best) return best.iso;
  for (const i of at) {
    const cue = LIST_CUE.exec(text.slice(i));
    if (!cue) continue;
    const from = i + cue.index + cue[0].length;
    const listed = dates.find((d) => d.index >= from && d.index <= from + LIST_WINDOW);
    if (listed) return listed.iso;
  }
  return null;
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

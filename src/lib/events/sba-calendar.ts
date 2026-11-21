/**
 * SBA's public events listing (legacy.sba.gov/events) is server-rendered HTML with stable
 * data-test hooks: date, title, in-person/online, district, and a per-event page that carries
 * the address, host organization, and register link. No API key. This is the one official
 * calendar the extract-sam-events run adds. Other OSDBU homepages we checked are not a list
 * of dated events, so they are not scraped.
 */
import { linkColumns } from './event-links';
import { NEW_CALENDAR_EVENTS_PER_RUN } from './capture-plan';

export const SBA_EVENTS_ORIGIN = 'https://legacy.sba.gov';
export const SBA_LISTING_KEYWORDS = ['matchmaking', 'industry day', 'contracting', 'outreach'] as const;

/** Contracting, matchmaking, and small-business outreach. Generic classes ("Sales 101") stay out. */
export const CONTRACTING_EVENT = /\b(matchmaking|match making|industry day|industry briefing|sources sought|sam\.gov|vendor outreach|small business outreach|outreach session|outreach|government contract|federal contract|contracting|procurement|8\(a\)|hubzone|wosb|sdvosb|capability briefing)\b/i;

const FETCH_TIMEOUT_MS = 8_000;
export const CALENDAR_BUDGET_MS = 45_000;
const PAGES_PER_KEYWORD = 3;

export interface SbaTeaser {
  id: string;
  title: string;
  date: string | null;
  online: boolean;
  district: string | null;
  path: string;
}

export interface SbaDetail {
  date: string | null;
  location: string | null;
  online: boolean;
  host: string | null;
  registrationUrl: string | null;
  canonicalUrl: string | null;
  description: string | null;
}

export interface CalendarEventRow {
  notice_id: string;
  title: string;
  event_type: string;
  agency: string;
  event_date: string;
  event_location: string | null;
  description: string | null;
  registration_url: string | null;
  contact_info: string | null;
  source_notice_type: string;
  solicitation_number: null;
  inferred_dodaac: null;
  inferred_office: string | null;
  inferred_subagency: null;
  extracted_at: string;
  source: 'official_calendar';
}

function decode(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sbaNoticeId(id: string): string {
  return `sba:${id}`;
}

export function parseSbaListing(html: string): SbaTeaser[] {
  const out: SbaTeaser[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split('class="views-row"').slice(1)) {
    const href = /href="(\/event\/(\d+))"/.exec(chunk);
    if (!href || seen.has(href[2])) continue;
    const titleRaw = /data-test="eventTitle"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(chunk);
    const title = titleRaw ? decode(titleRaw[1]) : '';
    if (!title) continue;
    const when = /datetime="(\d{4}-\d{2}-\d{2})/.exec(chunk);
    const district = /data-test-district-office="([^"]*)"/.exec(chunk);
    seen.add(href[2]);
    out.push({
      id: href[2],
      title,
      date: when ? when[1] : null,
      online: /event-teaser__location-type\s+online/.test(chunk),
      district: district ? decode(district[1]) : null,
      path: href[1],
    });
  }
  return out;
}

export function parseSbaDetail(html: string): SbaDetail {
  const when = /datetime="(\d{4}-\d{2}-\d{2})/.exec(html);
  const line1 = /class="address-line1">([^<]*)</.exec(html);
  const city = /class="locality">([^<]*)</.exec(html);
  const state = /class="administrative-area">([^<]*)</.exec(html);
  const zip = /class="postal-code">([^<]*)</.exec(html);
  const place = [line1?.[1], [city?.[1], state?.[1]].filter(Boolean).join(', '), zip?.[1]]
    .filter(Boolean)
    .map((s) => decode(s || ''))
    .filter(Boolean)
    .join(', ');
  const host = /event-detail__host-organizer[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html);
  const register = /data-test="registerButton"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-test="registerButton"/.exec(html);
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
  const desc = /data-test="eventDetails"[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html);
  const registrationRaw = register?.[1] || register?.[2] || null;
  const registrationUrl = registrationRaw ? registrationRaw.replace(/&amp;/g, '&') : null;
  const registrationUsable = registrationUrl && /^https:\/\//i.test(registrationUrl) && !/safelinks\.protection\.outlook\.com|urldefense\.com/i.test(registrationUrl)
    ? registrationUrl
    : null;
  return {
    date: when ? when[1] : null,
    location: place || null,
    online: /class="location-type online"/.test(html),
    host: host ? decode(host[1]) : null,
    registrationUrl: registrationUsable,
    canonicalUrl: canonical && /^https:\/\//i.test(canonical[1]) ? canonical[1] : null,
    description: desc ? decode(desc[1]).slice(0, 500) : null,
  };
}

function eventType(title: string, online: boolean): string {
  const t = title.toLowerCase();
  if (t.includes('webinar') || t.includes('virtual')) return 'webinar';
  if (online && !t.includes('industry day') && !t.includes('matchmaking')) return 'webinar';
  return 'industry_day';
}

export function sbaEventFromParts(teaser: SbaTeaser, detail: SbaDetail, runAt: string): CalendarEventRow | null {
  const date = detail.date || teaser.date;
  if (!date) return null;
  const sourceUrl = detail.canonicalUrl || `${SBA_EVENTS_ORIGIN}${teaser.path}`;
  const online = detail.online || teaser.online;
  const location = detail.location || (online ? 'Virtual' : null);
  if (!location) return null;
  const host = detail.host || (teaser.district ? `SBA ${teaser.district}` : 'U.S. Small Business Administration');
  const text = `${teaser.title} ${detail.description || ''}`;
  if (!CONTRACTING_EVENT.test(text)) return null;
  const links = linkColumns({
    registrationUrl: detail.registrationUrl,
    virtualUrl: null,
    location,
    sourceUrl,
  });
  return {
    notice_id: sbaNoticeId(teaser.id),
    title: teaser.title.slice(0, 300),
    event_type: eventType(teaser.title, online),
    agency: 'Small Business Administration',
    event_date: date,
    event_location: location,
    description: detail.description,
    registration_url: links.registration_url,
    contact_info: links.contact_info,
    source_notice_type: 'SBA event',
    solicitation_number: null,
    inferred_dodaac: null,
    inferred_office: host,
    inferred_subagency: null,
    extracted_at: runAt,
    source: 'official_calendar',
  };
}

async function getText(fetchImpl: typeof fetch, url: string, deadline: number): Promise<string> {
  if (Date.now() > deadline) throw new Error('calendar budget elapsed');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'text/html' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

/** A listing page we could read. `unreadable` is not an empty calendar. */
export function classifySbaListing(html: string): 'rows' | 'empty' | 'unreadable' {
  if (html.includes('class="views-row"') || html.includes("class='views-row'")) return 'rows';
  if (/of\s+0\s+events/i.test(html) || /no (upcoming )?events/i.test(html) || html.includes('sba-events-header')) return 'empty';
  return 'unreadable';
}

export type SbaCalendarStatus = 'ok' | 'degraded' | 'unavailable';

export interface SbaCalendarResult {
  status: SbaCalendarStatus;
  /** Rows safe to upsert. Empty when the source was unreadable. Not a count of the source. */
  events: CalendarEventRow[];
  /** Set only when status is ok. A failed read is null, never 0. */
  relevant: number | null;
  deferred: number | null;
  error: string | null;
}

export async function collectSbaEvents(opts: {
  fetchImpl?: typeof fetch;
  today: Date;
  runAt: string;
  cap?: number;
  budgetMs?: number;
  existingIds?: Set<string>;
}): Promise<SbaCalendarResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cap = opts.cap ?? NEW_CALENDAR_EVENTS_PER_RUN;
  const deadline = Date.now() + (opts.budgetMs ?? CALENDAR_BUDGET_MS);
  const todayStr = opts.today.toISOString().slice(0, 10);
  const existing = opts.existingIds ?? new Set<string>();
  const teasers = new Map<string, SbaTeaser>();
  let listingOk = 0;
  let failed = false;
  let error: string | null = null;

  const noteFailure = (e: unknown) => {
    failed = true;
    error = error || (e instanceof Error ? e.message : String(e));
  };

  try {
    for (const keyword of SBA_LISTING_KEYWORDS) {
      if (failed) break;
      for (let page = 0; page < PAGES_PER_KEYWORD; page++) {
        if (Date.now() > deadline) {
          noteFailure(new Error('calendar budget elapsed'));
          break;
        }
        const url = `${SBA_EVENTS_ORIGIN}/events?keyword=${encodeURIComponent(keyword)}&field_event_dates_value=3&page=${page}`;
        let html: string;
        try {
          html = await getText(fetchImpl, url, deadline);
        } catch (e) {
          noteFailure(e);
          break;
        }
        let kind: 'rows' | 'empty' | 'unreadable';
        try {
          kind = classifySbaListing(html);
          if (kind === 'unreadable') throw new Error(`listing did not parse: ${url}`);
        } catch (e) {
          noteFailure(e);
          break;
        }
        listingOk++;
        if (kind === 'empty') break;
        const rows = parseSbaListing(html);
        if (!rows.length) break;
        for (const row of rows) teasers.set(row.id, row);
      }
    }
  } catch (e) {
    noteFailure(e);
  }

  if (listingOk === 0) {
    return { status: 'unavailable', events: [], relevant: null, deferred: null, error: error || 'SBA events listing was not read' };
  }

  const relevant = [...teasers.values()].filter((t) => {
    if (!CONTRACTING_EVENT.test(t.title)) return false;
    if (t.date && t.date < todayStr) return false;
    return true;
  });
  const fresh = relevant.filter((t) => !existing.has(sbaNoticeId(t.id)));
  const chosen = fresh.slice(0, cap);
  const deferred = Math.max(0, fresh.length - chosen.length);
  const events: CalendarEventRow[] = [];
  for (const teaser of chosen) {
    if (Date.now() > deadline) {
      noteFailure(new Error('calendar budget elapsed'));
      break;
    }
    try {
      const html = await getText(fetchImpl, `${SBA_EVENTS_ORIGIN}${teaser.path}`, deadline);
      const row = sbaEventFromParts(teaser, parseSbaDetail(html), opts.runAt);
      if (row && row.event_date >= todayStr) events.push(row);
    } catch (e) {
      noteFailure(e);
    }
  }

  if (failed) {
    return { status: 'degraded', events, relevant: null, deferred: null, error };
  }
  return { status: 'ok', events, relevant: relevant.length, deferred, error: null };
}

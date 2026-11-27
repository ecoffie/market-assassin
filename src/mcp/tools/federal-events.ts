/**
 * MCP tool: search_federal_events — upcoming industry days, matchmaking, and
 * sources-sought events for an agency. "Where do I show up in person to win this
 * buyer?" — the 6th market-scan question.
 *
 * Wraps src/lib/events/query.ts: grounded `sam_events` (DoDAAC-office-anchored) +
 * dated curated-catalog occurrences + an OPTIONAL paid AI web-discovery pass (association conferences not in SAM).
 * credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { isAttendableType, queryFederalEvents, type FederalEvent } from '@/lib/events/query';
import type { RegionalEvent } from '@/lib/events/regional-catalog';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { buildEventsIcs } from '@/lib/events/ics';
import { mcpFlags } from '@/lib/mcp/flags';

export interface FederalEventsToolInput {
  /** Optional when a state / near is given. */
  agency?: string;
  /** State(s): codes or names ("CT", "Connecticut", ["CT","MA"], "CT, MA"). */
  state?: string | string[];
  /** "City, ST" (e.g. "Hartford, CT"): adds the state to the filter and orders that city's regional rows first. */
  near?: string;
  months_ahead?: number;
  include_ai_discovery?: boolean;
  limit?: number;
  /** Also return a base64 .ics of the DATED events, for one-shot calendar import. */
  include_ics?: boolean;
}

export interface FederalEventsToolResult {
  queried: { agency: string; months_ahead: number; states?: string[]; near_city?: string | null };
  events: FederalEvent[];
  /**
   * State/regional matchmakers and APEX Accelerator events for the requested state(s), from official organizer
   * pages. event_date null = no upcoming date stated: tell the user to check the organizer page (date_note).
   */
  regional_events?: RegionalEvent[];
  /** Which requested states the regional catalog covers; for the rest, point to the fallback directory. */
  regional_coverage?: { covered: string[]; not_covered: string[]; fallback: { name: string; url: string } };
  /** base64 VCALENDAR — present only when include_ics is set AND ≥1 event has a real date. */
  ics?: string;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    sam_count: number;
    ai_count: number;
    /** Dated rows from the curated catalog, each read from the organizer's page. */
    catalog_count: number;
    /** Returned events a person attends (industry day, webinar, conference). Forecast notices are not
     *  attendable; they are counted in notice_count. */
    attendable_count: number;
    /** Returned notices (sources sought / RFI) that are not events to attend. */
    notice_count: number;
    /** Exact SAM rows in the window before the limit. null = unreadable, never 0. */
    sam_attendable_total: number | null;
    sam_notice_total: number | null;
    ai_discovery: 'off' | 'ran' | 'unavailable';
    /** VEVENTs written. Only present when include_ics ran. */
    ics_events?: number;
    /** Events left OUT of the .ics for having no real date — never guessed onto a day. */
    ics_skipped_undated?: number;
    /**
     * Location filter (present only when state/near was given). location_unknown: SAM events in the window whose
     * state could not be established — say "N more with no stated location"; never present them as matches.
     * null = the location lookup failed (unknown, not zero).
     */
    location_filter?: {
      states: string[];
      matched: number;
      matched_by_place_of_performance: number;
      matched_by_buying_office: number;
      other_states: number;
      location_unknown: number | null;
    };
    regional_count?: number;
    /** Values that could not be read as a US state (never widen the search). */
    ignored_states?: string[];
  };
}

/** Parse state / near into 2-letter codes. Unreadable values are reported, never guessed. */
export function resolveEventLocation(state: unknown, near: unknown): { states: string[]; nearCity: string | null; ignored: string[] } {
  const raw = Array.isArray(state) ? state.map(String) : typeof state === 'string' ? state.split(/\s*[,;\/&]\s*|\s+(?:or|and)\s+/i) : [];
  const states: string[] = [];
  const ignored: string[] = [];
  for (const t of raw.map((x) => x.trim()).filter(Boolean)) {
    const c = normalizeStateCode(t);
    if (c) { if (!states.includes(c)) states.push(c); } else ignored.push(t);
  }
  let nearCity: string | null = null;
  if (typeof near === 'string' && near.trim()) {
    const m = near.trim().match(/^(.*?)[,\s]+([A-Za-z .]+)$/);
    const st = m ? normalizeStateCode(m[2].trim()) : null;
    if (st) { nearCity = m![1].trim() || null; if (!states.includes(st)) states.push(st); }
    else ignored.push(near.trim());
  }
  return { states, nearCity, ignored };
}

export async function searchFederalEvents(input: FederalEventsToolInput): Promise<FederalEventsToolResult> {
  const agency = (input.agency || '').trim();
  const months = Math.min(Math.max(Number(input.months_ahead) || 4, 1), 12);
  const loc = resolveEventLocation(input.state, input.near);
  const hasLocation = loc.states.length > 0;

  const res = await queryFederalEvents({
    agency,
    states: loc.states,
    nearCity: loc.nearCity,
    monthsAhead: months,
    includeAiDiscovery: input.include_ai_discovery === true,
    includeCatalog: true,
    currentYear: new Date().getFullYear(),
    limit: input.limit,
  });

  // A failed SAM read with only curated rows left is still a failed search: return the rows, but do
  // not report (or bill) it as a completed lookup.
  const onlyCatalogAfterFailure = res.degraded && res.samCount === 0 && res.aiCount === 0;
  const grounded = (res.events.length > 0 || res.regional.length > 0) && !onlyCatalogAfterFailure;
  const attendableCount = res.events.filter((e) => isAttendableType(e.event_type)).length;
  const result: FederalEventsToolResult = {
    queried: { agency, months_ahead: months, ...(hasLocation ? { states: loc.states, near_city: loc.nearCity } : {}) },
    events: res.events,
    ...(hasLocation ? { regional_events: res.regional, regional_coverage: res.regionalCoverage ?? undefined } : {}),
    _meta: {
      grounded,
      degraded: res.degraded,
      count: res.events.length,
      sam_count: res.samCount,
      ai_count: res.aiCount,
      catalog_count: res.catalogCount,
      attendable_count: attendableCount,
      notice_count: res.events.length - attendableCount,
      sam_attendable_total: res.samAttendableTotal,
      sam_notice_total: res.samNoticeTotal,
      ai_discovery: res.aiDiscovery,
      ...(res.locationFilter ? { location_filter: res.locationFilter, regional_count: res.regional.length } : {}),
      ...(loc.ignored.length ? { ignored_states: loc.ignored } : {}),
    },
  };

  if (input.include_ics === true) {
    const cal = buildEventsIcs(
      res.events.map((e) => ({
        date: e.event_date,
        endDate: e.event_end_date,
        title: e.title,
        location: e.location,
        description: e.description,
        url: e.url,
      })),
    );
    if (cal.base64) result.ics = cal.base64;
    result._meta.ics_events = cal.eventCount;
    result._meta.ics_skipped_undated = cal.skippedUndated;
  }

  if (mcpFlags.aiHint) {
    const top = res.events[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'Event lookup errored — retry; do not state there are no events.'
        : grounded
        ? `${res.events.length} event(s) for "${agency}" in the next ${months} month(s) (${res.samCount} from SAM.gov, ${res.catalogCount} from the curated catalog, ${res.aiCount} AI-discovered), attendable events first, then notices, each soonest first. Top: ${top.title}${top.event_date ? ` on ${top.event_date}` : ' (date TBD)'}${top.location ? ` — ${top.location}` : ''}.`
        : `No upcoming events found for "${agency}" in the next ${months} month(s). Widen months_ahead${res.aiDiscovery === 'off' ? ', or set include_ai_discovery to search the web for association conferences' : ''}.`,
      how_to_use: grounded
        ? `source="sam" events are grounded SAM.gov notices (trust the date). event_type="rfi" is a sources-sought notice to respond to, not an event to attend. source="catalog" events are curated, with the date read from the organizer's page (see source_url, verified_at). source="ai" events are web-discovered — treat confidence as a verify-before-attending signal, and confirm the date/registration on the linked page. matched_office is the decoded buying office. registration_url is where to sign up.${
            result.ics
              ? ' `ics` is a base64 .ics — decode it to a file the user imports into Google/Outlook/Apple Calendar to add every dated event at once.'
              : ''
          }`
        : 'No grounded events; tell the user none were found rather than inventing an industry day.',
      key_caveats: [
        ...(res.locationFilter
          ? [
              `Location filter ${loc.states.join(', ')}: SAM events matched on place of performance, else the buying office state.${
                res.locationFilter.location_unknown == null
                  ? ' The location lookup failed, so events without a known state could not be checked — say so, never "none".'
                  : res.locationFilter.location_unknown > 0
                    ? ` ${res.locationFilter.location_unknown} more event(s) in the window have no stated location — say "N more with no stated location", never list them as in-state.`
                    : ''
              }`,
              `regional_events are state matchmakers / APEX Accelerator events from official organizer pages; event_date null means no upcoming date is stated — tell the user to check the organizer page.${
                res.regionalCoverage?.not_covered.length
                  ? ` Not yet covered: ${res.regionalCoverage.not_covered.join(', ')} — point them to ${res.regionalCoverage.fallback.url}.`
                  : ''
              }`,
            ]
          : []),
        'AI-discovered events (source="ai") can be misdated or loosely attributed — always verify via the URL before committing travel.',
        ...(input.include_ics === true
          ? [
              result._meta.ics_skipped_undated
                ? `The .ics covers only the ${result._meta.ics_events} event(s) carrying a real date; ${result._meta.ics_skipped_undated} undated event(s) were left out rather than guessed onto a day — track those manually.`
                : 'The .ics covers only events carrying a real source date; undated events are never assigned a guessed day.',
            ]
          : []),
        res.aiDiscovery === 'unavailable'
          ? 'AI discovery was requested but web search is not configured on this deployment — only SAM.gov events were returned.'
          : 'SAM.gov event coverage skews toward DoD Special Notices; a civilian agency with few events may be a coverage gap, not a truly empty calendar.',
      ],
    };
  }
  return result;
}

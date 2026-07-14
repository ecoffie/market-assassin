/**
 * MCP tool: search_federal_events — upcoming industry days, matchmaking, and
 * sources-sought events for an agency. "Where do I show up in person to win this
 * buyer?" — the 6th market-scan question.
 *
 * Wraps src/lib/events/query.ts: grounded `sam_events` (DoDAAC-office-anchored) +
 * an OPTIONAL paid AI web-discovery pass (association conferences not in SAM).
 * credits: 2. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { queryFederalEvents, type FederalEvent } from '@/lib/events/query';
import { mcpFlags } from '@/lib/mcp/flags';

export interface FederalEventsToolInput {
  agency: string;
  months_ahead?: number;
  include_ai_discovery?: boolean;
  limit?: number;
}

export interface FederalEventsToolResult {
  queried: { agency: string; months_ahead: number };
  events: FederalEvent[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    sam_count: number;
    ai_count: number;
    ai_discovery: 'off' | 'ran' | 'unavailable';
  };
}

export async function searchFederalEvents(input: FederalEventsToolInput): Promise<FederalEventsToolResult> {
  const agency = (input.agency || '').trim();
  const months = Math.min(Math.max(Number(input.months_ahead) || 4, 1), 12);

  const res = await queryFederalEvents({
    agency,
    monthsAhead: months,
    includeAiDiscovery: input.include_ai_discovery === true,
    currentYear: new Date().getFullYear(),
    limit: input.limit,
  });

  const grounded = res.events.length > 0;
  const result: FederalEventsToolResult = {
    queried: { agency, months_ahead: months },
    events: res.events,
    _meta: {
      grounded,
      degraded: res.degraded,
      count: res.events.length,
      sam_count: res.samCount,
      ai_count: res.aiCount,
      ai_discovery: res.aiDiscovery,
    },
  };

  if (mcpFlags.aiHint) {
    const top = res.events[0];
    result._ai_hint = {
      summary: res.degraded
        ? 'Event lookup errored — retry; do not state there are no events.'
        : grounded
        ? `${res.events.length} event(s) for "${agency}" in the next ${months} month(s) (${res.samCount} from SAM.gov, ${res.aiCount} AI-discovered), soonest first. Top: ${top.title}${top.event_date ? ` on ${top.event_date}` : ' (date TBD)'}${top.location ? ` — ${top.location}` : ''}.`
        : `No upcoming events found for "${agency}" in the next ${months} month(s). Widen months_ahead${res.aiDiscovery === 'off' ? ', or set include_ai_discovery to search the web for association conferences' : ''}.`,
      how_to_use: grounded
        ? 'source="sam" events are grounded SAM.gov Special Notices (trust the date). source="ai" events are web-discovered — treat confidence as a verify-before-attending signal, and confirm the date/registration on the linked page. matched_office is the decoded buying office. registration_url is where to sign up.'
        : 'No grounded events; tell the user none were found rather than inventing an industry day.',
      key_caveats: [
        'AI-discovered events (source="ai") can be misdated or loosely attributed — always verify via the URL before committing travel.',
        res.aiDiscovery === 'unavailable'
          ? 'AI discovery was requested but web search is not configured on this deployment — only SAM.gov events were returned.'
          : 'SAM.gov event coverage skews toward DoD Special Notices; a civilian agency with few events may be a coverage gap, not a truly empty calendar.',
      ],
    };
  }
  return result;
}

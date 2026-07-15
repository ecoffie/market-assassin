/**
 * MCP tool: get_federal_event_series — the curated calendar of RECURRING federal-
 * contracting event series (AFCEA, NDIA, SAME, APEX Accelerators, GSA…) plus the major
 * annual conferences, filterable by agency / category / keyword. Answers "where do
 * contractors network in my market year over year" — complements search_federal_events
 * (which returns dated one-off SAM Special Notices) with the standing series a bidder
 * should put on the calendar.
 *
 * Pure static-catalog read from src/data/federal-events-sources.json (hand-curated).
 * tier: metered, credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import eventsStaticData from '@/data/federal-events-sources.json';
import { mcpFlags } from '@/lib/mcp/flags';

export interface EventSeriesInput {
  /** Filter to series serving this agency (matches the series' agencies[] / audience). */
  agency?: string;
  /** Filter by category, e.g. "matchmaking", "training", "conference", "industry_day". */
  category?: string;
  /** Free-text filter over name / notes / audience. */
  query?: string;
}

export interface EventSeriesRow {
  id: string;
  name: string;
  kind: 'recurring' | 'annual_conference';
  cadence: string; // frequency (recurring) or typical month (annual)
  url: string | null;
  categories: string[];
  agencies: string[];
  audience: string | null;
  location: string | null;
  cost: string | null;
  value: string | null;
  notes: string | null;
}

export interface EventSeriesResult {
  series: EventSeriesRow[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    total_in_catalog: number;
    returned: number;
    recurring: number;
    annual_conferences: number;
    filtered_by: string[];
    catalog_updated: string | null;
  };
}

type EventSourceEntry = {
  name?: string;
  url?: string;
  type?: string;
  frequency?: string;
  categories?: string[];
  agencies?: string[];
  notes?: string;
  cost?: string;
  value?: string;
};
type AnnualConference = {
  name?: string;
  typical_month?: string;
  location?: string;
  audience?: string;
  registration_cost?: string;
  value?: string;
  url?: string;
};

const data = eventsStaticData as {
  lastUpdated?: string;
  eventSources?: Record<string, EventSourceEntry>;
  majorAnnualConferences?: AnnualConference[];
};

/** Flatten the two catalog shapes into one uniform series list. */
function allSeries(): EventSeriesRow[] {
  const rows: EventSeriesRow[] = [];
  for (const [id, s] of Object.entries(data.eventSources || {})) {
    rows.push({
      id,
      name: s.name || id,
      kind: 'recurring',
      cadence: s.frequency || 'varies',
      url: s.url || null,
      categories: s.categories || [],
      agencies: s.agencies || [],
      audience: null,
      location: null,
      cost: s.cost || null,
      value: s.value || null,
      notes: s.notes || null,
    });
  }
  (data.majorAnnualConferences || []).forEach((c, i) => {
    rows.push({
      id: `conf_${i}_${(c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
      name: c.name || `Conference ${i + 1}`,
      kind: 'annual_conference',
      cadence: c.typical_month ? `annual · ${c.typical_month}` : 'annual',
      url: c.url || null,
      categories: ['conference'],
      agencies: [],
      audience: c.audience || null,
      location: c.location || null,
      cost: c.registration_cost || null,
      value: c.value || null,
      notes: null,
    });
  });
  return rows;
}

export function getFederalEventSeries(input: EventSeriesInput): EventSeriesResult {
  const agency = (input.agency || '').trim().toLowerCase();
  const category = (input.category || '').trim().toLowerCase();
  const query = (input.query || '').trim().toLowerCase();
  const filteredBy: string[] = [];
  if (agency) filteredBy.push('agency');
  if (category) filteredBy.push('category');
  if (query) filteredBy.push('query');

  const catalog = allSeries();

  const matched = catalog.filter((r) => {
    if (agency) {
      const hay = `${r.agencies.join(' ')} ${r.audience || ''}`.toLowerCase();
      // "multi-agency"/"government-wide" series serve every agency query.
      if (!hay.includes(agency) && !/multi-?agency|government-?wide|all agencies/i.test(hay)) return false;
    }
    if (category && !r.categories.some((c) => c.toLowerCase().includes(category))) return false;
    if (query) {
      const hay = `${r.name} ${r.notes || ''} ${r.audience || ''} ${r.categories.join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const recurring = matched.filter((r) => r.kind === 'recurring').length;
  const conferences = matched.filter((r) => r.kind === 'annual_conference').length;

  const result: EventSeriesResult = {
    series: matched,
    _meta: {
      grounded: matched.length > 0,
      degraded: false, // static read — never a provider failure
      total_in_catalog: catalog.length,
      returned: matched.length,
      recurring,
      annual_conferences: conferences,
      filtered_by: filteredBy,
      catalog_updated: data.lastUpdated || null,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary:
        matched.length === 0
          ? `No curated event series matched${filteredBy.length ? ` the ${filteredBy.join(' + ')} filter` : ''}. The catalog holds ${catalog.length} series; try a broader agency/category or drop a filter.`
          : `${matched.length} event series (${recurring} recurring, ${conferences} annual conference${conferences === 1 ? '' : 's'})${filteredBy.length ? ` for the given ${filteredBy.join(' + ')}` : ''} — the standing calendar where this market's buyers and primes gather.`,
      how_to_use:
        'Put the high-value recurring series (matchmaking, industry days) and annual conferences on the BD calendar. Register early — these are where you meet the buyer and teaming partners in person. Cross-reference search_federal_events for the specific DATED instances an agency has posted.',
      key_caveats: [
        `Curated catalog (last updated ${data.lastUpdated || 'n/a'}) — dates are cadence/typical-month, not confirmed instances; verify the current date + registration on the linked site.`,
        'Agency filtering is best-effort over each series\' declared agencies/audience; multi-agency and government-wide series are included for any agency query.',
        'This is the recurring SERIES calendar, not a live event feed — for a specific posted event, use search_federal_events.',
      ],
    };
  }
  return result;
}

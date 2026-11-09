/**
 * MCP tool: get_federal_event_series — the curated calendar of RECURRING federal-
 * contracting event series (AFCEA, NDIA, SAME, APEX Accelerators, GSA…) plus the major
 * annual conferences, filterable by agency / category / keyword. Answers "where do
 * contractors network in my market year over year" — complements search_federal_events
 * (which returns dated one-off SAM Special Notices) with the standing series a bidder
 * should put on the calendar.
 *
 * Pure static-catalog read from src/data/federal-events-sources.json (hand-curated).
 * tier: metered, credits: 5. `_meta` always ships; `_ai_hint` OFF by default.
 */
import eventsStaticData from '@/data/federal-events-sources.json';
import { mcpFlags } from '@/lib/mcp/flags';
import { currentOccurrence, type CatalogOccurrence } from '@/lib/events/catalog-occurrences';

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
  /** The next dated instance, only when read from the organizer's page and not yet over. */
  next_occurrence: CatalogOccurrence | null;
  /** Per-entry check against the organizer's own site. null = never checked. */
  verification: CatalogVerification | null;
}

/**
 * verified_upcoming = the organizer's site shows a dated upcoming event (or listing) · link_ok = the
 * link resolves to the organizer's page but no date was read · no_next_announced · unverifiable =
 * the site refuses automated reads · paused / not_found / unverified = see note. Editing the file
 * does not make an entry current — only this status does.
 */
export interface CatalogVerification {
  status: 'verified_upcoming' | 'link_ok' | 'no_next_announced' | 'unverifiable' | 'paused' | 'not_found' | 'unverified';
  checked_at: string;
  source_url: string;
  note?: string;
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
    /** Last edit to ANY entry. Not a review of the whole catalog: see catalog_last_full_review. */
    catalog_updated: string | null;
    /** Last time every entry was reviewed. */
    catalog_last_full_review: string | null;
    /** Entries per verification status across the whole catalog (not just the returned rows). */
    catalog_verification: Record<string, number>;
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
  verification?: CatalogVerification;
};
type AnnualConference = {
  name?: string;
  typical_month?: string;
  location?: string;
  audience?: string;
  registration_cost?: string;
  value?: string;
  url?: string;
  agencies?: string[];
  next_occurrence?: CatalogOccurrence;
  /** A single dated event rather than an annual series. */
  one_off?: boolean;
  verification?: CatalogVerification;
};

const data = eventsStaticData as {
  lastUpdated?: string;
  lastFullReview?: string;
  eventSources?: Record<string, EventSourceEntry>;
  majorAnnualConferences?: AnnualConference[];
};

/** Flatten the two catalog shapes into one uniform series list. */
function allSeries(todayStr: string): EventSeriesRow[] {
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
      next_occurrence: null,
      verification: s.verification || null,
    });
  }
  (data.majorAnnualConferences || []).forEach((c, i) => {
    rows.push({
      id: `conf_${i}_${(c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
      name: c.name || `Conference ${i + 1}`,
      kind: 'annual_conference',
      cadence: c.one_off ? `dated event · ${c.typical_month || 'see date'}` : c.typical_month ? `annual · ${c.typical_month}` : 'annual',
      url: c.url || null,
      categories: ['conference'],
      agencies: c.agencies || [],
      audience: c.audience || null,
      location: c.location || null,
      cost: c.registration_cost || null,
      value: c.value || null,
      notes: null,
      next_occurrence: currentOccurrence(c.next_occurrence, todayStr),
      verification: c.verification || null,
    });
  });
  return rows;
}

/** Words too common in this catalog to establish a match on their own. */
const WEAK_TOKENS = new Set([
  'a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to', 'with',
  'annual', 'business', 'businesses', 'conference', 'conferences', 'contracting', 'contractor', 'contractors',
  'day', 'days', 'event', 'events', 'federal', 'government', 'industry', 'small',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** veteran/veterans match; a token of 4+ letters also matches as a prefix (cyber/cybersecurity). */
function tokenHits(token: string, hay: string[]): boolean {
  const stem = token.length > 3 ? token.replace(/s$/, '') : token;
  return hay.some((h) => h === token || (stem.length > 3 && h.startsWith(stem)));
}

/**
 * Relevance of a series to a free-text query; 0 = not a match. The whole phrase always matches, as it
 * always has. Otherwise at least 60% of the query's words must match, including one word specific
 * enough to mean something, and a query of only common words must match all of them. So "veteran
 * small business engagement NVSBE" finds NVSBE, and "small business conference" does not return
 * every series that mentions small business.
 */
export function seriesQueryScore(row: Pick<EventSeriesRow, 'name' | 'notes' | 'audience' | 'categories'>, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = row.name.toLowerCase();
  const hay = `${name} ${row.notes || ''} ${row.audience || ''} ${row.categories.join(' ')}`.toLowerCase();
  const phrase = hay.includes(q) ? 100 : 0;
  const tokens = [...new Set(tokenize(q))];
  const hayTokens = tokenize(hay);
  const matched = tokens.filter((t) => tokenHits(t, hayTokens));
  const strong = tokens.filter((t) => !WEAK_TOKENS.has(t));
  const enough = strong.length === 0
    ? matched.length === tokens.length
    : matched.length >= Math.ceil(tokens.length * 0.6) && matched.some((t) => !WEAK_TOKENS.has(t));
  if (!phrase && (!tokens.length || !enough)) return 0;
  const nameTokens = tokenize(name);
  const inName = matched.filter((t) => tokenHits(t, nameTokens)).length;
  return phrase + (name.includes(q) ? 100 : 0) + inName * 2 + matched.length;
}

export function getFederalEventSeries(input: EventSeriesInput): EventSeriesResult {
  const agency = (input.agency || '').trim().toLowerCase();
  const category = (input.category || '').trim().toLowerCase();
  const query = (input.query || '').trim().toLowerCase();
  const filteredBy: string[] = [];
  if (agency) filteredBy.push('agency');
  if (category) filteredBy.push('category');
  if (query) filteredBy.push('query');

  const catalog = allSeries(new Date().toISOString().slice(0, 10));

  const matched = catalog.filter((r) => {
    if (agency) {
      const hay = `${r.agencies.join(' ')} ${r.audience || ''}`.toLowerCase();
      // "multi-agency"/"government-wide" series serve every agency query.
      if (!hay.includes(agency) && !/multi-?agency|government-?wide|all agencies/i.test(hay)) return false;
    }
    if (category && !r.categories.some((c) => c.toLowerCase().includes(category))) return false;
    if (query && seriesQueryScore(r, query) === 0) return false;
    return true;
  });

  if (query) matched.sort((a, b) => seriesQueryScore(b, query) - seriesQueryScore(a, query));

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
      catalog_last_full_review: data.lastFullReview || null,
      catalog_verification: catalog.reduce<Record<string, number>>((acc, r) => {
        const k = r.verification?.status || 'never_checked';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
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
        `Curated catalog (last edited ${data.lastUpdated || 'n/a'}, last fully reviewed ${data.lastFullReview || 'n/a'}) — dates are cadence/typical-month unless next_occurrence is set, so entries can be out of date; verify the current date + registration on the linked site.`,
        'Agency filtering is best-effort over each series\' declared agencies/audience; multi-agency and government-wide series are included for any agency query.',
        'This is the recurring SERIES calendar, not a live event feed — for a specific posted event, use search_federal_events.',
      ],
    };
  }
  return result;
}

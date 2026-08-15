/**
 * Federal events query — the data core of the MCP `search_federal_events` tool.
 * "Where do I show up in person to win this agency?" — upcoming industry days,
 * matchmaking, and sources-sought events.
 *
 * Two sources, merged:
 *   1. `sam_events` (cron-populated from SAM.gov Special Notices, DoDAAC-office-
 *      anchored) — the always-on, dated, grounded source. Cheap Supabase read.
 *   2. Optional AI web discovery (`searchEventsViaAI`, Serper + Groq) — surfaces
 *      association conferences (AFCEA/NDIA/SAME) that aren't in SAM. Off by default;
 *      degrades honestly to "unavailable" when Serper/Groq aren't configured.
 *
 * Agency-scoped (NOT bound to a user's saved target list, unlike the /target-events
 * route it's lifted from). Matching keys off the shared normalizeAgencyKey so a
 * plain "Department of Defense" resolves the messy "DEFENSE, DEPARTMENT OF" rows.
 */
import { createClient } from '@supabase/supabase-js';
import { normalizeAgencyKey, isValidDodaac } from '@/lib/gov-contacts/agency-key';
import { searchEventsViaAI } from '@/lib/events/ai-event-discovery';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const COLUMNS =
  'notice_id, title, event_type, agency, event_date, event_location, description, registration_url, source, confidence, inferred_office, inferred_subagency';

export interface FederalEventsInput {
  agency: string;
  /** Look-ahead window in months (default 4 ≈ 120 days, max 12). */
  monthsAhead?: number;
  /** Run the paid AI web discovery pass (Serper + Groq). Default false. */
  includeAiDiscovery?: boolean;
  /** Current year, passed in for the AI year-biasing (e.g. "AFCEA 2026"). */
  currentYear: number;
  limit?: number;
}

export interface FederalEvent {
  source: 'sam' | 'ai';
  title: string;
  event_type: string;
  event_date: string | null; // YYYY-MM-DD; null for undated AI-discovered series
  location: string | null;
  url: string | null;
  description: string | null;
  matched_office: string | null; // the decoded buying office, not "DEFENSE"
  confidence: number | null; // AI rows only (0..1); null for grounded SAM rows
}

export interface FederalEventsResult {
  events: FederalEvent[];
  samCount: number;
  aiCount: number;
  /** off = not requested; ran = executed; unavailable = requested but Serper/Groq not configured. */
  aiDiscovery: 'off' | 'ran' | 'unavailable';
  degraded: boolean; // the grounded SAM read hard-failed
}

export async function queryFederalEvents(input: FederalEventsInput): Promise<FederalEventsResult> {
  const agency = (input.agency || '').trim();
  const months = Math.min(Math.max(Number(input.monthsAhead) || 4, 1), 12);
  // Local sam_events table (not an external API), so a larger default is free.
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + months * 30);
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);

  // Match term: the normalized agency key ("Department of Defense" → "DEFENSE")
  // catches the messy raw values; fall back to the raw string if normalization
  // strips everything (all-stopword input).
  const key = normalizeAgencyKey(agency) || agency;
  const term = key.replace(/[%_,]/g, ' ').trim();

  let degraded = false;
  const events: FederalEvent[] = [];
  const seen = new Set<string>();

  // ── Source 1: sam_events (grounded, dated) ────────────────────────────────
  if (term) {
    const { data, error } = await supabase
      .from('sam_events')
      .select(COLUMNS)
      .gte('event_date', todayStr)
      .lte('event_date', horizonStr)
      .or(`agency.ilike.%${term}%,inferred_office.ilike.%${term}%,inferred_subagency.ilike.%${term}%`)
      .order('event_date', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[events:query] sam_events read failed:', error.message);
      degraded = true;
    } else {
      for (const row of data || []) {
        const isAi = row.source === 'ai_web_search'; // AI rows already backfilled into the table
        const dedupKey = (row.title || '').toLowerCase().slice(0, 60);
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        events.push({
          source: isAi ? 'ai' : 'sam',
          title: row.title,
          event_type: row.event_type || 'event',
          event_date: row.event_date,
          location: row.event_location ?? null,
          url: row.registration_url ?? null,
          description: row.description ?? null,
          matched_office: row.inferred_office || row.inferred_subagency || row.agency || null,
          confidence: isAi && typeof row.confidence === 'number' ? row.confidence : null,
        });
      }
    }
  }
  const samCount = events.length;

  // ── Source 2: on-demand AI web discovery (optional, paid) ─────────────────
  let aiDiscovery: FederalEventsResult['aiDiscovery'] = 'off';
  if (input.includeAiDiscovery && agency) {
    const ai = await searchEventsViaAI({
      agency,
      horizonDays: months * 30,
      currentYear: input.currentYear,
    });
    if (ai.reason === 'web_search_not_configured' || ai.reason === 'ai_not_configured') {
      aiDiscovery = 'unavailable';
    } else {
      aiDiscovery = 'ran';
      for (const e of ai.events) {
        const dedupKey = (e.title || '').toLowerCase().slice(0, 60);
        if (seen.has(dedupKey)) continue; // SAM rows win
        seen.add(dedupKey);
        events.push({
          source: 'ai',
          title: e.title,
          event_type: e.event_type || 'event',
          event_date: e.event_date,
          location: e.location,
          url: e.url,
          description: e.description,
          matched_office: null,
          confidence: typeof e.confidence === 'number' ? e.confidence : null,
        });
      }
    }
  }
  const aiCount = events.length - samCount;

  return { events, samCount, aiCount, aiDiscovery, degraded };
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity/office-scoped events (2026-08-14, Eric: "we need to add the events.
// They are nowhere in our opportunity cards or market research").
//
// MEASURED FIRST (rule: measure before you build a data feature):
//   3,948 sam_events rows — but 3,451 are event_type='rfi', i.e. sources-sought
//   NOTICES that are already opportunities in their own right. Listing those on an
//   opportunity card would restate what the map already shows. The genuinely
//   ATTENDABLE events are 497 (426 industry_day + 44 forecast + 22 webinar + 5
//   conference), of which 91 are upcoming.
//   Of those 91: 91 carry notice_id, 91 an agency, 68 a location, 45 an office —
//   and ZERO carry a registration_url, so a "Register" button would be dead on
//   every row. We render the source notice link instead. (Eric chose: real events
//   only, exclude RFIs.)
//
// ⚠️ WHY AGENCY-LEVEL IS THE WEAKEST TIER: 72 of the 91 upcoming events carry the
// department-level agency "DEPT OF DEFENSE". Falling back to agency for a DoD
// opportunity would show a Navy shipbuilding notice the same 72 DoD-wide events as
// an Army IT notice — the exact inflation this repo already fixed once (the TMR
// events count inheriting the whole-DoD number, 2026-06-29). So agency matches are
// returned but LABELLED `agency` (and for a department-level agency, flagged
// `broad:true`) so the UI can say "department-wide" instead of implying relevance.
const ATTENDABLE_TYPES = ['industry_day', 'forecast', 'webinar', 'conference'];

/** Department-level agency strings whose event set is too broad to imply relevance. */
const DEPT_LEVEL = /\b(DEPT OF DEFENSE|DEFENSE, DEPARTMENT OF|DEPARTMENT OF DEFENSE)\b/i;

export type EventMatchTier = 'notice' | 'office' | 'agency';

export interface ScopedEvent {
  title: string;
  event_type: string;
  event_date: string | null;
  location: string | null;
  agency: string | null;
  office: string | null;
  notice_id: string | null;
  solicitation_number: string | null;
  /** HOW this event was matched — the UI must show this, never imply exact relevance. */
  tier: EventMatchTier;
  /** True when the match is department-wide (e.g. all of DoD) rather than specific. */
  broad: boolean;
}

export interface ScopedEventsResult {
  events: ScopedEvent[];
  /** The most specific tier that produced results, or null when nothing matched. */
  bestTier: EventMatchTier | null;
  degraded: boolean; // the read errored — distinct from an honest empty result
}

/**
 * Upcoming attendable events for ONE opportunity / office / agency, most specific
 * match first: the notice's own event → its buying office's → its agency's.
 *
 * Returns an HONEST EMPTY (events: [], bestTier: null) when nothing matches — never
 * a fabricated or padded list. `degraded` distinguishes "the query failed" from
 * "there genuinely are none", which are different facts (count≠null invariant).
 */
export async function queryScopedEvents(input: {
  noticeId?: string | null;
  dodaac?: string | null;
  agency?: string | null;
  monthsAhead?: number;
  limit?: number;
}): Promise<ScopedEventsResult> {
  const months = Math.min(Math.max(Number(input.monthsAhead) || 6, 1), 12);
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 25);
  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + months * 30);
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const COLS = 'title, event_type, event_date, event_location, agency, inferred_office, inferred_dodaac, notice_id, solicitation_number';

  const base = () =>
    supabase
      .from('sam_events')
      .select(COLS)
      .in('event_type', ATTENDABLE_TYPES)      // never RFIs — those are opportunities
      .gte('event_date', todayStr)             // upcoming only; a past event is not actionable
      .lte('event_date', horizonStr)
      .order('event_date', { ascending: true })
      .limit(limit);

  // The extractor's event_location is UNRELIABLE: measured 2026-08-14, 57 of 68 upcoming events
  // carry a truncated fragment rather than a place ("ion Number: N6134027R1002" — the tail of
  // "Solicitation Number:"). Showing that is worse than showing nothing, so anything that does not
  // look like a place is dropped to null. NOT a data fix — the column stays as-is; this is display
  // honesty until the extractor is corrected.
  const cleanLocation = (v: unknown): string | null => {
    const s = String(v ?? '').trim();
    if (!s || s.length > 60) return null;
    if (/number\s*:/i.test(s)) return null;          // "…ion Number: N6134027R1002"
    if (/^[a-z]/.test(s)) return null;               // starts mid-word = a truncation
    return s;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toEvent = (r: any, tier: EventMatchTier): ScopedEvent => ({
    title: r.title,
    event_type: r.event_type,
    event_date: r.event_date ?? null,
    location: cleanLocation(r.event_location),
    agency: r.agency ?? null,
    office: r.inferred_office ?? null,
    notice_id: r.notice_id ?? null,
    solicitation_number: r.solicitation_number ?? null,
    tier,
    broad: tier === 'agency' && DEPT_LEVEL.test(String(r.agency || '')),
  });

  let degraded = false;

  // Tier 1 — this opportunity's OWN event (exact notice_id).
  if (input.noticeId) {
    const { data, error } = await base().eq('notice_id', input.noticeId);
    if (error) degraded = true;
    else if (data && data.length) return { events: data.map((r) => toEvent(r, 'notice')), bestTier: 'notice', degraded };
  }

  // Tier 2 — the BUYING OFFICE's events (DoDAAC). The meaningful tier for DoD, where
  // the agency string is department-level and therefore near-useless for relevance.
  if (input.dodaac && isValidDodaac(input.dodaac)) {
    const { data, error } = await base().eq('inferred_dodaac', input.dodaac.toUpperCase());
    if (error) degraded = true;
    else if (data && data.length) return { events: data.map((r) => toEvent(r, 'office')), bestTier: 'office', degraded };
  }

  // Tier 3 — the agency's events. Deliberately last, and flagged `broad` for
  // department-level agencies so the UI can label it honestly.
  if (input.agency) {
    const key = normalizeAgencyKey(input.agency) || input.agency;
    const term = key.replace(/[%_,]/g, ' ').trim();
    if (term) {
      const { data, error } = await base().ilike('agency', `%${term}%`);
      if (error) degraded = true;
      else if (data && data.length) return { events: data.map((r) => toEvent(r, 'agency')), bestTier: 'agency', degraded };
    }
  }

  return { events: [], bestTier: null, degraded };
}

/**
 * The user-facing "why did this match?" label. Eric 2026-08-14: best-match hierarchy,
 * NOT cumulative — "do not stack agency-level events underneath notice-level events by
 * default, because that dilutes relevance and makes the drawer feel noisy." queryScopedEvents
 * already returns on the FIRST tier that hits, so a result set is always single-tier; this
 * just names the tier honestly.
 */
export function eventMatchLabel(tier: EventMatchTier | null, broad = false): string {
  if (tier === 'notice') return 'Matched to this solicitation';
  if (tier === 'office') return 'Matched to buying office';
  if (tier === 'agency') return broad ? 'Department-wide event' : 'Matched to agency';
  return '';
}

/**
 * Compact summary for the collapsed state: one event → its own title/date; several at the
 * SAME tier → "N upcoming events" with the soonest date, and the caller offers "view all".
 * Returns null for an empty set so a surface renders NOTHING rather than a dead empty-state.
 */
export function eventsSummary(r: ScopedEventsResult): { headline: string; sub: string; count: number } | null {
  const n = r.events.length;
  if (!n) return null;
  const soonest = r.events[0];
  const when = soonest.event_date
    ? new Date(soonest.event_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'Date TBD';
  const label = eventMatchLabel(r.bestTier, soonest.broad);
  if (n === 1) return { headline: soonest.title, sub: `${when} · ${label}`, count: 1 };
  return { headline: `${n} upcoming events`, sub: `Next ${when} · ${label}`, count: n };
}

/**
 * Buyer-DNA signals from PAST events (Eric 2026-08-14, verbatim):
 *   "Upcoming events belong on opportunities because they are actionable. Past events
 *    belong on Players and Market Intelligence because they describe buyer behavior.
 *    Treat historical events as behavioral evidence, not calendar entries… Never show
 *    expired events on an opportunity page simply because they exist."
 *
 * So this returns SIGNALS, not a listing — the opportunity surfaces never call it.
 *
 * MEASURED (past 12 months, attendable only) before naming any signal, so a badge is
 * never asserted without its own evidence:
 *   · industry_day — 326 events across 54 offices  → "Runs Industry Days" is well-grounded
 *   · forecast     —  21 events across  3 offices  → "Forecasts Frequently" is REAL but RARE;
 *                                                     it earns a badge for those 3, and is
 *                                                     simply ABSENT elsewhere (never inferred)
 *   · small-business flavored — 26 events          → the weakest: a title/description KEYWORD
 *                                                     match, not a structured field, so it is
 *                                                     labeled as outreach *mentioned*, never a
 *                                                     certification claim
 * Each signal is emitted ONLY from its own event type. Absence of evidence renders nothing —
 * never "0 industry days", which reads as a data gap rather than a real absence.
 */
export interface BuyerEventDna {
  /** Named signals, strongest evidence first. Empty array → the surface renders nothing. */
  signals: Array<{ key: 'runs_industry_days' | 'forecasts_frequently' | 'small_business_outreach'; label: string; detail: string; count: number }>;
  pastYear: number;
  lastHeld: string | null;
}

export async function queryBuyerEventDna(input: {
  dodaac?: string | null;
  agency?: string | null;
}): Promise<BuyerEventDna | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);

  let q = supabase
    .from('sam_events')
    .select('event_date, event_type, title, description')
    .in('event_type', ATTENDABLE_TYPES)
    .gte('event_date', yearAgo)
    .lt('event_date', today)              // PAST only — this is evidence, not a calendar
    .order('event_date', { ascending: false })
    .limit(200);

  if (input.dodaac && isValidDodaac(input.dodaac)) {
    q = q.eq('inferred_dodaac', input.dodaac.toUpperCase());
  } else if (input.agency) {
    const key = normalizeAgencyKey(input.agency) || input.agency;
    const term = key.replace(/[%_,]/g, ' ').trim();
    if (!term) return null;
    q = q.ilike('agency', `%${term}%`);
  } else {
    return null;
  }

  const { data, error } = await q;
  // A failed read is UNKNOWN, never a fabricated zero (count≠null invariant).
  if (error || !data || !data.length) return null;

  const rows = data as Array<{ event_date: string; event_type: string; title: string | null; description: string | null }>;
  const industryDays = rows.filter((r) => r.event_type === 'industry_day').length;
  const forecasts = rows.filter((r) => r.event_type === 'forecast').length;
  const SB = /small business|8\(a\)|sdvosb|hubzone|\bwosb\b|small-business/i;
  const smallBiz = rows.filter((r) => SB.test(`${r.title || ''} ${r.description || ''}`)).length;

  const signals: BuyerEventDna['signals'] = [];
  if (industryDays >= 2) {
    signals.push({
      key: 'runs_industry_days',
      label: 'Runs Industry Days',
      detail: `${industryDays} in the past year`,
      count: industryDays,
    });
  }
  if (forecasts >= 2) {
    signals.push({
      key: 'forecasts_frequently',
      label: 'Forecasts Frequently',
      detail: `${forecasts} forecast sessions in the past year`,
      count: forecasts,
    });
  }
  if (smallBiz >= 2) {
    signals.push({
      key: 'small_business_outreach',
      label: 'Small Business Outreach',
      // Honest wording: this is a keyword match on the event text, NOT a set-aside field.
      detail: `${smallBiz} events mentioning small business`,
      count: smallBiz,
    });
  }

  if (!signals.length) return null;   // no evidence → render nothing
  return { signals, pastYear: rows.length, lastHeld: rows[0]?.event_date || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ENGAGEMENT GRAPH (2026-08-15, Eric's reframe)
//
// "Most platforms collect RECORDS. You're building RELATIONSHIPS… An industry day
//  by itself isn't valuable. An industry day connected to a buyer, a forecast, an
//  opportunity, and eventually an award becomes intelligence."
//
// So an event is not a calendar entry — it is a NODE. This resolves its edges:
//
//     Event ──notice_id──▶ Opportunity ──naics──▶ Forecast
//       └────dodaac─────▶ Buyers (contracting officers / POCs)
//
// MEASURED before building (2026-08-15) — the edges are real, not hopeful:
//   · 495 / 503 attendable events (98.4%) join an opportunity on notice_id  → FACT
//   · 156 / 170 events carrying a DoDAAC (92%)  join real buyers            → FACT
//   · 306 events reach a forecast via the opportunity's NAICS, 75 codes     → INFERENCE
//
// ⚠️ THE EDGES ARE NOT THE SAME KIND, and the UI must not pretend otherwise.
// notice_id and the DoDAAC prefix are hard KEYS — those edges are facts. The forecast
// edge is a shared-NAICS match: the same MARKET, not the same buy. It is labeled
// `inferred` so a surface can say "related market" instead of implying the forecast
// belongs to the event. This is the same discipline as the "Department-wide event"
// label, and the reason this repo already carries the piid_solnum_no_link scar (a
// 0%-match join that was assumed rather than measured).
export interface EngagementGraph {
  event: { title: string; event_type: string; event_date: string | null; agency: string | null; office: string | null };
  /** FACT — joined on notice_id. */
  opportunities: Array<{ notice_id: string; title: string; naics_code: string | null; response_deadline: string | null; active: boolean | null }>;
  /** FACT — joined on the buying-office DoDAAC prefix. */
  buyers: Array<{ name: string; title: string | null; agency: string | null }>;
  /** INFERENCE — same NAICS market, NOT the same procurement. Labeled as such. */
  forecasts: Array<{ title: string; agency: string | null; naics_code: string | null; solicitation_date: string | null }>;
  counts: { opportunities: number; buyers: number; forecasts: number };
  /** Per-edge provenance so the UI can label each row honestly. */
  edges: { opportunities: 'fact'; buyers: 'fact'; forecasts: 'inferred' };
  degraded: boolean;
}

/**
 * Resolve one event's connections. Returns null when the event itself is missing —
 * an honest miss, never an empty shell that reads like "this event has no connections".
 */
export async function queryEngagementGraph(noticeId: string): Promise<EngagementGraph | null> {
  const id = (noticeId || '').trim();
  if (!id) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let degraded = false;

  const { data: evRows, error: evErr } = await supabase
    .from('sam_events')
    .select('title, event_type, event_date, agency, inferred_office, inferred_dodaac, notice_id')
    .eq('notice_id', id)
    .in('event_type', ATTENDABLE_TYPES)
    .limit(1);
  if (evErr) return null;
  const ev = (evRows || [])[0] as
    | { title: string; event_type: string; event_date: string | null; agency: string | null; inferred_office: string | null; inferred_dodaac: string | null }
    | undefined;
  if (!ev) return null;

  // EDGE 1 (fact) — the opportunity this event was extracted from.
  const { data: opps, error: oppErr } = await supabase
    .from('sam_opportunities')
    .select('notice_id, title, naics_code, response_deadline, active')
    .eq('notice_id', id)
    .limit(10);
  if (oppErr) { degraded = true; console.error('[engagement-graph] opportunity edge failed:', oppErr.message); }
  const oppRows = (opps || []) as EngagementGraph['opportunities'];

  // EDGE 2 (fact) — the buying office's real people, via the solicitation prefix. The
  // `office` column is NULL on all 126k federal_contacts rows, so the prefix is the key.
  let buyers: EngagementGraph['buyers'] = [];
  if (ev.inferred_dodaac && isValidDodaac(ev.inferred_dodaac)) {
    const { data: cs, error: cErr } = await supabase
      .from('federal_contacts')
      .select('contact_fullname, contact_title, department_ind_agency')
      .ilike('solicitation_number', `${ev.inferred_dodaac.toUpperCase()}%`)
      .not('contact_fullname', 'is', null)
      .limit(50);
    if (cErr) { degraded = true; console.error('[engagement-graph] buyers edge failed:', cErr.message); }
    const seen = new Set<string>();
    for (const c of (cs || []) as Array<{ contact_fullname: string; contact_title: string | null; department_ind_agency: string | null }>) {
      const k = (c.contact_fullname || '').toLowerCase();
      if (!k || seen.has(k)) continue;                 // same person appears on many notices
      if (/^(telephone|phone|fax|tel)\s*:/i.test(c.contact_fullname)) continue;  // SAM placeholder rows
      seen.add(k);
      buyers.push({ name: c.contact_fullname, title: c.contact_title, agency: c.department_ind_agency });
      if (buyers.length >= 8) break;
    }
  }

  // EDGE 3 (INFERENCE) — forecasts in the same NAICS market. NOT the same procurement.
  let forecasts: EngagementGraph['forecasts'] = [];
  const naics = oppRows.map((o) => o.naics_code).filter(Boolean) as string[];
  if (naics.length) {
    const { data: fc, error: fErr } = await supabase
      .from('agency_forecasts')
      .select('title, source_agency, naics_code, solicitation_date')
      .in('naics_code', Array.from(new Set(naics)).slice(0, 5))
      .limit(5);
    if (fErr) { degraded = true; console.error('[engagement-graph] forecast edge failed:', fErr.message); }
    // agency_forecasts columns are source_agency / solicitation_date. Naming a column that does
    // not exist fails the WHOLE PostgREST query (the missing-column scar) — which is exactly
    // what degraded:true surfaced on the first live run instead of a fake empty list.
    forecasts = ((fc || []) as Array<{ title: string; source_agency: string | null; naics_code: string | null; solicitation_date: string | null }>)
      .map((f) => ({ title: f.title, agency: f.source_agency, naics_code: f.naics_code, solicitation_date: f.solicitation_date }));
  }

  return {
    event: {
      title: ev.title,
      event_type: ev.event_type,
      event_date: ev.event_date,
      agency: ev.agency,
      office: ev.inferred_office,
    },
    opportunities: oppRows,
    buyers,
    forecasts,
    counts: { opportunities: oppRows.length, buyers: buyers.length, forecasts: forecasts.length },
    edges: { opportunities: 'fact', buyers: 'fact', forecasts: 'inferred' },
    degraded,
  };
}

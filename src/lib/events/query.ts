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
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';
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

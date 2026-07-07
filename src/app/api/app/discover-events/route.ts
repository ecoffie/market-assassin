/**
 * /api/app/discover-events — AI event discovery for a saved target.
 *
 * Slice 5 of the Target Market Research roadmap. When a target has few
 * known events, the user clicks "Find more events" and this route:
 *   1. Resolves the agency from the saved target (or accepts it directly)
 *   2. Throttle-checks ai_event_discovery_runs (7-day TTL per agency) so
 *      we don't re-fire Serper + Groq for the same agency repeatedly
 *   3. Runs searchEventsViaAI() — Serper web search → Groq extraction
 *   4. Upserts discovered events into sam_events with source='ai_web_search'
 *      so future users (and the Slice-4 target-events route) hit the cache
 *   5. Records the run
 *
 * Pro-gated (target lists are Pro anyway; belt + suspenders).
 *
 * Verb:
 *   POST { email, target_id? , agency? }
 *     → { success, discovered, persisted, cached, events, reason? }
 *
 * Fail-soft: if web search / AI is unconfigured or errors, returns
 * success:true with an empty list + a reason — never 500s the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { logToolError, classifyError, ToolNames, AIProviders } from '@/lib/tool-errors';
import { searchEventsViaAI, type DiscoveredEvent } from '@/lib/events/ai-event-discovery';

// Throttle window: one live discovery run per agency per 7 days
// (roadmap: "Cache TTL: 7 days per (agency, week)").
const RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 2026 — passed into the discovery lib since Date-of-now context varies.
// Bump annually or derive from a request param if we want it dynamic.
const CURRENT_YEAR = 2026;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Normalize an agency name into a stable throttle key.
function agencyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Synthesize a stable notice_id so the sam_events upsert dedupes the
// same AI event across re-runs. Hash of agency + title + date.
function aiNoticeId(agency: string, ev: DiscoveredEvent): string {
  const basis = `${agencyKey(agency)}|${ev.title.toLowerCase()}|${ev.event_date || 'undated'}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) {
    h = (h * 31 + basis.charCodeAt(i)) | 0;
  }
  return `ai:${Math.abs(h).toString(36)}`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email : '';
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  // Identity gate — reads/writes the caller's target list.
  const gate = requireMIAuthSession(request, email);
  if (!gate.ok) return gate.response;

  // Pro gate.
  const access = await verifyMIAccess(email);
  if (access.tier === 'free' && !access.isStaff) {
    return NextResponse.json(
      {
        upgrade_required: true,
        message: 'AI event discovery is included with Mindy Pro',
      },
      { status: 402 }
    );
  }

  const supabase = getSupabase();
  // Coach Mode: the target being discovered belongs to the ACTIVE CLIENT, so the
  // ownership check must key on the client — else a client's target 404s.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : email.toLowerCase();

  // Resolve the agency: explicit `agency` wins; otherwise look up the
  // saved target by id. We prefer sub_agency_name (more specific) but
  // fall back to agency_name.
  let agency = typeof body.agency === 'string' ? body.agency.trim() : '';
  const targetId = typeof body.target_id === 'string' ? body.target_id : null;

  if (!agency && targetId) {
    const { data: target, error: tErr } = await supabase
      .from('user_target_list')
      .select('agency_name, sub_agency_name')
      .eq('id', targetId)
      .eq('user_email', scopedEmail)
      .maybeSingle();
    if (tErr) {
      return NextResponse.json({ error: tErr.message, code: tErr.code }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }
    agency = target.sub_agency_name || target.agency_name || '';
  }

  if (!agency) {
    return NextResponse.json({ error: 'agency or target_id required' }, { status: 400 });
  }

  const key = agencyKey(agency);

  // Throttle check. If a fresh run exists, return its already-persisted
  // events from sam_events instead of re-firing the AI.
  try {
    const { data: lastRun } = await supabase
      .from('ai_event_discovery_runs')
      .select('last_run_at, events_persisted')
      .eq('agency_key', key)
      .maybeSingle();

    if (lastRun?.last_run_at) {
      const age = Date.now() - new Date(lastRun.last_run_at).getTime();
      if (age < RUN_TTL_MS) {
        const { data: cachedEvents } = await supabase
          .from('sam_events')
          .select('title, event_type, event_date, event_location, description, registration_url, confidence')
          .eq('source', 'ai_web_search')
          .ilike('agency', agency)
          .order('event_date', { ascending: true });
        return NextResponse.json({
          success: true,
          cached: true,
          agency,
          discovered: 0,
          persisted: 0,
          events: (cachedEvents || []).map(mapRowToCard),
          run_age_ms: age,
        });
      }
    }
  } catch (throttleErr) {
    console.warn('[discover-events] throttle check failed (proceeding live):', throttleErr);
  }

  // Live discovery.
  let result;
  try {
    result = await searchEventsViaAI({ agency, currentYear: CURRENT_YEAR, horizonDays: 120 });
  } catch (err) {
    await logToolError({
      tool: ToolNames.MARKET_SCANNER,
      errorType: classifyError(err instanceof Error ? err : new Error(String(err))),
      errorMessage: err instanceof Error ? err.message : String(err),
      requestPath: '/api/app/discover-events',
      aiProvider: AIProviders.GROQ,
    }).catch(() => {});
    return NextResponse.json({ error: 'Event discovery failed' }, { status: 502 });
  }

  // Persist discovered events into sam_events (source='ai_web_search').
  let persisted = 0;
  if (result.events.length > 0) {
    const rows = result.events.map((ev) => ({
      notice_id: aiNoticeId(agency, ev),
      title: ev.title,
      event_type: ev.event_type,
      agency,
      event_date: ev.event_date,
      event_location: ev.location,
      description: ev.description,
      registration_url: ev.url,
      source: 'ai_web_search',
      confidence: ev.confidence,
      discovered_via: 'ai_web_search',
      source_notice_type: 'AI Web Discovery',
    }));
    try {
      const { data: upserted, error: upErr } = await supabase
        .from('sam_events')
        .upsert(rows, { onConflict: 'notice_id', ignoreDuplicates: false })
        .select('notice_id');
      if (upErr) {
        console.error('[discover-events] upsert error:', upErr);
      } else {
        persisted = upserted?.length || 0;
      }
    } catch (upThrew) {
      console.error('[discover-events] upsert threw:', upThrew);
    }
  }

  // Record the run (upsert by agency_key) so the throttle works.
  try {
    await supabase
      .from('ai_event_discovery_runs')
      .upsert(
        {
          agency_key: key,
          agency_name: agency,
          last_run_at: new Date().toISOString(),
          events_found: result.events.length,
          events_persisted: persisted,
          queries_used: result.queriesUsed,
          triggered_by: email.toLowerCase(),
        },
        { onConflict: 'agency_key' }
      );
  } catch (runErr) {
    console.warn('[discover-events] run record failed (non-fatal):', runErr);
  }

  return NextResponse.json({
    success: true,
    cached: false,
    agency,
    discovered: result.events.length,
    persisted,
    events: result.events.map((ev) => ({
      source: 'ai',
      title: ev.title,
      event_type: ev.event_type,
      event_date: ev.event_date,
      location: ev.location,
      url: ev.url,
      description: ev.description,
      confidence: ev.confidence,
      matched_agency: agency,
    })),
    reason: result.reason,
    search_result_count: result.searchResultCount,
  });
}

// Map a persisted sam_events row back to the EventCard shape the panel
// expects (source:'ai' so the UI badges it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRowToCard(row: any) {
  return {
    source: 'ai' as const,
    title: row.title,
    event_type: row.event_type || 'other',
    event_date: row.event_date,
    location: row.event_location,
    url: row.registration_url,
    description: row.description,
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    matched_agency: '',
  };
}

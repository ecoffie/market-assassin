/**
 * Admin: Opportunity Map FUNNEL — the behavioral drop-off curve (Epic #1, Market Intelligence Analytics).
 *
 * The write side already exists: the map's __track / __trackCard emitters POST to /api/app/engagement,
 * which writes the generic `user_engagement` table. NOTHING read those map events back as a funnel — they
 * accumulated invisibly. This endpoint is that read side.
 *
 * GET ?password=...&days=30
 *   → the ordered funnel map_open → pin_clicked → popup_open → listing_open → pursuit_started →
 *     proposal_started, with per-step user + event counts and step-to-step conversion.
 *
 * TWO SOURCES, ONE FUNNEL (the scan's cleanup): the map splits across two event_source values —
 * 'opportunity_map' (the __track surface events) and 'source_feed' (the __trackCard Decision-Card
 * events). We UNION both. The funnel STEP name lives in metadata->>'action' (__track) OR
 * metadata->>'kind' (__trackCard), never in event_type (which stays a valid catalog value like
 * 'tool_use'/'link_click' — the /api/app/engagement allowlist rejects unknown event_types).
 *
 * GROUND IN REAL DATA (count≠null): every count comes from a real query whose { data, error } is
 * bound and surfaced. A query failure returns an error — it NEVER coalesces to a fabricated 0, because
 * a dead pipe (nothing instrumented / a broken query) and an empty funnel (no users yet) must look
 * different. `instrumented:false` + an explicit note distinguishes "no events at all" from "0 conversion".
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// The map's two event_source values (see the emitters __track / __trackCard). UNION both.
const MAP_SOURCES = ['opportunity_map', 'source_feed'];

// The ordered funnel. Each step lists the metadata action/kind token(s) that COUNT as that step.
// map_open is emitted as action 'map_view' (once/session); the rest are their own tokens. pin_clicked
// and popup_open are distinct (a pin click that never opens a popup is a real drop). We de-dupe within
// a step (a user firing popup_open 5× on 5 pins is one funnel-reach for the step's user count).
// Token lists fold in the PRE-EXISTING app-panel tokens observed live in user_engagement (save_to_pipeline,
// open_details, open_sam …) alongside the map's own tokens — a discovery on the map that converts in the
// app panel is still a funnel conversion, so both spellings count for one step. (The map's savePursuit had
// NO event until this PR added pursuit_started; save_to_pipeline is the app-panel pursuit event.)
const FUNNEL_STEPS: { step: string; label: string; tokens: string[] }[] = [
  { step: 'map_open',         label: 'Map opened',       tokens: ['map_view'] },
  { step: 'pin_clicked',      label: 'Pin clicked',      tokens: ['pin_clicked'] },
  { step: 'popup_open',       label: 'Popup opened',     tokens: ['popup_open'] },
  // A listing opens via: map __track 'listing_open', __trackCard 'click' (card→drawer), or the app panel's 'open_details'.
  { step: 'listing_open',     label: 'Listing opened',   tokens: ['listing_open', 'click', 'open_details'] },
  // A pursuit starts via the map's new 'pursuit_started' OR the app panel's existing 'save_to_pipeline'.
  { step: 'pursuit_started',  label: 'Pursuit started',  tokens: ['pursuit_started', 'save_to_pipeline'] },
  { step: 'proposal_started', label: 'Proposal started', tokens: ['proposal_started'] },
];

interface EngRow {
  user_email: string | null;
  event_source: string | null;
  metadata: { action?: string; kind?: string; combo?: string; strands?: string[] } | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365);
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  const supabase = getReadClient();

  // Pull the raw map events in-window. Paginate so a busy month isn't silently capped at 1000 rows
  // (the PostgREST default — the exact bug class the enroll-cap fix hit). Bind + surface every error.
  const rows: EngRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_engagement')
      .select('user_email, event_source, metadata')
      .in('event_source', MAP_SOURCES)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    // A null/undefined data with an error is a BROKEN read — surface it, never treat as "0 events".
    if (error) {
      return NextResponse.json(
        { error: `map-funnel read failed: ${error.message}`, instrumented: null },
        { status: 500 },
      );
    }
    const batch = (data || []) as EngRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 200_000) break; // hard backstop; a month of map traffic is far under this
  }

  // A genuinely EMPTY result (no map events at all in-window) is NOT a zero-conversion funnel — it's
  // "not instrumented / nobody used the map yet". Say so explicitly so the dashboard can't read a dead
  // pipe as real behavior.
  const instrumented = rows.length > 0;

  // For each step, the SET of distinct users who reached it + the raw event count. A step's token can
  // arrive on either source, so we match against metadata.action OR metadata.kind.
  const stepUsers: Record<string, Set<string>> = {};
  const stepEvents: Record<string, number> = {};
  for (const s of FUNNEL_STEPS) { stepUsers[s.step] = new Set(); stepEvents[s.step] = 0; }

  const tokenToStep = new Map<string, string>();
  for (const s of FUNNEL_STEPS) for (const t of s.tokens) tokenToStep.set(t, s.step);

  // STRATEGY analytics (Eric: "that's not three filters, that's a strategy"). Roll up the
  // strategy_filter_changed events by the SORTED strand combination — how many distinct users applied
  // each strategy, and how often. This is the "what to build next" signal: a heavily-used combo
  // ('repeat_buyer+sb_friendly+closes_soon') is a real workflow; a never-used strand is dead weight.
  const comboUsers: Record<string, Set<string>> = {}; // combo key → distinct users
  const comboEvents: Record<string, number> = {};      // combo key → apply count
  const strandUsers: Record<string, Set<string>> = {}; // single strand → distinct users (marginal popularity)

  for (const r of rows) {
    const email = (r.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue; // staff/testimonial/advocate never count
    const token = r.metadata?.action || r.metadata?.kind || '';
    const step = tokenToStep.get(token);
    if (step) {
      stepUsers[step].add(email);
      stepEvents[step] += 1;
    }
    // Strategy rollup — independent of the funnel steps (a strategy_filter_changed is not a funnel step).
    if (token === 'strategy_filter_changed') {
      const combo = r.metadata?.combo || (Array.isArray(r.metadata?.strands) ? r.metadata!.strands!.slice().sort().join('+') : '');
      if (combo) {
        (comboUsers[combo] ||= new Set()).add(email);
        comboEvents[combo] = (comboEvents[combo] || 0) + 1;
        for (const strand of combo.split('+')) (strandUsers[strand] ||= new Set()).add(email);
      }
    }
  }

  // Build the ordered funnel with step-to-step conversion (user-based — a person, not a raw click).
  // Conversion is vs the PREVIOUS step's users (the classic funnel), and vs the top for overall.
  const topUsers = stepUsers[FUNNEL_STEPS[0].step].size;
  let prevUsers = topUsers;
  const funnel = FUNNEL_STEPS.map((s, i) => {
    const users = stepUsers[s.step].size;
    const fromPrev = i === 0 ? 1 : (prevUsers > 0 ? users / prevUsers : null); // null = can't divide (unknown, not 0%)
    const fromTop = topUsers > 0 ? users / topUsers : null;
    const row = {
      step: s.step,
      label: s.label,
      users,
      events: stepEvents[s.step],
      convFromPrev: fromPrev == null ? null : Math.round(fromPrev * 1000) / 10, // percent, 1dp
      convFromTop: fromTop == null ? null : Math.round(fromTop * 1000) / 10,
    };
    prevUsers = users;
    return row;
  });

  // The biggest single drop-off (where to focus) — only meaningful once instrumented.
  let biggestDrop: { fromStep: string; toStep: string; dropPct: number } | null = null;
  if (instrumented) {
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].users, cur = funnel[i].users;
      if (prev > 0) {
        const drop = Math.round((1 - cur / prev) * 1000) / 10;
        if (!biggestDrop || drop > biggestDrop.dropPct) {
          biggestDrop = { fromStep: funnel[i - 1].step, toStep: funnel[i].step, dropPct: drop };
        }
      }
    }
  }

  // Top strategy COMBINATIONS by distinct users (the "what to build next" signal), then descending events.
  const topStrategies = Object.keys(comboUsers)
    .map((combo) => ({ combo, strands: combo.split('+'), users: comboUsers[combo].size, applies: comboEvents[combo] }))
    .sort((a, b) => b.users - a.users || b.applies - a.applies)
    .slice(0, 25);
  // Marginal single-strand popularity — how many distinct users EVER included each strand in a strategy.
  const strandPopularity = Object.keys(strandUsers)
    .map((strand) => ({ strand, users: strandUsers[strand].size }))
    .sort((a, b) => b.users - a.users);
  const strategyUsers = new Set<string>();
  for (const c of Object.keys(comboUsers)) for (const u of comboUsers[c]) strategyUsers.add(u);

  return NextResponse.json({
    ok: true,
    windowDays: days,
    since: sinceIso,
    instrumented,                 // false = no map events in-window (NOT a 0% funnel — a quiet/undeployed pipe)
    totalMapEvents: rows.length,
    funnel,
    biggestDrop,
    // STRATEGY analytics — the differentiator's usage. strategyFilterUsers=0 (with instrumented=true) means
    // the strategy_filter_changed event hasn't reached prod yet (it ships in this PR), NOT that nobody
    // filters — distinct from a real "no one uses strategies" once the event is live.
    strategy: {
      strategyFilterUsers: strategyUsers.size,
      topStrategies,          // the winning COMBINATIONS (a strategy = the sorted strand set)
      strandPopularity,       // marginal: which single strands people reach for
    },
    note: instrumented
      ? 'User-based funnel over user_engagement (event_source in opportunity_map+source_feed). Staff/testimonial excluded.'
      : 'No map events in this window yet — the funnel is empty because nothing was logged, not because conversion is 0.',
  });
}

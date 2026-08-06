/**
 * Admin: Journey Analytics — TWO loops, TWO lenses (Epic #1, Market Intelligence Analytics).
 *
 * The write side already exists: the map's __track / __trackCard emitters POST to /api/app/engagement,
 * which writes the generic `user_engagement` table. NOTHING read those map events back — they
 * accumulated invisibly. This endpoint is that read side.
 *
 * ┌─ THE PRINCIPLES (BINDING — "The Mindy Principles" + Working Backwards Q3'26) ───────────────────┐
 * │ 01. Browsing with no intent to transact is the NORMAL state, not a failure to convert.          │
 * │     A pursuit is far rarer than a save — that ratio is HEALTHY, not a leak.                      │
 * │ 02. We optimise RETURN VISITS. "Came back tomorrow" is the headline, not clicks/pageviews.      │
 * │ What we optimise for (THESE): daily active contractors, listings opened/shared, saved, return.  │
 * │ NOT these (as binding as the above): clicks, pageviews, session length, sign-ups.               │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * So this endpoint is deliberately split into TWO parts with TWO lenses:
 *   - DISCOVERY (map_open -> pin -> popup -> listing -> saved): measured by ENGAGEMENT + RETURN, never
 *     conversion. No "biggest drop" is computed over these steps — a low step ratio here is browsing,
 *     the normal state, not a leak. The HEADLINE is the return-visit rate (distinct-active-days >= 2).
 *   - EXECUTION (pursuit_started -> proposal_started -> built -> exported -> submitted + outcomes): a
 *     LEGITIMATE funnel with conversion, framed as the rare minority path. The "biggest drop" callout
 *     is scoped to THESE steps only (an execution stall is real), NEVER to discovery.
 *
 * GROUND IN REAL DATA (count≠null): every count comes from a real query whose { data, error } is
 * bound and surfaced. A query failure returns an error — it NEVER coalesces to a fabricated 0, because
 * a dead pipe (nothing instrumented / a broken query) and an empty funnel (no users yet) must look
 * different. `instrumented:false` + an explicit note distinguishes "no events at all" from "0 conversion".
 * A ratio whose denominator is 0 is `null` ("no data yet"), NEVER a fabricated 0%.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// The map's two event_source values (see the emitters __track / __trackCard). UNION both.
// The map emits from opportunity_map/source_feed; the NEW sub-views (2026-08-05 instrumentation)
// emit from their own event_source so the LIFECYCLE past proposal_started (pursuit stages, proposal
// build/submit, the Saved->Pursuit hop) joins into ONE read. Add them or those events are excluded.
const MAP_SOURCES = ['opportunity_map', 'source_feed', 'pursuits', 'proposal', 'saved'];

// The ordered journey. Each step lists the metadata action/kind token(s) that COUNT as that step,
// and which LOOP it belongs to. The DISCOVERY loop is measured by engagement/return (NOT conversion);
// the EXECUTION loop is a legitimate funnel and the ONLY place a drop callout may appear.
// map_open is emitted as action 'map_view' (once/session); the rest are their own tokens. We de-dupe
// within a step (a user firing popup_open 5x on 5 pins is one reach for the step's user count).
// Token lists fold in the PRE-EXISTING app-panel tokens observed live in user_engagement
// (save_to_pipeline, open_details, open_sam …) alongside the map's own tokens.
type Loop = 'discovery' | 'execution';
const JOURNEY_STEPS: { step: string; label: string; tokens: string[]; loop: Loop }[] = [
  // ── DISCOVERY loop — browsing is the point; measured by return, not conversion ──
  { step: 'map_open',         label: 'Map opened',       tokens: ['map_view'],                          loop: 'discovery' },
  { step: 'pin_clicked',      label: 'Pin clicked',      tokens: ['pin_clicked'],                       loop: 'discovery' },
  { step: 'popup_open',       label: 'Popup opened',     tokens: ['popup_open'],                        loop: 'discovery' },
  // A listing opens via: map __track 'listing_open', __trackCard 'click' (card→drawer), or the app panel's 'open_details'.
  { step: 'listing_open',     label: 'Listing opened',   tokens: ['listing_open', 'click', 'open_details'], loop: 'discovery' },
  // "Saved" is the end of the discovery loop — a bookmark, not a commitment to bid.
  { step: 'saved',            label: 'Saved',            tokens: ['save_to_pipeline', 'pursuit_started', 'start_pursuit_clicked'], loop: 'discovery' },
  // ── EXECUTION loop — the rare minority path (Principle 01). A pursuit is far rarer than a save,
  //    and that is healthy. A drop callout is meaningful HERE (a started-but-never-submitted proposal
  //    is a real stall), and ONLY here. ──
  { step: 'pursuit_started',  label: 'Pursuit started',  tokens: ['pursuit_started', 'save_to_pipeline', 'start_pursuit_clicked'], loop: 'execution' },
  { step: 'proposal_started', label: 'Proposal opened',   tokens: ['proposal_started', 'proposal_opened'], loop: 'execution' },
  { step: 'proposal_built',   label: 'Section drafted',   tokens: ['section_built'],                   loop: 'execution' },
  { step: 'proposal_exported',label: 'Proposal exported', tokens: ['export_proposal'],                 loop: 'execution' },
  { step: 'proposal_submitted',label:'Proposal submitted',tokens: ['proposal_submitted'],              loop: 'execution' },
];

// Terminal PURSUIT OUTCOMES — NOT a funnel step (a pursuit ends won/lost/no-bid, they don't chain),
// so they're reported as a separate breakdown ("how many pursuits end won/lost/no-bid?").
const OUTCOME_TOKENS: Record<string, string> = { pursuit_won: 'won', pursuit_lost: 'lost', pursuit_nobid: 'no_bid' };

// The cards_shown -> listing_open ratio (a DISCOVERY-quality signal): of cards browsed, how many got
// opened? The tokens that COUNT as a card impression vs a listing open (both spellings observed live).
const IMPRESSION_TOKENS = new Set(['impression', 'cards_shown']);
const LISTING_OPEN_TOKENS = new Set(['listing_open', 'click', 'open_details']);
const SHARE_TOKENS = new Set(['listing_share', 'share', 'share_listing']);

// daily_alert opens land in user_engagement via the email tracking pixel:
//   /api/track?t=<token> -> recordEmailOpen() -> logEmailOpen(user, 'daily_alert') -> user_engagement
//   row { event_type:'email_open', event_source:'daily_alert' } (src/lib/engagement.ts).
// So the daily_alert opener -> map reach ratio IS capturable — we read this source separately (it is
// NOT in MAP_SOURCES) and cross-reference its distinct users against the map's map_view users.
const DAILY_ALERT_SOURCE = 'daily_alert';

interface EngRow {
  user_email: string | null;
  event_source: string | null;
  created_at: string | null;
  metadata: { action?: string; kind?: string; combo?: string; strands?: string[]; dna?: string[]; strategy?: string } | null;
}

// Distinct calendar days (UTC) a user was active — the raw material for the return-visit headline.
function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const t = iso.indexOf('T');
  return t > 0 ? iso.slice(0, t) : iso.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365);
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

  const supabase = getReadClient();

  // Paginated read helper — a busy month must not be silently capped at 1000 rows (the PostgREST
  // default; an unpaged query undercounts ~47x per the Working Backwards doc). Binds + surfaces every
  // error: a null/undefined data with an error is a BROKEN read, surfaced, never treated as "0 events".
  // `created_at` is in the select (a real, populated column) so the return-visit + daily-active headline
  // metrics can be computed per-day.
  async function readSource(sources: string[]): Promise<{ rows: EngRow[]; error: string | null }> {
    const rows: EngRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('user_engagement')
        .select('user_email, event_source, created_at, metadata')
        .in('event_source', sources)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return { rows, error: error.message };
      const batch = (data || []) as EngRow[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
      if (from > 200_000) break; // hard backstop; a month of map traffic is far under this
    }
    return { rows, error: null };
  }

  const mapRead = await readSource(MAP_SOURCES);
  if (mapRead.error) {
    return NextResponse.json(
      { error: `journey read failed: ${mapRead.error}`, instrumented: null },
      { status: 500 },
    );
  }
  const rows = mapRead.rows;

  // daily_alert opens (ratio #1 denominator) — read separately; NOT in MAP_SOURCES.
  const alertRead = await readSource([DAILY_ALERT_SOURCE]);
  if (alertRead.error) {
    return NextResponse.json(
      { error: `journey read failed (daily_alert): ${alertRead.error}`, instrumented: null },
      { status: 500 },
    );
  }

  // A genuinely EMPTY result (no map events at all in-window) is NOT a zero-conversion funnel — it's
  // "not instrumented / nobody used the map yet". Say so explicitly so the dashboard can't read a dead
  // pipe as real behavior.
  const instrumented = rows.length > 0;

  // For each step, the SET of distinct users who reached it + the raw event count.
  const stepUsers: Record<string, Set<string>> = {};
  const stepEvents: Record<string, number> = {};
  for (const s of JOURNEY_STEPS) { stepUsers[s.step] = new Set(); stepEvents[s.step] = 0; }

  const tokenToStep = new Map<string, string>();
  for (const s of JOURNEY_STEPS) for (const t of s.tokens) tokenToStep.set(t, s.step);

  // ── ENGAGEMENT + RETURN (the discovery lens — Principles 01/02) ──
  // Per-user set of distinct active days (any map event) → daily-active + return-visit headline.
  const userActiveDays: Record<string, Set<string>> = {};
  // Per-day distinct active users → the daily-active-contractors trend.
  const dayActiveUsers: Record<string, Set<string>> = {};
  // Right-column engagement VOLUME (NOT funnel conversions): listings opened/shared, saved.
  const listingOpenUsers = new Set<string>();
  let listingOpenEvents = 0;
  const listingShareUsers = new Set<string>();
  let listingShareEvents = 0;
  const savedUsers = new Set<string>();
  let savedEvents = 0;
  // cards_shown -> listing_open ratio (ratio #2) counters.
  let impressionEvents = 0;
  let listingOpenForRatio = 0;

  // STRATEGY analytics (already engagement-framed — kept). Roll up strategy_filter_changed by the
  // SORTED strand combination — a heavily-used combo is a real workflow; a never-used strand is dead weight.
  const comboUsers: Record<string, Set<string>> = {};
  const comboEvents: Record<string, number> = {};
  const strandUsers: Record<string, Set<string>> = {};

  // "WHY THIS OPPORTUNITY?" — per-strand impression vs click (kept; engagement-framed).
  const strandImpr: Record<string, number> = {};
  const strandClick: Record<string, number> = {};

  // TODAY'S LENS — the entry point to the loop (Today's Intel → Map). Distinct hero-CTA clickers.
  const lensClickUsers = new Set<string>();
  let lensClickEvents = 0;
  const lensStrategyUsers: Record<string, Set<string>> = {};

  // Terminal pursuit outcomes (execution lens).
  const outcomeCounts: Record<string, number> = { won: 0, lost: 0, no_bid: 0 };

  for (const r of rows) {
    const email = (r.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue; // staff/testimonial/advocate never count
    const token = r.metadata?.action || r.metadata?.kind || '';

    // Return-visit + daily-active: every real map event counts as activity for that user on that day.
    const dk = dayKey(r.created_at);
    if (dk) {
      (userActiveDays[email] ||= new Set()).add(dk);
      (dayActiveUsers[dk] ||= new Set()).add(email);
    }

    const step = tokenToStep.get(token);
    if (step) {
      stepUsers[step].add(email);
      stepEvents[step] += 1;
    }

    // Right-column engagement volume (measured as VOLUME, never as a conversion rate).
    if (LISTING_OPEN_TOKENS.has(token)) { listingOpenUsers.add(email); listingOpenEvents += 1; listingOpenForRatio += 1; }
    if (SHARE_TOKENS.has(token)) { listingShareUsers.add(email); listingShareEvents += 1; }
    if (token === 'save_to_pipeline' || token === 'pursuit_started' || token === 'start_pursuit_clicked') { savedUsers.add(email); savedEvents += 1; }
    if (IMPRESSION_TOKENS.has(token)) impressionEvents += 1;

    // Strategy rollup — independent of the funnel steps.
    if (token === 'strategy_filter_changed') {
      const combo = r.metadata?.combo || (Array.isArray(r.metadata?.strands) ? r.metadata!.strands!.slice().sort().join('+') : '');
      if (combo) {
        (comboUsers[combo] ||= new Set()).add(email);
        comboEvents[combo] = (comboEvents[combo] || 0) + 1;
        for (const strand of combo.split('+')) (strandUsers[strand] ||= new Set()).add(email);
      }
    }
    // Terminal pursuit outcome — a pursuit closed won/lost/no-bid.
    if (OUTCOME_TOKENS[token]) outcomeCounts[OUTCOME_TOKENS[token]] += 1;
    // Today's Lens CTA — the loop's ENTRY (Today's Intel → Map). Distinct clickers + arrival lens.
    if (token === 'todays_lens_click') {
      lensClickUsers.add(email);
      lensClickEvents += 1;
      const strat = String((r.metadata as { strategy?: string })?.strategy || '').split(',').filter(Boolean).sort().join('+');
      if (strat) (lensStrategyUsers[strat] ||= new Set()).add(email);
    }
    // "Why this opportunity?" — per-strand impression vs click, from the metadata.dna the opp carried.
    if ((token === 'impression' || token === 'click' || token === 'cta_click') && Array.isArray(r.metadata?.dna)) {
      const bucket = token === 'impression' ? strandImpr : strandClick;
      for (const strand of r.metadata!.dna!) if (strand) bucket[strand] = (bucket[strand] || 0) + 1;
    }
  }

  const mapOpenUsers = stepUsers['map_open'].size;

  // ── THE RETURN-VISIT HEADLINE (Principle 02: "we optimise return visits") ──
  // Of the distinct users active in-window, how many came back on a LATER day (>= 2 distinct active
  // days)? That is the retention signal the Working Backwards doc calls the entire business. Also the
  // median distinct-active-days. null (not 0%) when there are no active users to divide by.
  const activeEmails = Object.keys(userActiveDays);
  const activeUserCount = activeEmails.length;
  const returnerCount = activeEmails.filter((e) => userActiveDays[e].size >= 2).length;
  const activeDayCounts = activeEmails.map((e) => userActiveDays[e].size).sort((a, b) => a - b);
  const medianActiveDays = activeDayCounts.length
    ? (activeDayCounts.length % 2
        ? activeDayCounts[(activeDayCounts.length - 1) / 2]
        : (activeDayCounts[activeDayCounts.length / 2 - 1] + activeDayCounts[activeDayCounts.length / 2]) / 2)
    : null;
  const returnRate = activeUserCount > 0 ? Math.round((returnerCount / activeUserCount) * 1000) / 10 : null; // null = no data yet

  // Daily active contractors — today (latest day in window) + the whole-window average.
  const dayKeys = Object.keys(dayActiveUsers).sort();
  const dailyActiveTrend = dayKeys.map((d) => ({ date: d, users: dayActiveUsers[d].size }));
  const latestDay = dayKeys.length ? dayKeys[dayKeys.length - 1] : null;
  const dailyActiveToday = latestDay ? dayActiveUsers[latestDay].size : null; // null = no active day yet
  const dailyActiveAvg = dayKeys.length ? Math.round((dayKeys.reduce((a, d) => a + dayActiveUsers[d].size, 0) / dayKeys.length) * 10) / 10 : null;

  // ── DISCOVERY steps (context, NOT conversion) — counts + a NEUTRAL "N of the step above" ratio.
  //    NO drop is computed or flagged here: a low step ratio is browsing, the normal state (Principle 01).
  const discoveryStepDefs = JOURNEY_STEPS.filter((s) => s.loop === 'discovery');
  let discPrev = stepUsers[discoveryStepDefs[0].step].size;
  const discoveryTop = discPrev;
  const discoverySteps = discoveryStepDefs.map((s, i) => {
    const users = stepUsers[s.step].size;
    const ofPrev = i === 0 ? null : (discPrev > 0 ? Math.round((users / discPrev) * 1000) / 10 : null); // null = can't divide (unknown, not 0%)
    const ofTop = discoveryTop > 0 ? Math.round((users / discoveryTop) * 1000) / 10 : null;
    discPrev = users;
    // NOTE: no `drop`/`isDrop` field — discovery is never scored by conversion.
    return { step: s.step, label: s.label, users, events: stepEvents[s.step], ofPrev, ofTop };
  });

  // ── EXECUTION funnel — a LEGITIMATE conversion funnel, the rare minority path. Conversion vs the
  //    previous execution step; the biggest drop is computed HERE ONLY. ──
  const executionStepDefs = JOURNEY_STEPS.filter((s) => s.loop === 'execution');
  const execTop = stepUsers[executionStepDefs[0].step].size;
  let execPrev = execTop;
  const executionSteps = executionStepDefs.map((s, i) => {
    const users = stepUsers[s.step].size;
    const convFromPrev = i === 0 ? null : (execPrev > 0 ? Math.round((users / execPrev) * 1000) / 10 : null);
    const convFromTop = execTop > 0 ? Math.round((users / execTop) * 1000) / 10 : null;
    execPrev = users;
    return { step: s.step, label: s.label, users, events: stepEvents[s.step], convFromPrev, convFromTop };
  });

  // The biggest single EXECUTION drop-off (where execution stalls) — scoped to execution, never
  // applied to discovery. Only meaningful once instrumented + there are ≥2 execution steps with users.
  let executionDrop: { fromStep: string; toStep: string; dropPct: number } | null = null;
  if (instrumented) {
    for (let i = 1; i < executionSteps.length; i++) {
      const prev = executionSteps[i - 1].users, cur = executionSteps[i].users;
      if (prev > 0) {
        const drop = Math.round((1 - cur / prev) * 1000) / 10;
        if (!executionDrop || drop > executionDrop.dropPct) {
          executionDrop = { fromStep: executionSteps[i - 1].step, toStep: executionSteps[i].step, dropPct: drop };
        }
      }
    }
  }

  // ── THE TWO PENDING DISCOVERY RATIOS (Working Backwards §3) ──
  // Both null + "no data yet" when the denominator is 0 — NEVER a fabricated %. instrumented:false on a
  // ratio distinguishes a dead pipe (source never emitted at all) from a genuine empty window.
  // Ratio 1: daily_alert opener -> map reach. "Does distribution reach the destination?"
  const alertOpenerEmails = new Set<string>();
  for (const r of alertRead.rows) {
    const email = (r.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue;
    alertOpenerEmails.add(email);
  }
  const mapOpenEmailSet = stepUsers['map_open']; // distinct users with a map_view
  let alertToMapReached = 0;
  for (const e of alertOpenerEmails) if (mapOpenEmailSet.has(e)) alertToMapReached += 1;
  const alertToMapRatio = {
    // daily_alert opens ARE capturable from user_engagement (email pixel -> recordEmailOpen). Confirmed.
    capturable: true,
    instrumented: alertRead.rows.length > 0, // false = the daily_alert source has emitted nothing in-window (dead/quiet pipe)
    alertOpeners: alertOpenerEmails.size,
    reachedMap: alertToMapReached,
    ratio: alertOpenerEmails.size > 0 ? Math.round((alertToMapReached / alertOpenerEmails.size) * 1000) / 10 : null, // null = no data yet
  };

  // Ratio 2: cards_shown -> listing_open. "Of cards browsed, how many got opened?"
  const cardsToListingRatio = {
    instrumented: impressionEvents > 0, // false = no card-impression events in-window (the impression pipe hasn't accrued)
    impressions: impressionEvents,
    listingOpens: listingOpenForRatio,
    ratio: impressionEvents > 0 ? Math.round((listingOpenForRatio / impressionEvents) * 1000) / 10 : null, // null = no data yet
  };

  // Top strategy COMBINATIONS by distinct users, then descending events.
  const topStrategies = Object.keys(comboUsers)
    .map((combo) => ({ combo, strands: combo.split('+'), users: comboUsers[combo].size, applies: comboEvents[combo] }))
    .sort((a, b) => b.users - a.users || b.applies - a.applies)
    .slice(0, 25);
  const strandPopularity = Object.keys(strandUsers)
    .map((strand) => ({ strand, users: strandUsers[strand].size }))
    .sort((a, b) => b.users - a.users);
  const strategyUsers = new Set<string>();
  for (const c of Object.keys(comboUsers)) for (const u of comboUsers[c]) strategyUsers.add(u);

  // TODAY'S LENS → MAP CTR — the loop's entry conversion. Distinct hero-CTA clickers vs distinct
  // map-openers. null (not 0) if there are no map_opens to divide by.
  const lensCtr = mapOpenUsers > 0 ? Math.round((lensClickUsers.size / mapOpenUsers) * 1000) / 10 : null;
  const topArrivalLenses = Object.keys(lensStrategyUsers)
    .map((combo) => ({ combo, strands: combo.split('+'), users: lensStrategyUsers[combo].size }))
    .sort((a, b) => b.users - a.users)
    .slice(0, 10);

  // "Why this opportunity?" — per-strand click-through ranked by CTR (click/impression).
  const WHY_MIN_IMPR = 20;
  const allWhyStrands = new Set([...Object.keys(strandImpr), ...Object.keys(strandClick)]);
  const whyStrands = [...allWhyStrands]
    .map((strand) => {
      const impressions = strandImpr[strand] || 0;
      const clicks = strandClick[strand] || 0;
      const ctr = impressions >= WHY_MIN_IMPR ? Math.round((clicks / impressions) * 1000) / 10 : null; // null below the floor
      return { strand, impressions, clicks, ctr };
    })
    .sort((a, b) => (b.ctr ?? -1) - (a.ctr ?? -1) || b.clicks - a.clicks);

  // Events that reached the funnel (any journey-step token) — the honest "reached the funnel" count so
  // the header can read "N scanned · M reached the funnel" instead of implying a huge funnel population.
  const funnelReachedEvents = JOURNEY_STEPS.reduce((a, s) => a + stepEvents[s.step], 0);

  // ── NORTH-STAR: "Opportunities Advanced" (EXECUTION-ONLY) ──────────────────────────────────────────
  // Eric's binding decision: the north-star counts steps from PURSUIT onward (pursuit → proposal →
  // built → exported → submitted). Discovery → Pursuit is NEVER scored as conversion — it's the healthy
  // rare-minority boundary (Principle 01). This is derived from the ALREADY-COMPUTED execution steps
  // (reuse executionSteps; do NOT re-query), so a discovery step can never leak in.
  const northStar = {
    label: 'Opportunities Advanced',
    steps: executionSteps.map((s) => ({ step: s.step, label: s.label, users: s.users })),
  };

  // ── PRODUCT INTELLIGENCE — "what helped people win", GROUNDED via user_pipeline ────────────────────
  // The pursuit_won EVENTS carry no DNA/market/agency (only notice_id/journey_id/to_stage). But
  // user_pipeline DOES. So we read WON pursuits from the DB and join their notice_ids → sam_opportunities
  // for agency + state. Every count comes from a real query whose { data, error } is bound + surfaced —
  // a null count is UNKNOWN, never a fabricated 0 (Bug Prevention Rule #11).
  interface WonPursuitRow { notice_id: string | null; naics_code: string | null; owner_email: string | null; user_email: string | null }
  async function readWonPursuits(): Promise<{ rows: WonPursuitRow[]; error: string | null }> {
    const out: WonPursuitRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('user_pipeline')
        .select('notice_id, naics_code, owner_email, user_email')
        .eq('stage', 'won')
        .range(from, from + PAGE - 1);
      if (error) return { rows: out, error: error.message };
      const batch = (data || []) as WonPursuitRow[];
      out.push(...batch);
      if (batch.length < PAGE) break;
      if (from > 100_000) break; // hard backstop
    }
    return { rows: out, error: null };
  }

  const wonRead = await readWonPursuits();
  if (wonRead.error) {
    return NextResponse.json(
      { error: `product intelligence read failed (user_pipeline): ${wonRead.error}`, instrumented: null },
      { status: 500 },
    );
  }
  // Exclude staff/testimonial/advocate (owner preferred, else the row's user).
  const wonPursuits = wonRead.rows.filter((r) => !isExcludedFromMetrics((r.owner_email || r.user_email || '').toLowerCase()));

  // Join the won notice_ids → sam_opportunities for agency (sub_tier || department) + state.
  const wonNoticeIds = [...new Set(wonPursuits.map((r) => r.notice_id).filter((v): v is string => !!v))];
  interface SamOppRow { notice_id: string | null; department: string | null; sub_tier: string | null; naics_code: string | null; office_address: { state?: string } | null }
  const samByNotice = new Map<string, SamOppRow>();
  let samJoinError: string | null = null;
  for (let i = 0; i < wonNoticeIds.length; i += 200) {
    const chunk = wonNoticeIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from('sam_opportunities')
      .select('notice_id, department, sub_tier, naics_code, office_address')
      .in('notice_id', chunk);
    if (error) { samJoinError = error.message; break; }
    for (const row of (data || []) as SamOppRow[]) if (row.notice_id) samByNotice.set(row.notice_id, row);
  }
  if (samJoinError) {
    return NextResponse.json(
      { error: `product intelligence join failed (sam_opportunities): ${samJoinError}`, instrumented: null },
      { status: 500 },
    );
  }

  // Aggregate three rankings among won pursuits. Every key traces to a real column — never invented.
  const marketWins: Record<string, number> = {};   // by naics_code (pursuit's own, else joined sam)
  const agencyWins: Record<string, number> = {};    // by resolved agency (sub_tier || department)
  const stateWins: Record<string, number> = {};     // by resolved office state
  for (const r of wonPursuits) {
    const sam = r.notice_id ? samByNotice.get(r.notice_id) : undefined;
    const market = r.naics_code || sam?.naics_code || null;
    if (market) marketWins[market] = (marketWins[market] || 0) + 1;
    const agency = sam?.sub_tier || sam?.department || null;
    if (agency) agencyWins[agency] = (agencyWins[agency] || 0) + 1;
    const state = sam?.office_address?.state || null;
    if (state) stateWins[state] = (stateWins[state] || 0) + 1;
  }
  const rank = (m: Record<string, number>) =>
    Object.keys(m).map((key) => ({ key, wins: m[key] })).sort((a, b) => b.wins - a.wins).slice(0, 8);
  const productIntelligence = {
    grounded: wonPursuits.length > 0,           // false = zero won pursuits → the UI shows an honest empty state
    wonCount: wonPursuits.length,
    topMarket: rank(marketWins),                // [{ key: naics, wins }]
    topAgency: rank(agencyWins),                // [{ key: agency, wins }]
    topState: rank(stateWins),                  // [{ key: state, wins }]
  };

  // ── NOT YET MEASURABLE — honest placeholders for metrics with NO source today (never fabricate) ────
  const notYetMeasurable = [
    { metric: 'Top DNA strand among wins', needs: 'the won-pursuit event to carry the opportunity DNA strands (pursuit_won metadata has none today)' },
    { metric: 'Top search among wins', needs: 'a search_term field on the save/pursuit event' },
    { metric: 'Pursuit velocity (saved → pursuit days)', needs: 'a saved_at timestamp on the pipeline row to diff against pursuit start' },
    { metric: 'M-Win of won vs lost pursuits', needs: 'the M-Win score stored on the pursuit row at decision time' },
    { metric: 'Proposal completion rate (started → submitted)', needs: 'this IS partly live in the execution funnel; a per-user started-vs-submitted rate needs proposal_started keyed to the same journey_id as proposal_submitted' },
  ];

  return NextResponse.json({
    ok: true,
    windowDays: days,
    since: sinceIso,
    instrumented,                 // false = no map events in-window (NOT a 0% funnel — a quiet/undeployed pipe)
    totalMapEvents: rows.length,  // events SCANNED
    funnelReachedEvents,          // of those, how many were an actual journey-step event ("reached the funnel")

    // ══ DISCOVERY LOOP — browsing is the point; measured by RETURN + ENGAGEMENT, never conversion. ══
    discovery: {
      // The HEADLINE (Principle 02). null when there are no active users to divide by (no data yet).
      returnVisit: {
        activeUsers: activeUserCount,
        returners: returnerCount,          // users with >= 2 distinct active days
        returnRate,                        // % of active users who came back on a later day — THE headline
        medianActiveDays,                  // median distinct active days per user
      },
      dailyActive: {
        today: dailyActiveToday,           // distinct active contractors on the latest day (null = no active day yet)
        avg: dailyActiveAvg,               // whole-window daily average
        trend: dailyActiveTrend,           // per-day distinct active users
        latestDay,
      },
      // Right-column engagement VOLUME (what the Principles say we optimise for) — shown as volume,
      // NOT as funnel conversion rates.
      engagement: {
        listingsOpened: { users: listingOpenUsers.size, events: listingOpenEvents },
        listingsShared: { users: listingShareUsers.size, events: listingShareEvents },
        saved: { users: savedUsers.size, events: savedEvents },
      },
      // The discovery steps as neutral context (counts + "N of the step above"). NO drop flag.
      steps: discoverySteps,
      // The two PENDING discovery ratios (retention/reach) — null when the denominator is 0.
      ratios: {
        alertToMap: alertToMapRatio,       // daily_alert opener -> map reach (capturable:true, confirmed)
        cardsToListing: cardsToListingRatio, // cards_shown -> listing_open
      },
    },

    // ══ EXECUTION LOOP — the rare MINORITY path (Principle 01). A pursuit is far rarer than a save,
    //    and that is healthy. A legitimate conversion funnel; the drop callout lives HERE only. ══
    execution: {
      steps: executionSteps,               // conversion vs the previous execution step
      biggestDrop: executionDrop,          // where execution STALLS (scoped to execution, never discovery)
      // The north-star (EXECUTION-ONLY): "Opportunities Advanced" = pursuit → proposal → submitted.
      // Discovery → Pursuit is the healthy rare-minority boundary, NEVER scored as conversion.
      northStar,
      outcomes: (function(){
        const won=outcomeCounts.won, lost=outcomeCounts.lost, nb=outcomeCounts.no_bid;
        const decided=won+lost;
        return { won, lost, no_bid: nb, total: won+lost+nb,
          winRate: decided>0 ? Math.round((won/decided)*1000)/10 : null }; // null when nothing closed (not 0%)
      })(),
    },

    // STRATEGY analytics — the differentiator's usage (already engagement-framed — kept).
    strategy: {
      strategyFilterUsers: strategyUsers.size,
      topStrategies,
      strandPopularity,
    },
    // "WHY THIS OPPORTUNITY?" — which DNA strand DRIVES the click (impression→click CTR per strand).
    whyThisOpportunity: {
      minImpressions: WHY_MIN_IMPR,
      strands: whyStrands,
    },
    // TODAY'S LENS — the habit-loop entry (Today's Intel → Map).
    todaysLens: {
      clickUsers: lensClickUsers.size,
      clickEvents: lensClickEvents,
      mapOpenUsers,
      ctr: lensCtr,
      topArrivalLenses,
    },
    // PRODUCT INTELLIGENCE — "what helped people win" — grounded in user_pipeline (won) ⋈ sam_opportunities.
    productIntelligence,
    // The honest "we don't fake it" section — metrics Eric listed that have NO source today.
    notYetMeasurable,
    note: instrumented
      ? 'Journey Analytics over user_engagement. Discovery (map_open→saved) measured by RETURN + engagement, not conversion (browsing is normal — Principle 01). Execution (pursuit→submitted) is a legitimate funnel, the rare minority path. Staff/testimonial excluded.'
      : 'No map events in this window yet — the journey is empty because nothing was logged, not because engagement or conversion is 0.',
  });
}

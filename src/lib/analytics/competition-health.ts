/**
 * Competition Health — the buyer-side mirror of the Market Intelligence dashboard.
 *
 * A procurement director's scorecard: is my market competitive and healthy? Grounded ENTIRELY in
 * data we already have (sam_opportunities + recompete_opportunities + BigQuery awards), scoped to
 * one agency/department. Every metric is real or honestly flagged — NEVER a fabricated number.
 * (PRD: docs/strategy/PRD-buyer-competition-health.md.)
 *
 * ⚠️ HONESTY (Bug Prevention Rule #11): every count binds { count/data, error } and surfaces it. A
 * metric we cannot ground today is returned as `null` + listed in `notYetMeasurable`, never a fake 0.
 *
 * ⚠️ CLIENT: pass the PRIMARY client (getWriteClient()). Several metrics use `{count:'exact',head:true}`,
 * and the read replica returns a NULL count for head:true (memory read_replica_live) — which would
 * blank real metrics. The counts are cheap + must be accurate → primary.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeCompetitionDepth, resolveAgencyIdentity, type CompetitionDepth } from './competition-depth';

// Set-aside code → readable label + whether it counts as a small-business set-aside.
// SAM `set_aside_code` values seen live: SDVOSBC, SDVOSBS, SBA, WOSB, VSA, NONE, HZC, 8A, EDWOSB, ...
// "NONE"/"" = full & open (NOT a set-aside). Anything else = a small-biz-favoring set-aside.
const SETASIDE_LABEL: Record<string, string> = {
  SDVOSBC: 'SDVOSB', SDVOSBS: 'SDVOSB', VSA: 'VOSB', VSS: 'VOSB',
  SBA: 'Small Business', SBP: 'Small Business (partial)',
  '8A': '8(a)', '8AN': '8(a)', WOSB: 'WOSB', EDWOSB: 'EDWOSB',
  HZC: 'HUBZone', HZS: 'HUBZone',
};
const isSetAside = (code: string | null | undefined) => {
  const c = (code || '').trim().toUpperCase();
  return c !== '' && c !== 'NONE';
};
const saLabel = (code: string) => SETASIDE_LABEL[code.trim().toUpperCase()] || code.trim();

export interface CompetitionHealth {
  agency: string;
  windowDays: number;
  grounded: boolean;
  // ✅ groundable now
  /**
   * Which kind of agency key this is. Participation and winner counts are computed from SAM records
   * keyed by `sam_opportunities.department`, so they are only MEASURABLE for a department key.
   *   department   — a department name present in Mindy's SAM record
   *   subagency    — a known sub-agency (e.g. Navy) stored under sub_tier, not department → unavailable
   *   unsupported  — not a department in the record and not a known sub-agency → unsupported
   * An unavailable/unsupported measure is null + reason, never a measured zero.
   */
  scope: { status: 'department' | 'subagency' | 'unsupported'; reason: string | null };
  smallBizParticipation: {
    activeOpps: number; withSetAside: number; pct: number | null;
    status: 'measured' | 'unavailable' | 'unsupported'; reason: string | null;
  };
  setAsideMix: { label: string; count: number }[];          // from ACTIVE open notices — SAMPLED (see openNoticeSample)
  /** The open-notice mix + NAICS coverage come from a bounded row pull (PostgREST caps at 1,000).
   *  Disclosed so the card never presents a sample as the population. Population fix = follow-up. */
  openNoticeSample: { rows: number; of: number; complete: boolean };
  awardedSetAsideMix: { label: string; count: number }[];    // from the recompete/award record (set_aside_enriched) — exact head-counts
  awardedSetAside: {
    identity: { name: string; tier: 'toptier' | 'subtier' } | null; // canonical USASpending agency matched EXACTLY
    total: number | null;                                           // enriched rows for that agency (null = unknown)
    note: string | null;                                            // why the mix is empty/unknown, when it is
  };
  marketCoverage: { distinctNaics: number; topNaics: { naics: string; opps: number }[] };
  /**
   * SUPPLIER-BASE BREADTH (the OBS-008 input; "supplier churn" was the earlier internal name for the
   * same input). An implemented signal, NOT a published Observatory standard. Population-level via
   * the competition_health_winners RPC — never a capped row pull (the defect that displayed 712
   * distinct DoD winners against an actual 4,763). Every field is null when the aggregate is
   * unavailable: unknown, never zero.
   */
  winners: {
    /**
     * measured     — a valid department with award notices in the window, ≥1 winner identity
     * zero         — a valid department WITH award notices in the window but zero qualifying winner
     *                identities (no notice carried an awardee name). The only state that shows "0".
     * unavailable  — sub-agency scope, no award notices in the window, or the aggregate failed
     * unsupported  — the agency key is not a department in Mindy's SAM record
     */
    status: 'measured' | 'zero' | 'unavailable' | 'unsupported';
    reason: string | null;
    /** Award notices posted in-window for this department, with or without an awardee (exact). */
    awardNoticesInWindow: number | null;
    window: { since: string; until: string; days: number; basis: string };
    awardsWithAwardee: number | null;       // award notices posted in-window carrying an awardee
    distinctWinners: number | null;         // distinct exact awardee names in-window
    awardsWithAmount: number | null;        // notices carrying a positive amount (the $ denominator)
    topWinners: { name: string; total: number; awards: number }[]; // by $ won
    firstTimeVendors: number | null;        // winners with no award notice at this agency before the window
    firstTime: {
      lookbackStart: string | null;         // earliest award notice in the record for this agency
      lookbackDays: number | null;          // history available BEFORE the window
      historySufficient: boolean;           // lookbackDays >= MIN_FIRST_TIME_LOOKBACK_DAYS
      definition: string;
    };
    concentrationPct: number | null;        // % of $ captured by the top 3 winners
    complete: boolean;                      // true only when computed over the whole window population
    error: string | null;
  };
  // ✅ NEW (competition depth via the per-award detail endpoint) — avg bidders + single-bid rate.
  competitionDepth: CompetitionDepth;
  // 🟡 needs new data — returned null + disclosed, never faked
  supplierReach: null;      // needs the map emitters to tag agency on card events
  notYetMeasurable: { metric: string; needs: string }[];
  error: string | null;
}

/**
 * "First-time winner" needs history BEFORE the window to mean anything. The sam_opportunities
 * corpus begins 2026-03-15, so a 90-day window in Oct 2026 has ~4 months of prior record: most
 * "first-time" winners are simply firms the record had not yet seen. Below a year of lookback the
 * count is still computed and shown, but labeled insufficient and never used to claim "broadening".
 */
export const MIN_FIRST_TIME_LOOKBACK_DAYS = 365;

/** The OBS-002 enriched set-aside categories (measured 2026-10-06: these 10 cover every row). */
export const AWARDED_SETASIDE_LABELS = ['Full & Open', 'SB-Total', '8(a)', 'SDVOSB', 'WOSB', 'Indian-SB', 'HUBZone', 'SB-Partial', 'VOSB', 'EDWOSB'];

const FIRST_TIME_DEFINITION =
  'A winner in the window with no award notice at this agency posted before the window starts, within the history Mindy holds.';

function emptyWinners(
  windowDays: number,
  nowMs: number,
  error: string | null = null,
  status: CompetitionHealth['winners']['status'] = 'unavailable',
  reason: string | null = null,
): CompetitionHealth['winners'] {
  return {
    status, reason: reason ?? error, awardNoticesInWindow: null,
    window: {
      since: new Date(nowMs - windowDays * 86400_000).toISOString(),
      until: new Date(nowMs).toISOString(),
      days: windowDays,
      basis: 'award-notice posting date',
    },
    awardsWithAwardee: null, distinctWinners: null, awardsWithAmount: null, topWinners: [],
    firstTimeVendors: null,
    firstTime: { lookbackStart: null, lookbackDays: null, historySufficient: false, definition: FIRST_TIME_DEFINITION },
    concentrationPct: null, complete: false, error,
  };
}

interface WinnersRow {
  awards: number | string; distinct_winners: number | string; awards_with_amount: number | string;
  total_dollars: number | string; top3_dollars: number | string; first_time_winners: number | string;
  lookback_start: string | null; top_winners: { name: string; total: number | string; awards: number | string }[] | null;
}

export async function computeCompetitionHealth(
  supabase: SupabaseClient,
  agency: string,
  windowDays = 90,
  nowMs: number = Date.now(),
): Promise<CompetitionHealth> {
  const AG = agency.trim();

  const base: CompetitionHealth = {
    agency: AG, windowDays, grounded: false,
    scope: { status: 'department', reason: null },
    smallBizParticipation: { activeOpps: 0, withSetAside: 0, pct: null, status: 'measured', reason: null },
    setAsideMix: [], awardedSetAsideMix: [],
    openNoticeSample: { rows: 0, of: 0, complete: false },
    awardedSetAside: { identity: null, total: null, note: 'not computed' },
    marketCoverage: { distinctNaics: 0, topNaics: [] },
    winners: emptyWinners(windowDays, nowMs),
    competitionDepth: { agency: AG, scope: { naics: null, state: null }, resolvedAgency: null, grounded: false, sampled: 0, sampledWithData: 0, avgBidders: null, medianBidders: null, singleBidCount: 0, singleBidPct: null, singleBidSampleInterval: null, intervalScope: '', sampleOrder: '', strength: 'insufficient' as const, singleBidMoe: null, singleBidPlain: null, note: 'not computed' },
    supplierReach: null,
    notYetMeasurable: [
      { metric: 'Supplier reach / opportunity visibility', needs: 'the map card-view events (user_engagement) do not yet carry the listing\'s agency — the emitters must tag agency on impression/click so we can count distinct contractors who viewed THIS buyer\'s listings' },
    ],
    error: null,
  };

  // ── 0) SCOPE — is this a department key the SAM-based measures can actually be computed for? ──
  //    A sub-agency (Navy) lives in sub_tier, and an unknown name matches no department; for both,
  //    the department-keyed counts below would return 0 — a FALSE zero. Decide the scope first.
  const ident = resolveAgencyIdentity(AG);
  // Existence check (one row), not a count: we only need to know whether the key exists at all.
  const { data: deptRows, error: deptErr } = await supabase
    .from('sam_opportunities').select('department').eq('department', AG).limit(1);
  if (deptErr || !deptRows) {
    return { ...base, error: `competition-health scope check failed: ${deptErr?.message ?? 'no data'}` };
  }
  if (deptRows.length === 0) {
    const scope: CompetitionHealth['scope'] = ident.resolved && ident.tier === 'subtier'
      ? { status: 'subagency', reason: `${ident.name} is a sub-agency. Mindy's SAM record files it under its parent department (sub_tier), and these counts are computed per department only.` }
      : { status: 'unsupported', reason: `"${AG}" is not a department in Mindy's SAM opportunity record.` };
    const st = scope.status === 'subagency' ? 'unavailable' : 'unsupported';
    base.scope = scope;
    base.smallBizParticipation = { activeOpps: 0, withSetAside: 0, pct: null, status: st, reason: scope.reason };
    base.openNoticeSample = { rows: 0, of: 0, complete: false };
    base.winners = emptyWinners(windowDays, nowMs, null, st, scope.reason);
  }
  const deptScoped = base.scope.status === 'department';

  // ── 1) small-business participation — EXACT head-counts (NOT a sampled ratio) ──
  // ⚠️ PostgREST caps a `.select()` at 1000 rows regardless of `.limit()`, so counting set-aside %
  //    from a fetched page would silently sample the first 1000 of a 2,882-opp agency (the documented
  //    1000-row-cap trap). Use two EXACT head-counts instead so the ratio is over the WHOLE set.
  const activeQ = () => supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('department', AG).eq('active', true);
  // "with a set-aside" = set_aside_code present AND not the literal 'NONE'/'' (full & open).
  const saQ = () => supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('department', AG).eq('active', true)
    .not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE');
  // Out of scope → no department-keyed count is even built (it could only return a false 0).
  const [activeRes, saRes] = deptScoped
    ? await Promise.all([activeQ(), saQ()])
    : [{ count: 0, error: null }, { count: 0, error: null }];
  const { count: activeCount, error: activeErr } = activeRes;
  if (activeErr || activeCount == null) {
    // The PRIMARY count failed or came back null (unknown) — surface it; never pretend the market is empty.
    return { ...base, error: `competition-health read failed: ${activeErr?.message ?? 'null active count'}` };
  }
  const activeOpps = activeCount;
  // A failed/null set-aside count is UNKNOWN, not zero (Bug Prevention Rule #11) → pct null.
  const saKnown = !saRes.error && saRes.count != null;
  const withSetAside = saKnown ? (saRes.count as number) : 0;
  if (deptScoped) {
    base.smallBizParticipation = {
      activeOpps,
      withSetAside,
      pct: saKnown && activeOpps > 0 ? Math.round((withSetAside / activeOpps) * 1000) / 10 : null,
      status: 'measured',
      reason: saKnown ? null : 'set-aside count unavailable',
    };
  }

  // ── 1b) set-aside MIX + NAICS breadth — a bounded SAMPLE (up to 1000) is fine for shape/ranking. ──
  //    (The exact % comes from the head-counts above; this pull only ranks the categories.)
  const { data: sample, error: sampleErr } = deptScoped
    ? await supabase
      .from('sam_opportunities')
      .select('set_aside_code, naics_code')
      .eq('department', AG)
      .eq('active', true)
      .limit(1000)
    : { data: [] as { set_aside_code: string | null; naics_code: string | null }[], error: null };
  if (sampleErr) {
    // Non-fatal: the exact % above still ships. The mix/coverage stay empty and are labeled a
    // 0-row sample (complete:false) — never presented as "this agency buys across 0 NAICS".
    console.error('[competition-health] open-notice sample failed:', sampleErr.message);
  }
  const rows = sampleErr ? [] : (sample || []);
  if (deptScoped) base.openNoticeSample = { rows: rows.length, of: activeOpps, complete: !sampleErr && rows.length >= activeOpps };
  const saTally: Record<string, number> = {};
  const naicsTally: Record<string, number> = {};
  for (const r of rows) {
    if (isSetAside(r.set_aside_code)) {
      const lbl = saLabel(r.set_aside_code as string);
      saTally[lbl] = (saTally[lbl] || 0) + 1;
    }
    const n = (r.naics_code || '').trim();
    if (n) naicsTally[n] = (naicsTally[n] || 0) + 1;
  }
  base.setAsideMix = Object.entries(saTally).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  base.marketCoverage = {
    distinctNaics: Object.keys(naicsTally).length,
    topNaics: Object.entries(naicsTally).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([naics, opps]) => ({ naics, opps })),
  };

  // ── 2) awarded set-aside mix (the AWARD record — stronger than open notices) ──
  // Canonical agency identity, EXACT match — never a keyword ILIKE. `awarding_agency` stores the
  // USASpending toptier name ("Department of Defense"); service branches live in
  // `awarding_sub_agency`. An unresolvable agency is refused (null + note), not guessed.
  // Exact per-category head-counts (the OBS-002 method), not a row pull capped at 1,000.
  if (!ident.resolved) {
    base.awardedSetAside = { identity: null, total: null, note: `Can't confidently map "${AG}" to a USASpending agency, so the awarded mix is withheld rather than risk counting another buyer's awards.` };
  } else {
    const col = ident.tier === 'subtier' ? 'awarding_sub_agency' : 'awarding_agency';
    const headAw = (label?: string) => {
      let q = supabase.from('recompete_opportunities').select('*', { count: 'exact', head: true }).eq(col, ident.name);
      q = label ? q.eq('set_aside_enriched', label) : q.not('set_aside_enriched', 'is', null);
      return q;
    };
    const [totRes, ...catRes] = await Promise.all([headAw(), ...AWARDED_SETASIDE_LABELS.map((l) => headAw(l))]);
    const failed = [totRes, ...catRes].find((r) => r.error || r.count == null);
    if (failed) {
      base.awardedSetAside = { identity: { name: ident.name, tier: ident.tier }, total: null, note: `awarded set-aside counts unavailable: ${failed.error?.message ?? 'null count'}` };
    } else {
      const total = totRes.count as number;
      const mix = AWARDED_SETASIDE_LABELS.map((label, i) => ({ label, count: catRes[i].count as number })).filter((m) => m.count > 0);
      const other = total - mix.reduce((acc, m) => acc + m.count, 0);
      if (other > 0) mix.push({ label: 'Other', count: other });
      base.awardedSetAsideMix = mix.sort((a, b) => b.count - a.count);
      base.awardedSetAside = {
        identity: { name: ident.name, tier: ident.tier },
        total,
        note: total === 0 ? `No enriched award set-aside records for ${ident.name}.` : null,
      };
    }
  }

  // ── 3) SUPPLIER-BASE BREADTH — who won, over the WHOLE window population (DB-side aggregate) ──
  //    competition_health_winners (migration 20261006) returns ONE row: no page to truncate. The old
  //    `.limit(4000)` pull was silently capped at 1,000 rows. On failure (incl. the function not yet
  //    applied) every figure is null + the error is surfaced — there is no capped-fetch fallback.
  if (deptScoped) {
    const winners = emptyWinners(windowDays, nowMs);
    // Exact count of ALL award notices in the window (awardee or not) — separates a genuine zero
    // (notices exist, none name a winner) from "nothing to measure" (no notices in the window).
    const [rpcRes, noticesRes] = await Promise.all([
      supabase.rpc('competition_health_winners', {
        p_department: AG, p_since: winners.window.since, p_until: winners.window.until, p_top: 6,
      }),
      supabase.from('sam_opportunities').select('*', { count: 'exact', head: true })
        .eq('department', AG).eq('notice_type', 'Award Notice')
        .gte('posted_date', winners.window.since).lt('posted_date', winners.window.until),
    ]);
    const { data: wData, error: wErr } = rpcRes;
    const wRow = (Array.isArray(wData) ? wData[0] : wData) as WinnersRow | null | undefined;
    const notices = noticesRes.error || noticesRes.count == null ? null : noticesRes.count;
    if (wErr || !wRow) {
      const msg = `supplier-breadth aggregate unavailable: ${wErr?.message ?? 'no row returned'}`;
      base.winners = { ...winners, status: 'unavailable', reason: msg, error: msg };
    } else if (notices == null) {
      const msg = `award-notice count unavailable: ${noticesRes.error?.message ?? 'null count'}`;
      base.winners = { ...winners, status: 'unavailable', reason: msg, error: msg };
    } else if (notices === 0) {
      base.winners = {
        ...winners, status: 'unavailable', awardNoticesInWindow: 0,
        reason: `No award notices were posted for this department in the ${windowDays}-day window, so there is nothing to measure.`,
      };
    } else {
      const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
      const total = num(wRow.total_dollars);
      const distinct = num(wRow.distinct_winners);
      const lookbackStart = wRow.lookback_start;
      const lookbackDays = lookbackStart
        ? Math.max(0, Math.floor((Date.parse(winners.window.since) - Date.parse(lookbackStart)) / 86400_000))
        : null;
      base.winners = {
        ...winners,
        status: distinct > 0 ? 'measured' : 'zero',
        reason: distinct > 0 ? null : `${notices.toLocaleString()} award notice${notices === 1 ? '' : 's'} posted in the window, none naming an awardee.`,
        awardNoticesInWindow: notices,
        awardsWithAwardee: num(wRow.awards),
        distinctWinners: distinct,
        awardsWithAmount: num(wRow.awards_with_amount),
        topWinners: (wRow.top_winners || []).map((w) => ({ name: w.name, total: num(w.total), awards: num(w.awards) })),
        firstTimeVendors: num(wRow.first_time_winners),
        firstTime: {
          lookbackStart,
          lookbackDays,
          historySufficient: lookbackDays != null && lookbackDays >= MIN_FIRST_TIME_LOOKBACK_DAYS,
          definition: FIRST_TIME_DEFINITION,
        },
        concentrationPct: total > 0 ? Math.round((num(wRow.top3_dollars) / total) * 1000) / 10 : null,
        complete: true,
        error: null,
      };
    }
  }

  // ── 4) COMPETITION DEPTH — avg bidders + single-bid rate (per-award detail endpoint, cached 24h). ──
  //    Best-effort + self-contained: a failure yields grounded:false (the dashboard shows "not enough
  //    data"), never a fabricated average. Does NOT touch any Supabase table.
  base.competitionDepth = await computeCompetitionDepth(AG);

  base.grounded = activeOpps > 0;
  return base;
}

/**
 * The buyer-side "Today's Priorities" — grounded, rule-based (same discipline as the contractor
 * dashboard). Each priority fires only when its data condition is met and the numbers ARE the
 * computed values. Returns [] when there's nothing grounded to say.
 */
export function buildCompetitionPriorities(h: CompetitionHealth): { level: 'go' | 'watch' | 'stop'; title: string; body: string; rec: string }[] {
  const out: { level: 'go' | 'watch' | 'stop'; title: string; body: string; rec: string }[] = [];
  const sb = h.smallBizParticipation;

  // Small-business participation — the OSDBU's headline.
  if (sb.pct != null) {
    if (sb.pct >= 30) {
      out.push({
        level: 'go',
        title: 'Small-business participation is healthy',
        body: `${sb.pct}% of your ${sb.activeOpps.toLocaleString()} active solicitations carry a set-aside (${sb.withSetAside.toLocaleString()} of ${sb.activeOpps.toLocaleString()}).`,
        rec: 'Sustain it — this is the number you\'re graded on. Watch the trend quarter over quarter.',
      });
    } else {
      out.push({
        level: 'watch',
        title: 'Small-business participation is low',
        body: `Only ${sb.pct}% of your ${sb.activeOpps.toLocaleString()} active solicitations carry a set-aside.`,
        rec: 'Rule-of-two check: markets with 2+ capable small firms should be set aside. Mindy can show you which.',
      });
    }
  }

  // Supplier-reach concentration — is attention/market spread, or piled into a few codes?
  const topN = h.marketCoverage.topNaics;
  const totalTop = topN.reduce((s, x) => s + x.opps, 0);
  const allOpps = h.smallBizParticipation.activeOpps;
  if (allOpps > 20 && topN.length >= 3) {
    const top3 = topN.slice(0, 3).reduce((s, x) => s + x.opps, 0);
    const top3Pct = Math.round((top3 / allOpps) * 100);
    if (top3Pct >= 60) {
      out.push({
        level: 'watch',
        title: 'Your market is concentrated in a few codes',
        body: `${top3Pct}% of your active solicitations sit in just 3 NAICS (of ${h.marketCoverage.distinctNaics} you buy across). The rest may be getting little supplier attention.`,
        rec: 'Broaden outreach on the long-tail codes, or expect thin competition there.',
      });
    }
  }

  // Competition depth — single-bid rate is the marquee "under-competed" signal.
  const cd = h.competitionDepth;
  if (cd.grounded && cd.singleBidPct != null) {
    if (cd.singleBidPct >= 40) {
      out.push({
        level: 'watch',
        title: 'Many awards are drawing a single bidder',
        body: `${cd.singleBidPct}% of your recent awards received exactly one reported offer (avg ${cd.avgBidders} bidders across ${cd.sampledWithData} sampled). Under-competed markets cost more.`,
        rec: 'These are the markets to broaden outreach on — a Rule-of-Two set-aside or an industry day can pull in more bidders.',
      });
    } else if (cd.avgBidders != null && cd.avgBidders >= 3) {
      out.push({
        level: 'go',
        title: 'Competition on your awards is healthy',
        body: `Your recent awards averaged ${cd.avgBidders} bidders (single-bid ${cd.singleBidPct}% across ${cd.sampledWithData} sampled).`,
        rec: 'Healthy competition keeps prices down — sustain it.',
      });
    }
  }

  // Winner concentration — is the supplier base broad, or are a few firms winning everything?
  const w = h.winners;
  // Only over a COMPLETE population — a sampled or unavailable winner count never drives a call.
  if (w.complete && w.distinctWinners != null && w.distinctWinners >= 10 && w.concentrationPct != null) {
    if (w.concentrationPct >= 60) {
      out.push({
        level: 'watch',
        title: 'Awards are concentrated in a few suppliers',
        body: `The top 3 winners captured ${w.concentrationPct}% of award dollars across ${w.distinctWinners.toLocaleString()} distinct winners this period.`,
        rec: 'A broad supplier base is healthier — check whether the concentrated markets are genuinely sole-capable or just under-marketed.',
      });
    } else if (w.firstTime.historySufficient && w.firstTimeVendors != null && w.firstTimeVendors >= 2) {
      // Gated on history: with < a year of record before the window, "first-time" mostly means
      // "first time Mindy saw them", which cannot support a "broadening" claim.
      out.push({
        level: 'go',
        title: 'Your supplier base is broadening',
        body: `${w.distinctWinners.toLocaleString()} distinct firms won this period, including ${w.firstTimeVendors} first-time winner${w.firstTimeVendors === 1 ? '' : 's'} at your agency — new competition entering the market.`,
        rec: 'Keep it up — new entrants are a sign of a healthy, competitive market.',
      });
    }
  }

  return out.slice(0, 3);
}

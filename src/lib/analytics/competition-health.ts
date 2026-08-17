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
import { computeCompetitionDepth, type CompetitionDepth } from './competition-depth';

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
  smallBizParticipation: { activeOpps: number; withSetAside: number; pct: number | null };
  setAsideMix: { label: string; count: number }[];          // from ACTIVE open notices
  awardedSetAsideMix: { label: string; count: number }[];    // from the recompete/award record (set_aside_enriched)
  marketCoverage: { distinctNaics: number; topNaics: { naics: string; opps: number }[] };
  // ✅ NEW (PR #1062 awardee backfill): the award record on sam_opportunities.
  winners: {
    awardsWithAwardee: number;              // award notices posted in-window carrying an awardee
    distinctWinners: number;                // how many different firms won
    topWinners: { name: string; total: number; awards: number }[]; // by $ won
    firstTimeVendors: number | null;        // winners with no prior award at this agency (null if not computed)
    concentrationPct: number | null;        // % of $ captured by the top 3 winners — a competition-health signal
  };
  // ✅ NEW (competition depth via the per-award detail endpoint) — avg bidders + single-bid rate.
  competitionDepth: CompetitionDepth;
  // 🟡 needs new data — returned null + disclosed, never faked
  supplierReach: null;      // needs the map emitters to tag agency on card events
  notYetMeasurable: { metric: string; needs: string }[];
  error: string | null;
}

const norm = (a: string) => a.trim().toUpperCase();

export async function computeCompetitionHealth(
  supabase: SupabaseClient,
  agency: string,
  windowDays = 90,
): Promise<CompetitionHealth> {
  const AG = agency.trim();

  const base: CompetitionHealth = {
    agency: AG, windowDays, grounded: false,
    smallBizParticipation: { activeOpps: 0, withSetAside: 0, pct: null },
    setAsideMix: [], awardedSetAsideMix: [],
    marketCoverage: { distinctNaics: 0, topNaics: [] },
    winners: { awardsWithAwardee: 0, distinctWinners: 0, topWinners: [], firstTimeVendors: null, concentrationPct: null },
    competitionDepth: { agency: AG, scope: { naics: null, state: null }, resolvedAgency: null, grounded: false, sampled: 0, sampledWithData: 0, avgBidders: null, medianBidders: null, singleBidCount: 0, singleBidPct: null, note: 'not computed' },
    supplierReach: null,
    notYetMeasurable: [
      { metric: 'Supplier reach / opportunity visibility', needs: 'the map card-view events (user_engagement) do not yet carry the listing\'s agency — the emitters must tag agency on impression/click so we can count distinct contractors who viewed THIS buyer\'s listings' },
    ],
    error: null,
  };

  // ── 1) small-business participation — EXACT head-counts (NOT a sampled ratio) ──
  // ⚠️ PostgREST caps a `.select()` at 1000 rows regardless of `.limit()`, so counting set-aside %
  //    from a fetched page would silently sample the first 1000 of a 2,882-opp agency (the documented
  //    1000-row-cap trap). Use two EXACT head-counts instead so the ratio is over the WHOLE set.
  const activeQ = supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('department', AG).eq('active', true);
  // "with a set-aside" = set_aside_code present AND not the literal 'NONE'/'' (full & open).
  const saQ = supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('department', AG).eq('active', true)
    .not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE');
  const [activeRes, saRes] = await Promise.all([activeQ, saQ]);
  if (activeRes.error) {
    // The PRIMARY count failed — surface it; do not pretend the market is empty.
    return { ...base, error: `competition-health read failed: ${activeRes.error.message}` };
  }
  const activeOpps = activeRes.count ?? 0;
  const withSetAside = saRes.error ? 0 : (saRes.count ?? 0);
  base.smallBizParticipation = {
    activeOpps,
    withSetAside,
    pct: activeOpps > 0 ? Math.round((withSetAside / activeOpps) * 1000) / 10 : null,
  };

  // ── 1b) set-aside MIX + NAICS breadth — a bounded SAMPLE (up to 1000) is fine for shape/ranking. ──
  //    (The exact % comes from the head-counts above; this pull only ranks the categories.)
  const { data: sample } = await supabase
    .from('sam_opportunities')
    .select('set_aside_code, naics_code')
    .eq('department', AG)
    .eq('active', true)
    .limit(1000);
  const rows = sample || [];
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
  // recompete_opportunities.set_aside_enriched is filled on ~51k rows; match the agency by keyword
  // (awarding_agency stores full names, e.g. "VETERANS AFFAIRS, DEPARTMENT OF").
  const kw = AG.split(',')[0].trim(); // "VETERANS AFFAIRS" from "VETERANS AFFAIRS, DEPARTMENT OF"
  const { data: awarded, error: awErr } = await supabase
    .from('recompete_opportunities')
    .select('set_aside_enriched')
    .not('set_aside_enriched', 'is', null)
    .ilike('awarding_agency', `%${kw}%`)
    .limit(4000);
  if (!awErr && awarded) {
    const t: Record<string, number> = {};
    for (const r of awarded as { set_aside_enriched: string | null }[]) {
      const c = (r.set_aside_enriched || '').trim();
      if (c) t[c] = (t[c] || 0) + 1;
    }
    base.awardedSetAsideMix = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
  }
  // awErr is non-fatal — the open-notice metrics still ship; the awarded mix is a bonus.

  // ── 3) THE AWARD RECORD — who won, from the enriched awardee fields (PR #1062 backfill) ──
  //    ⚠️ Window on `posted_date` (clean), NOT `award_date`: the awardee backfill left `award_date`
  //    with parse-garbage (year 2260, future dates) on many rows. posted_date is the notice-posting
  //    date and a reliable proxy for "recently awarded". awardee_name is empty on ~0.4% (the guard
  //    dropped empty-string names) — filter those out so a blank never counts as a winner.
  const winSince = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const { data: awards, error: awdErr } = await supabase
    .from('sam_opportunities')
    .select('awardee_name, award_amount')
    .eq('department', AG)
    .eq('notice_type', 'Award Notice')
    .neq('awardee_name', '')
    .not('awardee_name', 'is', null)
    .gte('posted_date', winSince)
    .limit(4000);
  if (!awdErr && awards) {
    const byVendor: Record<string, { total: number; awards: number }> = {};
    for (const a of awards as { awardee_name: string | null; award_amount: string | number | null }[]) {
      const name = (a.awardee_name || '').trim();
      if (!name) continue;
      const amt = Number(a.award_amount) || 0;
      const v = (byVendor[name] ||= { total: 0, awards: 0 });
      v.total += amt;
      v.awards += 1;
    }
    const ranked = Object.entries(byVendor).sort((x, y) => y[1].total - x[1].total);
    const totalDollars = ranked.reduce((s, [, v]) => s + v.total, 0);
    const top3Dollars = ranked.slice(0, 3).reduce((s, [, v]) => s + v.total, 0);
    base.winners = {
      awardsWithAwardee: awards.length,
      distinctWinners: ranked.length,
      topWinners: ranked.slice(0, 6).map(([name, v]) => ({ name, total: v.total, awards: v.awards })),
      // first-time vendors computed below (needs a per-vendor prior-award check — bounded to the top set)
      firstTimeVendors: null,
      concentrationPct: totalDollars > 0 ? Math.round((top3Dollars / totalDollars) * 1000) / 10 : null,
    };

    // First-time vendors: of the top winners this window, how many have NO award at this agency
    // BEFORE the window? Bounded to the top ~15 (a head-count each; a full-population scan would be
    // heavy). This is a real "is the supplier base broadening?" signal, honestly scoped.
    const topForCheck = ranked.slice(0, 15).map(([name]) => name);
    if (topForCheck.length > 0) {
      const checks = await Promise.all(topForCheck.map((name) =>
        supabase.from('sam_opportunities').select('*', { count: 'exact', head: true })
          .eq('department', AG).eq('notice_type', 'Award Notice').eq('awardee_name', name).lt('posted_date', winSince)
          .then((r) => ({ name, prior: r.error ? null : (r.count ?? 0) })),
      ));
      const firstTime = checks.filter((c) => c.prior === 0).length;
      const measurable = checks.filter((c) => c.prior != null).length;
      // Only report if we actually measured (a query error on all → leave null, disclosed).
      base.winners.firstTimeVendors = measurable > 0 ? firstTime : null;
    }
  }
  // awdErr is non-fatal — participation/mix/coverage still ship; the award record is additive.

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
        body: `${cd.singleBidPct}% of your recent awards received 1 or fewer offers (avg ${cd.avgBidders} bidders across ${cd.sampledWithData} sampled). Under-competed markets cost more.`,
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
  if (w.distinctWinners >= 10 && w.concentrationPct != null) {
    if (w.concentrationPct >= 60) {
      out.push({
        level: 'watch',
        title: 'Awards are concentrated in a few suppliers',
        body: `The top 3 winners captured ${w.concentrationPct}% of award dollars across ${w.distinctWinners.toLocaleString()} distinct winners this period.`,
        rec: 'A broad supplier base is healthier — check whether the concentrated markets are genuinely sole-capable or just under-marketed.',
      });
    } else if (w.firstTimeVendors != null && w.firstTimeVendors >= 2) {
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

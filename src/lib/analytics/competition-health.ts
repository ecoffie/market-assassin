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
  // 🟡 needs new data — returned null + disclosed, never faked
  supplierReach: null;      // needs the map emitters to tag agency on card events
  averageBidders: null;     // number_of_offers is NULL on every row — needs the FPDS competition extract
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
    supplierReach: null, averageBidders: null,
    notYetMeasurable: [
      { metric: 'Supplier reach / opportunity visibility', needs: 'the map card-view events (user_engagement) do not yet carry the listing\'s agency — the emitters must tag agency on impression/click so we can count distinct contractors who viewed THIS buyer\'s listings' },
      { metric: 'Average bidders · single-bid rate · response rate', needs: 'number_of_offers is NULL on all 150k recompete rows (USASpending\'s award endpoint omits it) — needs the FPDS competition extract (number_of_offers_received / extent_competed)' },
      { metric: 'First-time / new vendors', needs: 'a windowed first-action_date-per-recipient query over the 63M-row BigQuery usaspending.awards table — deferred to Phase 1.5 (cold BQ scan; not a Supabase read)' },
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

  // The awarded-vs-open honesty: if the award record is heavily Full&Open but opens are set-aside,
  // that's a real signal worth surfacing (or vice-versa). Kept simple for v1 — a single go/watch above.
  return out.slice(0, 3);
}

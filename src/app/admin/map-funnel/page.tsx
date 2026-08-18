'use client';

/**
 * Admin: Mission Control — the five-stage lifecycle (Epic #1).
 *
 * The morning dashboard FOR ERIC over /api/admin/map-funnel: "what should we improve today so
 * contractors make better decisions tomorrow?" Five stages top-to-bottom —
 * Discover → Decide → Pursue → Build → Win — split by a HARD WALL into two halves:
 *   - HABIT half (Discover + Decide) — browsing is the point; measured by RETURN + engagement, NEVER
 *     conversion. The HEADLINE is the return-visit rate (Principle 02). NO red "drop" on discovery
 *     steps (a low step ratio here is normal browsing, Principle 01). Decide = engagement volume +
 *     the two discovery-quality ratios — NOT a funnel.
 *   - FUNNEL half (Pursue + Build + Win) — the rare MINORITY path (a pursuit is far rarer than a save,
 *     by design). The EXECUTION-ONLY funnel; the "Opportunities Advanced" north-star + the drop callout
 *     live HERE only. Discovery → Pursuit is the healthy boundary, never scored as conversion.
 * Plus PRODUCT INTELLIGENCE ("what helped people win", grounded in user_pipeline) and an honest
 * "not yet measurable" section — never a fabricated number.
 *
 * Pure CSS/SVG bars (no chart lib), matching the /mcp usage-charts house style. Honest empty-states:
 * instrumented:false, ratio:null, ctr:null, grounded:false read as "no data yet", never a fabricated 0/0%.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface DiscoveryStep { step: string; label: string; users: number; events: number; ofMapOpen: number | null; reachableOffMap: boolean }
interface ExecStep { step: string; label: string; users: number; events: number; convFromPrev: number | null; convFromTop: number | null }
interface StrategyCombo { combo: string; strands: string[]; users: number; applies: number }
interface StrandPop { strand: string; users: number }
interface WhyStrand { strand: string; impressions: number; clicks: number; ctr: number | null }
interface AlertToMap { capturable: boolean; instrumented: boolean; alertOpeners: number; reachedMap: number; ratio: number | null }
interface CardsToListing { instrumented: boolean; impressions: number; listingOpens: number; ratio: number | null }
interface NorthStarStep { step: string; label: string; users: number }
interface WinRank { key: string; wins: number }
interface ProductIntelligence { grounded: boolean; windowScoped: boolean; wonCount: number; wonUndated: number; topMarket: WinRank[]; topAgency: WinRank[]; topState: WinRank[] }
interface NotMeasurable { metric: string; needs: string }
interface EmailMapClicker { email: string; clicks: number; lastClickAt: string; reachedMap: boolean }
interface EmailMapConverter {
  windowDays: number; clicks: number; clickers: number; mapReached: number;
  clickToReachRate: number | null; recentClickers: EmailMapClicker[];
}
// ── The Intelligence layer (Market Intelligence redesign 2026-08-07) ──
interface Priority { level: 'go' | 'watch' | 'stop'; title: string; body: string; rec: string }
interface PulseSignal { key: string; label: string; sub: string; delta: string | null; dir: 'up' | 'down' | 'flat' | null }
interface MarketPulse { grounded: boolean; windowDays: number; signals: PulseSignal[]; error: string | null }
interface DecisionConfidence {
  deciders: number; deep: number; considered: number; shallow: number;
  deepPct: number | null; consideredPct: number | null; shallowPct: number | null;
}
interface OpportunityQuality { topStrands: { strand: string; clicks: number }[]; winningMarkets: WinRank[]; grounded: boolean }

interface FunnelData {
  ok: boolean; windowDays: number; instrumented: boolean; totalMapEvents: number; funnelReachedEvents: number;
  todaysPriorities: Priority[];
  marketPulse: MarketPulse;
  decisionConfidence: DecisionConfidence;
  opportunityQuality: OpportunityQuality;
  emailMapConverter: EmailMapConverter;
  discovery: {
    returnVisit: { activeUsers: number; returners: number; returnRate: number | null; medianActiveDays: number | null };
    dailyActive: { today: number | null; avg: number | null; trend: { date: string; users: number }[]; latestDay: string | null };
    engagement: {
      listingsOpened: { users: number; events: number };
      listingsShared: { users: number; events: number };
      saved: { users: number; events: number };
    };
    steps: DiscoveryStep[];
    ratios: { alertToMap: AlertToMap; cardsToListing: CardsToListing };
  };
  execution: {
    steps: ExecStep[];
    biggestDrop: { fromStep: string; toStep: string; dropPct: number } | null;
    northStar: { label: string; steps: NorthStarStep[] };
    outcomes: { won: number; lost: number; no_bid: number; total: number; winRate: number | null };
  };
  productIntelligence: ProductIntelligence;
  notYetMeasurable: NotMeasurable[];
  strategy: { strategyFilterUsers: number; topStrategies: StrategyCombo[]; strandPopularity: StrandPop[] };
  whyThisOpportunity: { minImpressions: number; strands: WhyStrand[] };
  note: string;
}

// The five-stage Mission Control lifecycle: Discover → Decide → Pursue → Build → Win.
// Discover+Decide = the HABIT half (measured by return/engagement). Pursue+Build+Win = the FUNNEL half.
// A hard visual wall separates the two (Principle 01: a pursuit is far rarer than a save, by design).

// Principle → Question — static editorial, NOT data (hard-coded per Eric's spec).
const PRINCIPLE_QUESTIONS: [string, string][] = [
  ['Discovery beats search', 'Are people discovering?'],
  ['Habit beats transactions', 'Are they coming back?'],
  ['The decision is the product', 'Are listings becoming pursuits?'],
  ['Simplicity beats features', 'Which features are actually used?'],
  ['Every feature earns "daily"', 'Which surfaces create daily engagement?'],
  ['Data before AI', 'Which recommendations actually improve outcomes?'],
];

// Turn a snake_case strand/step key into a human label ("repeat_buyer" → "Repeat Buyer").
const humanize = (k: string) => k.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const nfmt = new Intl.NumberFormat('en-US');
const pct = (v: number | null) => (v == null ? 'no data yet' : `${v}%`);
// A metric that is genuinely unmeasured (null) reads "no data yet", never a fabricated 0.
const numOrNA = (v: number | null) => (v == null ? '—' : nfmt.format(v));
// Short date for the per-person ledger (e.g. "Aug 5"). Invalid/empty → em-dash, never a fake date.
const shortDate = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(t));
};

export default function MapFunnelDashboard() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [days, setDays] = useState(30);
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const today = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date()), []);

  // ── auth (mirrors launch-command-center: sessionStorage + /api/admin/verify-password) ──────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = sessionStorage.getItem('adminPassword');
      if (!stored) { if (!cancelled) setChecking(false); return; }
      try {
        const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: stored }) });
        const d = await r.json();
        if (cancelled) return;
        if (d.valid || d.success) { setAuthenticated(true); setPassword(stored); }
        else { sessionStorage.removeItem('adminPassword'); }
      } catch { if (!cancelled) sessionStorage.removeItem('adminPassword'); }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (e: FormEvent) => {
    e.preventDefault(); setAuthError('');
    try {
      const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwInput }) });
      const d = await r.json();
      if (d.valid || d.success) { sessionStorage.setItem('adminPassword', pwInput); setPassword(pwInput); setAuthenticated(true); }
      else setAuthError('Invalid admin password');
    } catch { setAuthError('Could not verify. Try again.'); }
  }, [pwInput]);

  // ── load ───────────────────────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true); setLoadError('');
    try {
      const r = await fetch(`/api/admin/map-funnel?password=${encodeURIComponent(password)}&days=${days}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d as FunnelData);
    } catch (err) { setLoadError(err instanceof Error ? err.message : 'Load failed'); setData(null); }
    finally { setLoading(false); }
  }, [password, days]);

  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);

  if (checking) return <Shell><p style={S.muted}>Checking access…</p></Shell>;

  if (!authenticated) {
    return (
      <Shell>
        <form onSubmit={login} style={{ maxWidth: 340, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ ...S.h1, fontSize: 20 }}>Mission Control — admin</h1>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
          <button type="submit" style={S.btnPrimary}>Enter</button>
          {authError && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{authError}</p>}
        </form>
      </Shell>
    );
  }

  const notInstrumented = data && !data.instrumented;
  const disc = data?.discovery;
  const exec = data?.execution;
  const discSteps = disc?.steps ?? [];
  const discTop = discSteps[0]?.users ?? 0; // discovery mouth — bars scale to this
  const execSteps = exec?.steps ?? [];
  const execTop = execSteps[0]?.users ?? 0;
  const trendMax = disc ? Math.max(1, ...disc.dailyActive.trend.map((t) => t.users)) : 1;

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <a href="/admin/dashboard" style={{ fontSize: 12, color: '#64748b', textDecoration: 'none', display: 'inline-block', marginBottom: 4 }}>&larr; Operations (ops &amp; access)</a>
          <div style={S.eyebrow}>Mindy · Mission Control · {today}</div>
          <h1 style={S.h1}>Market Intelligence</h1>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, maxWidth: 720 }}>The procurement discovery observatory. What should we improve today so contractors make better decisions tomorrow? (Business ops &amp; access live in Operations.)</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 2 }}>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                style={{ ...S.segBtn, ...(days === d ? S.segBtnOn : {}) }}>{d}d</button>
            ))}
          </div>
          <button onClick={load} disabled={loading} style={S.btnGhost}>{loading ? '…' : '↻ Refresh'}</button>
        </div>
      </div>

      {loadError && <div style={S.errorBox}>Couldn&apos;t load: {loadError}</div>}

      {notInstrumented && (
        <div style={S.noteBox}>
          <strong>No map events in this {data!.windowDays}-day window yet.</strong> The journey is empty because
          nothing was logged — not because engagement or conversion is 0. (Newly-shipped events populate a day or two after deploy.)
        </div>
      )}

      {/* ═══ THE INTELLIGENCE LAYER (renders as soon as data is present) ═══ */}
      {data && (
        <>
          {/* 1 · TODAY'S PRIORITIES — the "Head of Product" read (grounded, rule-based). */}
          {data.todaysPriorities.length > 0 && (
            <div style={{ background: 'linear-gradient(160deg,#131b28,#0b1120)', border: '1px solid #2a3547', borderRadius: 14, padding: '18px 20px', marginBottom: 18, boxShadow: '0 18px 44px rgba(0,0,0,.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f5a623', boxShadow: '0 0 10px rgba(245,166,35,.5)' }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Today&apos;s Priorities</div>
                <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>what the team should work on today</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.todaysPriorities.map((p, i) => <PriorityItem key={i} p={p} />)}
              </div>
            </div>
          )}

          {/* 2 · TODAY IN THE MARKET — the Bloomberg desk read (grounded in cached SAM/recompete). */}
          {data.marketPulse.grounded && (
            <div style={{ marginBottom: 18 }}>
              <SectionHead kicker="Today in the Market" title="The desk read — what moved in federal procurement" sub="Live signals from our cached opportunity + recompete data. Grounded, not a guess." />
              <div style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: '1px solid #1e293b', background: '#0f172a' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3ecf8e', boxShadow: '0 0 8px #3ecf8e' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', letterSpacing: '.04em' }}>Live signals · last {data.marketPulse.windowDays} days</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
                  {data.marketPulse.signals.map((s) => <PulseRow key={s.key} s={s} />)}
                </div>
              </div>
            </div>
          )}

          {/* 3 · DECISION CONFIDENCE + OPPORTUNITY QUALITY — decision-native measures. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16, marginBottom: 4 }}>
            <Card title="Decision Confidence" sub="Of contractors who opened a listing, how deep did they go? Measure decisions, not clicks.">
              {data.decisionConfidence.deciders === 0 ? (
                <Empty>No listing-openers in this window yet — no decision depth to compute.</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <ConfRow label="Deep · reached save/pursuit" pct={data.decisionConfidence.deepPct} color="#3ecf8e" />
                  <ConfRow label="Considered · multi-open" pct={data.decisionConfidence.consideredPct} color="#f5a623" />
                  <ConfRow label="Shallow · opened & left" pct={data.decisionConfidence.shallowPct} color="#f0616d" />
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 6, paddingTop: 8, borderTop: '1px solid #1e293b' }}>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{data.decisionConfidence.deciders}</span> contractors opened a listing this window. Most browsing without committing is HEALTHY for a discovery product — a save/pursuit is the rare, high-intent signal.
                  </div>
                </div>
              )}
            </Card>
            <Card title="Opportunity Quality" sub="Which listing traits + markets convert — this teaches the algorithm.">
              {!data.opportunityQuality.grounded ? (
                <Empty>No strand-click or win data in this window yet.</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.opportunityQuality.topStrands.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', marginBottom: 6 }}>Top DNA strands by engagement</div>
                      {data.opportunityQuality.topStrands.map((t) => <StrandRow key={t.strand} strand={t.strand} clicks={t.clicks} max={data.opportunityQuality.topStrands[0].clicks} />)}
                    </div>
                  )}
                  {data.opportunityQuality.winningMarkets.length > 0 && (
                    <div style={{ paddingTop: 4 }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', marginBottom: 6 }}>Markets that produced wins</div>
                      {data.opportunityQuality.winningMarkets.map((m) => (
                        <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                          <span style={{ color: '#e2e8f0' }}>{m.key}</span>
                          <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{m.wins} win{m.wins === 1 ? '' : 's'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {data && disc && exec && (
        <>
          {/* ═══ HABIT HALF ═══ STAGE 1 · DISCOVER — browsing is the point; measured by return, not conversion. */}
          <SectionHead
            kicker="Stage 1 · Discover"
            title="Discover — browsing is the point; measured by return, not conversion"
            sub="Low step-to-step ratios here are NORMAL (browsing with no intent to transact is the normal state, not a leak). We optimise return visits, not clicks."
          />

          {/* THE HEADLINE — return-visit rate (Principle 02). */}
          <Card title="Came back tomorrow — the headline" sub="Return-visit rate = % of active contractors with 2+ distinct active days. This is the retention signal we optimise for.">
            {disc.returnVisit.activeUsers === 0 ? (
              <Empty>No active contractors in this window yet — no return-visit data to compute.</Empty>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
                <Stat big value={pct(disc.returnVisit.returnRate)} label="Return-visit rate" color="#34d399" />
                <Stat value={nfmt.format(disc.returnVisit.returners)} label="Returners (2+ days)" />
                <Stat value={nfmt.format(disc.returnVisit.activeUsers)} label="Active contractors" />
                <Stat value={numOrNA(disc.returnVisit.medianActiveDays)} label="Median active days" />
              </div>
            )}
          </Card>

          {/* Daily active contractors — trend + today + avg. */}
          <Card title="Daily active contractors" sub="Distinct contractors with any map activity per day. A volume-of-engagement signal, not a conversion.">
            {disc.dailyActive.trend.length === 0 ? (
              <Empty>No active days in this window yet.</Empty>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
                  <Stat value={numOrNA(disc.dailyActive.today)} label={`Today${disc.dailyActive.latestDay ? ' · ' + disc.dailyActive.latestDay : ''}`} />
                  <Stat value={numOrNA(disc.dailyActive.avg)} label="Daily average (window)" />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
                  {disc.dailyActive.trend.map((t) => (
                    <div key={t.date} title={`${t.date}: ${t.users} active`} style={{ flex: 1, minWidth: 3, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                      <div style={{ height: `${Math.max((t.users / trendMax) * 100, t.users > 0 ? 4 : 0)}%`, background: '#10b981', borderRadius: '3px 3px 0 0' }} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {/* Discovery steps — NEUTRAL context (counts + "N of the step above"). NO drop callout. */}
          <Card title="Discovery steps — neutral context" sub="Map opened → pin → popup → listing → saved. Counts + share of the step above. NO drop is flagged: a lower step here is browsing, the normal state.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {discSteps.map((s, i) => {
                const w = discTop > 0 ? Math.max((s.users / discTop) * 100, s.users > 0 ? 2 : 0) : 0;
                return (
                  <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 130, fontSize: 13, color: '#cbd5e1', textAlign: 'right', flexShrink: 0 }}>{s.label}</div>
                    <div style={{ flex: 1, position: 'relative', height: 30, background: '#0f172a', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', inset: 0, width: `${w}%`, background: 'linear-gradient(90deg,#10b98122,#10b981)', borderRadius: 6, transition: 'width .4s ease' }} />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 13, fontWeight: 600, color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                        {nfmt.format(s.users)}
                      </div>
                    </div>
                    <div style={{ width: 108, fontSize: 12, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: '#64748b' }}>
                      {i === 0
                        ? 'map openers'
                        : s.reachableOffMap
                          // Also reachable without the map (app panels, email), so the
                          // share of map-openers can exceed 100% — say that instead of
                          // printing a ratio that reads as a conversion rate.
                          ? 'also off-map'
                          : `${pct(s.ofMapOpen)} of map openers`}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ═══ HABIT HALF ═══ STAGE 2 · DECIDE — the decision is the product; engagement volume + discovery quality. */}
          <div style={{ height: 8 }} />
          <SectionHead
            kicker="Stage 2 · Decide"
            title="Decide — the decision is the product"
            sub="Are listings becoming decisions? Engagement VOLUME (opened / shared / saved) + discovery-quality ratios. This is NOT a funnel — no drop scoring, no red."
          />

          {/* Engagement volume — listings opened / shared / saved (the right-column "THESE" metrics). */}
          <Card title="Engagement — what we optimise for" sub="Listings opened, shared, and saved — shown as engagement VOLUME, not as funnel conversion rates.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <Stat value={nfmt.format(disc.engagement.listingsOpened.users)} label="Listings opened" sub2={`${nfmt.format(disc.engagement.listingsOpened.events)} opens`} />
              <Stat value={nfmt.format(disc.engagement.listingsShared.users)} label="Listings shared" sub2={`${nfmt.format(disc.engagement.listingsShared.events)} shares`} />
              <Stat value={nfmt.format(disc.engagement.saved.users)} label="Saved" sub2={`${nfmt.format(disc.engagement.saved.events)} saves`} />
            </div>
          </Card>

          {/* The two PENDING discovery ratios (retention / reach) — honest null when denominator 0. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
            <Card title="Daily alert → map reach" sub="Of contractors who OPENED a daily alert, how many also opened the map. Does distribution reach the destination?">
              {!disc.ratios.alertToMap.capturable ? (
                <Empty>Not capturable yet — daily-alert opens are not recorded in user_engagement.</Empty>
              ) : !disc.ratios.alertToMap.instrumented ? (
                <Empty>No daily-alert opens recorded in this window yet — no data to compute.</Empty>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Stat big value={pct(disc.ratios.alertToMap.ratio)} label="Alert openers who reached the map" color="#34d399" />
                  <Stat value={nfmt.format(disc.ratios.alertToMap.reachedMap)} label="Reached the map" sub2={`of ${nfmt.format(disc.ratios.alertToMap.alertOpeners)} openers`} />
                </div>
              )}
            </Card>

            <Card title="Cards shown → listing opened" sub="Of cards browsed on the map, how many got opened. A discovery-quality signal, not a conversion target.">
              {!disc.ratios.cardsToListing.instrumented ? (
                <Empty>No card-impression events in this window yet — no data to compute.</Empty>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  <Stat big value={pct(disc.ratios.cardsToListing.ratio)} label="Cards opened" color="#34d399" />
                  <Stat value={nfmt.format(disc.ratios.cardsToListing.listingOpens)} label="Listing opens" sub2={`of ${nfmt.format(disc.ratios.cardsToListing.impressions)} shown`} />
                </div>
              )}
            </Card>
          </div>

          {/* Email → map converter — clicks on the daily alert's Open-Today's-Map button + reach. */}
          <Card title="Email → map converter" sub="Clicks on the alert's Open-Today's-Map button, and how many reached the map.">
            {data.emailMapConverter.clicks === 0 ? (
              <Empty>No map-button clicks in this window yet.</Empty>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
                <Stat value={nfmt.format(data.emailMapConverter.clicks)} label="Button clicks" />
                <Stat value={nfmt.format(data.emailMapConverter.clickers)} label="Distinct clickers" />
                <Stat value={nfmt.format(data.emailMapConverter.mapReached)} label="Reached the map" />
                <Stat big value={pct(data.emailMapConverter.clickToReachRate)} label="Click → map reach" color="#34d399" />
              </div>
            )}
          </Card>

          {/* Per-person ledger — which named contractors opened Today's Map from a daily alert. */}
          <Card title="Who clicked the map from the email" sub="Named contractors who opened Today's Map from a daily alert — newest first.">
            {data.emailMapConverter.recentClickers.length === 0 ? (
              <Empty>No map-button clicks in this window yet.</Empty>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#64748b', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      <th style={{ padding: '4px 0' }}>Email</th>
                      <th style={{ ...S.thNum }}>Clicks</th>
                      <th style={{ ...S.thNum }}>Reached map</th>
                      <th style={{ ...S.thNum }}>Last click</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.emailMapConverter.recentClickers.map((c) => (
                      <tr key={c.email} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '6px 0', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{c.email}</td>
                        <td style={S.tdNum}>{nfmt.format(c.clicks)}</td>
                        <td style={{ ...S.tdNum, color: c.reachedMap ? '#34d399' : '#64748b', fontWeight: c.reachedMap ? 700 : 400 }}>{c.reachedMap ? 'yes' : 'no'}</td>
                        <td style={S.tdNum}>{shortDate(c.lastClickAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.emailMapConverter.recentClickers.length >= 200 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>Showing the 200 most recent clickers.</div>
                )}
              </>
            )}
          </Card>

          {/* ══════════ THE WALL — habit above · execution funnel below ══════════ */}
          <Wall />

          {/* ═══ FUNNEL HALF ═══ STAGE 3 · PURSUE — the execution-only funnel begins here. */}
          <SectionHead
            kicker="Stage 3 · Pursue  ·  Stage 4 · Build  ·  Stage 5 · Win"
            title="Pursue → Build → Win — the execution-only funnel (and this half is the minority path, by design)"
            sub="A pursuit is far rarer than a save — most discovery never becomes a bid (Principle 01). These are the few who chose to act, so small numbers + steep drops are EXPECTED. Here a stall is real, so the drop callout is scoped to execution only. Discovery → Pursuit is NEVER counted as conversion."
          />

          <Card title="The execution funnel — pursuit → proposal → submitted" sub={`${nfmt.format(data.totalMapEvents)} scanned · ${nfmt.format(data.funnelReachedEvents)} reached the funnel · users per step, % = conversion from the step above`}>
            {execTop === 0 && execSteps.every((s) => s.users === 0) ? (
              <Empty>No one has started a pursuit in this window yet — the minority path is empty.</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {execSteps.map((s, i) => {
                  const w = execTop > 0 ? Math.max((s.users / execTop) * 100, s.users > 0 ? 2 : 0) : 0;
                  const isDrop = exec.biggestDrop && exec.biggestDrop.toStep === s.step;
                  return (
                    <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 130, fontSize: 13, color: '#cbd5e1', textAlign: 'right', flexShrink: 0 }}>{s.label}</div>
                      <div style={{ flex: 1, position: 'relative', height: 30, background: '#0f172a', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${w}%`, background: isDrop ? 'linear-gradient(90deg,#b4530933,#b45309)' : 'linear-gradient(90deg,#7c3aed22,#7c3aed)', borderRadius: 6, transition: 'width .4s ease' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 13, fontWeight: 600, color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                          {nfmt.format(s.users)}
                        </div>
                      </div>
                      <div style={{ width: 92, fontSize: 12, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: i === 0 ? '#64748b' : isDrop ? '#f59e0b' : '#94a3b8' }}>
                        {i === 0 ? 'start' : `${pct(s.convFromPrev)}${isDrop ? ' ⚠' : ''}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {exec.biggestDrop && (
              <div style={S.dropCallout}>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>Where execution stalls:</span>{' '}
                {humanize(exec.biggestDrop.fromStep)} → {humanize(exec.biggestDrop.toStep)} loses{' '}
                <strong>{exec.biggestDrop.dropPct}%</strong> of the users who got that far.
              </div>
            )}
          </Card>

          {/* NORTH-STAR — "Opportunities Advanced" (EXECUTION-ONLY: pursuit → proposal → submitted). */}
          <Card title={`★ ${exec.northStar.label} — the north-star`} sub="Users advancing each execution step, from pursuit onward. Discovery → Pursuit is NOT counted here — it's the healthy rare-minority boundary.">
            {exec.northStar.steps.every((s) => s.users === 0) ? (
              <Empty>No opportunities advanced past a save into the execution funnel yet.</Empty>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
                {exec.northStar.steps.map((s, i) => (
                  <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: '#0f172a', border: '1px solid #3b1d80', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#a78bfa', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{nfmt.format(s.users)}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>{s.label}</div>
                    </div>
                    {i < exec.northStar.steps.length - 1 && <span style={{ color: '#5b21b6', fontSize: 18, fontWeight: 700 }}>→</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* OUTCOME — how the work that reached a decision ended (bottom of the execution loop). */}
          <Card title="Outcomes — how pursuits closed" sub="won / lost / no-bid · win rate = won ÷ (won + lost); no-bid never competed">
            {exec.outcomes.total === 0 ? (
              <Empty>No pursuits have closed (won / lost / no-bid) in this window yet.</Empty>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
                {([
                  { k: 'won', label: 'Won', n: exec.outcomes.won, c: '#10b981' },
                  { k: 'lost', label: 'Lost', n: exec.outcomes.lost, c: '#e5484d' },
                  { k: 'no_bid', label: 'No-bid', n: exec.outcomes.no_bid, c: '#94a3b8' },
                ] as const).map((o) => (
                  <div key={o.k} style={{ flex: '1 1 120px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: o.c, fontVariantNumeric: 'tabular-nums' }}>{nfmt.format(o.n)}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{o.label}</div>
                  </div>
                ))}
                <div style={{ flex: '1 1 120px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' }}>{exec.outcomes.winRate == null ? '—' : `${exec.outcomes.winRate}%`}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Win rate</div>
                </div>
              </div>
            )}
          </Card>

          {/* ══════════ Strategy analytics (engagement-framed — kept) ══════════ */}
          <div style={{ height: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
            <Card title="Top strategies" sub={`${nfmt.format(data.strategy.strategyFilterUsers)} users filtered by strategy · a combination = one strategy`}>
              {data.strategy.topStrategies.length === 0 ? (
                <Empty>No strategy filters applied yet in this window.</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.strategy.topStrategies.slice(0, 8).map((c) => {
                    const maxU = data.strategy.topStrategies[0].users || 1;
                    return (
                      <div key={c.combo}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                          <span style={{ color: '#e2e8f0', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {c.strands.map((st) => <span key={st} style={S.chip}>{humanize(st)}</span>)}
                          </span>
                          <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>{nfmt.format(c.users)}</span>
                        </div>
                        <div style={{ height: 5, background: '#0f172a', borderRadius: 3 }}>
                          <div style={{ height: 5, width: `${(c.users / maxU) * 100}%`, background: '#7c3aed', borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Why this opportunity?" sub={`Which DNA strand drives the click (CTR = click ÷ impression, min ${data.whyThisOpportunity.minImpressions} impressions)`}>
              {data.whyThisOpportunity.strands.filter((s) => s.ctr != null).length === 0 ? (
                <Empty>Not enough clicked-card data yet — needs the DNA-on-card event live + traffic.</Empty>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#64748b', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      <th style={{ padding: '4px 0' }}>Strand</th>
                      <th style={{ ...S.thNum }}>Seen</th>
                      <th style={{ ...S.thNum }}>Clicks</th>
                      <th style={{ ...S.thNum }}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.whyThisOpportunity.strands.filter((s) => s.ctr != null).slice(0, 10).map((s) => (
                      <tr key={s.strand} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '6px 0', color: '#e2e8f0' }}>{humanize(s.strand)}</td>
                        <td style={S.tdNum}>{nfmt.format(s.impressions)}</td>
                        <td style={S.tdNum}>{nfmt.format(s.clicks)}</td>
                        <td style={{ ...S.tdNum, color: '#34d399', fontWeight: 700 }}>{s.ctr}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {/* ══════════ PRODUCT INTELLIGENCE — "what helped people win" (grounded in user_pipeline) ══════════ */}
          <div style={{ height: 8 }} />
          <SectionHead
            kicker="Product Intelligence"
            title="What helped people win"
            sub="Grounded in real won pursuits (user_pipeline stage=won ⋈ sam_opportunities), dated by their won-transition (pipeline_history). Which markets, agencies, and states our winners actually won in — never inferred, never fabricated."
          />
          <Card
            title={`Winning markets, agencies & states`}
            sub={data.productIntelligence.grounded
              ? `${nfmt.format(data.productIntelligence.wonCount)} won pursuit${data.productIntelligence.wonCount === 1 ? '' : 's'} in the last ${data.windowDays} days`
              : undefined}
          >
            {!data.productIntelligence.grounded ? (
              <Empty>No pursuits were marked won in this {data.windowDays}-day window{data.productIntelligence.wonUndated > 0 ? ` (${nfmt.format(data.productIntelligence.wonUndated)} older win${data.productIntelligence.wonUndated === 1 ? '' : 's'} predate the stage-history log, so they can't be placed in a window)` : ''} — nothing to rank. Widen the range to 90d, or this fills in as contractors mark pursuits won.</Empty>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
                  <WinRankList title="Top market (NAICS)" rows={data.productIntelligence.topMarket} color="#10b981" />
                  <WinRankList title="Top agency" rows={data.productIntelligence.topAgency} color="#7c3aed" />
                  <WinRankList title="Top state" rows={data.productIntelligence.topState} color="#0ea5e9" />
                </div>
                {data.productIntelligence.wonUndated > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
                    + {nfmt.format(data.productIntelligence.wonUndated)} older win{data.productIntelligence.wonUndated === 1 ? '' : 's'} predate the stage-history log and aren&apos;t dated, so they&apos;re excluded from this window (not hidden).
                  </div>
                )}
              </>
            )}
          </Card>

          {/* ══════════ NOT YET MEASURABLE — the honest "we don't fake it" section ══════════ */}
          <Card title="Not yet measurable" sub="Metrics we want but have no source for today. We render the gap honestly rather than fabricate a number.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.notYetMeasurable.map((m) => (
                <div key={m.metric} style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.45 }}>
                  <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{m.metric}</span>
                  <span style={{ color: '#475569' }}> — needs {m.needs}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* ══════════ PRINCIPLE → QUESTION — static editorial (not data) ══════════ */}
          <Card title="Principle → Question" sub="The lens we hold every screen up against. Static — this is editorial, not data.">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <th style={{ padding: '4px 12px 4px 0' }}>Principle</th>
                  <th style={{ padding: '4px 0' }}>The question we ask</th>
                </tr>
              </thead>
              <tbody>
                {PRINCIPLE_QUESTIONS.map(([p, q]) => (
                  <tr key={p} style={{ borderTop: '1px solid #1e293b' }}>
                    <td style={{ padding: '7px 12px 7px 0', color: '#e2e8f0', fontWeight: 600 }}>{p}</td>
                    <td style={{ padding: '7px 0', color: '#94a3b8' }}>{q}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p style={{ ...S.muted, fontSize: 12, marginTop: 18 }}>{data.note}</p>
        </>
      )}
    </Shell>
  );
}

// The hard visual WALL between the habit half (Discover + Decide) and the execution funnel half
// (Pursue + Build + Win) — the load-bearing principle marker (Principle 01).
function Wall() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' }}>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,#334155)' }} />
      <div style={{ fontSize: 11.5, color: '#64748b', textAlign: 'center', letterSpacing: '.02em', flexShrink: 0, maxWidth: 520 }}>
        ── habit above · execution funnel below · a pursuit is far rarer than a save, by design ──
      </div>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#334155,transparent)' }} />
    </div>
  );
}

// A ranked bar-list for Product Intelligence (reuses the "Top strategies" bar house style).
function WinRankList({ title, rows, color }: { title: string; rows: WinRank[]; color: string }) {
  const max = rows[0]?.wins || 1;
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#475569' }}>No data</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{r.key}</span>
                <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{nfmt.format(r.wins)}</span>
              </div>
              <div style={{ height: 5, background: '#0f172a', borderRadius: 3 }}>
                <div style={{ height: 5, width: `${(r.wins / max) * 100}%`, background: color, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Intelligence-layer sub-components (Market Intelligence redesign) ──────────────────────────────
const LEVEL_STYLE: Record<Priority['level'], { bg: string; border: string; dot: string }> = {
  go:    { bg: 'rgba(62,207,142,.10)', border: 'rgba(62,207,142,.24)', dot: '#3ecf8e' },
  watch: { bg: 'rgba(232,177,58,.10)', border: 'rgba(232,177,58,.24)', dot: '#e8b13a' },
  stop:  { bg: 'rgba(240,97,109,.10)', border: 'rgba(240,97,109,.26)', dot: '#f0616d' },
};
function PriorityItem({ p }: { p: Priority }) {
  const st = LEVEL_STYLE[p.level];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 12, alignItems: 'start', padding: '12px 14px', borderRadius: 10, background: st.bg, border: `1px solid ${st.border}` }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', marginTop: 4, justifySelf: 'center', background: st.dot, boxShadow: `0 0 10px ${st.dot}88` }} />
      <div>
        <div style={{ fontSize: 14, fontWeight: 650, color: '#f1f5f9', marginBottom: 2 }}>{p.title}</div>
        <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{p.body}</div>
        <div style={{ fontSize: 12.5, color: '#7c8899', marginTop: 5 }}><span style={{ color: '#f5a623', fontWeight: 700 }}>&rarr; </span>{p.rec}</div>
      </div>
    </div>
  );
}
const PULSE_ICON: Record<string, string> = { new_opps: '▤', top_buyer: '▩', demand_mover: '⌂', recompetes: '▱', closing_soon: '◷' };
function PulseRow({ s }: { s: PulseSignal }) {
  const dcolor = s.dir === 'up' ? '#3ecf8e' : s.dir === 'down' ? '#f0616d' : '#94a3b8';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b' }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: '#1c2533', display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0, color: '#f5a623' }}>{PULSE_ICON[s.key] || '○'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: '#e8edf4', fontWeight: 550 }}>{s.label}</div>
        <div style={{ fontSize: 11.5, color: '#64748b' }}>{s.sub}</div>
      </div>
      {s.delta && <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 13, fontWeight: 600, color: dcolor, fontVariantNumeric: 'tabular-nums' }}>{s.delta}</span>}
    </div>
  );
}
function ConfRow({ label, pct, color }: { label: string; pct: number | null; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 44px', gap: 11, alignItems: 'center', fontSize: 12.5 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ height: 9, borderRadius: 99, background: '#0f172a', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct ?? 0}%`, background: color, borderRadius: 99 }} />
      </span>
      <span style={{ textAlign: 'right', color: '#e2e8f0', fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{pct == null ? '—' : `${pct}%`}</span>
    </div>
  );
}
function StrandRow({ strand, clicks, max }: { strand: string; clicks: number; max: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0', fontSize: 13 }}>
      <span style={{ flex: 1, color: '#cbd5e1' }}>{humanize(strand)}</span>
      <span style={{ width: 74, height: 6, borderRadius: 99, background: '#0f172a', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${(clicks / Math.max(1, max)) * 100}%`, background: '#f5a623', borderRadius: 99 }} />
      </span>
      <span style={{ width: 66, textAlign: 'right', color: '#e2e8f0', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{clicks} clicks</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-sans-serif,system-ui,-apple-system,sans-serif', padding: '28px 20px 60px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
function SectionHead({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div style={{ margin: '10px 0 12px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c3aed', fontWeight: 700 }}>{kicker}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#f1f5f9', marginTop: 2 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.45, maxWidth: 760 }}>{sub}</div>
    </div>
  );
}
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
function Stat({ value, label, sub2, color, big }: { value: string; label: string; sub2?: string; color?: string; big?: boolean }) {
  return (
    <div style={{ flex: big ? '1 1 180px' : '1 1 120px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 800, color: color || '#f1f5f9', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{label}</div>
      {sub2 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub2}</div>}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '18px 4px', fontSize: 13, color: '#64748b' }}>{children}</div>;
}

const S: Record<string, React.CSSProperties> = {
  eyebrow: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c3aed', fontWeight: 700 },
  h1: { fontSize: 24, fontWeight: 800, margin: '2px 0 0', color: '#f8fafc', letterSpacing: '-.01em' },
  muted: { color: '#64748b' },
  chip: { fontSize: 11, background: '#1e293b', color: '#cbd5e1', padding: '1px 6px', borderRadius: 4 },
  dropCallout: { marginTop: 14, padding: '10px 12px', background: '#b4530915', border: '1px solid #b4530944', borderRadius: 8, fontSize: 13, color: '#fcd9a8' },
  noteBox: { padding: '12px 14px', background: '#0b1120', border: '1px solid #1e293b', borderRadius: 10, fontSize: 13, color: '#94a3b8', marginBottom: 16 },
  errorBox: { padding: '12px 14px', background: '#7f1d1d22', border: '1px solid #7f1d1d', borderRadius: 10, fontSize: 13, color: '#fca5a5', marginBottom: 16 },
  segBtn: { padding: '5px 12px', fontSize: 13, border: 'none', background: 'transparent', color: '#94a3b8', borderRadius: 6, cursor: 'pointer', fontWeight: 600 },
  segBtnOn: { background: '#1e293b', color: '#f1f5f9' },
  btnGhost: { padding: '7px 14px', fontSize: 13, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  btnPrimary: { padding: '10px 14px', fontSize: 14, border: 'none', background: '#7c3aed', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700 },
  thNum: { padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tdNum: { padding: '6px 0', textAlign: 'right', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' },
};

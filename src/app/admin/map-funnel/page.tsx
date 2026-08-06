'use client';

/**
 * Admin: Journey Analytics — TWO loops, TWO lenses (Epic #1).
 *
 * The morning dashboard FOR ERIC over /api/admin/map-funnel. Reframed (per "The Mindy Principles" +
 * Working Backwards Q3'26) so discovery is NOT scored as a conversion funnel:
 *   - DISCOVERY (top) — browsing is the point; measured by RETURN + engagement, never conversion.
 *     The HEADLINE is the return-visit rate (Principle 02). NO red "biggest drop" on discovery steps
 *     (a low step ratio here is normal browsing, Principle 01), and NO left-column success metrics
 *     (clicks/pageviews/session/sign-ups). Plus the two PENDING ratios (alert→map, cards→listing).
 *   - EXECUTION (bottom) — the rare MINORITY path (a pursuit is far rarer than a save, and that is
 *     healthy). A legitimate conversion funnel; the drop callout lives HERE only, framed as
 *     "where execution stalls".
 *
 * Pure CSS/SVG bars (no chart lib), matching the /mcp usage-charts house style. Honest empty-states:
 * instrumented:false, ratio:null, ctr:null read as "no data yet", never a fabricated 0/0%.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface DiscoveryStep { step: string; label: string; users: number; events: number; ofPrev: number | null; ofTop: number | null }
interface ExecStep { step: string; label: string; users: number; events: number; convFromPrev: number | null; convFromTop: number | null }
interface StrategyCombo { combo: string; strands: string[]; users: number; applies: number }
interface StrandPop { strand: string; users: number }
interface WhyStrand { strand: string; impressions: number; clicks: number; ctr: number | null }
interface AlertToMap { capturable: boolean; instrumented: boolean; alertOpeners: number; reachedMap: number; ratio: number | null }
interface CardsToListing { instrumented: boolean; impressions: number; listingOpens: number; ratio: number | null }
interface FunnelData {
  ok: boolean; windowDays: number; instrumented: boolean; totalMapEvents: number; funnelReachedEvents: number;
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
    outcomes: { won: number; lost: number; no_bid: number; total: number; winRate: number | null };
  };
  strategy: { strategyFilterUsers: number; topStrategies: StrategyCombo[]; strandPopularity: StrandPop[] };
  whyThisOpportunity: { minImpressions: number; strands: WhyStrand[] };
  note: string;
}

// Turn a snake_case strand/step key into a human label ("repeat_buyer" → "Repeat Buyer").
const humanize = (k: string) => k.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const nfmt = new Intl.NumberFormat('en-US');
const pct = (v: number | null) => (v == null ? 'no data yet' : `${v}%`);
// A metric that is genuinely unmeasured (null) reads "no data yet", never a fabricated 0.
const numOrNA = (v: number | null) => (v == null ? '—' : nfmt.format(v));

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
          <h1 style={{ ...S.h1, fontSize: 20 }}>Journey Analytics — admin</h1>
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
          <div style={S.eyebrow}>Today&apos;s Product · {today}</div>
          <h1 style={S.h1}>Journey Analytics &mdash; two loops: discovery (engagement) &amp; execution (the minority funnel)</h1>
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

      {data && disc && exec && (
        <>
          {/* ══════════ DISCOVERY LOOP — browsing is the point; measured by return, not conversion. ══════════ */}
          <SectionHead
            kicker="Loop 1 · Discovery"
            title="Discovery — browsing is the point; measured by return, not conversion"
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

          {/* Engagement volume — listings opened / shared / saved (the right-column "THESE" metrics). */}
          <Card title="Engagement — what we optimise for" sub="Listings opened, shared, and saved — shown as engagement VOLUME, not as funnel conversion rates.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <Stat value={nfmt.format(disc.engagement.listingsOpened.users)} label="Listings opened" sub2={`${nfmt.format(disc.engagement.listingsOpened.events)} opens`} />
              <Stat value={nfmt.format(disc.engagement.listingsShared.users)} label="Listings shared" sub2={`${nfmt.format(disc.engagement.listingsShared.events)} shares`} />
              <Stat value={nfmt.format(disc.engagement.saved.users)} label="Saved" sub2={`${nfmt.format(disc.engagement.saved.events)} saves`} />
            </div>
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
                      {i === 0 ? 'start' : `${pct(s.ofPrev)} of prior`}
                    </div>
                  </div>
                );
              })}
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

          {/* ══════════ EXECUTION LOOP — the rare minority path; a legitimate funnel. ══════════ */}
          <div style={{ height: 8 }} />
          <SectionHead
            kicker="Loop 2 · Execution"
            title="Execution — the minority path (and that is healthy)"
            sub="A pursuit is far rarer than a save — most discovery never becomes a bid, by design (Principle 01). These are the few who chose to act, so small numbers + steep drops are EXPECTED. Here a stall is real, so the drop callout is scoped to execution only."
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

          <p style={{ ...S.muted, fontSize: 12, marginTop: 18 }}>{data.note}</p>
        </>
      )}
    </Shell>
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

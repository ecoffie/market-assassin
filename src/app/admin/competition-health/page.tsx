'use client';

/**
 * Admin: Competition Health — the buyer-side mirror of Market Intelligence.
 *
 * A procurement director's scorecard for one agency, insight-first (same dark console + priority
 * cards as /admin/map-funnel). Every metric is grounded in real data or honestly flagged "Coming".
 * Admin-previewable (Phase 1); a gated per-agency buyer entry is Phase 3 (PRD).
 */

import { FormEvent, useCallback, useEffect, useState } from 'react';

interface Priority { level: 'go' | 'watch' | 'stop'; title: string; body: string; rec: string }
interface Health {
  agency: string; windowDays: number; grounded: boolean;
  smallBizParticipation: { activeOpps: number; withSetAside: number; pct: number | null };
  setAsideMix: { label: string; count: number }[];
  awardedSetAsideMix: { label: string; count: number }[];
  marketCoverage: { distinctNaics: number; topNaics: { naics: string; opps: number }[] };
  winners: {
    awardsWithAwardee: number; distinctWinners: number;
    topWinners: { name: string; total: number; awards: number }[];
    firstTimeVendors: number | null; concentrationPct: number | null;
  };
  competitionDepth: {
    resolvedAgency: string | null; grounded: boolean; sampled: number; sampledWithData: number;
    avgBidders: number | null; medianBidders: number | null;
    singleBidCount: number; singleBidPct: number | null; note: string;
    strength: 'insufficient' | 'limited' | 'sampled' | 'strong';
    singleBidMoe: number | null; singleBidPlain: string | null;
  };
  notYetMeasurable: { metric: string; needs: string }[];
}
interface CHData { ok: boolean; agency: string; windowDays: number; todaysPriorities: Priority[]; health: Health; note: string }

// A few common agencies for the quick-switch (the admin preview; the buyer version is scoped to one).
/**
 * Ordered by REAL active-solicitation volume (measured 2026-08-15 against `sam_opportunities`),
 * not by reputation — so the picker opens on the buyers that actually have a market.
 *
 * The original six omitted INTERIOR (1,583 active opps — the #3 buyer in the whole dataset),
 * STATE (787), COMMERCE (589) and JUSTICE (488), so several genuinely large agencies simply
 * weren't trackable here.
 *
 * ⚠️ Every entry must resolve through `resolveToptier` in `src/lib/analytics/competition-depth.ts`
 * — either via its TOPTIER map or the "X, DEPARTMENT OF" regex fallback — or the card silently
 * loses competition depth (the sampler refuses rather than risk sampling the WRONG buyer's
 * awards). All thirteen below were verified end-to-end before being added: each returned
 * grounded=true with a real offers sample. COMMERCE has no TOPTIER entry and resolves via the
 * regex — verified: "Department of Commerce", 40 awards, 2.8 avg bidders.
 *
 * Deliberately NOT included: the long tail under ~200 active opps (EPA 75, Treasury 65, Labor 31,
 * SSA 16…). A 60-award sample from a buyer that small is mostly noise, and MIN_SAMPLE would
 * often refuse anyway — an empty card teaches nothing.
 */
const AGENCIES = [
  'DEPT OF DEFENSE',                                // 23,708 active
  'VETERANS AFFAIRS, DEPARTMENT OF',                //  3,271
  'INTERIOR, DEPARTMENT OF THE',                    //  1,583
  'AGRICULTURE, DEPARTMENT OF',                     //    998
  'HOMELAND SECURITY, DEPARTMENT OF',               //    936
  'STATE, DEPARTMENT OF',                           //    787
  'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',       //    759
  'COMMERCE, DEPARTMENT OF',                        //    589 (resolves via regex fallback)
  'JUSTICE, DEPARTMENT OF',                         //    488
  'GENERAL SERVICES ADMINISTRATION',                //    408
  'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION',  //    334
  'ENERGY, DEPARTMENT OF',                          //    324
  'TRANSPORTATION, DEPARTMENT OF',                  //    209
];
const shortAgency = (a: string) => a.split(',')[0].replace(/DEPT OF /i, '').replace(/DEPARTMENT OF /i, '').trim();

export default function CompetitionHealthDashboard() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [agency, setAgency] = useState(AGENCIES[0]);
  const [data, setData] = useState<CHData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = sessionStorage.getItem('adminPassword');
      if (!stored) { if (!cancelled) setChecking(false); return; }
      try {
        const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: stored }) });
        const d = await r.json();
        if (cancelled) return;
        if (d.valid || d.success) { setAuthed(true); setPassword(stored); }
        else sessionStorage.removeItem('adminPassword');
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
      if (d.valid || d.success) { sessionStorage.setItem('adminPassword', pwInput); setPassword(pwInput); setAuthed(true); }
      else setAuthError('Invalid admin password');
    } catch { setAuthError('Could not verify. Try again.'); }
  }, [pwInput]);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true); setLoadError('');
    try {
      const r = await fetch(`/api/admin/competition-health?password=${encodeURIComponent(password)}&agency=${encodeURIComponent(agency)}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d as CHData);
    } catch (err) { setLoadError(err instanceof Error ? err.message : 'Load failed'); setData(null); }
    finally { setLoading(false); }
  }, [password, agency]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  if (checking) return <Shell><p style={{ color: '#64748b' }}>Checking access…</p></Shell>;
  if (!authed) {
    return (
      <Shell>
        <form onSubmit={login} style={{ maxWidth: 340, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>Competition Health — admin</h1>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
          <button type="submit" style={{ padding: '10px 14px', border: 'none', background: '#6366f1', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Enter</button>
          {authError && <p style={{ color: '#f87171', fontSize: 13 }}>{authError}</p>}
        </form>
      </Shell>
    );
  }

  const h = data?.health;
  const sb = h?.smallBizParticipation;
  const mixMax = h && h.setAsideMix.length ? h.setAsideMix[0].count : 1;
  const awMax = h && h.awardedSetAsideMix.length ? h.awardedSetAsideMix[0].count : 1;

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <a href="/admin/map-funnel" style={{ fontSize: 12, color: '#64748b', textDecoration: 'none', display: 'inline-block', marginBottom: 4 }}>&larr; Market Intelligence (contractor view)</a>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6366f1', fontWeight: 700 }}>Mindy · Buyer mirror · procurement scorecard</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '2px 0 0', color: '#f8fafc', letterSpacing: '-.01em' }}>Competition Health</h1>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, maxWidth: 680 }}>Is this buyer&apos;s market competitive and healthy? The same intelligence platform, a procurement director&apos;s lens. (Admin preview — the gated per-agency buyer entry is Phase 3.)</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={agency} onChange={(e) => setAgency(e.target.value)}
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, cursor: 'pointer' }}>
            {AGENCIES.map((a) => <option key={a} value={a}>{shortAgency(a)}</option>)}
          </select>
          <button onClick={load} disabled={loading} style={{ padding: '7px 14px', fontSize: 13, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>{loading ? '…' : '↻ Refresh'}</button>
        </div>
      </div>

      {loadError && <div style={{ padding: '12px 14px', background: '#7f1d1d22', border: '1px solid #7f1d1d', borderRadius: 10, fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>Couldn&apos;t load: {loadError}</div>}

      {data && h && (
        <>
          {/* TODAY'S PRIORITIES */}
          {data.todaysPriorities.length > 0 && (
            <div style={{ background: 'linear-gradient(160deg,#131b28,#0b1120)', border: '1px solid #2a3547', borderRadius: 14, padding: '18px 20px', marginBottom: 18, boxShadow: '0 18px 44px rgba(0,0,0,.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f5a623', boxShadow: '0 0 10px rgba(245,166,35,.5)' }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>The director&apos;s read — {shortAgency(h.agency)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.todaysPriorities.map((p, i) => <PriorityItem key={i} p={p} />)}
              </div>
            </div>
          )}

          {/* SUPPLIER HEALTH + DIVERSITY */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
            <Card title="Small-business participation" sub="% of active solicitations carrying a set-aside — the number a procurement director is graded on.">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#3ecf8e', fontVariantNumeric: 'tabular-nums' }}>{sb?.pct == null ? '—' : `${Math.round(sb.pct)}%`}</span>
                {/* EXACT, not sampled — a head-count over every active solicitation. The chip is
                    the contrast that makes the SAMPLED depth card legible as a different kind of
                    number rather than a less trustworthy one. */}
                <Provenance kind="exact" />
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                <b style={{ color: '#e2e8f0' }}>{sb?.withSetAside.toLocaleString()}</b> of <b style={{ color: '#e2e8f0' }}>{sb?.activeOpps.toLocaleString()}</b> active solicitations carry a set-aside · buying across <b style={{ color: '#e2e8f0' }}>{h.marketCoverage.distinctNaics}</b> NAICS.
              </div>
              {h.setAsideMix.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', marginBottom: 8 }}>Set-aside mix · open notices</div>
                  {h.setAsideMix.map((m) => <MixRow key={m.label} label={m.label} count={m.count} max={mixMax} color="#6366f1" />)}
                </div>
              )}
            </Card>

            <Card title="Award record · who actually won" sub="Set-aside mix from the recompete/award record (set_aside_enriched) — stronger signal than open notices.">
              {h.awardedSetAsideMix.length === 0 ? (
                <div style={{ padding: '18px 4px', fontSize: 13, color: '#64748b' }}>No enriched award set-aside data for this agency yet.</div>
              ) : (
                <div>
                  {h.awardedSetAsideMix.map((m) => <MixRow key={m.label} label={m.label} count={m.count} max={awMax} color="#3ecf8e" />)}
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 10, paddingTop: 9, borderTop: '1px solid #1e293b' }}>
                    Compare open-notice intent (left) against what was actually awarded — a gap between them is a real competition signal.
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* MARKET COVERAGE */}
          {h.marketCoverage.topNaics.length > 0 && (
            <Card title="Market coverage · where the buying concentrates" sub="Top NAICS by active-solicitation volume — is competition spread, or piled into a few codes?">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {h.marketCoverage.topNaics.map((n, i) => (
                  <div key={n.naics} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < h.marketCoverage.topNaics.length - 1 ? '1px solid #1e293b' : 'none', fontSize: 13 }}>
                    <span style={{ width: 18, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: '#64748b' }}>{i + 1}</span>
                    <span style={{ flex: 1, color: '#cbd5e1', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12.5 }}>{n.naics}</span>
                    <span style={{ width: 90, height: 6, borderRadius: 99, background: '#0f172a', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${(n.opps / h.marketCoverage.topNaics[0].opps) * 100}%`, background: '#6366f1', borderRadius: 99 }} />
                    </span>
                    <span style={{ width: 60, textAlign: 'right', color: '#e2e8f0', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{n.opps} opps</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* WHO WON — the award record (awardee name + $ from PR #1062 backfill) */}
          {h.winners.distinctWinners > 0 && (
            <Card title="Who won · the award record" sub={`Recent winners at this buyer — name + $ from the award notices. ${h.winners.awardsWithAwardee.toLocaleString()} awards, ${h.winners.distinctWinners.toLocaleString()} distinct firms.`}>
              {/* KPI strip */}
              <div style={{ marginBottom: 8 }}><Provenance kind="exact" /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <Kpi value={h.winners.distinctWinners.toLocaleString()} label="distinct winners" />
                <Kpi value={h.winners.firstTimeVendors == null ? '—' : String(h.winners.firstTimeVendors)} label="first-time (top 15)" color="#3ecf8e" />
                <Kpi value={h.winners.concentrationPct == null ? '—' : `${h.winners.concentrationPct}%`} label="top-3 share of $" color={h.winners.concentrationPct != null && h.winners.concentrationPct >= 60 ? '#e8b13a' : '#e2e8f0'} />
              </div>
              {/* top winners by $ */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {h.winners.topWinners.map((w, i) => (
                  <div key={w.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < h.winners.topWinners.length - 1 ? '1px solid #1e293b' : 'none', fontSize: 13 }}>
                    <span style={{ width: 18, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: '#64748b' }}>{i + 1}</span>
                    <span style={{ flex: 1, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                    {w.awards > 1 && <span style={{ fontSize: 11, color: '#64748b' }}>{w.awards} awards</span>}
                    <span style={{ width: 76, textAlign: 'right', color: '#e2e8f0', fontWeight: 600, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(w.total)}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 10, paddingTop: 9, borderTop: '1px solid #1e293b' }}>
                Windowed on notice posting date (the award-date field has parse errors in the source backfill). Amounts as reported on the award notice.
              </div>
            </Card>
          )}

          {/* COMPETITION DEPTH — NOW LIVE (avg bidders + single-bid rate from the award detail endpoint) */}
          <Card title="Competition depth · average bidders" sub="How many firms actually bid on this buyer's awards — the marquee competition metric. Sampled from the award record.">
            {/* PROVE THE BUYER: show exactly which USASpending agency was sampled, so a wrong
                name/mapping is visible instead of silent. Null = we refused to guess an agency. */}
            {h.competitionDepth.resolvedAgency && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', fontWeight: 700 }}>Sampled from</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600, background: 'rgba(62,207,142,.08)', border: '1px solid rgba(62,207,142,.20)', borderRadius: 6, padding: '2px 8px' }}>{h.competitionDepth.resolvedAgency}</span>
                <span style={{ color: '#64748b' }}>· USASpending awarding agency (FPDS offers-received)</span>
              </div>
            )}
            {!h.competitionDepth.grounded ? (
              <div style={{ padding: '14px 4px', fontSize: 13, color: '#64748b' }}>{h.competitionDepth.note}</div>
            ) : (
              <>
                {/* THE EXECUTIVE READ FIRST — a plain band, not a decimal.
                    Eric 2026-08-22: "47.9% can be mathematically accurate for those 48
                    observations while still communicating more certainty than the evidence
                    warrants." At n=48 the 95% CI on 47.9% is ~±14 points. So the headline is
                    "About half"; the exact value stays below it for analysts. */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 30, fontWeight: 700, color: h.competitionDepth.singleBidPct != null && h.competitionDepth.singleBidPct >= 40 ? '#e8b13a' : '#3ecf8e', lineHeight: 1.15 }}>
                    {h.competitionDepth.singleBidPlain ?? '—'}
                  </div>
                  <div style={{ fontSize: 13.5, color: '#cbd5e1', marginTop: 3 }}>
                    of sampled recent awards received one or fewer offers
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                    Observed single-bid rate: <b style={{ color: '#94a3b8' }}>{h.competitionDepth.singleBidPct == null ? '—' : `${Math.round(h.competitionDepth.singleBidPct)}%`}</b>
                    {' '}(n={h.competitionDepth.sampledWithData}
                    {h.competitionDepth.singleBidMoe != null ? `, \u00b1${Math.round(h.competitionDepth.singleBidMoe)} pts` : ''})
                    {' · '}
                    <b style={{ color: '#94a3b8' }}>~{h.competitionDepth.avgBidders}</b> average offers
                    {' · '}median <b style={{ color: '#94a3b8' }}>{h.competitionDepth.medianBidders}</b>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                    <Provenance kind="sampled" n={h.competitionDepth.sampledWithData} strength={h.competitionDepth.strength} of={h.competitionDepth.sampled} />
                  </div>
                </div>
                {h.competitionDepth.singleBidPct != null && h.competitionDepth.singleBidPct >= 40 && (
                  <div style={{ fontSize: 13, color: '#e2e8f0', background: 'rgba(232,177,58,.10)', border: '1px solid rgba(232,177,58,.24)', borderRadius: 9, padding: '10px 13px', marginBottom: 10 }}>
                    <b style={{ color: '#e8b13a' }}>Roughly {Math.round(h.competitionDepth.singleBidPct)}% of sampled awards drew ≤1 bidder.</b> These are under-competed markets — the ones where broadening outreach (Rule-of-Two set-asides, industry days) most improves price and participation.
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#64748b', paddingTop: 4 }}>{h.competitionDepth.note}</div>
              </>
            )}
          </Card>

          {/* What's still honestly deferred (supplier reach — needs event agency-tagging) */}
          {h.notYetMeasurable.length > 0 && (
            <div style={{ background: '#0b1120', border: '1px dashed #334155', borderRadius: 14, padding: '16px 20px', marginTop: 4 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#e8b13a', fontWeight: 700, marginBottom: 8 }}>Still coming</div>
              {h.notYetMeasurable.map((m) => (
                <div key={m.metric} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, fontSize: 12.5, padding: '8px 0', borderTop: '1px solid #1e293b' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.metric}</span>
                  <span style={{ color: '#64748b' }}>{m.needs}</span>
                </div>
              ))}
            </div>
          )}

          <p style={{ color: '#64748b', fontSize: 12, marginTop: 18 }}>{data.note}</p>
        </>
      )}
    </Shell>
  );
}

// ── components (mirror the Market Intelligence house style) ──
const LEVEL: Record<Priority['level'], { bg: string; border: string; dot: string }> = {
  go: { bg: 'rgba(62,207,142,.10)', border: 'rgba(62,207,142,.24)', dot: '#3ecf8e' },
  watch: { bg: 'rgba(232,177,58,.10)', border: 'rgba(232,177,58,.24)', dot: '#e8b13a' },
  stop: { bg: 'rgba(240,97,109,.10)', border: 'rgba(240,97,109,.26)', dot: '#f0616d' },
};
function PriorityItem({ p }: { p: Priority }) {
  const st = LEVEL[p.level];
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
function MixRow({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0', fontSize: 13 }}>
      <span style={{ width: 130, color: '#cbd5e1' }}>{label}</span>
      <span style={{ flex: 1, height: 7, borderRadius: 99, background: '#0f172a', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${(count / Math.max(1, max)) * 100}%`, background: color, borderRadius: 99 }} />
      </span>
      <span style={{ width: 44, textAlign: 'right', color: '#e2e8f0', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  );
}
const fmtMoney = (n: number) => {
  if (!n) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n / 1e9 >= 100 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n / 1e6 >= 100 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
};
/**
 * PROVENANCE CHIP — says how much weight a number should carry, without methodology.
 *
 * Eric, 2026-08-22, on this page reading as not credible: "make the distinction between
 * exact and sampled visually explicit... It teaches the procurement director how much
 * confidence to place in each number without forcing them to read methodology."
 *
 * EXACT   = a head-count over the whole population (1,470 of 3,240 solicitations).
 * SAMPLED = an observation over n awards, with the strength of that n stated.
 *
 * Strength tiers are deliberately SEPARATE from MIN_SAMPLE. MIN_SAMPLE is the epistemic
 * floor (below it we do not report at all); this is "given that we can report, how strong
 * is the evidence" — a sample can be valid enough to observe and still too thin to headline.
 */
function Provenance({ kind, n, of, strength }: {
  kind: 'exact' | 'sampled';
  n?: number;
  of?: number;
  strength?: 'insufficient' | 'limited' | 'sampled' | 'strong';
}) {
  const LABEL: Record<string, string> = {
    insufficient: 'Insufficient evidence',
    limited: 'Limited observation',
    sampled: 'Sampled',
    strong: 'Strong sample',
  };
  const tone = kind === 'exact'
    ? { fg: '#3ecf8e', bg: 'rgba(62,207,142,.10)', bd: 'rgba(62,207,142,.22)' }
    : strength === 'strong'
      ? { fg: '#7dd3fc', bg: 'rgba(125,211,252,.10)', bd: 'rgba(125,211,252,.22)' }
      : { fg: '#e8b13a', bg: 'rgba(232,177,58,.10)', bd: 'rgba(232,177,58,.22)' };
  const head = kind === 'exact' ? 'Exact' : LABEL[strength ?? 'sampled'];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 700, color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 5, padding: '2px 7px' }}>
      {head}
      {kind === 'sampled' && n != null && (
        <span style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'none', letterSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
          n={n}{of != null ? ` of ${of}` : ''} with offer counts
        </span>
      )}
    </span>
  );
}

function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ flex: '1 1 90px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || '#f1f5f9', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{label}</div>
    </div>
  );
}
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
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
